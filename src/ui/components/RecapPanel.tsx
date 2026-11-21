import { useState } from 'react';
import { CalendarDays, Cloud, Download, Sparkles } from 'lucide-react';
import type { RecapRecord } from '@/shared/types';
import { weeklyRecapService } from '@/features/recap/weeklyRecapService';
import { AiBadge } from './AiBadge';

interface RecapPanelProps {
  recaps: RecapRecord[];
  onRefresh: () => void;
  onJumpToCluster?: (clusterId: string) => void;
}

/**
 * Weekly Recap screen (FR-WR-1..FR-WR-5):
 * Shows top topics, new entities, time by cluster bar chart, completed journeys, open loops,
 * changes detected, archive switcher, optional stats-only cloud polish, and zero-URL PNG share card.
 */
export function RecapPanel({ recaps, onRefresh, onJumpToCluster }: RecapPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(recaps[0]?.id ?? null);
  const [generating, setGenerating] = useState(false);

  const active = recaps.find((r) => r.id === selectedId) ?? recaps[0] ?? null;

  async function handleGenerate(polishWithCloud: boolean) {
    setGenerating(true);
    try {
      const created = await weeklyRecapService.generateRecap({ polishWithCloud });
      setSelectedId(created.id);
      onRefresh();
    } finally {
      setGenerating(false);
    }
  }

  function handleDownloadShareCard() {
    if (!active) return;
    const dataUrl = weeklyRecapService.renderShareCardDataUrl(active);
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `trailmind-recap-${active.week}.png`;
    a.click();
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {recaps.length > 1 && (
            <select
              aria-label="Select archived week"
              value={active?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              {recaps.map((r) => (
                <option key={r.id} value={r.id}>
                  Week {r.week}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={generating}
            onClick={() => handleGenerate(false)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generating ? 'Building…' : 'Generate on-device'}
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={() => handleGenerate(true)}
            title="Sends only aggregated topic counts — zero page text or URLs"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <Cloud className="h-3.5 w-3.5" /> Polish with cloud (stats only)
          </button>
          {active && (
            <button
              type="button"
              onClick={handleDownloadShareCard}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
            >
              <Download className="h-3.5 w-3.5" /> Share PNG
            </button>
          )}
        </div>
      </div>

      {!active ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <CalendarDays className="mb-3 h-7 w-7 text-blue-600" aria-hidden="true" />
          <h3 className="text-sm font-semibold">No weekly recap generated yet</h3>
          <p className="mt-1 max-w-xs text-slate-500">
            Every Sunday evening Trailmind summarizes your top topics, discoveries, journeys, and
            open loops privately on-device.
          </p>
        </div>
      ) : (
        <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Week {active.week} Recap</h2>
              <p className="text-[11px] text-slate-500">
                {new Date(active.startDate).toLocaleDateString()} –{' '}
                {new Date(active.endDate).toLocaleDateString()}
              </p>
            </div>
            <AiBadge source={active.aiSource} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
              <div className="text-[11px] text-slate-500">Pages read</div>
              <div className="text-lg font-semibold">{active.stats.pagesRead}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
              <div className="text-[11px] text-slate-500">Active time</div>
              <div className="text-lg font-semibold">{active.stats.totalActiveMinutes}m</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
              <div className="text-[11px] text-slate-500">Journeys</div>
              <div className="text-lg font-semibold">{active.stats.journeysCompleted}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70">
              <div className="text-[11px] text-slate-500">Open loops / Changes</div>
              <div className="text-lg font-semibold">
                {active.stats.openLoopsCount} / {active.stats.changesDetected}
              </div>
            </div>
          </div>

          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {active.text}
          </p>

          {/* Time chart by cluster with graph links (FR-WR-3) */}
          {active.stats.timeByCluster.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-600 dark:text-slate-300">Time by cluster</h3>
              {active.stats.timeByCluster.map((item) => {
                const maxMins = Math.max(1, ...active.stats.timeByCluster.map((c) => c.minutes));
                const pct = Math.max(8, Math.round((item.minutes / maxMins) * 100));
                return (
                  <button
                    key={item.clusterId}
                    type="button"
                    onClick={() => onJumpToCluster?.(item.clusterId)}
                    className="flex w-full items-center gap-3 text-left hover:opacity-85"
                  >
                    <span className="w-36 truncate font-medium">{item.clusterName}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: item.color }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-[11px] text-slate-500">
                      {item.minutes}m
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {active.stats.newEntities.length > 0 && (
            <div>
              <h3 className="mb-1.5 font-semibold text-slate-600 dark:text-slate-300">
                New tools & entities discovered
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {active.stats.newEntities.map((ent) => (
                  <span
                    key={ent.name}
                    className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                  >
                    {ent.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
