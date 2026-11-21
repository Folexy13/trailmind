import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { WatchRecord } from '@/shared/types';
import { memoryStore } from '@/core/store/memoryStore';
import { changeWatchService } from '@/features/changeWatch/changeWatchService';
import { AiBadge } from './AiBadge';

interface WatchPanelProps {
  watches: WatchRecord[];
  onRefresh: () => void;
}

/**
 * Change Watch screen (FR-CW-1..FR-CW-8):
 * Watched pages with change history, auto-suggested watches, manual watch + price target input, check now.
 */
export function WatchPanel({ watches, onRefresh }: WatchPanelProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [priceTarget, setPriceTarget] = useState('');
  const [intervalHours, setIntervalHours] = useState('12');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ pageId: string; url: string; title: string; reason: string; price?: number; currency?: string }>
  >([]);

  useEffect(() => {
    void changeWatchService.computeSuggestions().then(setSuggestions);
  }, [watches]);

  async function handleAddWatch(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    await changeWatchService.addWatch({
      url: url.trim(),
      title: title.trim() || url.trim(),
      intervalHours: Number(intervalHours) || 12,
      priceTarget: priceTarget ? Number(priceTarget) : undefined,
    });
    setUrl('');
    setTitle('');
    setPriceTarget('');
    onRefresh();
  }

  async function handleCheckNow(watchId: string) {
    setCheckingId(watchId);
    try {
      await changeWatchService.checkWatch(watchId);
      onRefresh();
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Add manual watch */}
      <form
        onSubmit={handleAddWatch}
        className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… page URL to watch"
          aria-label="URL to watch"
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 sm:col-span-2 dark:border-slate-700 dark:bg-slate-950"
        />
        <input
          type="number"
          step="any"
          value={priceTarget}
          onChange={(e) => setPriceTarget(e.target.value)}
          placeholder="Price target (optional)"
          aria-label="Optional price target"
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
        />
        <div className="flex gap-1.5">
          <select
            value={intervalHours}
            onChange={(e) => setIntervalHours(e.target.value)}
            aria-label="Check frequency"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="6">6h</option>
            <option value="12">12h</option>
            <option value="24">24h</option>
          </select>
          <button
            type="submit"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" /> Watch
          </button>
        </div>
      </form>

      {/* Active watches */}
      {watches.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <Bell className="mb-3 h-7 w-7 text-blue-600" aria-hidden="true" />
          <h3 className="text-sm font-semibold">No watched pages yet</h3>
          <p className="mt-1 max-w-xs text-slate-500">
            Watch docs, product prices, or policy pages. Trailmind diffs changes locally and alerts
            you in one sentence.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {watches.map((w) => (
            <article
              key={w.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {w.title}
                  </a>
                  <p className="text-[11px] text-slate-500">
                    Every {w.intervalHours}h · Last checked {new Date(w.lastCheck).toLocaleString()}
                    {w.priceTarget !== undefined && ` · Target ≤ ${w.priceCurrency ?? ''}${w.priceTarget}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={checkingId === w.id}
                    onClick={() => handleCheckNow(w.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
                  >
                    <RefreshCw className={`h-3 w-3 ${checkingId === w.id ? 'animate-spin' : ''}`} />
                    Check
                  </button>
                  <button
                    type="button"
                    aria-label="Remove watch"
                    onClick={async () => {
                      await memoryStore.deleteWatch(w.id);
                      onRefresh();
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {w.changes.length > 0 && (
                <ul className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  {w.changes.map((chg) => (
                    <li
                      key={chg.id}
                      className="flex items-start justify-between gap-2 rounded-lg bg-blue-50/70 p-2 dark:bg-blue-950/30"
                    >
                      <div>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {chg.summary}
                        </span>
                        <div className="text-[10px] text-slate-500">
                          {new Date(chg.detectedAt).toLocaleString()} · {chg.kind}
                        </div>
                      </div>
                      <AiBadge source={chg.aiSource} compact />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Auto-suggested watches (FR-CW-1) */}
      {suggestions.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Suggested watches
          </h3>
          {suggestions.map((s) => (
            <div
              key={s.pageId}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{s.title}</div>
                <div className="text-[11px] text-slate-500">{s.reason}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await changeWatchService.addWatch({
                    pageId: s.pageId,
                    url: s.url,
                    title: s.title,
                    priceTarget: s.price ? Math.round(s.price * 0.9) : undefined,
                    priceCurrency: s.currency,
                  });
                  onRefresh();
                }}
                className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
              >
                Watch
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
