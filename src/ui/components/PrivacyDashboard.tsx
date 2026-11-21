import { useEffect, useState, type ChangeEvent } from 'react';
import { Download, HardDrive, ShieldAlert, Trash2, Upload } from 'lucide-react';
import type {
  RoutingLogRecord,
  SettingsRecord,
  SkippedDomainRecord,
} from '@/shared/types';
import { memoryStore } from '@/core/store/memoryStore';
import { exportService } from '@/features/export/exportService';

interface PrivacyDashboardProps {
  settings: SettingsRecord;
  logs: RoutingLogRecord[];
  onRefresh: () => void;
}

/**
 * Privacy Dashboard & Data Portability screen (FR-PRV-1..FR-PRV-9, FR-EXP-1..FR-EXP-5).
 */
export function PrivacyDashboard({ settings, logs, onRefresh }: PrivacyDashboardProps) {
  const [storage, setStorage] = useState({
    totalBytes: 0,
    snapshotBytes: 0,
    pageCount: 0,
    snapshotCount: 0,
    factCount: 0,
    embeddingCount: 0,
  });
  const [skippedDomains, setSkippedDomains] = useState<SkippedDomainRecord[]>([]);
  const [forgetDomainInput, setForgetDomainInput] = useState('');
  const [forgetTopicInput, setForgetTopicInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [newExclusion, setNewExclusion] = useState('');

  useEffect(() => {
    void Promise.all([
      memoryStore.estimateStorageBytes(),
      memoryStore.listSkippedDomains(),
    ]).then(([st, skipped]) => {
      setStorage(st);
      setSkippedDomains(skipped);
    });
  }, [settings, logs]);

  const cloudCalls = logs.filter((l) => l.ranOn === 'cloud');
  const onDeviceCalls = logs.filter((l) => l.ranOn === 'on_device');
  const share =
    cloudCalls.length + onDeviceCalls.length > 0
      ? Math.round((onDeviceCalls.length / (cloudCalls.length + onDeviceCalls.length)) * 100)
      : 100;

  const usedMb = (storage.totalBytes / (1024 * 1024)).toFixed(2);

  async function handleAddExclusion() {
    const val = newExclusion.trim().toLowerCase();
    if (!val) return;
    const next = Array.from(new Set([...settings.exclusions, val]));
    await memoryStore.saveSettings({ exclusions: next });
    setNewExclusion('');
    setStatusMsg(`Added "${val}" to exclusions.`);
    onRefresh();
  }

  async function handleExportObsidian() {
    const res = await exportService.exportObsidianZip({ kind: 'all' });
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`Exported ${res.fileCount} Markdown files with Obsidian wiki links.`);
  }

  async function handleExportJson() {
    const json = await exportService.exportFullJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailmind-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Full portable JSON export downloaded.');
  }

  async function handleImportJson(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = await exportService.importFullJson(text);
    setStatusMsg(
      `Imported ${res.pagesImported} pages, ${res.snapshotsImported} snapshots, and ${res.factsImported} facts.`,
    );
    onRefresh();
  }

  async function handleExportNotion() {
    if (!settings.notionToken || !settings.notionParentPageId) {
      setStatusMsg('Add your Notion integration token and parent page ID in Settings first.');
      return;
    }
    try {
      const res = await exportService.exportToNotion({
        token: settings.notionToken,
        parentPageId: settings.notionParentPageId,
      });
      setStatusMsg(`Exported ${res.createdCount} pages to Notion.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Notion export failed.');
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {statusMsg && (
        <div
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
        >
          {statusMsg}
        </div>
      )}

      {/* Storage & Privacy Stats (FR-PRV-5) */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <HardDrive className="h-3.5 w-3.5 text-blue-600" /> Local storage
          </div>
          <div className="mt-1 text-lg font-bold">
            {usedMb} MB <span className="text-xs font-normal text-slate-400">/ {settings.storageBudgetMb} MB</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">Encrypted records</div>
          <div className="mt-1 text-lg font-bold">
            {storage.pageCount} <span className="text-xs font-normal text-slate-400">pages · {storage.snapshotCount} snaps</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">On-device AI share</div>
          <div className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400">{share}%</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">Cloud calls logged</div>
          <div className="mt-1 text-lg font-bold">{cloudCalls.length}</div>
        </div>
      </div>

      {/* Instant Forget Controls (FR-PRV-3, FR-PRV-4) */}
      <section className="space-y-3 rounded-xl border border-rose-200 bg-white p-4 dark:border-rose-900/50 dark:bg-slate-900">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-400">
          <Trash2 className="h-4 w-4" /> Forget memory (immediate & complete across all stores)
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              const n = await memoryStore.forgetLastMinutes(15);
              setStatusMsg(`Forgot ${n} pages from the last 15 minutes.`);
              onRefresh();
            }}
            className="rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
          >
            Forget last 15 minutes
          </button>
          <button
            type="button"
            onClick={async () => {
              const n = await memoryStore.forgetLastMinutes(60);
              setStatusMsg(`Forgot ${n} pages from the last 1 hour.`);
              onRefresh();
            }}
            className="rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
          >
            Forget last 1 hour
          </button>
          <button
            type="button"
            onClick={async () => {
              await memoryStore.forgetEverything();
              setStatusMsg('All local browsing memory, snapshots, and embeddings deleted.');
              onRefresh();
            }}
            className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700"
          >
            Delete everything
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={forgetDomainInput}
              onChange={(e) => setForgetDomainInput(e.target.value)}
              placeholder="Forget site (e.g. reddit.com)"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={async () => {
                if (!forgetDomainInput.trim()) return;
                const n = await memoryStore.forgetDomain(forgetDomainInput.trim());
                setStatusMsg(`Forgot ${n} pages from ${forgetDomainInput}.`);
                setForgetDomainInput('');
                onRefresh();
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Forget site
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={forgetTopicInput}
              onChange={(e) => setForgetTopicInput(e.target.value)}
              placeholder="Forget topic (e.g. Laptops)"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={async () => {
                if (!forgetTopicInput.trim()) return;
                const n = await memoryStore.forgetTopic(forgetTopicInput.trim());
                setStatusMsg(`Forgot ${n} pages on topic "${forgetTopicInput}".`);
                setForgetTopicInput('');
                onRefresh();
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Forget topic
            </button>
          </div>
        </div>
      </section>

      {/* Export & Portability (FR-EXP-1..FR-EXP-5) */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Export & Import (your data, portable anytime)</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportObsidian}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
          >
            <Download className="h-3.5 w-3.5" /> Export Obsidian / Markdown ZIP
          </button>
          <button
            type="button"
            onClick={handleExportNotion}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700"
          >
            <Download className="h-3.5 w-3.5" /> Export to Notion
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700"
          >
            <Download className="h-3.5 w-3.5" /> Full JSON export
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import JSON
            <input type="file" accept="application/json" onChange={handleImportJson} className="hidden" />
          </label>
        </div>
      </section>

      {/* Skipped Sensitive & Excluded Domains Log (FR-PRV-6: domain only, zero URLs/content) */}
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-emerald-600" /> Skipped domains (domain only — never stored)
        </h3>
        {skippedDomains.length === 0 ? (
          <p className="text-slate-500">No domains skipped yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {skippedDomains.map((item) => (
              <span
                key={item.id}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] dark:bg-slate-800"
              >
                {item.domain} · {item.reason === 'sensitive_page' ? 'sensitive' : 'excluded'} (×{item.count})
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <input
            type="text"
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            placeholder="Add exclusion pattern (e.g. *.bank.com)"
            className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="button"
            onClick={handleAddExclusion}
            className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
          >
            Add rule
          </button>
        </div>
      </section>
    </div>
  );
}
