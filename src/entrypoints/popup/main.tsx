import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
  Clock,
  HelpCircle,
  Layers,
  Maximize2,
  Network,
  Pause,
  Play,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { memoryStore } from '@/core/store/memoryStore';
import { applyTheme } from '@/ui/hooks/useTrailmindData';
import '@/ui/styles/global.css';

interface PopupSummary {
  pausedGlobal: boolean;
  pausedUntil?: number;
  tabPaused: boolean;
  demoMode: boolean;
  todayCount: number;
  totalPages: number;
  openLoopsCount: number;
  watchesCount: number;
}

function PopupApp() {
  const [summary, setSummary] = useState<PopupSummary>({
    pausedGlobal: false,
    tabPaused: false,
    demoMode: false,
    todayCount: 0,
    totalPages: 0,
    openLoopsCount: 0,
    watchesCount: 0,
  });
  const [activeTab, setActiveTab] = useState<{ id?: number; url?: string; title?: string }>({});
  const [openTabsCount, setOpenTabsCount] = useState(0);
  const [quickQuery, setQuickQuery] = useState('');
  const [toast, setToast] = useState('');

  async function loadSummary() {
    await memoryStore.init();
    const settings = await memoryStore.getSettings();
    applyTheme(settings.theme);

    let tab: chrome.tabs.Tab | undefined;
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const windowTabs = await chrome.tabs.query({ currentWindow: true });
      tab = windowTabs.find((t) => t.active);
      setOpenTabsCount(
        windowTabs.filter((t) => !t.pinned && !t.active && t.url?.startsWith('http')).length,
      );
      setActiveTab({ id: tab?.id, url: tab?.url, title: tab?.title });
    }

    const [pages, loops, watches] = await Promise.all([
      memoryStore.listPages(),
      memoryStore.listLoops(),
      memoryStore.listWatches(),
    ]);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    setSummary({
      pausedGlobal: settings.capturePausedGlobal,
      pausedUntil: settings.capturePausedUntil,
      tabPaused: tab?.id !== undefined && settings.pausedTabIds.includes(tab.id),
      demoMode: settings.demoMode,
      todayCount: pages.filter((p) => p.lastSeen >= todayStart.getTime()).length,
      totalPages: pages.length,
      openLoopsCount: loops.filter((l) => l.state === 'open').length,
      watchesCount: watches.filter((w) => w.enabled).length,
    });
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  const isTimedPauseActive = Boolean(summary.pausedUntil && Date.now() < summary.pausedUntil);
  const isRecording = !summary.pausedGlobal && !isTimedPauseActive && !summary.tabPaused;

  async function toggleGlobalPause() {
    await memoryStore.saveSettings({
      capturePausedGlobal: !summary.pausedGlobal,
      capturePausedUntil: undefined,
    });
    await loadSummary();
  }

  async function pauseForMinutes(minutes: number) {
    await memoryStore.saveSettings({
      capturePausedGlobal: false,
      capturePausedUntil: Date.now() + minutes * 60_000,
    });
    setToast(`Recording paused for ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}.`);
    await loadSummary();
  }

  async function toggleTabPause() {
    if (activeTab.id === undefined) return;
    const settings = await memoryStore.getSettings();
    const next = settings.pausedTabIds.includes(activeTab.id)
      ? settings.pausedTabIds.filter((id) => id !== activeTab.id)
      : [...settings.pausedTabIds, activeTab.id];
    await memoryStore.saveSettings({ pausedTabIds: next });
    await loadSummary();
  }

  async function handleForget(minutes: number) {
    const removed = await memoryStore.forgetLastMinutes(minutes);
    setToast(`Forgot ${removed} page${removed === 1 ? '' : 's'} from the last ${minutes} min.`);
    await loadSummary();
  }

  async function handleWatchCurrent() {
    if (!activeTab.url || !activeTab.url.startsWith('http')) {
      setToast('Open a web page to watch it for changes.');
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: 'WATCH_CURRENT_PAGE',
        payload: { url: activeTab.url, title: activeTab.title || activeTab.url },
      },
      () => {
        setToast('Added current page to Change Watch.');
        void loadSummary();
      },
    );
  }

  function openSidePanel() {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', payload: { tab: 'graph' } });
    window.close();
  }

  function openFullApp(hash = '') {
    chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${hash}`) });
    window.close();
  }

  function handleQuickSearch(e: FormEvent) {
    e.preventDefault();
    if (!quickQuery.trim()) return;
    openFullApp(`#ask?q=${encodeURIComponent(quickQuery.trim())}`);
  }

  return (
    <div className="space-y-3 p-4 text-xs">
      {/* Header & Recording status */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isRecording ? 'bg-emerald-500' : 'bg-slate-400'}`}
          />
          <div>
            <h1 className="text-sm font-bold tracking-tight">Trailmind</h1>
            <p className="text-[11px] text-slate-500">
              {isRecording
                ? 'Remembering on-device'
                : summary.tabPaused
                  ? 'Paused on this tab'
                  : 'Recording paused'}
            </p>
          </div>
        </div>
      </header>

      {/* Quick Search (FR-ASK-1) */}
      <form onSubmit={handleQuickSearch} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          type="search"
          value={quickQuery}
          onChange={(e) => setQuickQuery(e.target.value)}
          placeholder="Ask your memory… (Alt+M on any page)"
          aria-label="Quick ask your memory"
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      </form>

      {/* Today stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
          <div className="text-base font-bold">{summary.todayCount}</div>
          <div className="text-[10px] text-slate-500">Today</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
          <div className="text-base font-bold text-blue-600 dark:text-blue-400">
            {summary.openLoopsCount}
          </div>
          <div className="text-[10px] text-slate-500">Open loops</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
          <div className="text-base font-bold">{summary.totalPages}</div>
          <div className="text-[10px] text-slate-500">Total pages</div>
        </div>
      </div>

      {/* Pause controls (FR-CAP-10, FR-PRV-2) */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={toggleGlobalPause}
            className={`inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-2 font-medium ${
              summary.pausedGlobal
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900'
            }`}
          >
            {summary.pausedGlobal ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {summary.pausedGlobal ? 'Resume all' : 'Pause all'}
          </button>
          <button
            type="button"
            onClick={toggleTabPause}
            className="flex-1 rounded-lg border border-slate-300 px-2.5 py-2 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            {summary.tabPaused ? 'Resume tab' : 'Pause tab'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-1 text-[11px]">
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Clock className="h-3 w-3" /> Pause:
          </span>
          <button
            type="button"
            onClick={() => pauseForMinutes(15)}
            className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 dark:border-slate-800"
          >
            15m
          </button>
          <button
            type="button"
            onClick={() => pauseForMinutes(60)}
            className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 dark:border-slate-800"
          >
            1h
          </button>
          <button
            type="button"
            onClick={() => pauseForMinutes(12 * 60)}
            className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 dark:border-slate-800"
          >
            Tomorrow
          </button>
        </div>
      </div>

      {/* Quick Forget + Watch Page (FR-PRV-4, FR-CW-2) */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => handleForget(15)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" /> Forget 15m
        </button>
        <button
          type="button"
          onClick={() => handleForget(60)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" /> Forget 1h
        </button>
      </div>

      <button
        type="button"
        onClick={handleWatchCurrent}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
      >
        <Bell className="h-3.5 w-3.5 text-blue-600" /> Watch this page for changes
      </button>

      <button
        type="button"
        onClick={() => openFullApp('#rescue')}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 py-1.5 font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200"
      >
        <Layers className="h-3.5 w-3.5" />
        {openTabsCount > 0
          ? `Rescue ${openTabsCount} open tab${openTabsCount === 1 ? '' : 's'} (~${openTabsCount * 75} MB RAM)`
          : 'Tab Graveyard Rescue'}
      </button>

      {toast && (
        <p role="status" className="rounded-lg bg-blue-50 p-2 text-[11px] text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
          {toast}
        </p>
      )}

      {/* Navigation Footer */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <button
          type="button"
          onClick={openSidePanel}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 py-2 font-semibold text-white hover:bg-blue-700"
        >
          <Network className="h-3.5 w-3.5" /> Open Side Panel
        </button>
        <button
          type="button"
          onClick={() => openFullApp('#graph')}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 py-2 font-medium hover:bg-slate-50 dark:border-slate-700"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Full View
        </button>
      </div>

      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
        <button
          type="button"
          onClick={() => openFullApp('#settings')}
          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200"
        >
          <Settings className="h-3.5 w-3.5" /> Settings & Privacy
        </button>
        <button
          type="button"
          onClick={() => openFullApp('#help')}
          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200"
        >
          <HelpCircle className="h-3.5 w-3.5" /> Help & Routing
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
