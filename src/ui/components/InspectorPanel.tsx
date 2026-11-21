import { useEffect, useState } from 'react';
import { Activity, Bug, Cloud, Cpu, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  DeviceAiStatus,
  JobRecord,
  RemoteConfigValues,
  RoutingLogRecord,
} from '@/shared/types';
import { HYBRID_ROUTING_TABLE } from '@/shared/constants';
import { checkDeviceAiReadiness } from '@/core/ai/hybridAi';
import { getAppCheckStatus } from '@/core/firebase/config';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { memoryStore } from '@/core/store/memoryStore';
import { AiBadge } from './AiBadge';

interface InspectorPanelProps {
  logs: RoutingLogRecord[];
  onRefresh: () => void;
}

/**
 * Live Hybrid Routing Inspector (FR-AI-5, FR-FB-8, NFR-OB-3):
 * Shows on-device share, every AI job with mode/runtime/latency/tokens, exact cloud payload previews,
 * active Firebase Remote Config policy, App Check status, and hidden Developer Debug Panel.
 */
export function InspectorPanel({ logs, onRefresh }: InspectorPanelProps) {
  const [rc, setRc] = useState<RemoteConfigValues>(() => remoteConfigService.getValues());
  const [showDebug, setShowDebug] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<DeviceAiStatus | null>(null);
  const [embeddingCount, setEmbeddingCount] = useState(0);
  const [refreshingRc, setRefreshingRc] = useState(false);

  const appCheck = getAppCheckStatus();

  useEffect(() => {
    if (!showDebug) return;
    void Promise.all([
      memoryStore.listJobs(30),
      checkDeviceAiReadiness(),
      memoryStore.db.embeddings.count(),
    ]).then(([j, status, count]) => {
      setJobs(j);
      setDeviceStatus(status);
      setEmbeddingCount(count);
    });
  }, [showDebug, logs]);

  const onDeviceCount = logs.filter((l) => l.ranOn === 'on_device').length;
  const cloudCount = logs.filter((l) => l.ranOn === 'cloud').length;
  const failedCount = logs.filter((l) => l.ranOn === 'failed').length;
  const completedCount = onDeviceCount + cloudCount;
  const onDeviceShare =
    completedCount > 0 ? Math.round((onDeviceCount / completedCount) * 100) : 100;

  async function handleRefreshRemoteConfig() {
    setRefreshingRc(true);
    try {
      const next = await remoteConfigService.init(true);
      setRc(next);
    } finally {
      setRefreshingRc(false);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Top KPI summary */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Cpu className="h-3.5 w-3.5 text-emerald-600" /> On-device share
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {onDeviceShare}%
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">On-device jobs</div>
          <div className="mt-1 text-xl font-bold">{onDeviceCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Cloud className="h-3.5 w-3.5 text-amber-600" /> Cloud calls
          </div>
          <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">
            {cloudCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" /> App Check
          </div>
          <div className="mt-1 text-xs font-semibold">
            {appCheck.mode === 'recaptcha_enterprise'
              ? 'Enforced (reCAPTCHA)'
              : appCheck.mode === 'debug_token'
                ? 'Enforced (Debug token)'
                : 'Local-only (no cloud)'}
          </div>
        </div>
      </div>

      {/* Cloud payload transparency log */}
      <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/20">
        <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
          <Cloud className="h-4 w-4" /> Cloud calls audit ({cloudCount})
        </h3>
        {cloudCount === 0 ? (
          <p className="text-amber-800 dark:text-amber-300">
            Zero cloud calls made. 0 bytes of page content have left your device.
          </p>
        ) : (
          <ul className="space-y-2">
            {logs
              .filter((l) => l.ranOn === 'cloud')
              .map((l) => (
                <li
                  key={l.id}
                  className="rounded-lg border border-amber-200 bg-white p-2.5 dark:border-amber-900 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{HYBRID_ROUTING_TABLE[l.jobKind]?.label ?? l.jobKind}</span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(l.timestamp).toLocaleTimeString()} · {l.ms} ms · ~{l.tokensEstimated}{' '}
                      tok
                    </span>
                  </div>
                  <p className="mt-1 rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Sent: {l.cloudPayloadPreview || '(metadata only)'}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Active Remote Config Hybrid Policy (FR-FB-8) */}
      <section className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Active Firebase Remote Config routing policy</h3>
            <p className="text-[11px] text-slate-500">
              Source: <strong>{rc.source}</strong> · Cloud model: <code>{rc.cloudModelName}</code> ·
              Kill switch: <strong>{rc.cloudKillSwitch ? 'ON' : 'OFF'}</strong> · Prompt v
              {rc.promptSchemaVersion}
            </p>
          </div>
          <button
            type="button"
            disabled={refreshingRc}
            onClick={handleRefreshRemoteConfig}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingRc ? 'animate-spin' : ''}`} /> Fetch
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(Object.keys(rc.modes) as Array<keyof typeof rc.modes>).map((job) => (
            <div
              key={job}
              className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/70"
            >
              <span className="truncate font-mono text-[11px]">{job}</span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-medium dark:bg-slate-700">
                {rc.modes[job]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Live Job Execution Feed */}
      <section className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Activity className="h-4 w-4 text-blue-600" /> Live AI routing log ({logs.length})
          </h3>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded border border-slate-200 px-2 py-0.5 text-[11px] hover:bg-slate-50 dark:border-slate-700"
          >
            Refresh
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="py-4 text-center text-slate-500">No AI jobs logged yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
                  <th className="py-1.5 pr-2">Job</th>
                  <th className="py-1.5 pr-2">Mode</th>
                  <th className="py-1.5 pr-2">Ran on</th>
                  <th className="py-1.5 pr-2">Latency</th>
                  <th className="py-1.5">Est. tok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.slice(0, 40).map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-1.5 pr-2 font-mono">{entry.jobKind}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{entry.mode}</td>
                    <td className="py-1.5 pr-2">
                      <AiBadge source={entry.ranOn} compact />
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{entry.ms} ms</td>
                    <td className="py-1.5 font-mono">{entry.tokensEstimated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hidden Developer Debug Panel (NFR-OB-3) */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowDebug((s) => !s)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <Bug className="h-3 w-3" /> {showDebug ? 'Hide' : 'Show'} developer debug panel
        </button>
      </div>

      {showDebug && (
        <section className="rounded-xl border border-slate-300 bg-slate-900 p-3.5 font-mono text-[11px] text-slate-200">
          <div className="mb-2 font-semibold text-sky-400">Developer Debug View (NFR-OB-3)</div>
          <div>
            Chrome: {deviceStatus?.chromeVersion ?? 'unknown'} | Prompt API:{' '}
            {deviceStatus?.availability ?? 'checking'} | Storage headroom:{' '}
            {deviceStatus?.availableStorageGb ?? '?'} GB
          </div>
          <div>
            Vector index rows: {embeddingCount} | Failed AI jobs: {failedCount} | Queued jobs:{' '}
            {jobs.filter((j) => j.state === 'queued').length} | Running:{' '}
            {jobs.filter((j) => j.state === 'running').length}
          </div>
        </section>
      )}
    </div>
  );
}
