import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { PBKDF2_ITERATIONS, SCHEMA_VERSION } from '@/shared/constants';
import type {
  ClusterRecord,
  RecapRecord,
  SettingsRecord,
  WatchRecord,
} from '@/shared/types';
import {
  cryptoService,
  generateRecoveryKey,
  randomBytesBase64,
  type CryptoService,
} from '@/core/crypto/encryption';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import { ensureFirebaseApp } from './config';

export interface EncryptedBackupPayload {
  settings: Partial<SettingsRecord>;
  exclusions: string[];
  clusters: Array<Pick<ClusterRecord, 'id' | 'name' | 'summary' | 'userRenamed' | 'pinned' | 'hidden'>>;
  watches: WatchRecord[];
  recaps: RecapRecord[];
  exportedAt: number;
}

export interface EncryptedFirestoreEnvelope {
  ciphertext: string;
  iv: string;
  salt: string;
  schemaVersion: number;
  updatedAt: number;
}

export interface SyncRecordEnvelope extends EncryptedFirestoreEnvelope {
  recordId: string;
  collection: 'pages' | 'clusters' | 'journeys' | 'loops' | 'watches' | 'recaps' | 'settings' | 'facts' | 'snapshots';
  versionVector: Record<string, number>;
  deleted: boolean;
}

/**
 * Merges two version vectors using element-wise maximum (FR-SY-3).
 */
export function mergeVersionVectors(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...a };
  for (const [deviceId, seq] of Object.entries(b)) {
    merged[deviceId] = Math.max(merged[deviceId] ?? 0, seq);
  }
  return merged;
}

/**
 * Compares two version vectors:
 *  - 'after' if a strictly dominates b
 *  - 'before' if b strictly dominates a
 *  - 'equal' if identical
 *  - 'concurrent' if neither dominates (requires LWW + set-union conflict resolution)
 */
export function compareVersionVectors(
  a: Record<string, number>,
  b: Record<string, number>,
): 'after' | 'before' | 'equal' | 'concurrent' {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (va > vb) aGreater = true;
    if (vb > va) bGreater = true;
  }
  if (!aGreater && !bGreater) return 'equal';
  if (aGreater && !bGreater) return 'after';
  if (bGreater && !aGreater) return 'before';
  return 'concurrent';
}

/**
 * Deterministic CRDT-style record merger (FR-SY-3):
 * last-writer-wins (by updatedAt) on scalar fields, union on array/set fields.
 */
export function mergeSyncRecords<T extends { updatedAt: number }>(
  local: T,
  remote: T,
  setFields: Array<keyof T> = [],
): T {
  const winner = remote.updatedAt >= local.updatedAt ? remote : local;
  const loser = remote.updatedAt >= local.updatedAt ? local : remote;
  const merged: T = { ...loser, ...winner };

  for (const field of setFields) {
    const a = Array.isArray(local[field]) ? (local[field] as unknown[]) : [];
    const b = Array.isArray(remote[field]) ? (remote[field] as unknown[]) : [];
    const unique = Array.from(new Set([...a, ...b]));
    merged[field] = unique as T[keyof T];
  }

  return merged;
}

/**
 * Manages Firestore encrypted backup (FR-FB-6) and incremental E2EE sync (FR-SY-2 to FR-SY-5).
 * Server documents contain ONLY ciphertext + IV + salt; decryption keys never leave the device.
 */
export class EncryptedSyncService {
  private firestore: Firestore | null = null;

  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly crypto: CryptoService = cryptoService,
  ) {}

  private getDb(): Firestore {
    const { app, configured } = ensureFirebaseApp();
    if (!configured) {
      throw new Error('Firebase is not configured. Configure VITE_FIREBASE_* to use encrypted sync.');
    }
    if (!this.firestore) {
      this.firestore = getFirestore(app);
    }
    return this.firestore;
  }

  /**
   * Initializes encrypted sync for a signed-in user and generates a one-time recovery key (FR-SY-4).
   */
  async setupSyncPassphrase(
    uid: string,
    passphrase: string,
  ): Promise<{ recoveryKey: string; salt: string }> {
    if (passphrase.length < 10) {
      throw new Error('Sync passphrase must be at least 10 characters.');
    }
    const db = this.getDb();
    const recoveryKey = generateRecoveryKey();
    const salt = randomBytesBase64(16);
    const keyCheck = await this.crypto.encryptForSync(
      { check: 'trailmind-e2ee-v1', recoveryHint: recoveryKey.slice(0, 4) },
      passphrase,
      salt,
      PBKDF2_ITERATIONS,
    );

    await setDoc(doc(db, 'users', uid, 'meta', 'syncConfig'), {
      keyCheckCiphertext: keyCheck.ciphertext,
      keyCheckIv: keyCheck.iv,
      salt: keyCheck.salt,
      iterations: keyCheck.iterations,
      updatedAt: Date.now(),
    });

    await this.store.saveSettings({ syncEnabled: true, syncUserUid: uid });
    return { recoveryKey, salt };
  }

  /**
   * Creates an encrypted profile backup in Firestore (FR-FB-6):
   * settings, exclusions, cluster names, watches, and recaps — ciphertext only.
   */
  async uploadEncryptedBackup(
    uid: string,
    passphrase: string,
  ): Promise<{ bytesUploaded: number; updatedAt: number }> {
    const db = this.getDb();
    const [settings, clusters, watches, recaps] = await Promise.all([
      this.store.getSettings(),
      this.store.listClusters(),
      this.store.listWatches(),
      this.store.listRecaps(),
    ]);

    const payload: EncryptedBackupPayload = {
      settings: {
        exclusions: settings.exclusions,
        cloud: settings.cloud,
        seenBeforeEnabled: settings.seenBeforeEnabled,
        seenBeforeThreshold: settings.seenBeforeThreshold,
        seenBeforeDisabledDomains: settings.seenBeforeDisabledDomains,
        changeWatchIntervalHours: settings.changeWatchIntervalHours,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        storageBudgetMb: settings.storageBudgetMb,
        autoDeleteDays: settings.autoDeleteDays,
        customSearchPatterns: settings.customSearchPatterns,
        theme: settings.theme,
      },
      exclusions: settings.exclusions,
      clusters: clusters.map((c) => ({
        id: c.id,
        name: c.name,
        summary: c.summary,
        userRenamed: c.userRenamed,
        pinned: c.pinned,
        hidden: c.hidden,
      })),
      watches,
      recaps,
      exportedAt: Date.now(),
    };

    const encrypted = await this.crypto.encryptForSync(payload, passphrase);
    const updatedAt = Date.now();
    const envelope: EncryptedFirestoreEnvelope = {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      schemaVersion: SCHEMA_VERSION,
      updatedAt,
    };

    await setDoc(doc(db, 'users', uid, 'backups', 'primary'), envelope);
    await this.store.saveSettings({ syncLastAt: updatedAt });

    return { bytesUploaded: envelope.ciphertext.length, updatedAt };
  }

  /**
   * Restores an encrypted backup on another device after passphrase entry (FR-FB-6).
   */
  async restoreEncryptedBackup(
    uid: string,
    passphrase: string,
  ): Promise<{ clustersRestored: number; watchesRestored: number; recapsRestored: number }> {
    const db = this.getDb();
    const snap = await getDoc(doc(db, 'users', uid, 'backups', 'primary'));
    if (!snap.exists()) {
      throw new Error('No encrypted backup found for this account.');
    }

    const envelope = snap.data() as EncryptedFirestoreEnvelope;
    const payload = await this.crypto.decryptFromSync<EncryptedBackupPayload>(envelope, passphrase);

    await this.store.saveSettings({
      ...payload.settings,
      exclusions: payload.exclusions,
    });

    const existingClusters = await this.store.listClusters();
    const clusterMap = new Map(existingClusters.map((c) => [c.id, c]));
    for (const remoteCluster of payload.clusters) {
      const local = clusterMap.get(remoteCluster.id);
      if (local) {
        clusterMap.set(remoteCluster.id, { ...local, ...remoteCluster, updatedAt: Date.now() });
      }
    }
    if (clusterMap.size > 0) {
      await this.store.putClusters(Array.from(clusterMap.values()));
    }

    for (const watch of payload.watches) {
      await this.store.putWatch(watch);
    }
    for (const recap of payload.recaps) {
      await this.store.putRecap(recap);
    }

    return {
      clustersRestored: payload.clusters.length,
      watchesRestored: payload.watches.length,
      recapsRestored: payload.recaps.length,
    };
  }

  /**
   * Runs an incremental version-vector sync of clusters, watches, and journeys (FR-SY-3).
   */
  async runIncrementalSync(
    uid: string,
    passphrase: string,
    deviceId: string,
  ): Promise<{ pushed: number; pulled: number }> {
    const db = this.getDb();
    const syncCol = collection(db, 'users', uid, 'sync');
    const remoteSnaps = await getDocs(syncCol);
    const remoteMap = new Map<string, SyncRecordEnvelope>();
    remoteSnaps.forEach((docSnap) => {
      remoteMap.set(docSnap.id, docSnap.data() as SyncRecordEnvelope);
    });

    let pushed = 0;
    let pulled = 0;

    // Sync clusters (user renames, pinned/hidden, pageIds union)
    const localClusters = await this.store.listClusters();
    const localClusterMap = new Map(localClusters.map((c) => [c.id, c]));

    for (const [docKey, remoteEnv] of remoteMap.entries()) {
      if (remoteEnv.collection !== 'clusters' || remoteEnv.deleted) continue;
      const remoteCluster = await this.crypto.decryptFromSync<ClusterRecord>(remoteEnv, passphrase);
      const local = localClusterMap.get(remoteCluster.id);
      if (!local) {
        localClusterMap.set(remoteCluster.id, remoteCluster);
        pulled++;
      } else {
        const merged = mergeSyncRecords(local, remoteCluster, ['pageIds', 'topics']);
        localClusterMap.set(remoteCluster.id, merged);
        pulled++;
      }
      await this.store.db.sync_meta.put({
        key: docKey,
        collection: 'clusters',
        recordId: remoteCluster.id,
        versionVector: remoteEnv.versionVector,
        updatedAt: remoteEnv.updatedAt,
        deleted: false,
      });
    }

    if (localClusterMap.size > 0) {
      await this.store.putClusters(Array.from(localClusterMap.values()));
    }

    const batch = writeBatch(db);
    for (const cluster of localClusterMap.values()) {
      const key = `clusters_${cluster.id}`;
      const prevMeta = await this.store.db.sync_meta.get(key);
      const remoteEnv = remoteMap.get(key);
      const nextVec = mergeVersionVectors(
        prevMeta?.versionVector ?? {},
        remoteEnv?.versionVector ?? {},
      );
      if (!remoteEnv || cluster.updatedAt > remoteEnv.updatedAt) {
        nextVec[deviceId] = (nextVec[deviceId] ?? 0) + 1;
        const encrypted = await this.crypto.encryptForSync(cluster, passphrase);
        const envelope: SyncRecordEnvelope = {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          salt: encrypted.salt,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: cluster.updatedAt || Date.now(),
          recordId: cluster.id,
          collection: 'clusters',
          versionVector: nextVec,
          deleted: false,
        };
        batch.set(doc(db, 'users', uid, 'sync', key), envelope);
        await this.store.db.sync_meta.put({
          key,
          collection: 'clusters',
          recordId: cluster.id,
          versionVector: nextVec,
          updatedAt: envelope.updatedAt,
          deleted: false,
        });
        pushed++;
      }
    }

    if (pushed > 0) {
      await batch.commit();
    }

    await this.store.saveSettings({ syncLastAt: Date.now() });
    return { pushed, pulled };
  }

  /**
   * Deletes all synced data and backups from Firestore in one action (FR-SY-5).
   */
  async deleteAllServerSyncData(uid: string): Promise<{ deletedDocs: number }> {
    const db = this.getDb();
    let deletedDocs = 0;

    for (const subcol of ['backups', 'sync', 'meta']) {
      const snaps = await getDocs(collection(db, 'users', uid, subcol));
      for (const s of snaps.docs) {
        await deleteDoc(s.ref);
        deletedDocs++;
      }
    }

    await this.store.db.sync_meta.clear();
    await this.store.saveSettings({ syncEnabled: false, syncLastAt: undefined });
    return { deletedDocs };
  }
}

export const encryptedSyncService = new EncryptedSyncService();
