import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bell,
  CalendarDays,
  HelpCircle,
  Layers,
  MessageSquareText,
  Network,
  Route,
  Scale,
  Settings,
  Shield,
  Trash2,
} from 'lucide-react';
import type { PageRecord, SnapshotRecord } from '@/shared/types';
import { memoryStore } from '@/core/store/memoryStore';
import { AskPanel } from '@/ui/components/AskPanel';
import { DecisionsPanel } from '@/ui/components/DecisionsPanel';
import { GraphView } from '@/ui/components/GraphView';
import { HelpPanel } from '@/ui/components/HelpPanel';
import { InspectorPanel } from '@/ui/components/InspectorPanel';
import { JourneysPanel } from '@/ui/components/JourneysPanel';
import { LockGate } from '@/ui/components/LockGate';
import { LoopsPanel } from '@/ui/components/LoopsPanel';
import { OnboardingWizard } from '@/ui/components/OnboardingWizard';
import { PrivacyDashboard } from '@/ui/components/PrivacyDashboard';
import { RecapPanel } from '@/ui/components/RecapPanel';
import { SettingsPanel } from '@/ui/components/SettingsPanel';
import { TabRescuePanel } from '@/ui/components/TabRescuePanel';
import { WatchPanel } from '@/ui/components/WatchPanel';
import { useTrailmindData } from '@/ui/hooks/useTrailmindData';
import '@/ui/styles/global.css';

type AppRoute =
  | 'onboarding'
  | 'graph'
  | 'ask'
  | 'decisions'
  | 'rescue'
  | 'journeys'
  | 'loops'
  | 'watch'
  | 'recap'
  | 'inspector'
  | 'privacy'
  | 'settings'
  | 'help'
  | 'snapshot';

function parseHashRoute(): { route: AppRoute; param?: string; query?: string } {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { route: 'graph' };
  const [pathPart, qs] = raw.split('?');
  const params = new URLSearchParams(qs ?? '');
  const [head, arg] = (pathPart ?? '').split('/');
  const valid: AppRoute[] = [
    'onboarding',
    'graph',
    'ask',
    'decisions',
    'rescue',
    'journeys',
    'loops',
    'watch',
    'recap',
    'inspector',
    'privacy',
    'settings',
    'help',
    'snapshot',
  ];
  const route = valid.includes(head as AppRoute) ? (head as AppRoute) : 'graph';
  return { route, param: arg, query: params.get('q') ?? undefined };
}

/**
 * Sandboxed Snapshot Reader host (FR-SN-3, SEC-5):
 * Loads encrypted snapshot versions locally and posts DOMPurify-sanitized HTML to the sandboxed iframe.
 */
function SnapshotHostView({ pageId, onBack }: { pageId: string; onBack: () => void }) {
  const [page, setPage] = useState<PageRecord | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    void Promise.all([
      memoryStore.getPage(pageId),
      memoryStore.listSnapshotsForPage(pageId),
    ]).then(([p, snaps]) => {
      setPage(p ?? null);
      setSnapshots(snaps);
      setSelectedIndex(0);
    });
  }, [pageId]);

  const active = snapshots[selectedIndex];

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !active) return;
    win.postMessage(
      {
        type: 'RENDER_SNAPSHOT',
        payload: {
          title: active.title,
          url: page?.url ?? '',
          capturedAt: active.capturedAt,
          status: page?.status ?? 'full',
          sanitizedHtml: active.sanitizedHtml,
          text: active.text,
          screenshotPng: active.screenshotPng,
        },
      },
      '*',
    );
  }, [active, page]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium dark:border-slate-700"
          >
            ← Back
          </button>
          <div>
            <div className="font-semibold">{page?.title ?? 'Saved Snapshot'}</div>
            <div className="text-[11px] text-slate-500">
              {active
                ? `Captured on ${new Date(active.capturedAt).toLocaleString()} · ${snapshots.length} saved version(s)`
                : 'No snapshot text saved for this page.'}
              {page?.status === 'gone' && ' · Page gone, snapshot kept'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {snapshots.length > 1 && (
            <select
              aria-label="Choose snapshot version"
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
            >
              {snapshots.map((s, idx) => (
                <option key={s.id} value={idx}>
                  Version {snapshots.length - idx} · {new Date(s.capturedAt).toLocaleString()}
                </option>
              ))}
            </select>
          )}
          {page?.url && (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
            >
              Open live page
            </a>
          )}
        </div>
      </div>

      {/* Sandboxed iframe (SEC-5: zero script execution, isolated from extension APIs) */}
      <iframe
        ref={iframeRef}
        title="Sandboxed snapshot reader"
        src="snapshot.html"
        onLoad={() => {
          if (!active || !iframeRef.current?.contentWindow) return;
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'RENDER_SNAPSHOT',
              payload: {
                title: active.title,
                url: page?.url ?? '',
                capturedAt: active.capturedAt,
                status: page?.status ?? 'full',
                sanitizedHtml: active.sanitizedHtml,
                text: active.text,
                screenshotPng: active.screenshotPng,
              },
            },
            '*',
          );
        }}
        className="h-[72vh] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800"
      />
    </div>
  );
}

const NAV_ITEMS: Array<{ id: AppRoute; label: string; icon: typeof Network }> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'ask', label: 'Ask Memory', icon: MessageSquareText },
  { id: 'decisions', label: 'Decisions & Radar', icon: Scale },
  { id: 'rescue', label: 'Tab Rescue', icon: Trash2 },
  { id: 'journeys', label: 'Journeys', icon: Route },
  { id: 'loops', label: 'Open Loops', icon: Layers },
  { id: 'watch', label: 'Change Watch', icon: Bell },
  { id: 'recap', label: 'Weekly Recap', icon: CalendarDays },
  { id: 'inspector', label: 'Routing Inspector', icon: Activity },
  { id: 'privacy', label: 'Privacy & Export', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help & Routing', icon: HelpCircle },
];

function FullPageApp() {
  const data = useTrailmindData();
  const initial = parseHashRoute();
  const [route, setRoute] = useState<AppRoute>(initial.route);
  const [routeParam, setRouteParam] = useState<string | undefined>(initial.param);
  const [askQuery, setAskQuery] = useState<string>(initial.query ?? '');
  const [jumpClusterId, setJumpClusterId] = useState<string | undefined>();

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHashRoute();
      setRoute(parsed.route);
      setRouteParam(parsed.param);
      if (parsed.query) setAskQuery(parsed.query);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!data.loading && !data.settings.onboardingCompleted && !window.location.hash) {
      setRoute('onboarding');
    }
  }, [data.loading, data.settings.onboardingCompleted]);

  function navigate(next: AppRoute, param?: string) {
    setRoute(next);
    setRouteParam(param);
    window.location.hash = param ? `${next}/${param}` : next;
  }

  return (
    <LockGate
      locked={data.locked}
      webAuthnCredentialId={data.settings.lockWebAuthnCredentialId}
      onUnlocked={() => void data.refresh()}
    >
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
        {/* Sidebar */}
        {route !== 'onboarding' && (
          <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5">
              <h1 className="text-base font-bold tracking-tight">Trailmind</h1>
              <p className="text-[11px] text-slate-500">Your browsing, remembered.</p>
            </div>
            <nav aria-label="Main navigation" className="flex-1 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = route === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={() => navigate('onboarding')}
              className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300"
            >
              Import History &amp; Setup
            </button>
          </aside>
        )}

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {data.loading ? (
            <p className="py-16 text-center text-sm text-slate-500">Loading Trailmind…</p>
          ) : route === 'onboarding' ? (
            <OnboardingWizard
              settings={data.settings}
              onComplete={async () => {
                await data.refresh();
                navigate('graph');
              }}
            />
          ) : route === 'snapshot' && routeParam ? (
            <SnapshotHostView pageId={routeParam} onBack={() => navigate('graph')} />
          ) : route === 'graph' ? (
            <GraphView
              pages={data.pages}
              clusters={data.clusters}
              nodes={data.nodes}
              edges={data.edges}
              loops={data.loops}
              backfillProgress={data.backfillProgress}
              initialClusterId={jumpClusterId}
              onRefresh={() => void data.refresh()}
              onOpenSnapshot={(pid) => navigate('snapshot', pid)}
              onBuildDecisionMatrix={(cid) => navigate('decisions', cid)}
            />
          ) : route === 'ask' ? (
            <AskPanel
              initialQuery={askQuery}
              onOpenSnapshot={(pid) => navigate('snapshot', pid)}
            />
          ) : route === 'decisions' ? (
            <DecisionsPanel initialClusterId={routeParam} />
          ) : route === 'rescue' ? (
            <TabRescuePanel
              onRescued={() => void data.refresh()}
              onGoToJourneys={() => navigate('journeys')}
            />
          ) : route === 'journeys' ? (
            <JourneysPanel
              journeys={data.journeys}
              pages={data.pages}
              onRefresh={() => void data.refresh()}
            />
          ) : route === 'loops' ? (
            <LoopsPanel
              loops={data.loops}
              pages={data.pages}
              onRefresh={() => void data.refresh()}
            />
          ) : route === 'watch' ? (
            <WatchPanel watches={data.watches} onRefresh={() => void data.refresh()} />
          ) : route === 'recap' ? (
            <RecapPanel
              recaps={data.recaps}
              onRefresh={() => void data.refresh()}
              onJumpToCluster={(cid) => {
                setJumpClusterId(cid);
                navigate('graph');
              }}
            />
          ) : route === 'inspector' ? (
            <InspectorPanel logs={data.routingLogs} onRefresh={() => void data.refresh()} />
          ) : route === 'privacy' ? (
            <PrivacyDashboard
              settings={data.settings}
              logs={data.routingLogs}
              onRefresh={() => void data.refresh()}
            />
          ) : route === 'settings' ? (
            <SettingsPanel settings={data.settings} onRefresh={() => void data.refresh()} />
          ) : (
            <HelpPanel />
          )}
        </main>
      </div>
    </LockGate>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FullPageApp />
  </StrictMode>,
);
