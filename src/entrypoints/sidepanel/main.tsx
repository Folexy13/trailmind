import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bell,
  CalendarDays,
  Layers,
  Maximize2,
  MessageSquareText,
  Network,
  Route,
  Scale,
  Trash2,
} from 'lucide-react';
import { AskPanel } from '@/ui/components/AskPanel';
import { DecisionsPanel } from '@/ui/components/DecisionsPanel';
import { GraphView } from '@/ui/components/GraphView';
import { InspectorPanel } from '@/ui/components/InspectorPanel';
import { JourneysPanel } from '@/ui/components/JourneysPanel';
import { LockGate } from '@/ui/components/LockGate';
import { LoopsPanel } from '@/ui/components/LoopsPanel';
import { RecapPanel } from '@/ui/components/RecapPanel';
import { TabRescuePanel } from '@/ui/components/TabRescuePanel';
import { WatchPanel } from '@/ui/components/WatchPanel';
import { useTrailmindData } from '@/ui/hooks/useTrailmindData';
import '@/ui/styles/global.css';

type SideTab =
  | 'graph'
  | 'ask'
  | 'decisions'
  | 'rescue'
  | 'journeys'
  | 'loops'
  | 'watch'
  | 'recap'
  | 'inspector';

const TABS: Array<{ id: SideTab; label: string; icon: typeof Network }> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'ask', label: 'Ask', icon: MessageSquareText },
  { id: 'decisions', label: 'Decisions', icon: Scale },
  { id: 'rescue', label: 'Rescue', icon: Trash2 },
  { id: 'journeys', label: 'Journeys', icon: Route },
  { id: 'loops', label: 'Loops', icon: Layers },
  { id: 'watch', label: 'Watch', icon: Bell },
  { id: 'recap', label: 'Recap', icon: CalendarDays },
  { id: 'inspector', label: 'Inspector', icon: Activity },
];

function SidePanelApp() {
  const data = useTrailmindData();
  const [activeTab, setActiveTab] = useState<SideTab>('graph');
  const [navClusterId, setNavClusterId] = useState<string | undefined>();
  const [navPageId, setNavPageId] = useState<string | undefined>();

  // Honor navigation targets set when clicking the in-page "Seen before" chip (FR-SB-3)
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
      chrome.storage.session.get('tm_panel_nav', (res) => {
        const nav = res.tm_panel_nav as { tab?: SideTab; pageId?: string; clusterId?: string } | undefined;
        if (nav) {
          if (nav.tab) setActiveTab(nav.tab);
          if (nav.pageId) setNavPageId(nav.pageId);
          if (nav.clusterId) setNavClusterId(nav.clusterId);
          void chrome.storage.session.remove('tm_panel_nav');
        }
      });
    }
  }, []);

  function openSnapshotInFullApp(pageId: string) {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#snapshot/${pageId}`) });
    } else {
      window.open(`app.html#snapshot/${pageId}`, '_blank');
    }
  }

  function openFullView() {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${activeTab}`) });
    } else {
      window.open(`app.html#${activeTab}`, '_blank');
    }
  }

  const openLoopCount = data.loops.filter((l) => l.state === 'open').length;

  return (
    <LockGate
      locked={data.locked}
      webAuthnCredentialId={data.settings.lockWebAuthnCredentialId}
      onUnlocked={() => void data.refresh()}
    >
      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold tracking-tight">Trailmind</h1>
              <p className="text-[10px] text-slate-500">Your browsing, remembered. On your device.</p>
            </div>
            <button
              type="button"
              onClick={openFullView}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              <Maximize2 className="h-3 w-3" /> Full view
            </button>
          </div>

          {/* Responsive Tab Navigation (320px+ NFR-UX-5) */}
          <nav aria-label="Trailmind views" className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={selected ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    selected
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {tab.id === 'loops' && openLoopCount > 0 && (
                    <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{openLoopCount}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 p-3">
          {data.loading ? (
            <p className="py-12 text-center text-xs text-slate-500">Decrypting local memory…</p>
          ) : activeTab === 'graph' ? (
            <GraphView
              pages={data.pages}
              clusters={data.clusters}
              nodes={data.nodes}
              edges={data.edges}
              loops={data.loops}
              backfillProgress={data.backfillProgress}
              initialClusterId={navClusterId}
              initialPageId={navPageId}
              onRefresh={() => void data.refresh()}
              onOpenSnapshot={openSnapshotInFullApp}
              onBuildDecisionMatrix={(cid) => {
                setNavClusterId(cid);
                setActiveTab('decisions');
              }}
              onPauseBackfill={(paused) => {
                chrome.runtime?.sendMessage({ type: 'PAUSE_BACKFILL', payload: { paused } });
                void data.refresh();
              }}
            />
          ) : activeTab === 'ask' ? (
            <AskPanel onOpenSnapshot={openSnapshotInFullApp} />
          ) : activeTab === 'decisions' ? (
            <DecisionsPanel initialClusterId={navClusterId} />
          ) : activeTab === 'rescue' ? (
            <TabRescuePanel
              onRescued={() => void data.refresh()}
              onGoToJourneys={() => setActiveTab('journeys')}
            />
          ) : activeTab === 'journeys' ? (
            <JourneysPanel
              journeys={data.journeys}
              pages={data.pages}
              onRefresh={() => void data.refresh()}
            />
          ) : activeTab === 'loops' ? (
            <LoopsPanel
              loops={data.loops}
              pages={data.pages}
              onRefresh={() => void data.refresh()}
            />
          ) : activeTab === 'watch' ? (
            <WatchPanel watches={data.watches} onRefresh={() => void data.refresh()} />
          ) : activeTab === 'recap' ? (
            <RecapPanel
              recaps={data.recaps}
              onRefresh={() => void data.refresh()}
              onJumpToCluster={(cid) => {
                setNavClusterId(cid);
                setActiveTab('graph');
              }}
            />
          ) : (
            <InspectorPanel logs={data.routingLogs} onRefresh={() => void data.refresh()} />
          )}
        </main>
      </div>
    </LockGate>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
