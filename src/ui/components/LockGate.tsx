import { useState, type FormEvent, type ReactNode } from 'react';
import { Lock, Fingerprint } from 'lucide-react';
import { cryptoService } from '@/core/crypto/encryption';

interface LockGateProps {
  locked: boolean;
  webAuthnCredentialId?: string;
  onUnlocked: () => void;
  children: ReactNode;
}

/**
 * Protects local browsing memory behind a passphrase or WebAuthn device unlock (FR-PRV-8).
 */
export function LockGate({
  locked,
  webAuthnCredentialId,
  onUnlocked,
  children,
}: LockGateProps) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  if (!locked) return <>{children}</>;

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setError('');
    setUnlocking(true);
    try {
      const ok = await cryptoService.unlockWithPassphrase(passphrase);
      if (ok) {
        setPassphrase('');
        onUnlocked();
      } else {
        setError('Incorrect passphrase. Please try again.');
      }
    } finally {
      setUnlocking(false);
    }
  }

  async function handleWebAuthn() {
    if (!webAuthnCredentialId) return;
    setError('');
    const ok = await cryptoService.verifyDeviceUnlockCredential(webAuthnCredentialId);
    if (ok) {
      onUnlocked();
    } else {
      setError('Device biometric/PIN unlock was cancelled. Enter your passphrase instead.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Trailmind is locked</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your browsing memory is encrypted on this device.
            </p>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="space-y-3">
          <div>
            <label htmlFor="tm-unlock-pass" className="mb-1 block text-xs font-medium">
              Passphrase
            </label>
            <input
              id="tm-unlock-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter vault passphrase"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={unlocking}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {unlocking ? 'Unlocking…' : 'Unlock memory'}
          </button>
        </form>

        {webAuthnCredentialId && (
          <button
            type="button"
            onClick={handleWebAuthn}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Unlock with device biometrics
          </button>
        )}
      </div>
    </main>
  );
}
