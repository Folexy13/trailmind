import { useEffect, useRef } from 'react';
import {
  Bookmark,
  BookOpen,
  Check,
  Clock,
  ExternalLink,
  FileInput,
  Scale,
  XCircle,
} from 'lucide-react';
import type { LoopKind, LoopRecord, PageRecord } from '@/shared/types';
import { openLoopsService } from '@/features/loops/openLoopsService';

interface LoopsPanelProps {
  loops: LoopRecord[];
  pages: PageRecord[];
  onRefresh: () => void;
}

const LOOP_META: Record<LoopKind, { label: string; icon: typeof BookOpen }> = {
  comparing: { label: 'Unfinished comparisons', icon: Scale },
  reading: { label: 'Half-read articles', icon: BookOpen },
  form: { label: 'Abandoned forms', icon: FileInput },
  saved: { label: 'Saved but not used', icon: Bookmark },
};

/**
 * Open Loops screen (FR-OL-1..FR-OL-7):
 * Cards grouped by kind with one-line reason, side-by-side product/price comparison table,
 * and open / mark done / snooze (1d, 1w) / dismiss forever actions.
 */
export function LoopsPanel({ loops, pages, onRefresh }: LoopsPanelProps) {
  const refreshedOnce = useRef(false);
  useEffect(() => {
    if (refreshedOnce.current) return;
    refreshedOnce.current = true;
    void openLoopsService.refreshOpenLoops().then(() => onRefresh());
  }, [onRefresh]);

  const pageMap = new Map(pages.map((p) => [p.id, p]));
  const openLoops = loops.filter((l) => l.state === 'open');

  if (openLoops.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <Check className="mb-3 h-8 w-8 text-emerald-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold">No open loops</h2>
        <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
          Trailmind automatically spots half-read articles, unfinished product comparisons,
          abandoned forms, and untouched bookmarks so nothing slips through the cracks.
        </p>
      </div>
    );
  }

  const kinds: LoopKind[] = ['comparing', 'reading', 'form', 'saved'];

  return (
    <div className="space-y-4">
      {kinds.map((kind) => {
        const items = openLoops.filter((l) => l.kind === kind);
        if (items.length === 0) return null;
        const Icon = LOOP_META[kind].icon;

        return (
          <section key={kind} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {LOOP_META[kind].label} ({items.length})
              </h3>
              <button
                type="button"
                onClick={async () => {
                  await openLoopsService.dismissKindForever(kind);
                  onRefresh();
                }}
                className="text-[11px] text-slate-400 hover:text-rose-600"
              >
                Dismiss type forever
              </button>
            </div>

            {items.map((loop) => {
              const primaryPage = pageMap.get(loop.pageIds[0] ?? '');
              return (
                <article
                  key={loop.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        {loop.kind === 'comparing'
                          ? `Comparing ${loop.pageIds.length} products`
                          : primaryPage?.title ?? 'Unfinished item'}
                      </h4>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-400">{loop.reason}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {primaryPage && (
                        <a
                          href={primaryPage.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 font-medium text-white hover:bg-blue-700"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await openLoopsService.markDone(loop.id);
                          onRefresh();
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
                      >
                        <Check className="h-3 w-3" /> Done
                      </button>
                      <button
                        type="button"
                        title="Snooze this loop for 1 day"
                        onClick={async () => {
                          await openLoopsService.snooze(loop.id, '1d');
                          onRefresh();
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
                      >
                        <Clock className="h-3 w-3" /> Snooze 1d
                      </button>
                      <button
                        type="button"
                        title="Snooze this loop for 1 week"
                        onClick={async () => {
                          await openLoopsService.snooze(loop.id, '1w');
                          onRefresh();
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
                      >
                        Snooze 1w
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss loop"
                        onClick={async () => {
                          await openLoopsService.markDone(loop.id);
                          onRefresh();
                        }}
                        className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Side-by-side comparison table built from extracted price fields (FR-OL-7) */}
                  {loop.comparisonRows && loop.comparisonRows.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full border-collapse text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
                            <th className="py-1.5 pr-3">Product</th>
                            <th className="py-1.5 pr-3">Price</th>
                            <th className="py-1.5">Site</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {loop.comparisonRows.map((row) => (
                            <tr key={row.pageId}>
                              <td className="py-1.5 pr-3 font-medium">
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-700 hover:underline dark:text-blue-400"
                                >
                                  {row.title}
                                </a>
                              </td>
                              <td className="py-1.5 pr-3 font-semibold text-emerald-700 dark:text-emerald-400">
                                {row.price?.raw ?? '—'}
                              </td>
                              <td className="py-1.5 text-slate-500">{row.domain}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
