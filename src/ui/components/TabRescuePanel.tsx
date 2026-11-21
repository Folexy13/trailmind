import { useEffect, useState } from 'react';
import { CheckCircle2, Layers, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { TabRescueOutcome, TabRescuePlan } from '@/shared/types';
import { tabRescueService } from '@/features/tabRescue/tabRescueService';

interface TabRescuePanelProps {
  onRescued: () => void;
  onGoToJourneys?: () => void;
}

/**
 * Tab Graveyard Rescue panel:
 * Scans all open Chrome tabs in the current window, flags duplicates & already-saved tabs,
 * estimates RAM reclaimed, archives into encrypted Journeys, and closes rescued tabs in one click.
 */
export function TabRescuePanel({ onRescued, onGoToJourneys }: TabRescuePanelProps) {
  const [plan, setPlan] = useState<TabRescuePlan | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [rescuing, setRescuing] = useState(false);
  const [outcome, setOutcome] = useState<TabRescueOutcome | null>(null);

  async function scanTabs() {
    setScanning(true);
    setOutcome(null);
    try {
      const next = await tabRescueService.scanCurrentChromeWindow();
      setPlan(next);
      // Pre-select all non-active, non-pinned tabs for 1-click rescue
      setSelectedIds(
        new Set(
          next.rescuableTabs.filter((t) => !t.active && !t.pinned).map((t) => t.tabId),
        ),
      );
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    void scanTabs();
  }, []);

  function toggleTab(tabId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  }

  async function handleRescue(closeTabs: boolean) {
    if (!plan) return;
    setRescuing(true);
    try {
      const chosen = plan.rescuableTabs.filter((t) => selectedIds.has(t.tabId));
      const res = await tabRescueService.executeRescue(chosen, { closeTabs });
      setOutcome(res);
      onRescued();
      const refreshed = await tabRescueService.scanCurrentChromeWindow();
      setPlan(refreshed);
      setSelectedIds(
        new Set(
          refreshed.rescuableTabs.filter((t) => !t.active && !t.pinned).map((t) => t.tabId),
        ),
      );
    } finally {
      setRescuing(false);
    }
  }

  const selectedCount = selectedIds.size;
  const estRamSelectedMb = selectedCount * 75;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-blue-600" /> Tab Graveyard Rescue
          </h2>
          <p className="mt-0.5 text-slate-500">
            Stop keeping 40 tabs open out of fear of losing them. Archive every open tab into
            encrypted searchable memory &amp; resumable Tab-Group Journeys, then reclaim Chrome RAM
            in one click.
          </p>
        </div>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void scanTabs()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} /> Rescan window
        </button>
      </div>

      {outcome && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <strong>Rescued {outcome.archivedCount} tabs</strong> into{' '}
              <strong>{outcome.journeysCreated} pinned Journeys</strong>
              {outcome.closedCount > 0 &&
                ` · Closed ${outcome.closedCount} tabs (~${outcome.estimatedRamFreedMb} MB RAM freed)`}
              .
            </span>
          </div>
          {onGoToJourneys && (
            <button
              type="button"
              onClick={onGoToJourneys}
              className="rounded-lg bg-emerald-700 px-3 py-1 font-semibold text-white hover:bg-emerald-800"
            >
              View in Journeys →
            </button>
          )}
        </div>
      )}

      {plan && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Rescuable tabs</div>
              <div className="mt-0.5 text-lg font-bold">{plan.rescuableTabs.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Duplicate tabs</div>
              <div className="mt-0.5 text-lg font-bold text-amber-600">{plan.duplicateCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Already in memory</div>
              <div className="mt-0.5 text-lg font-bold text-emerald-600">
                {plan.alreadySavedCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500">Est. RAM reclaimable</div>
              <div className="mt-0.5 text-lg font-bold text-blue-600">
                ~{estRamSelectedMb >= 1000 ? `${(estRamSelectedMb / 1024).toFixed(1)} GB` : `${estRamSelectedMb} MB`}
              </div>
            </div>
          </div>

          {plan.rescuableTabs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
              Your current Chrome window is already spotless — no open web tabs to rescue.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={rescuing || selectedCount === 0}
                  onClick={() => void handleRescue(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {rescuing
                    ? 'Rescuing tabs…'
                    : `Archive & Close ${selectedCount} Tab${selectedCount === 1 ? '' : 's'} (~${estRamSelectedMb} MB freed)`}
                </button>
                <button
                  type="button"
                  disabled={rescuing || selectedCount === 0}
                  onClick={() => void handleRescue(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                >
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" /> Archive Only (Keep Tabs Open)
                </button>
              </div>

              <div className="space-y-3">
                {plan.groups.map((group) => (
                  <section
                    key={group.label}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold">
                        {group.label}{' '}
                        <span className="font-normal text-slate-500">({group.tabs.length})</span>
                      </h3>
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {group.tabs.map((tab) => (
                        <li key={tab.tabId} className="flex items-center justify-between gap-2 py-2">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(tab.tabId)}
                              disabled={tab.active || tab.pinned}
                              onChange={() => toggleTab(tab.tabId)}
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{tab.title}</div>
                              <div className="truncate text-[11px] text-slate-500">{tab.domain}</div>
                            </div>
                          </label>
                          <div className="flex shrink-0 items-center gap-1">
                            {tab.isDuplicate && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                Duplicate
                              </span>
                            )}
                            {tab.alreadyInMemory && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                                Saved
                              </span>
                            )}
                            {tab.pinned && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Pinned (kept)
                              </span>
                            )}
                            {tab.active && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                                Current tab
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
