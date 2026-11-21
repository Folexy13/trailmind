import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma, { DEFAULT_STYLES } from 'sigma';
import {
  Camera,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Filter,
  GitMerge,
  List,
  Network,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BackfillProgress,
  ClusterRecord,
  FactRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  LoopRecord,
  NodeKind,
  PageRecord,
  VisitRecord,
} from '@/shared/types';
import { graphEngine } from '@/core/graph/graphEngine';
import { memoryStore } from '@/core/store/memoryStore';
import { AiBadge } from './AiBadge';

interface GraphViewProps {
  pages: PageRecord[];
  clusters: ClusterRecord[];
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  loops: LoopRecord[];
  backfillProgress?: BackfillProgress | null;
  initialClusterId?: string;
  initialPageId?: string;
  onRefresh: () => void;
  onOpenSnapshot: (pageId: string) => void;
  onBuildDecisionMatrix?: (clusterId: string) => void;
  onPauseBackfill?: (paused: boolean) => void;
}

const NODE_KIND_COLORS: Record<NodeKind, string> = {
  page: '#2563eb',
  search: '#0d9488',
  site: '#64748b',
  topic: '#7c3aed',
  entity: '#d97706',
  journey: '#059669',
  highlight: '#e11d48',
};

/**
 * Interactive Sigma.js WebGL Knowledge Graph (FR-GR-1..FR-GR-11, NFR-PF-8, NFR-UX-2):
 *  - Two zoom levels: Cluster bubbles & Detail nodes/edges (double-click cluster to expand)
 *  - Timeline date-range slider with animated Play button
 *  - Combined AND filters (node type, site, topic, cluster, has open loop, has snapshot)
 *  - Accessible List View toggle (WCAG 2.2 AA)
 *  - Node Detail Drawer (summary, facts, highlights, snapshot link, dead-link badge, star screenshot, visits, forget)
 *  - Cluster rename, pin, hide, merge (survives re-clustering)
 */
export function GraphView({
  pages,
  clusters,
  nodes,
  edges,
  loops,
  backfillProgress,
  initialClusterId,
  initialPageId,
  onRefresh,
  onOpenSnapshot,
  onBuildDecisionMatrix,
  onPauseBackfill,
}: GraphViewProps) {
  const sigmaContainerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [zoomLevel, setZoomLevel] = useState<'clusters' | 'detail'>(
    initialClusterId || initialPageId ? 'detail' : 'clusters',
  );
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(initialClusterId ?? null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(initialPageId ?? null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Combined AND filters (FR-GR-8)
  const [filterKind, setFilterKind] = useState<NodeKind | 'all'>('all');
  const [filterDomain, setFilterDomain] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [filterHasLoop, setFilterHasLoop] = useState(false);
  const [filterHasSnapshot, setFilterHasSnapshot] = useState(false);
  const [showHiddenClusters, setShowHiddenClusters] = useState(false);

  // Timeline slider + play animation (FR-GR-7)
  const timeBounds = useMemo(() => {
    if (pages.length === 0) return { min: Date.now() - 7 * 86400000, max: Date.now() };
    const times = pages.map((p) => p.lastSeen);
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [pages]);

  const [timelineEnd, setTimelineEnd] = useState<number>(timeBounds.max);
  const [playingTimeline, setPlayingTimeline] = useState(false);

  useEffect(() => {
    setTimelineEnd(timeBounds.max);
  }, [timeBounds.max]);

  useEffect(() => {
    if (!playingTimeline) return;
    const step = Math.max(3600_000, Math.round((timeBounds.max - timeBounds.min) / 30));
    const timer = window.setInterval(() => {
      setTimelineEnd((prev) => {
        if (prev >= timeBounds.max) {
          setPlayingTimeline(false);
          return timeBounds.max;
        }
        return Math.min(timeBounds.max, prev + step);
      });
    }, 300);
    return () => window.clearInterval(timer);
  }, [playingTimeline, timeBounds.min, timeBounds.max]);

  // Drawer details
  const [drawerFacts, setDrawerFacts] = useState<FactRecord[]>([]);
  const [drawerVisits, setDrawerVisits] = useState<VisitRecord[]>([]);
  const [drawerSnapshotCount, setDrawerSnapshotCount] = useState(0);
  const [renamingClusterId, setRenamingClusterId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [reclustering, setReclustering] = useState(false);
  const autoReclusteredRef = useRef(false);
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );

  // React immediately when the user switches between Light, Dark, and System theme
  useEffect(() => {
    const syncTheme = () => setIsDarkTheme(document.documentElement.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Auto-upgrade fragmented legacy singleton clusters (e.g. from older metadata-only imports)
  useEffect(() => {
    if (autoReclusteredRef.current || reclustering) return;
    if (pages.length > 40 && clusters.length > 35) {
      autoReclusteredRef.current = true;
      setReclustering(true);
      void graphEngine
        .rebuildGraphAndClusters({ nameWithAi: false })
        .then(() => onRefresh())
        .finally(() => setReclustering(false));
    }
  }, [pages.length, clusters.length, reclustering, onRefresh]);

  const pageMap = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const clusterMap = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);
  const loopPageIds = useMemo(
    () => new Set(loops.filter((l) => l.state === 'open').flatMap((l) => l.pageIds)),
    [loops],
  );

  useEffect(() => {
    if (!selectedPageId) {
      setDrawerFacts([]);
      setDrawerVisits([]);
      setDrawerSnapshotCount(0);
      return;
    }
    void Promise.all([
      memoryStore.listFactsForPage(selectedPageId),
      memoryStore.listVisitsForPage(selectedPageId),
      memoryStore.listSnapshotsForPage(selectedPageId),
    ]).then(([f, v, s]) => {
      setDrawerFacts(f);
      setDrawerVisits(v);
      setDrawerSnapshotCount(s.length);
    });
  }, [selectedPageId]);

  const visibleClusters = useMemo(
    () =>
      clusters
        .filter((c) => showHiddenClusters || !c.hidden)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.pageIds.length - a.pageIds.length),
    [clusters, showHiddenClusters],
  );

  // Apply AND filters + timeline window (FR-GR-7, FR-GR-8)
  const filteredPages = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return pages.filter((p) => {
      if (p.firstSeen > timelineEnd) return false;
      if (focusedClusterId && p.clusterId !== focusedClusterId) return false;
      if (filterDomain && !p.domain.toLowerCase().includes(filterDomain.toLowerCase())) return false;
      if (
        filterTopic &&
        !p.topics.some((t) => t.toLowerCase().includes(filterTopic.toLowerCase())) &&
        !p.englishTopics.some((t) => t.toLowerCase().includes(filterTopic.toLowerCase()))
      ) {
        return false;
      }
      if (filterHasLoop && !loopPageIds.has(p.id)) return false;
      if (filterHasSnapshot && p.status === 'metadata_only') return false;
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.summary.toLowerCase().includes(q) &&
        !p.domain.toLowerCase().includes(q) &&
        !p.englishTopics.some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [
    pages,
    timelineEnd,
    focusedClusterId,
    filterDomain,
    filterTopic,
    filterHasLoop,
    filterHasSnapshot,
    loopPageIds,
    searchTerm,
  ]);

  const filteredPageIdSet = useMemo(() => new Set(filteredPages.map((p) => p.id)), [filteredPages]);

  // Render Sigma.js WebGL Graph (FR-GR-5, FR-GR-6)
  useEffect(() => {
    const container = sigmaContainerRef.current;

    const killSigmaSafely = () => {
      if (sigmaRef.current) {
        try {
          sigmaRef.current.kill();
        } catch {
          // Ignore DOM cleanup races if container already detached
        }
        sigmaRef.current = null;
      }
      if (container) {
        container.replaceChildren();
      }
    };

    if (viewMode !== 'graph' || !container) {
      killSigmaSafely();
      return;
    }

    killSigmaSafely();

    const g = new Graph({ type: 'undirected', allowSelfLoops: false });
    const labelColor = isDarkTheme ? '#f1f5f9' : '#0f172a';
    const backdropColor = isDarkTheme ? '#1e293b' : '#ffffff';
    const edgeColor = isDarkTheme ? '#334155' : '#94a3b8';

    if (zoomLevel === 'clusters' && !focusedClusterId) {
      // Cluster bubble level: each bubble sized by page count in screen pixels, spaced in a golden spiral (FR-GR-6)
      const activeClusters = visibleClusters
        .filter((c) => c.pageIds.some((pid) => filteredPageIdSet.has(pid)))
        .slice(0, 40);
      const maxCount = Math.max(
        1,
        ...activeClusters.map(
          (c) => c.pageIds.filter((pid) => filteredPageIdSet.has(pid)).length,
        ),
      );
      activeClusters.forEach((cluster, idx) => {
        const goldenAngle = idx * 2.3999632;
        const radius = idx === 0 ? 0 : Math.sqrt(idx) * 28;
        const matchingPages = cluster.pageIds.filter((pid) => filteredPageIdSet.has(pid)).length;
        const norm = Math.sqrt(matchingPages / maxCount);
        g.addNode(`cluster:${cluster.id}`, {
          label: `${cluster.name} (${matchingPages})`,
          x: Math.cos(goldenAngle) * radius,
          y: Math.sin(goldenAngle) * radius,
          size: Math.round(11 + norm * 21), // clean 11px..32px screen-pixel bubbles
          color: cluster.color,
        });
      });

      // Connect clusters that share topics OR have cross-cluster navigation edges
      const pageIdToCluster = new Map<string, string>();
      for (const c of activeClusters) {
        for (const pid of c.pageIds) pageIdToCluster.set(pid, c.id);
      }
      const clusterLinkWeight = new Map<string, number>();
      for (const edge of edges) {
        if (!edge.from.startsWith('page:') || !edge.to.startsWith('page:')) continue;
        const cA = pageIdToCluster.get(edge.from.slice(5));
        const cB = pageIdToCluster.get(edge.to.slice(5));
        if (!cA || !cB || cA === cB) continue;
        const pairKey = cA < cB ? `${cA}|${cB}` : `${cB}|${cA}`;
        clusterLinkWeight.set(pairKey, (clusterLinkWeight.get(pairKey) ?? 0) + 1);
      }

      // Connect each cluster to its top 3 strongest linked neighbors so edges stay clean and readable
      const clusterPairs: Array<{ a: string; b: string; weight: number }> = [];
      for (let i = 0; i < activeClusters.length; i++) {
        for (let j = i + 1; j < activeClusters.length; j++) {
          const a = activeClusters[i]!;
          const b = activeClusters[j]!;
          const topicOverlap = a.topics.some((t) => b.topics.includes(t)) ? 3 : 0;
          const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          const navLinks = clusterLinkWeight.get(pairKey) ?? 0;
          const weight = topicOverlap + navLinks;
          if (weight >= 2) {
            clusterPairs.push({ a: a.id, b: b.id, weight });
          }
        }
      }
      clusterPairs.sort((x, y) => y.weight - x.weight);
      const degree = new Map<string, number>();
      for (const pair of clusterPairs) {
        const degA = degree.get(pair.a) ?? 0;
        const degB = degree.get(pair.b) ?? 0;
        if (degA >= 3 && degB >= 3) continue;
        g.addEdge(`cluster:${pair.a}`, `cluster:${pair.b}`, {
          color: edgeColor,
          size: Math.min(2.2, 0.8 + Math.log2(pair.weight) * 0.35),
        });
        degree.set(pair.a, degA + 1);
        degree.set(pair.b, degB + 1);
      }
    } else {
      // Detail level: always include every filtered page directly + connected non-page nodes (FR-GR-1, FR-GR-2)
      const detailNodesMap = new Map<string, GraphNodeRecord>();

      if (filterKind === 'all' || filterKind === 'page') {
        for (const p of filteredPages) {
          detailNodesMap.set(`page:${p.id}`, {
            id: `page:${p.id}`,
            kind: 'page',
            label: p.title,
            clusterId: p.clusterId,
            weight: p.bookmarked ? 3 : 1.5,
            refId: p.id,
            firstSeen: p.firstSeen,
            lastSeen: p.lastSeen,
          });
        }
      }

      for (const n of nodes) {
        if (n.kind === 'page') continue;
        if (n.firstSeen > timelineEnd) continue;
        if (filterKind !== 'all' && n.kind !== filterKind) continue;
        if (focusedClusterId && n.clusterId !== focusedClusterId) continue;
        detailNodesMap.set(n.id, n);
      }

      const capped = Array.from(detailNodesMap.values()).slice(0, 5000);
      const total = Math.max(1, capped.length);

      capped.forEach((node, idx) => {
        const goldenAngle = idx * 2.3999632;
        const r = Math.sqrt(idx + 1) * 14;
        const clusterColor = node.clusterId ? clusterMap.get(node.clusterId)?.color : undefined;
        const isHighlighted =
          searchTerm.trim().length > 0 &&
          node.label.toLowerCase().includes(searchTerm.trim().toLowerCase());
        const page = node.kind === 'page' && node.refId ? pageMap.get(node.refId) : undefined;
        const baseColor =
          page?.status === 'gone'
            ? '#f43f5e'
            : page?.status === 'metadata_only'
              ? clusterColor ?? '#64748b'
              : clusterColor ?? NODE_KIND_COLORS[node.kind];

        g.addNode(node.id, {
          label: node.label.slice(0, 38),
          x: Math.cos(goldenAngle) * r + (idx % total) * 0.001,
          y: Math.sin(goldenAngle) * r,
          size: isHighlighted
            ? 12
            : node.kind === 'page'
              ? 7
              : node.kind === 'topic' || node.kind === 'journey'
                ? 9
                : 5,
          color: isHighlighted ? '#eab308' : baseColor,
        });
      });

      for (const edge of edges) {
        if (g.hasNode(edge.from) && g.hasNode(edge.to) && !g.hasEdge(edge.from, edge.to)) {
          g.addEdge(edge.from, edge.to, {
            color: edge.kind === 'search-to-result' ? '#0d9488' : edgeColor,
            size: Math.min(2.5, 0.8 + edge.weight * 0.25),
          });
        }
      }
    }

    if (g.order === 0) return;

    try {
      const sigma = new Sigma(g, container, {
        styles: {
          nodes: {
            ...DEFAULT_STYLES.nodes,
            labelColor,
            backdropColor,
          },
          edges: {
            ...DEFAULT_STYLES.edges,
          },
        },
        settings: {
          itemSizesReference: 'screen',
          stagePadding: 64,
          renderLabels: true,
          labelDensity: 0.9,
          labelRenderedSizeThreshold: 6,
          allowInvalidContainer: true,
        },
      });

      sigma.on('clickNode', ({ node }) => {
        if (node.startsWith('cluster:')) {
          const cid = node.replace('cluster:', '');
          setFocusedClusterId(cid);
          setZoomLevel('detail');
        } else if (node.startsWith('page:')) {
          setSelectedPageId(node.replace('page:', ''));
        }
      });

      sigma.on('doubleClickNode', ({ node }) => {
        if (node.startsWith('cluster:')) {
          const cid = node.replace('cluster:', '');
          setFocusedClusterId(cid);
          setZoomLevel('detail');
        }
      });

      sigmaRef.current = sigma;
    } catch {
      // Fallback safely to List view in headless/non-WebGL environments
      setViewMode('list');
    }

    return () => {
      killSigmaSafely();
    };
  }, [
    viewMode,
    zoomLevel,
    focusedClusterId,
    visibleClusters,
    filteredPages,
    nodes,
    edges,
    filteredPageIdSet,
    timelineEnd,
    filterKind,
    searchTerm,
    clusterMap,
    pageMap,
    isDarkTheme,
  ]);

  const selectedPage = selectedPageId ? pageMap.get(selectedPageId) : undefined;
  const focusedCluster = focusedClusterId ? clusterMap.get(focusedClusterId) : undefined;

  async function handleStarAndScreenshot(page: PageRecord) {
    await memoryStore.putPage({ ...page, starred: !page.starred, updatedAt: Date.now() });
    if (!page.starred && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STAR_SCREENSHOT',
        payload: { pageId: page.id },
      });
    }
    onRefresh();
  }

  async function handleForgetPage(pageId: string) {
    await memoryStore.forgetPages([pageId]);
    setSelectedPageId(null);
    onRefresh();
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <Network className="mb-3 h-8 w-8 text-blue-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Your memory graph is empty</h2>
        <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
          Browse normally or import your Chrome history in Onboarding to build your private,
          searchable knowledge graph on-device.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {backfillProgress?.running && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
        >
          <div>
            <strong>Backfill running:</strong> {backfillProgress.done}/{backfillProgress.total} pages
            enriched ({backfillProgress.estimatedMinutesLeft}m left). You can keep browsing.
          </div>
          {onPauseBackfill && (
            <button
              type="button"
              onClick={() => onPauseBackfill(!backfillProgress.paused)}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
            >
              {backfillProgress.paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Filter graph nodes"
            placeholder="Highlight pages, topics, domains…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              setZoomLevel('clusters');
              setFocusedClusterId(null);
            }}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              zoomLevel === 'clusters' && !focusedClusterId
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Clusters
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel('detail')}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              zoomLevel === 'detail' || focusedClusterId
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Detail
          </button>
        </div>

        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'graph' ? 'list' : 'graph')}
          aria-label={viewMode === 'graph' ? 'Switch to accessible list view' : 'Switch to WebGL graph view'}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          {viewMode === 'graph' ? (
            <>
              <List className="h-3.5 w-3.5" aria-hidden="true" /> List
            </>
          ) : (
            <>
              <Network className="h-3.5 w-3.5" aria-hidden="true" /> Graph
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden="true" /> Filters
        </button>

        <button
          type="button"
          disabled={reclustering}
          onClick={async () => {
            setReclustering(true);
            try {
              await graphEngine.rebuildGraphAndClusters({ nameWithAi: false });
              onRefresh();
            } finally {
              setReclustering(false);
            }
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${reclustering ? 'animate-spin' : ''}`} aria-hidden="true" />
          {reclustering ? 'Clustering…' : 'Re-cluster'}
        </button>
      </div>

      {/* Combined AND Filter Bar (FR-GR-8) */}
      {showFilters && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-500">Node type</span>
            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as NodeKind | 'all')}
              className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">All types</option>
              <option value="page">Page</option>
              <option value="search">Search</option>
              <option value="site">Site</option>
              <option value="topic">Topic</option>
              <option value="entity">Entity</option>
              <option value="journey">Journey</option>
              <option value="highlight">Highlight</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-500">Site / Domain</span>
            <input
              type="text"
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
              placeholder="e.g. github.com"
              className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-500">Topic</span>
            <input
              type="text"
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
              placeholder="e.g. Hybrid AI"
              className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={filterHasLoop}
              onChange={(e) => setFilterHasLoop(e.target.checked)}
            />
            <span>Has open loop</span>
          </label>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={filterHasSnapshot}
              onChange={(e) => setFilterHasSnapshot(e.target.checked)}
            />
            <span>Has snapshot</span>
          </label>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={showHiddenClusters}
              onChange={(e) => setShowHiddenClusters(e.target.checked)}
            />
            <span>Show hidden clusters</span>
          </label>
        </div>
      )}

      {/* Focused Cluster Banner with Rename / Pin / Hide / Merge (FR-GR-10) */}
      {focusedCluster && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: focusedCluster.color }}
            />
            {renamingClusterId === focusedCluster.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await graphEngine.renameCluster(focusedCluster.id, renameValue);
                  setRenamingClusterId(null);
                  onRefresh();
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  autoFocus
                />
                <button type="submit" className="rounded bg-blue-600 px-2 py-0.5 text-white">
                  Save
                </button>
              </form>
            ) : (
              <div>
                <span className="font-semibold">{focusedCluster.name}</span>
                <span className="ml-2 text-slate-500">{focusedCluster.summary}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onBuildDecisionMatrix && (
              <button
                type="button"
                onClick={() => onBuildDecisionMatrix(focusedCluster.id)}
                className="rounded bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-700"
              >
                Decision Matrix
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRenamingClusterId(focusedCluster.id);
                setRenameValue(focusedCluster.name);
              }}
              className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={async () => {
                await graphEngine.toggleClusterPin(focusedCluster.id);
                onRefresh();
              }}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
            >
              <Pin className="h-3 w-3" /> {focusedCluster.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={async () => {
                await graphEngine.toggleClusterHidden(focusedCluster.id);
                setFocusedClusterId(null);
                onRefresh();
              }}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
            >
              {focusedCluster.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {focusedCluster.hidden ? 'Unhide' : 'Hide'}
            </button>
            {visibleClusters.length > 1 && (
              <div className="inline-flex items-center gap-1">
                <select
                  aria-label="Merge into cluster"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Merge into…</option>
                  {visibleClusters
                    .filter((c) => c.id !== focusedCluster.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                {mergeTargetId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await graphEngine.mergeClusters(focusedCluster.id, mergeTargetId);
                      setFocusedClusterId(mergeTargetId);
                      setMergeTargetId('');
                      onRefresh();
                    }}
                    className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-white"
                  >
                    <GitMerge className="h-3 w-3" /> Merge
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setFocusedClusterId(null);
                setZoomLevel('clusters');
              }}
              className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700"
            >
              All clusters
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas or Accessible List View */}
      <div className="grid min-h-[380px] flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${
            selectedPage ? 'lg:col-span-2' : 'lg:col-span-3'
          }`}
        >
          {/* Keep Sigma WebGL host permanently isolated from React List children so toggling never causes DOM removeChild collisions */}
          <div
            key="sigma-canvas-host"
            ref={sigmaContainerRef}
            className={`sigma-canvas-container h-[560px] w-full ${viewMode === 'graph' ? 'block' : 'hidden'}`}
          />
          {viewMode === 'list' && (
            <div
              key="accessible-list-view"
              className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto p-2 dark:divide-slate-800"
            >
              {zoomLevel === 'clusters' && !focusedClusterId ? (
                visibleClusters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setFocusedClusterId(c.id);
                      setZoomLevel('detail');
                    }}
                    className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      <div>
                        <div className="text-sm font-medium">
                          {c.name} {c.pinned ? '· Pinned' : ''}
                        </div>
                        <div className="text-xs text-slate-500">{c.summary}</div>
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">
                      {c.pageIds.length} pages
                    </span>
                  </button>
                ))
              ) : (
                filteredPages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPageId(p.id)}
                    className={`flex w-full items-start justify-between gap-2 rounded-lg p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                      p.status === 'metadata_only' ? 'border border-dashed border-slate-300 dark:border-slate-700' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{p.title}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {p.domain} · {new Date(p.lastSeen).toLocaleDateString()}
                        {p.price ? ` · ${p.price.raw}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {p.status === 'gone' && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          Page gone, snapshot kept
                        </span>
                      )}
                      {p.status === 'metadata_only' && (
                        <span className="rounded border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] text-slate-500">
                          Metadata only
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Node Detail Drawer (FR-GR-9) */}
        {selectedPage && (
          <aside
            aria-label="Page node details"
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-snug">{selectedPage.title}</h3>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{selectedPage.domain}</p>
              </div>
              <button
                type="button"
                aria-label="Close detail drawer"
                onClick={() => setSelectedPageId(null)}
                className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <AiBadge source={selectedPage.aiSource} compact />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize dark:bg-slate-800">
                {selectedPage.type}
              </span>
              {selectedPage.status === 'gone' && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  Page gone, snapshot kept
                </span>
              )}
              {selectedPage.price && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  {selectedPage.price.raw}
                </span>
              )}
            </div>

            {selectedPage.summary && (
              <p className="leading-relaxed text-slate-700 dark:text-slate-300">
                {selectedPage.summary}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              <a
                href={selectedPage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 font-medium text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open page
              </a>
              <button
                type="button"
                onClick={() => onOpenSnapshot(selectedPage.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5" /> Snapshot ({drawerSnapshotCount})
              </button>
              <button
                type="button"
                onClick={() => handleStarAndScreenshot(selectedPage)}
                title="Star page & capture optional screenshot (FR-SN-5)"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 hover:bg-slate-50 dark:border-slate-700"
              >
                <Star
                  className={`h-3.5 w-3.5 ${selectedPage.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                />
                <Camera className="h-3 w-3 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => handleForgetPage(selectedPage.id)}
                title="Forget this page completely"
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {drawerFacts.length > 0 && (
              <div>
                <h4 className="mb-1.5 font-semibold text-slate-600 dark:text-slate-300">
                  Extracted facts & highlights
                </h4>
                <ul className="space-y-1.5">
                  {drawerFacts.map((f) => (
                    <li
                      key={f.id}
                      className={`rounded-lg p-2 ${
                        f.highlight
                          ? 'border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
                          : 'bg-slate-50 dark:bg-slate-800/70'
                      }`}
                    >
                      {f.highlight && (
                        <span className="mr-1 font-semibold text-amber-700 dark:text-amber-300">
                          Highlight:
                        </span>
                      )}
                      {f.fromImage && (
                        <span className="mr-1 font-semibold text-blue-700 dark:text-blue-300">
                          [Image]:
                        </span>
                      )}
                      {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {drawerVisits.length > 0 && (
              <div>
                <h4 className="mb-1 font-semibold text-slate-600 dark:text-slate-300">
                  Visits ({drawerVisits.length})
                </h4>
                <ul className="space-y-1 text-[11px] text-slate-500">
                  {drawerVisits.slice(-4).reverse().map((v) => (
                    <li key={v.id}>
                      {new Date(v.time).toLocaleString()} · {Math.round(v.activeMs / 1000)}s ·{' '}
                      {v.maxScroll}% scrolled
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Timeline Slider with Play Animation (FR-GR-7) */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => {
            if (!playingTimeline && timelineEnd >= timeBounds.max) {
              setTimelineEnd(timeBounds.min);
            }
            setPlayingTimeline((p) => !p);
          }}
          aria-label={playingTimeline ? 'Pause timeline animation' : 'Play timeline animation'}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {playingTimeline ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <input
          type="range"
          min={timeBounds.min}
          max={timeBounds.max}
          value={timelineEnd}
          onChange={(e) => setTimelineEnd(Number(e.target.value))}
          aria-label="Filter graph timeline up to date"
          className="flex-1 accent-blue-600"
        />
        <span className="whitespace-nowrap text-[11px] font-medium text-slate-600 dark:text-slate-300">
          Up to {new Date(timelineEnd).toLocaleDateString()} ({filteredPages.length} pages)
        </span>
        {timelineEnd < timeBounds.max && (
          <button
            type="button"
            aria-label="Reset timeline"
            onClick={() => setTimelineEnd(timeBounds.max)}
            className="text-slate-500 hover:text-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
