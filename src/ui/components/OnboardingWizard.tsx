import { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Download, History, Shield, XCircle } from 'lucide-react';
import type { DeviceAiStatus, SettingsRecord } from '@/shared/types';
import { checkDeviceAiReadiness, triggerDeviceModelDownload } from '@/core/ai/hybridAi';
import { memoryStore } from '@/core/store/memoryStore';

interface OnboardingWizardProps {
  settings: SettingsRecord;
  onComplete: () => void;
}

/**
 * 3-step Welcome & Onboarding screen (FR-ON-1..FR-ON-7):
 *  Step 1: What Trailmind records, what it NEVER records (incognito, passwords, payments), where data lives
 *  Step 2: On-device AI readiness check + user-click "Enable on-device AI" calling initializeDeviceModel()
 *  Step 3: History import range (7/30/90 days or skip), editable exclusion list, and "Try Demo Data" toggle
 */
export function OnboardingWizard({ settings, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [status, setStatus] = useState<DeviceAiStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  const [downloadSuccess, setDownloadSuccess] = useState('');

  const [days, setDays] = useState<7 | 30 | 90>(settings.backfillDays);
  const [exclusionsText, setExclusionsText] = useState(settings.exclusions.join('\n'));
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState('');

  useEffect(() => {
    void checkDeviceAiReadiness().then(setStatus);
  }, []);

  async function handleEnableDeviceAi() {
    setDownloading(true);
    setDownloadError('');
    setDownloadSuccess('');
    setDownloadProgress(0.05);
    try {
      await triggerDeviceModelDownload((progress) => {
        setDownloadProgress(Math.max(0.05, Math.min(1, progress)));
      });
      setDownloadProgress(1);
      const refreshed = await checkDeviceAiReadiness();
      setStatus(refreshed);
      setDownloadSuccess('On-device Gemini Nano is initialized and ready.');
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : 'Gemini Nano could not be initialized. Ensure Chrome 139+ and the Prompt API flag are enabled — or continue in metadata-only / demo mode.',
      );
    } finally {
      setDownloading(false);
    }
  }

  async function saveExclusions(): Promise<string[]> {
    const cleaned = exclusionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await memoryStore.saveSettings({ exclusions: cleaned, backfillDays: days });
    return cleaned;
  }

  async function handleImportHistory() {
    setImporting(true);
    setImportSummary('');
    try {
      await saveExclusions();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const res = await new Promise<{ ok?: boolean; data?: { pagesCreated?: number; sessionsCreated?: number } }>(
          (resolve) => {
            chrome.runtime.sendMessage({ type: 'START_BACKFILL', payload: { days } }, resolve);
          },
        );
        setImportSummary(
          `Imported ${res?.data?.pagesCreated ?? 0} pages across ${res?.data?.sessionsCreated ?? 0} sessions. Background enrichment will continue while Chrome is idle.`,
        );
      }
      await memoryStore.saveSettings({ onboardingCompleted: true });
      onComplete();
    } finally {
      setImporting(false);
    }
  }

  async function handleSkipImport() {
    await saveExclusions();
    await memoryStore.saveSettings({ onboardingCompleted: true });
    onComplete();
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="mb-6 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          Trailmind · Private Browsing Memory
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          Your browsing, remembered. On your device.
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Step {step} of 3 — Set up local encryption, on-device Gemini Nano, and your privacy rules.
        </p>
      </div>

      {/* Stepper */}
      <div className="mb-6 grid grid-cols-3 gap-2 text-center text-xs font-medium">
        {(['1. Privacy pledge', '2. On-device AI', '3. History & exclusions'] as const).map(
          (label, idx) => {
            const num = (idx + 1) as 1 | 2 | 3;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(num)}
                className={`rounded-lg py-2 ${
                  step === num
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            );
          },
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Shield className="h-5 w-5 text-blue-600" /> Local by default, encrypted at rest
            </div>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
                <h3 className="font-semibold text-emerald-900 dark:text-emerald-200">
                  What Trailmind remembers
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-emerald-800 dark:text-emerald-300">
                  <li>Readable text of public pages you actually read (20s+ or 30% scrolled)</li>
                  <li>Topics, entities, facts, prices, and your Alt+H highlights</li>
                  <li>Encrypted AES-GCM snapshots stored only inside your browser&apos;s IndexedDB</li>
                </ul>
              </div>
              <div className="rounded-xl bg-rose-50 p-4 dark:bg-rose-950/30">
                <h3 className="font-semibold text-rose-900 dark:text-rose-200">
                  What Trailmind NEVER records
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-rose-800 dark:text-rose-300">
                  <li>Incognito windows or chrome:// pages</li>
                  <li>Passwords, typed form field values, or payment card forms</li>
                  <li>Banks, email, medical portals, password managers, or excluded domains</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Every per-page AI extraction runs locally via Chrome Gemini Nano (`ONLY_ON_DEVICE`).
              Cloud calls are OFF by default and only run when you explicitly opt in.
            </p>
            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Cpu className="h-5 w-5 text-blue-600" /> On-device AI readiness (Gemini Nano)
            </div>

            <div className="space-y-2 text-xs">
              {[
                {
                  label: `Desktop Chrome 139+ (detected: ${status?.chromeVersion ?? 'unknown'})`,
                  ok: Boolean(status?.chromeSupported),
                  fix: 'Update Chrome to version 139 or newer.',
                },
                {
                  label: 'Chrome Prompt API multimodal flag',
                  ok: Boolean(status?.promptApiAvailable),
                  fix: 'Open chrome://flags/#prompt-api-for-gemini-nano-multimodal-input, set Enabled, and relaunch Chrome.',
                },
                {
                  label: `Gemini Nano model status (${status?.availability ?? 'checking'})`,
                  ok: status?.availability === 'available',
                  fix: 'Click "Enable on-device AI" below to download Gemini Nano.',
                },
                {
                  label: `Local disk headroom (${status?.availableStorageGb ?? '?'} GB free)`,
                  ok: Boolean(status?.diskSpaceOk),
                  fix: 'Free at least 4 GB of disk space for the on-device model.',
                },
              ].map((check) => (
                <div
                  key={check.label}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div className="flex items-start gap-2">
                    {check.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div>
                      <div className="font-medium">{check.label}</div>
                      {!check.ok && <div className="text-[11px] text-slate-500">{check.fix}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
              <button
                type="button"
                disabled={downloading}
                onClick={handleEnableDeviceAi}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {downloading ? 'Downloading Gemini Nano…' : 'Enable on-device AI'}
              </button>
              {downloading && (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{ width: `${Math.round(downloadProgress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {Math.round(downloadProgress * 100)}% complete
                  </p>
                </div>
              )}
              {downloadSuccess && (
                <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {downloadSuccess}
                </p>
              )}
              {downloadError && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{downloadError}</p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                No Gemini Nano on this machine? Trailmind still works in metadata-only mode or with
                optional opt-in cloud fallback in Settings.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <History className="h-5 w-5 text-blue-600" /> Import Chrome history & review exclusions
            </div>

            <div className="space-y-2 text-xs">
              <span className="font-medium">History window to build your day-one graph</span>
              <div className="flex gap-2">
                {([7, 30, 90] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDays(opt)}
                    className={`flex-1 rounded-lg border py-2 font-medium ${
                      days === opt
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Last {opt} days {opt === 30 ? '(default)' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <label htmlFor="tm-onboard-exclusions" className="font-medium">
                Excluded domains (one per line, supports wildcards like <code>*.bank.com</code>)
              </label>
              <textarea
                id="tm-onboard-exclusions"
                rows={6}
                value={exclusionsText}
                onChange={(e) => setExclusionsText(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            {importSummary && (
              <p className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {importSummary}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700"
              >
                ← Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleSkipImport}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700"
                >
                  Skip import
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleImportHistory}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing ? 'Importing…' : `Import ${days} days & build graph`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
