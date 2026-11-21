import { CheckCircle2, Download, ExternalLink, GitBranch, Pin, Play, Route } from 'lucide-react';
import type { JourneyRecord, PageRecord } from '@/shared/types';
import { exportService } from '@/features/export/exportService';
import { journeysService } from '@/features/journeys/journeysService';
import { AiBadge } from './AiBadge';

interface JourneysPanelProps {
  journeys: JourneyRecord[];
  pages: PageRecord[];
  onRefresh: () => void;
}

/**
 * Journeys screen (FR-JR-1..FR-JR-6):
 * Horizontal path of page cards with branch indicators, 2-sentence outcome summary,
 * multi-day linked journeys, "Resume journey" tab-group opener, pin/done actions, and export.
 */
export function JourneysPanel({ journeys, pages, onRefresh }: JourneysPanelProps) {
  const pageMap = new Map(pages.map((p) => [p.id, p]));

  async function handleResume(journeyId: string) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'RESUME_JOURNEY',
        payload: { journeyId, maxTabs: 6 },
      });
    } else {
      await journeysService.resumeJourneyInTabGroup(journeyId, 6);
    }
  }

  async function handleExportJourney(journey: JourneyRecord) {
    const res = await exportService.exportObsidianZip({ kind: 'journey', id: journey.id });
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (journeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <Route className="mb-3 h-8 w-8 text-blue-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold">No journeys recorded yet</h2>
        <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
          Each browsing session becomes a replayable path from your first search to your final page,
          ready to resume as a Chrome tab group.
        </p>
      </div>
    );
  }

  const sorted = [...journeys].sort(
    (a, b) => Number(b.state === 'pinned') - Number(a.state === 'pinned') || b.end - a.end,
  );

  return (
    <div className="space-y-3">
      {sorted.map((journey) => {
        const journeyPages = journey.pageIds
          .map((id) => pageMap.get(id))
          .filter((p): p is PageRecord => Boolean(p));
        const branchFromIds = new Set(journey.branches.map((b) => b.fromPageId));

        return (
          <article
            key={journey.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{journey.name}</h3>
                  <AiBadge source={journey.aiSource} compact />
                  {journey.state === 'pinned' && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                      Pinned
                    </span>
                  )}
                  {journey.state === 'done' && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      Done
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{journey.outcome}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {new Date(journey.start).toLocaleString()} · {journeyPages.length} pages
                  {journey.linkedJourneyIds.length > 0 &&
                    ` · Continues across ${journey.linkedJourneyIds.length + 1} sessions`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleResume(journey.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Play className="h-3 w-3" aria-hidden="true" /> Resume
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await journeysService.setJourneyState(
                      journey.id,
                      journey.state === 'pinned' ? 'active' : 'pinned',
                    );
                    onRefresh();
                  }}
                  title="Pin journey"
                  className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-700"
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await journeysService.setJourneyState(
                      journey.id,
                      journey.state === 'done' ? 'active' : 'done',
                    );
                    onRefresh();
                  }}
                  title="Mark done"
                  className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleExportJourney(journey)}
                  title="Export journey to Obsidian Markdown ZIP"
                  className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-700"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Horizontal path of page cards with branch markers (FR-JR-3) */}
            <div className="mt-3 flex items-stretch gap-2 overflow-x-auto pb-1">
              {journeyPages.map((p, idx) => (
                <div key={`${p.id}_${idx}`} className="flex items-center gap-2">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-44 shrink-0 flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800/70"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="line-clamp-2 font-medium">{p.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span className="truncate">{p.domain}</span>
                      {branchFromIds.has(p.id) && (
                        <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                          <GitBranch className="h-3 w-3" /> branch
                        </span>
                      )}
                    </div>
                  </a>
                  {idx < journeyPages.length - 1 && (
                    <span className="text-slate-400" aria-hidden="true">
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
