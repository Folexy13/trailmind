import { PBKDF2_ITERATIONS } from '@/shared/constants';
import type { EncryptedBlob } from '@/shared/types';

const KEY_DB_NAME = 'trailmind_keystore';
const KEY_STORE_NAME = 'keys';
const DATA_KEY_ID = 'install_data_key';
const WRAPPED_KEY_ID = 'wrapped_data_key';
const PASSPHRASE_META_ID = 'passphrase_meta';

export interface WrappedKeyRecord {
  id: string;
  wrappedBytes: string;
  iv: string;
  salt: string;
  iterations: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.v === 1 && typeof record.iv === 'string' && typeof record.ct === 'string';
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomBytesBase64(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return toBase64(bytes);
}

/**
 * Generates a human-readable 256-bit recovery key grouped in 4-character hex blocks (FR-SY-4).
 */
export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.match(/.{1,4}/g)?.join('-') ?? hex;
}

export async function deriveAesKeyFromPassphrase(
  passphrase: string,
  saltBase64: string,
  iterations = PBKDF2_ITERATIONS,
  usages: KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltBase64),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open keystore DB'));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const req = tx.objectStore(KEY_STORE_NAME).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result as T | undefined);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error(`Keystore read failed for ${key}`));
    };
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    tx.objectStore(KEY_STORE_NAME).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`Keystore write failed for ${key}`));
    };
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    tx.objectStore(KEY_STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`Keystore delete failed for ${key}`));
    };
  });
}

/**
 * Manages the per-install AES-GCM 256 CryptoKey stored non-extractably in IndexedDB (SEC-1),
 * plus optional passphrase locking (FR-PRV-8) and sync encryption envelopes (FR-SY-2).
 */
export class CryptoService {
  private activeKey: CryptoKey | null = null;
  private locked = false;

  async init(): Promise<void> {
    const wrapped = await idbGet<WrappedKeyRecord>(WRAPPED_KEY_ID);
    if (wrapped) {
      this.locked = true;
      return;
    }

    let existing = await idbGet<CryptoKey>(DATA_KEY_ID);
    if (!existing) {
      existing = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable at rest (SEC-1)
        ['encrypt', 'decrypt'],
      );
      await idbPut(DATA_KEY_ID, existing);
    }
    this.activeKey = existing;
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked && !this.activeKey;
  }

  lock(): void {
    if (this.activeKey) {
      this.activeKey = null;
      this.locked = true;
    }
  }

  /**
   * Enables passphrase wrapping by generating an extractable key to wrap once,
   * storing only the AES-GCM wrapped bytes + PBKDF2 salt/iterations, and removing
   * the unwrapped install key from IndexedDB.
   */
  async enablePassphraseLock(
    passphrase: string,
    iterations = PBKDF2_ITERATIONS,
  ): Promise<void> {
    if (!passphrase || passphrase.length < 8) {
      throw new Error('Passphrase must be at least 8 characters.');
    }
    const salt = randomBytesBase64(16);
    const wrappingKey = await deriveAesKeyFromPassphrase(passphrase, salt, iterations, [
      'wrapKey',
      'unwrapKey',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Fresh extractable key wrapped immediately; callers re-encrypt or rotate if needed.
    const rawKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const wrappedBuffer = await crypto.subtle.wrapKey('raw', rawKey, wrappingKey, {
      name: 'AES-GCM',
      iv,
    });
    const record: WrappedKeyRecord = {
      id: WRAPPED_KEY_ID,
      wrappedBytes: toBase64(new Uint8Array(wrappedBuffer)),
      iv: toBase64(iv),
      salt,
      iterations,
    };
    await idbPut(WRAPPED_KEY_ID, record);
    await idbPut(PASSPHRASE_META_ID, { enabled: true, salt, iterations });
    await idbDelete(DATA_KEY_ID);

    // Keep an in-memory non-extractable copy active for this session until lock().
    const exported = await crypto.subtle.exportKey('raw', rawKey);
    this.activeKey = await crypto.subtle.importKey(
      'raw',
      exported,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    this.locked = false;
  }

  async unlockWithPassphrase(passphrase: string): Promise<boolean> {
    const wrapped = await idbGet<WrappedKeyRecord>(WRAPPED_KEY_ID);
    if (!wrapped) {
      await this.init();
      return true;
    }
    try {
      const wrappingKey = await deriveAesKeyFromPassphrase(
        passphrase,
        wrapped.salt,
        wrapped.iterations,
        ['unwrapKey'],
      );
      this.activeKey = await crypto.subtle.unwrapKey(
        'raw',
        fromBase64(wrapped.wrappedBytes),
        wrappingKey,
        { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      this.locked = false;
      return true;
    } catch {
      return false;
    }
  }

  async disablePassphraseLock(): Promise<void> {
    await idbDelete(WRAPPED_KEY_ID);
    await idbDelete(PASSPHRASE_META_ID);
    this.locked = false;
    if (!this.activeKey) {
      await this.init();
    } else {
      await idbPut(DATA_KEY_ID, this.activeKey);
    }
  }

  private async ensureKey(): Promise<CryptoKey> {
    if (this.locked && !this.activeKey) {
      throw new Error('Trailmind memory is locked. Unlock with your passphrase first.');
    }
    if (!this.activeKey) {
      await this.init();
    }
    if (!this.activeKey) {
      throw new Error('Encryption key unavailable.');
    }
    return this.activeKey;
  }

  async encryptString(plaintext: string): Promise<EncryptedBlob> {
    const key = await this.ensureKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      v: 1,
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(cipherBuffer)),
    };
  }

  async decryptString(value: EncryptedBlob | string): Promise<string> {
    if (typeof value === 'string') return value;
    if (!isEncryptedBlob(value)) return '';
    const key = await this.ensureKey();
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(value.iv) },
      key,
      fromBase64(value.ct),
    );
    return new TextDecoder().decode(plainBuffer);
  }

  /**
   * Encrypts an arbitrary JSON payload for Firestore backup / E2EE sync using a user passphrase key (FR-SY-2).
   */
  async encryptForSync(
    payload: unknown,
    passphrase: string,
    saltBase64?: string,
    iterations = PBKDF2_ITERATIONS,
  ): Promise<{ ciphertext: string; iv: string; salt: string; iterations: number }> {
    const salt = saltBase64 ?? randomBytesBase64(16);
    const key = await deriveAesKeyFromPassphrase(passphrase, salt, iterations, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      ciphertext: toBase64(new Uint8Array(cipherBuffer)),
      iv: toBase64(iv),
      salt,
      iterations,
    };
  }

  async decryptFromSync<T>(
    envelope: { ciphertext: string; iv: string; salt: string; iterations?: number },
    passphrase: string,
  ): Promise<T> {
    const key = await deriveAesKeyFromPassphrase(
      passphrase,
      envelope.salt,
      envelope.iterations ?? PBKDF2_ITERATIONS,
      ['decrypt'],
    );
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plainBuffer)) as T;
  }

  /**
   * Registers a platform WebAuthn credential for quick device unlock on shared computers (FR-PRV-8).
   */
  async registerDeviceUnlockCredential(rpName = 'Trailmind'): Promise<string | null> {
    if (typeof navigator === 'undefined' || !navigator.credentials?.create) {
      return null;
    }
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: rpName },
        user: {
          id: userId,
          name: 'trailmind-local-user',
          displayName: 'Trailmind Local Vault',
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!cred) return null;
    return toBase64(new Uint8Array(cred.rawId));
  }

  async verifyDeviceUnlockCredential(credentialIdBase64: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.credentials?.get) {
      return false;
    }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: fromBase64(credentialIdBase64), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      return Boolean(assertion);
    } catch {
      return false;
    }
  }

  resetInMemoryForTest(): void {
    this.activeKey = null;
    this.locked = false;
  }
}

export const cryptoService = new CryptoService();
