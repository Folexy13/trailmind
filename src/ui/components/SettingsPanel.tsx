import { useState } from 'react';
import { Cloud, KeyRound, Lock, RefreshCw, Save, Trash2, UserCheck } from 'lucide-react';
import type { SettingsRecord } from '@/shared/types';
import { cryptoService } from '@/core/crypto/encryption';
import { firebaseAuthService } from '@/core/firebase/auth';
import { encryptedSyncService } from '@/core/firebase/sync';
import { memoryStore } from '@/core/store/memoryStore';

interface SettingsPanelProps {
  settings: SettingsRecord;
  onRefresh: () => void;
}

/**
 * Complete Settings screen covering all sections in FR-SET-1, FR-PRV-7..9, and FR-SY-1..5:
 * capture, backfill, privacy, cloud switches, notifications, storage, lock, sync, Notion, search patterns, theme.
 */
export function SettingsPanel({ settings, onRefresh }: SettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsRecord>(settings);
  const [status, setStatus] = useState('');
  const [lockPassphrase, setLockPassphrase] = useState('');
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [customHost, setCustomHost] = useState('');
  const [customParam, setCustomParam] = useState('q');

  async function save(patch: Partial<SettingsRecord>, msg = 'Settings saved.') {
    const updated = await memoryStore.saveSettings(patch);
    setDraft(updated);
    setStatus(msg);
    onRefresh();
  }

  async function handleEnableLock() {
    try {
      await cryptoService.enablePassphraseLock(lockPassphrase);
      const credId = await cryptoService.registerDeviceUnlockCredential().catch(() => null);
      await save(
        { lockEnabled: true, lockWebAuthnCredentialId: credId ?? undefined },
        'Vault passphrase lock enabled.',
      );
      setLockPassphrase('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to enable lock.');
    }
  }

  async function handleSignInGoogle() {
    try {
      const user = await firebaseAuthService.signInWithGoogle();
      await save(
        { syncUserEmail: user.email ?? undefined, syncUserUid: user.uid },
        `Signed in as ${user.email ?? user.uid}. Set a sync passphrase to encrypt backups.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  }

  async function handleSetupSync() {
    if (!draft.syncUserUid) {
      setStatus('Sign in with Google first.');
      return;
    }
    try {
      const res = await encryptedSyncService.setupSyncPassphrase(draft.syncUserUid, syncPassphrase);
      setRecoveryKey(res.recoveryKey);
      await save({ syncEnabled: true }, 'E2EE sync configured. Save your one-time recovery key!');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Sync setup failed.');
    }
  }

  async function handleBackupNow() {
    if (!draft.syncUserUid || !syncPassphrase) {
      setStatus('Enter your sync passphrase to encrypt and upload backup.');
      return;
    }
    try {
      const res = await encryptedSyncService.uploadEncryptedBackup(
        draft.syncUserUid,
        syncPassphrase,
      );
      setStatus(`Encrypted backup uploaded (${res.bytesUploaded} bytes of ciphertext).`);
      onRefresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Backup upload failed.');
    }
  }

  async function handleDeleteCloudSync() {
    if (!draft.syncUserUid) return;
    try {
      const res = await encryptedSyncService.deleteAllServerSyncData(draft.syncUserUid);
      setStatus(`Deleted ${res.deletedDocs} encrypted documents from Firebase.`);
      onRefresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to delete server sync data.');
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {status && (
        <div
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
        >
          {status}
        </div>
      )}

      {/* Cloud Master Switch & Per-Feature Toggles (FR-PRV-7) */}
      <section className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Cloud className="h-4 w-4 text-amber-600" /> Hybrid Cloud AI Controls (Off by default)
        </h3>
        <p className="text-slate-500">
          When the master switch is off, Trailmind sends 0 bytes to cloud AI models. Page extraction
          and sensitive-page checks always stay on-device.
        </p>

        <label className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 font-medium dark:bg-slate-800/70">
          <span>Cloud AI master switch</span>
          <input
            type="checkbox"
            checked={draft.cloud.masterEnabled}
            onChange={(e) =>
              void save({ cloud: { ...draft.cloud, masterEnabled: e.target.checked } })
            }
          />
        </label>

        {draft.cloud.masterEnabled && (
          <div className="space-y-1.5 pl-2">
            {(
              [
                ['cloudAnswers', 'Allow "Ask cloud" fallback on long questions (sends retrieved passages only)'],
                ['cloudDeepSummary', 'Allow opt-in cross-month deep summaries (sends extracted facts only)'],
                ['cloudRecapPolish', 'Allow "Polish weekly recap with cloud" (sends aggregated stats only)'],
                ['cloudMediaPdf', 'Allow opt-in PDF, audio, and video analysis in cloud'],
                ['cloudExtractionFallback', 'Fallback extraction on unsupported machines without Gemini Nano'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between py-1">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={draft.cloud[key]}
                  onChange={(e) =>
                    void save({ cloud: { ...draft.cloud, [key]: e.target.checked } })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Capture, Seen Before & Backfill */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Capture, Seen Before & Backfill</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between">
            <span>Show in-page &ldquo;Seen before&rdquo; chip</span>
            <input
              type="checkbox"
              checked={draft.seenBeforeEnabled}
              onChange={(e) => void save({ seenBeforeEnabled: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between">
            <span>Capture charts & diagrams for Nano description</span>
            <input
              type="checkbox"
              checked={draft.captureImages}
              onChange={(e) => void save({ captureImages: e.target.checked })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Seen-before similarity threshold ({draft.seenBeforeThreshold})</span>
            <input
              type="range"
              min="0.6"
              max="0.95"
              step="0.02"
              value={draft.seenBeforeThreshold}
              onChange={(e) => void save({ seenBeforeThreshold: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Theme</span>
            <select
              value={draft.theme}
              onChange={(e) => void save({ theme: e.target.value as SettingsRecord['theme'] })}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>

        {/* Custom search patterns (FR-BF-3) */}
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="mb-1.5 font-medium">Custom search engine URL patterns</div>
          <div className="flex gap-1.5">
            <input
              value={customHost}
              onChange={(e) => setCustomHost(e.target.value)}
              placeholder="Host (e.g. docs.rs)"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              value={customParam}
              onChange={(e) => setCustomParam(e.target.value)}
              placeholder="Query param (e.g. query)"
              className="w-28 rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={async () => {
                if (!customHost.trim()) return;
                const next = [
                  ...draft.customSearchPatterns,
                  {
                    id: crypto.randomUUID().slice(0, 8),
                    name: customHost.trim(),
                    hostPattern: customHost.trim(),
                    queryParam: customParam.trim() || 'q',
                  },
                ];
                await save({ customSearchPatterns: next }, 'Added custom search pattern.');
                setCustomHost('');
              }}
              className="rounded-lg bg-blue-600 px-3 py-1 font-medium text-white"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      {/* Storage Budget, Auto-Delete & Notifications */}
      <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Storage budget (MB, oldest snapshot bodies pruned first)</span>
          <input
            type="number"
            min={100}
            max={10240}
            value={draft.storageBudgetMb}
            onChange={(e) => setDraft({ ...draft, storageBudgetMb: Number(e.target.value) })}
            onBlur={() => void save({ storageBudgetMb: draft.storageBudgetMb })}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Auto-delete memory older than (FR-PRV-9)</span>
          <select
            value={draft.autoDeleteDays}
            onChange={(e) =>
              void save({ autoDeleteDays: Number(e.target.value) as SettingsRecord['autoDeleteDays'] })
            }
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={0}>Off (keep until budget)</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>
        <label className="flex items-center justify-between">
          <span>Change Watch & Recap notifications</span>
          <input
            type="checkbox"
            checked={draft.notificationsEnabled}
            onChange={(e) => void save({ notificationsEnabled: e.target.checked })}
          />
        </label>
        <div className="flex items-center gap-2">
          <span>Quiet hours:</span>
          <input
            type="number"
            min={0}
            max={23}
            value={draft.quietHoursStart}
            onChange={(e) => void save({ quietHoursStart: Number(e.target.value) })}
            className="w-16 rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
          />
          <span>to</span>
          <input
            type="number"
            min={0}
            max={23}
            value={draft.quietHoursEnd}
            onChange={(e) => void save({ quietHoursEnd: Number(e.target.value) })}
            className="w-16 rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </section>

      {/* Local Passphrase Lock (FR-PRV-8) */}
      <section className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Lock className="h-4 w-4 text-blue-600" /> Local Vault Lock (shared computers)
        </h3>
        {draft.lockEnabled ? (
          <div className="flex items-center justify-between">
            <span className="text-emerald-700 dark:text-emerald-400">
              Vault passphrase lock is active (PBKDF2-SHA256, 600,000 iterations).
            </span>
            <button
              type="button"
              onClick={async () => {
                await cryptoService.disablePassphraseLock();
                await save({ lockEnabled: false, lockWebAuthnCredentialId: undefined }, 'Lock disabled.');
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5"
            >
              Disable lock
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="password"
              value={lockPassphrase}
              onChange={(e) => setLockPassphrase(e.target.value)}
              placeholder="New vault passphrase (min 8 chars)"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={handleEnableLock}
              className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white"
            >
              Enable lock
            </button>
          </div>
        )}
      </section>

      {/* Optional End-to-End Encrypted Backup & Sync (FR-FB-5, FR-FB-6, FR-SY-1..FR-SY-5) */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-blue-600" /> Optional End-to-End Encrypted Sync (Firebase Auth + Firestore)
        </h3>
        <p className="text-slate-500">
          Everything is encrypted on your device with your sync passphrase before leaving Chrome.
          Firebase never receives your decryption key. Losing both your passphrase and recovery key
          means synced data cannot be recovered.
        </p>

        {!draft.syncUserUid ? (
          <button
            type="button"
            onClick={handleSignInGoogle}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 font-medium text-white hover:bg-blue-700"
          >
            <UserCheck className="h-4 w-4" /> Sign in with Google for encrypted backup
          </button>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
              <span>
                Signed in as <strong>{draft.syncUserEmail ?? draft.syncUserUid}</strong>
                {draft.syncLastAt && ` · Last backup ${new Date(draft.syncLastAt).toLocaleString()}`}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await firebaseAuthService.signOutUser();
                  await save({ syncUserUid: undefined, syncUserEmail: undefined, syncEnabled: false });
                }}
                className="text-rose-600 hover:underline"
              >
                Sign out
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={syncPassphrase}
                onChange={(e) => setSyncPassphrase(e.target.value)}
                placeholder="Sync passphrase (min 10 chars, never sent to server)"
                className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={handleSetupSync}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 font-medium text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
              >
                Setup E2EE key
              </button>
              <button
                type="button"
                onClick={handleBackupNow}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Backup now
              </button>
              <button
                type="button"
                onClick={handleDeleteCloudSync}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-700 dark:border-rose-800 dark:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete server sync data
              </button>
            </div>

            {recoveryKey && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/50">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  Save this one-time recovery key now (FR-SY-4)
                </div>
                <p className="mt-1 font-mono text-sm font-bold tracking-wider">{recoveryKey}</p>
                <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                  This key is shown only once. If you lose both your passphrase and this key, your
                  encrypted cloud data cannot be recovered.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Notion Integration (FR-EXP-3) */}
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Notion Export Integration (Optional)</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="password"
            value={draft.notionToken ?? ''}
            onChange={(e) => setDraft({ ...draft, notionToken: e.target.value })}
            placeholder="Notion internal integration secret (secret_...)"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="text"
            value={draft.notionParentPageId ?? ''}
            onChange={(e) => setDraft({ ...draft, notionParentPageId: e.target.value })}
            placeholder="Target Notion Parent Page ID"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            void save(
              { notionToken: draft.notionToken, notionParentPageId: draft.notionParentPageId },
              'Notion export credentials saved locally.',
            )
          }
          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          <Save className="h-3.5 w-3.5" /> Save Notion config
        </button>
      </section>
    </div>
  );
}
