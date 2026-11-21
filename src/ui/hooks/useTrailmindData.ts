import { useCallback, useEffect, useState } from 'react';
import type {
  BackfillProgress,
  ClusterRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  JourneyRecord,
  LoopRecord,
  PageRecord,
  RecapRecord,
  RoutingLogRecord,
  SettingsRecord,
  WatchRecord,
} from '@/shared/types';
import { createDefaultSettings } from '@/shared/constants';
import { cryptoService } from '@/core/crypto/encryption';
import { memoryStore } from '@/core/store/memoryStore';

export interface TrailmindDataState {
  loading: boolean;
  locked: boolean;
  settings: SettingsRecord;
  pages: PageRecord[];
  clusters: ClusterRecord[];
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  journeys: JourneyRecord[];
  loops: LoopRecord[];
  watches: WatchRecord[];
  recaps: RecapRecord[];
  routingLogs: RoutingLogRecord[];
  backfillProgress: BackfillProgress | null;
  refresh: () => Promise<void>;
}

export function applyTheme(theme: SettingsRecord['theme']): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
}

export function useTrailmindData(): TrailmindDataState {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [settings, setSettings] = useState<SettingsRecord>(() => createDefaultSettings());
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [clusters, setClusters] = useState<ClusterRecord[]>([]);
  const [nodes, setNodes] = useState<GraphNodeRecord[]>([]);
  const [edges, setEdges] = useState<GraphEdgeRecord[]>([]);
  const [journeys, setJourneys] = useState<JourneyRecord[]>([]);
  const [loops, setLoops] = useState<LoopRecord[]>([]);
  const [watches, setWatches] = useState<WatchRecord[]>([]);
  const [recaps, setRecaps] = useState<RecapRecord[]>([]);
  const [routingLogs, setRoutingLogs] = useState<RoutingLogRecord[]>([]);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);

  const refresh = useCallback(async () => {
    try {
      await memoryStore.init();
      const s = await memoryStore.getSettings();
      setSettings(s);
      applyTheme(s.theme);

      if (cryptoService.isLocked()) {
        setLocked(true);
        setLoading(false);
        return;
      }
      setLocked(false);

      const [p, c, n, e, j, l, w, r, logs] = await Promise.all([
        memoryStore.listPages(),
        memoryStore.listClusters(),
        memoryStore.listNodes(),
        memoryStore.listEdges(),
        memoryStore.listJourneys(),
        memoryStore.listLoops(),
        memoryStore.listWatches(),
        memoryStore.listRecaps(),
        memoryStore.listRoutingLog(300),
      ]);

      setPages(p);
      setClusters(c);
      setNodes(n);
      setEdges(e);
      setJourneys(j);
      setLoops(l);
      setWatches(w);
      setRecaps(r);
      setRoutingLogs(logs);

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          { type: 'GET_BACKFILL_PROGRESS' },
          (res: { ok?: boolean; data?: BackfillProgress } | undefined) => {
            if (!chrome.runtime.lastError && res?.ok && res.data) {
              setBackfillProgress(res.data);
            }
          },
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    locked,
    settings,
    pages,
    clusters,
    nodes,
    edges,
    journeys,
    loops,
    watches,
    recaps,
    routingLogs,
    backfillProgress,
    refresh,
  };
}
