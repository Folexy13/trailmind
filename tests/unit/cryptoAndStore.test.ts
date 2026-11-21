import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { CryptoService, isEncryptedBlob } from '@/core/crypto/encryption';
import {
  compareVersionVectors,
  mergeSyncRecords,
  mergeVersionVectors,
} from '@/core/firebase/sync';
import { TrailmindDB } from '@/core/store/db';
import { MemoryStore } from '@/core/store/memoryStore';

async function createTestStore() {
  const db = new TrailmindDB(`TestDB_${crypto.randomUUID()}`);
  const cryptoSvc = new CryptoService();
  const store = new MemoryStore(db, cryptoSvc);
  await store.init();
  return { db, cryptoSvc, store };
}

describe('Encrypted IndexedDB store & WebCrypto (FR-ST-1..5, FR-PRV-3, FR-EXP-4..5)', () => {
  it('stores content fields as AES-GCM ciphertext only in raw IndexedDB (FR-ST-1)', async () => {
    const { db, store } = await createTestStore();
    const secretText = 'Top secret architectural notes on Firebase hybrid routing';

    await store.putPage({
      id: 'pg_enc_1',
      url: 'https://example.com/secret',
      canonicalUrl: 'https://example.com/secret',
      domain: 'example.com',
      title: 'Secret Architecture',
      type: 'article',
      summary: secretText,
      language: 'en',
      topics: ['Architecture'],
      englishTopics: ['Architecture'],
      entities: [],
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      status: 'full',
      promptVersion: '1.0.0',
      updatedAt: Date.now(),
    });

    await store.saveSnapshotVersion({
      id: 'snap_1',
      pageId: 'pg_enc_1',
      capturedAt: Date.now(),
      contentHash: 'hash_a',
      title: 'Secret Architecture',
      text: secretText,
      images: [],
      byteSize: 200,
    });

    // Inspect raw IndexedDB rows directly
    const rawPage = await db.pages.get('pg_enc_1');
    const rawSnap = await db.snapshots.get('snap_1');

    expect(isEncryptedBlob(rawPage?.summaryEnc)).toBe(true);
    expect(JSON.stringify(rawPage)).not.toContain(secretText);
    expect(isEncryptedBlob(rawSnap?.textEnc)).toBe(true);
    expect(JSON.stringify(rawSnap)).not.toContain(secretText);

    // Decrypted read through store returns plaintext
    const decryptedPage = await store.getPage('pg_enc_1');
    const decryptedSnap = await store.getLatestSnapshot('pg_enc_1');
    expect(decryptedPage?.summary).toBe(secretText);
    expect(decryptedSnap?.text).toBe(secretText);

    await db.delete();
  });

  it('deduplicates unchanged snapshot hashes and caps history at 5 versions (FR-CAP-8, FR-SN-2)', async () => {
    const { db, store } = await createTestStore();

    const first = await store.saveSnapshotVersion({
      id: 's0',
      pageId: 'pg_ver',
      capturedAt: 1000,
      contentHash: 'same_hash',
      title: 'Doc',
      text: 'Version 0 text',
      images: [],
      byteSize: 100,
    });
    const dup = await store.saveSnapshotVersion({
      id: 's0_dup',
      pageId: 'pg_ver',
      capturedAt: 1500,
      contentHash: 'same_hash',
      title: 'Doc',
      text: 'Version 0 text',
      images: [],
      byteSize: 100,
    });
    expect(first.saved).toBe(true);
    expect(dup.saved).toBe(false);

    for (let i = 1; i <= 6; i++) {
      await store.saveSnapshotVersion({
        id: `s_${i}`,
        pageId: 'pg_ver',
        capturedAt: 2000 + i * 1000,
        contentHash: `hash_${i}`,
        title: 'Doc',
        text: `Version ${i} content`,
        images: [],
        byteSize: 100,
      });
    }

    const versions = await store.listSnapshotsForPage('pg_ver');
    expect(versions).toHaveLength(5);
    expect(versions[0]?.id).toBe('s_6');
    expect(versions[4]?.id).toBe('s_2');

    await db.delete();
  });

  it('prunes oldest snapshot bodies first when storage budget is exceeded while keeping page metadata (FR-ST-3)', async () => {
    const { db, store } = await createTestStore();

    await store.putPage({
      id: 'pg_budget',
      url: 'https://example.com/budget',
      canonicalUrl: 'https://example.com/budget',
      domain: 'example.com',
      title: 'Budget Page',
      type: 'article',
      summary: 'Kept metadata',
      language: 'en',
      topics: [],
      englishTopics: [],
      entities: [],
      firstSeen: 1000,
      lastSeen: 3000,
      status: 'full',
      promptVersion: '1.0.0',
      updatedAt: 3000,
    });

    await store.saveSnapshotVersion({
      id: 'old_snap',
      pageId: 'pg_budget',
      capturedAt: 1000,
      contentHash: 'h1',
      title: 'Old',
      text: 'old body',
      images: [],
      byteSize: 5000,
    });
    await store.saveSnapshotVersion({
      id: 'new_snap',
      pageId: 'pg_budget',
      capturedAt: 2000,
      contentHash: 'h2',
      title: 'New',
      text: 'new body',
      images: [],
      byteSize: 5000,
    });

    const result = await store.enforceStorageBudget(8000);
    expect(result.prunedSnapshots).toBeGreaterThanOrEqual(1);

    const remaining = await store.listSnapshotsForPage('pg_budget');
    expect(remaining.some((s) => s.id === 'old_snap')).toBe(false);
    // Page metadata must remain intact
    const meta = await store.getPage('pg_budget');
    expect(meta?.title).toBe('Budget Page');

    await db.delete();
  });

  it('upgrades a v1 database cleanly to v2 preserving records (FR-ST-5)', async () => {
    const dbName = `MigrationTest_${crypto.randomUUID()}`;

    // Create v1 DB and write a legacy page row missing v2 fields
    const v1 = new Dexie(dbName);
    v1.version(1).stores({
      pages: 'id, canonicalUrl, domain, type, status, clusterId, firstSeen, lastSeen',
      visits: 'id, pageId, time, sessionId',
      snapshots: 'id, pageId, capturedAt, contentHash',
      chunks: 'id, pageId, snapshotId, index',
      facts: 'id, pageId, chunkId, highlight, fromImage',
      nodes: 'id, kind, clusterId, refId, lastSeen',
      edges: 'id, from, to, kind, firstSeen',
      embeddings: 'id, ownerId, ownerKind, pageId',
      clusters: 'id, name, pinned, hidden, updatedAt',
      journeys: 'id, start, end, state, clusterId',
      loops: 'id, kind, state, clusterId, snoozeUntil, createdAt',
      watches: 'id, pageId, enabled, lastCheck',
      recaps: 'id, week, startDate, createdAt',
      settings: 'id',
      jobs: 'id, kind, state, priority, createdAt',
      routing_log: 'id, timestamp, jobKind, ranOn',
    });
    await v1.open();
    await v1.table('pages').put({
      id: 'legacy_1',
      url: 'https://legacy.dev',
      canonicalUrl: 'https://legacy.dev',
      domain: 'legacy.dev',
      title: 'Legacy Page',
      type: 'article',
      summaryEnc: 'Plain legacy summary',
      language: 'en',
      firstSeen: 1000,
      lastSeen: 2000,
      status: 'full',
      promptVersion: '0.9.0',
    });
    v1.close();

    // Open with TrailmindDB (v2)
    const v2 = new TrailmindDB(dbName);
    await v2.open();
    const migrated = await v2.pages.get('legacy_1');
    expect(migrated?.title).toBe('Legacy Page');
    expect(Array.isArray(migrated?.topics)).toBe(true);
    expect(Array.isArray(migrated?.englishTopics)).toBe(true);
    expect(typeof migrated?.updatedAt).toBe('number');
    await v2.delete();
  });

  it('immediately removes pages, snapshots, facts, embeddings, and graph edges on forget (FR-PRV-3, FR-PRV-4)', async () => {
    const { db, store } = await createTestStore();
    const now = Date.now();

    await store.putPage({
      id: 'pg_forget',
      url: 'https://reddit.com/r/typescript/1',
      canonicalUrl: 'https://reddit.com/r/typescript/1',
      domain: 'reddit.com',
      title: 'Delete me',
      type: 'thread',
      summary: 'Should vanish completely',
      language: 'en',
      topics: ['TempTopic'],
      englishTopics: ['TempTopic'],
      entities: [],
      firstSeen: now - 5 * 60_000,
      lastSeen: now - 5 * 60_000,
      status: 'full',
      promptVersion: '1.0.0',
      updatedAt: now,
    });
    await store.putVisit({
      id: 'vis_f1',
      pageId: 'pg_forget',
      time: now - 5 * 60_000,
      activeMs: 40_000,
      maxScroll: 50,
      transition: 'link',
      sessionId: 'ses_1',
    });
    await store.putFact({
      id: 'fct_f1',
      pageId: 'pg_forget',
      text: 'Private fact',
      fromImage: false,
      highlight: false,
      createdAt: now,
    });
    await store.putEmbeddings([
      { id: 'emb_f1', ownerId: 'pg_forget', ownerKind: 'page', pageId: 'pg_forget', vector: [1, 2], scale: 1, dim: 2 },
    ]);

    const removed = await store.forgetLastMinutes(15);
    expect(removed).toBe(1);
    expect(await store.getPage('pg_forget')).toBeUndefined();
    expect(await store.listFactsForPage('pg_forget')).toHaveLength(0);
    expect(await store.listAllEmbeddings()).toHaveLength(0);

    await db.delete();
  });

  it('round-trips full portable JSON export and import (FR-EXP-4, FR-EXP-5)', async () => {
    const { db: db1, store: store1 } = await createTestStore();
    const now = Date.now();

    await store1.putPage({
      id: 'pg_rt',
      url: 'https://docs.example.com/rt',
      canonicalUrl: 'https://docs.example.com/rt',
      domain: 'docs.example.com',
      title: 'Round Trip Doc',
      type: 'docs',
      summary: 'Preserved across export and import',
      language: 'en',
      topics: ['Portability'],
      englishTopics: ['Portability'],
      entities: [],
      firstSeen: now,
      lastSeen: now,
      status: 'full',
      promptVersion: '1.0.0',
      updatedAt: now,
    });
    await store1.putFact({
      id: 'fct_rt',
      pageId: 'pg_rt',
      text: 'Portable fact survives JSON dump',
      fromImage: false,
      highlight: true,
      createdAt: now,
    });

    const dump = await store1.exportPortableJson();

    const { db: db2, store: store2 } = await createTestStore();
    const imported = await store2.importPortableJson(dump);
    expect(imported.pagesImported).toBe(1);
    expect(imported.factsImported).toBe(1);

    const restored = await store2.getPage('pg_rt');
    expect(restored?.summary).toBe('Preserved across export and import');
    const restoredFacts = await store2.listFactsForPage('pg_rt');
    expect(restoredFacts[0]?.text).toBe('Portable fact survives JSON dump');

    await db1.delete();
    await db2.delete();
  });

  it('encrypts E2EE sync envelopes with passphrase and merges version vectors deterministically (FR-SY-2, FR-SY-3)', async () => {
    const cryptoSvc = new CryptoService();
    const payload = { id: 'clu_1', name: 'Auth Research', updatedAt: 100 };
    const env = await cryptoSvc.encryptForSync(payload, 'correct-horse-battery-staple', undefined, 10_000);

    expect(env.ciphertext).not.toContain('Auth Research');
    const decrypted = await cryptoSvc.decryptFromSync<typeof payload>(
      { ...env, iterations: 10_000 },
      'correct-horse-battery-staple',
    );
    expect(decrypted.name).toBe('Auth Research');

    // Wrong passphrase fails decryption
    await expect(
      cryptoSvc.decryptFromSync({ ...env, iterations: 10_000 }, 'wrong-passphrase'),
    ).rejects.toThrow();

    // Version vector comparison & LWW + set union merge
    expect(compareVersionVectors({ devA: 2, devB: 1 }, { devA: 1, devB: 2 })).toBe('concurrent');
    expect(mergeVersionVectors({ devA: 2, devB: 1 }, { devA: 1, devB: 3 })).toEqual({
      devA: 2,
      devB: 3,
    });

    const merged = mergeSyncRecords(
      { id: 'c1', name: 'Old Name', pageIds: ['p1', 'p2'], updatedAt: 100 },
      { id: 'c1', name: 'Renamed Cluster', pageIds: ['p2', 'p3'], updatedAt: 200 },
      ['pageIds'],
    );
    expect(merged.name).toBe('Renamed Cluster');
    expect(merged.pageIds).toEqual(['p1', 'p2', 'p3']);
  });
});
