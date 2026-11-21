import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { CLUSTER_PALETTE } from '@/shared/constants';
import type {
  ClusterRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  PageRecord,
} from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { cosineSimilarityInt8 } from '@/core/embeddings/embeddingEngine';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const MAX_TOP_CLUSTERS = 24;

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'about', 'into', 'home',
  'page', 'search', 'google', 'login', 'sign', 'http', 'https', 'www', 'com', 'org', 'net',
  'what', 'when', 'where', 'which', 'how', 'why', 'will', 'have', 'been', 'more', 'free',
]);

function getRootDomain(domain: string): string {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  // Preserve IPv4 addresses intact (e.g. 192.168.0.1) instead of slicing to "0.1"
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean)) {
    return clean;
  }
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  // Preserve multi-part ccTLDs like .co.uk, .com.ng, .gov.ng
  const secondLast = parts[parts.length - 2] ?? '';
  if (['co', 'com', 'org', 'gov', 'edu', 'ac', 'net'].includes(secondLast) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function formatDomainClusterName(rootDomain: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rootDomain)) {
    return `Local (${rootDomain})`;
  }
  const base = rootDomain.split('.')[0] ?? rootDomain;
  const known: Record<string, string> = {
    github: 'GitHub',
    youtube: 'YouTube',
    google: 'Google Search',
    chatgpt: 'ChatGPT',
    stackoverflow: 'Stack Overflow',
    linkedin: 'LinkedIn',
    reddit: 'Reddit',
    medium: 'Medium',
    wikipedia: 'Wikipedia',
    firebase: 'Firebase',
    tiktok: 'TikTok',
    twitter: 'X / Twitter',
    x: 'X / Twitter',
    notion: 'Notion',
    figma: 'Figma',
    amazon: 'Amazon',
    jumia: 'Jumia',
  };
  return known[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));
}

function extractTitleKeywords(title: string): string[] {
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !TITLE_STOPWORDS.has(w)),
    ),
  ).slice(0, 6);
}

/**
 * Core Graph & Incremental Clustering Engine (FR-GR-1 to FR-GR-4, FR-GR-10).
 * Combines page embedding similarity + shared English topics + root domains + title keywords
 * via O(N) sparse graph construction and Louvain community detection, while preserving
 * stable cluster IDs and user renames/pins/hides across re-runs.
 */
export class GraphEngine {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  async rebuildGraphAndClusters(options?: { nameWithAi?: boolean }): Promise<{
    nodes: GraphNodeRecord[];
    edges: GraphEdgeRecord[];
    clusters: ClusterRecord[];
  }> {
    const [pages, visits, facts, embeddings, existingClusters, existingNodes] = await Promise.all([
      this.store.listPages(),
      this.store.listAllVisits(),
      this.store.listAllFacts(),
      this.store.listAllEmbeddings(),
      this.store.listClusters(),
      this.store.listNodes(),
    ]);

    const pageEmbeddings = new Map<string, number[]>();
    for (const emb of embeddings) {
      if (emb.ownerKind === 'page') {
        pageEmbeddings.set(emb.pageId, emb.vector);
      }
    }

    // 1. Build sparse O(N) undirected page similarity graph for Louvain clustering (FR-GR-3)
    const simGraph = new Graph({ type: 'undirected', allowSelfLoops: false });
    for (const page of pages) {
      simGraph.addNode(page.id);
    }

    const addWeight = (aId: string, bId: string, delta: number) => {
      if (aId === bId || !simGraph.hasNode(aId) || !simGraph.hasNode(bId)) return;
      if (simGraph.hasEdge(aId, bId)) {
        const prev = (simGraph.getEdgeAttribute(aId, bId, 'weight') as number) ?? 0;
        simGraph.setEdgeAttribute(aId, bId, 'weight', prev + delta);
      } else {
        simGraph.addEdge(aId, bId, { weight: delta });
      }
    };

    // Connect pages sharing topics, root domain, or meaningful title keywords using star/chain topology (O(N))
    const byTopic = new Map<string, string[]>();
    const byRootDomain = new Map<string, string[]>();
    const byTitleKeyword = new Map<string, string[]>();

    for (const p of pages) {
      const topics = p.englishTopics.length ? p.englishTopics : p.topics;
      for (const rawTopic of topics) {
        const key = rawTopic.toLowerCase().trim();
        if (!key) continue;
        const arr = byTopic.get(key) ?? [];
        arr.push(p.id);
        byTopic.set(key, arr);
      }

      const root = getRootDomain(p.domain);
      if (root) {
        const arr = byRootDomain.get(root) ?? [];
        arr.push(p.id);
        byRootDomain.set(root, arr);
      }

      // For metadata-only pages (before AI extraction), also link via distinctive title keywords
      if (topics.length === 0) {
        for (const kw of extractTitleKeywords(p.title)) {
          const arr = byTitleKeyword.get(kw) ?? [];
          arr.push(p.id);
          byTitleKeyword.set(kw, arr);
        }
      }
    }

    const connectBucket = (ids: string[], weight: number) => {
      if (ids.length < 2) return;
      // Hub + chain keeps graph sparse (O(N) edges) while tightly grouping every community
      const hub = ids[0]!;
      for (let i = 1; i < ids.length; i++) {
        addWeight(hub, ids[i]!, weight);
        if (i > 1) addWeight(ids[i - 1]!, ids[i]!, weight * 0.5);
      }
    };

    for (const ids of byTopic.values()) connectBucket(ids, 2.0);
    for (const ids of byRootDomain.values()) connectBucket(ids, 1.2);
    for (const ids of byTitleKeyword.values()) {
      // Ignore ultra-common generic words across > 60 pages
      if (ids.length >= 2 && ids.length <= 60) {
        connectBucket(ids, 0.7);
      }
    }

    // Add embedding similarity edges for AI-enriched pages (bounded to keep clustering fast)
    const embeddedPages = pages.filter((p) => pageEmbeddings.has(p.id)).slice(0, 300);
    for (let i = 0; i < embeddedPages.length; i++) {
      const a = embeddedPages[i]!;
      const vecA = pageEmbeddings.get(a.id)!;
      for (let j = i + 1; j < embeddedPages.length; j++) {
        const b = embeddedPages[j]!;
        const cos = cosineSimilarityInt8(vecA, pageEmbeddings.get(b.id)!);
        if (cos >= 0.48) {
          addWeight(a.id, b.id, cos * 1.5);
        }
      }
    }

    // Run deterministic Louvain community assignment
    const communityByPage: Record<string, number> =
      simGraph.order > 0 && simGraph.size > 0
        ? louvain(simGraph, { getEdgeWeight: 'weight', rng: () => 0.5 })
        : Object.fromEntries(pages.map((p, idx) => [p.id, idx]));

    const groupedPages = new Map<number, PageRecord[]>();
    for (const page of pages) {
      const comm = communityByPage[page.id] ?? 0;
      const list = groupedPages.get(comm) ?? [];
      list.push(page);
      groupedPages.set(comm, list);
    }

    // Keep the top MAX_TOP_CLUSTERS meaningful communities and fold tiny long-tail orphans into "Other Browsing"
    const rawGroups = Array.from(groupedPages.values()).sort((a, b) => b.length - a.length);
    const sortedGroups: PageRecord[][] = [];
    const overflowPages: PageRecord[] = [];
    const isLargeHistory = pages.length > 40;

    for (const group of rawGroups) {
      const tooSmallForLargeGraph = isLargeHistory && group.length === 1 && sortedGroups.length >= 8;
      if (sortedGroups.length < MAX_TOP_CLUSTERS && !tooSmallForLargeGraph) {
        sortedGroups.push(group);
      } else {
        overflowPages.push(...group);
      }
    }
    if (overflowPages.length > 0) {
      sortedGroups.push(overflowPages);
    }

    // 2. Match new communities to existing clusters by maximum page overlap so IDs & user edits survive (FR-GR-3, FR-GR-10)
    const usedExistingIds = new Set<string>();
    const newClusters: ClusterRecord[] = [];
    const pageToClusterId = new Map<string, string>();
    const now = Date.now();

    for (let idx = 0; idx < sortedGroups.length; idx++) {
      const group = sortedGroups[idx]!;
      const isOverflowGroup = overflowPages.length > 0 && idx === sortedGroups.length - 1;
      const groupPageIds = group.map((p) => p.id);
      const groupSet = new Set(groupPageIds);

      let bestMatch: ClusterRecord | null = null;
      let bestOverlap = 0;
      for (const existing of existingClusters) {
        if (usedExistingIds.has(existing.id)) continue;
        let overlap = 0;
        for (const pid of existing.pageIds) {
          if (groupSet.has(pid)) overlap++;
        }
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestMatch = existing;
        }
      }

      const topicCounts = new Map<string, number>();
      const domainCounts = new Map<string, number>();
      for (const p of group) {
        const root = getRootDomain(p.domain);
        if (root) domainCounts.set(root, (domainCounts.get(root) ?? 0) + 1);
        for (const t of p.englishTopics.length ? p.englishTopics : p.topics) {
          const clean = t.trim();
          if (!clean) continue;
          topicCounts.set(clean, (topicCounts.get(clean) ?? 0) + 1);
        }
      }
      const topTopics = Array.from(topicCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);
      const topDomains = Array.from(domainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([d]) => d);

      const fallbackName = isOverflowGroup
        ? 'Other Browsing'
        : topTopics.slice(0, 2).join(' & ') ||
          (topDomains[0] ? formatDomainClusterName(topDomains[0]) : `Topic ${idx + 1}`);
      const fallbackSummary = isOverflowGroup
        ? `${group.length} single-visit pages across ${domainCounts.size} sites.`
        : `${group.length} page${group.length === 1 ? '' : 's'} covering ${topTopics.slice(0, 3).join(', ') || topDomains.join(', ') || 'recent browsing'}.`;

      const clusterId = bestMatch ? bestMatch.id : `clu_${groupPageIds[0] ?? idx}`;
      if (bestMatch) usedExistingIds.add(bestMatch.id);

      let name = bestMatch?.userRenamed ? bestMatch.name : fallbackName;
      let summary = bestMatch?.userRenamed ? bestMatch.summary : fallbackSummary;
      let aiSource = bestMatch?.aiSource;

      if (options?.nameWithAi && !bestMatch?.userRenamed && group.length >= 2) {
        try {
          const named = await this.ai.nameCluster({
            topics: topTopics.length ? topTopics : [fallbackName],
            sampleTitles: group.slice(0, 8).map((p) => p.title),
          });
          name = named.data.name.split(/\s+/).slice(0, 4).join(' ');
          summary = named.data.summary;
          aiSource = named.ranOn;
        } catch {
          // Keep deterministic fallback cluster name
        }
      }

      const cluster: ClusterRecord = {
        id: clusterId,
        name,
        summary,
        userRenamed: bestMatch?.userRenamed ?? false,
        pinned: bestMatch?.pinned ?? false,
        hidden: bestMatch?.hidden ?? false,
        color: bestMatch?.color ?? CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length]!,
        pageIds: groupPageIds,
        topics: topTopics,
        aiSource,
        createdAt: bestMatch?.createdAt ?? now,
        updatedAt: now,
      };

      newClusters.push(cluster);
      for (const pid of groupPageIds) {
        pageToClusterId.set(pid, clusterId);
      }
    }

    // Update page.clusterId
    const updatedPages = pages.map((p) => ({
      ...p,
      clusterId: pageToClusterId.get(p.id) ?? p.clusterId,
    }));
    await this.store.putPagesBulk(updatedPages);

    // 3. Build all 7 node types & 6 edge types (FR-GR-1, FR-GR-2)
    const nodesMap = new Map<string, GraphNodeRecord>();
    const edgesMap = new Map<string, GraphEdgeRecord>();

    // Preserve search & journey nodes created elsewhere
    for (const existing of existingNodes) {
      if (existing.kind === 'search' || existing.kind === 'journey') {
        nodesMap.set(existing.id, existing);
      }
    }

    const upsertNode = (node: GraphNodeRecord) => {
      const prev = nodesMap.get(node.id);
      if (!prev) {
        nodesMap.set(node.id, node);
      } else {
        nodesMap.set(node.id, {
          ...prev,
          weight: prev.weight + node.weight,
          clusterId: node.clusterId ?? prev.clusterId,
          firstSeen: Math.min(prev.firstSeen, node.firstSeen),
          lastSeen: Math.max(prev.lastSeen, node.lastSeen),
        });
      }
    };

    const addEdge = (from: string, to: string, kind: GraphEdgeRecord['kind'], firstSeen: number) => {
      if (from === to) return;
      const id = `${kind}:${from}->${to}`;
      const prev = edgesMap.get(id);
      if (prev) {
        prev.weight += 1;
      } else {
        edgesMap.set(id, { id, from, to, kind, weight: 1, firstSeen });
      }
    };

    for (const page of updatedPages) {
      const pageNodeId = `page:${page.id}`;
      upsertNode({
        id: pageNodeId,
        kind: 'page',
        label: page.title,
        clusterId: page.clusterId,
        weight: page.bookmarked ? 3 : 1.5,
        refId: page.id,
        firstSeen: page.firstSeen,
        lastSeen: page.lastSeen,
        metadata: {
          domain: page.domain,
          status: page.status,
          type: page.type,
          bookmarked: Boolean(page.bookmarked),
        },
      });

      const siteNodeId = `site:${page.domain}`;
      upsertNode({
        id: siteNodeId,
        kind: 'site',
        label: page.domain,
        clusterId: page.clusterId,
        weight: 1,
        firstSeen: page.firstSeen,
        lastSeen: page.lastSeen,
      });

      for (const topic of page.englishTopics.length ? page.englishTopics : page.topics) {
        const cleanTopic = topic.trim();
        if (!cleanTopic) continue;
        const topicNodeId = `topic:${cleanTopic.toLowerCase()}`;
        upsertNode({
          id: topicNodeId,
          kind: 'topic',
          label: cleanTopic,
          clusterId: page.clusterId,
          weight: 1,
          firstSeen: page.firstSeen,
          lastSeen: page.lastSeen,
        });
        addEdge(pageNodeId, topicNodeId, 'page-to-topic', page.firstSeen);
      }

      for (const ent of page.entities) {
        const entId = `entity:${ent.canonicalName.toLowerCase()}`;
        upsertNode({
          id: entId,
          kind: 'entity',
          label: ent.canonicalName,
          clusterId: page.clusterId,
          weight: 1,
          firstSeen: page.firstSeen,
          lastSeen: page.lastSeen,
          metadata: { entityKind: ent.kind },
        });
        addEdge(pageNodeId, entId, 'page-to-entity', page.firstSeen);
      }
    }

    // Highlight nodes
    for (const fact of facts) {
      if (!fact.highlight) continue;
      const page = updatedPages.find((p) => p.id === fact.pageId);
      const hlId = `highlight:${fact.id}`;
      upsertNode({
        id: hlId,
        kind: 'highlight',
        label: fact.text.slice(0, 72),
        clusterId: page?.clusterId,
        weight: 2,
        refId: fact.pageId,
        firstSeen: fact.createdAt,
        lastSeen: fact.createdAt,
      });
      if (page) {
        addEdge(`page:${page.id}`, hlId, 'page-to-entity', fact.createdAt);
      }
    }

    // Session edges: page-to-page, same-session, and topic-to-topic co-occurrence (FR-GR-2)
    const visitsBySession = new Map<string, typeof visits>();
    for (const v of visits) {
      const arr = visitsBySession.get(v.sessionId) ?? [];
      arr.push(v);
      visitsBySession.set(v.sessionId, arr);
    }

    const pageById = new Map(updatedPages.map((p) => [p.id, p]));
    for (const sessionVisits of visitsBySession.values()) {
      sessionVisits.sort((a, b) => a.time - b.time);
      const sessionTopicIds = new Set<string>();
      for (let i = 0; i < sessionVisits.length; i++) {
        const curr = sessionVisits[i]!;
        const page = pageById.get(curr.pageId);
        if (page) {
          for (const t of page.englishTopics.length ? page.englishTopics : page.topics) {
            sessionTopicIds.add(`topic:${t.toLowerCase().trim()}`);
          }
        }
        if (i > 0) {
          const prev = sessionVisits[i - 1]!;
          if (prev.pageId !== curr.pageId) {
            addEdge(`page:${prev.pageId}`, `page:${curr.pageId}`, 'page-to-page', curr.time);
            addEdge(`page:${prev.pageId}`, `page:${curr.pageId}`, 'same-session', curr.time);
          }
        }
      }

      const topicArr = Array.from(sessionTopicIds).slice(0, 10);
      for (let i = 0; i < topicArr.length; i++) {
        for (let j = i + 1; j < topicArr.length; j++) {
          addEdge(topicArr[i]!, topicArr[j]!, 'topic-to-topic', sessionVisits[0]?.time ?? now);
        }
      }
    }

    const finalNodes = Array.from(nodesMap.values());
    const finalEdges = Array.from(edgesMap.values());

    await this.store.db.transaction(
      'rw',
      [this.store.db.clusters, this.store.db.nodes, this.store.db.edges],
      async () => {
        await this.store.db.clusters.clear();
        await this.store.db.clusters.bulkPut(newClusters);
        await this.store.db.nodes.bulkPut(finalNodes);
        await this.store.db.edges.bulkPut(finalEdges);
      },
    );

    return { nodes: finalNodes, edges: finalEdges, clusters: newClusters };
  }

  /**
   * User cluster management operations that survive re-clustering (FR-GR-10).
   */
  async renameCluster(clusterId: string, newName: string): Promise<void> {
    await this.store.db.clusters.update(clusterId, {
      name: newName.trim().slice(0, 60),
      userRenamed: true,
      updatedAt: Date.now(),
    });
  }

  async toggleClusterPin(clusterId: string): Promise<void> {
    const c = await this.store.db.clusters.get(clusterId);
    if (!c) return;
    await this.store.db.clusters.update(clusterId, { pinned: !c.pinned, updatedAt: Date.now() });
  }

  async toggleClusterHidden(clusterId: string): Promise<void> {
    const c = await this.store.db.clusters.get(clusterId);
    if (!c) return;
    await this.store.db.clusters.update(clusterId, { hidden: !c.hidden, updatedAt: Date.now() });
  }

  async mergeClusters(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) return;
    const [source, target] = await Promise.all([
      this.store.db.clusters.get(sourceId),
      this.store.db.clusters.get(targetId),
    ]);
    if (!source || !target) return;

    const mergedPageIds = Array.from(new Set([...target.pageIds, ...source.pageIds]));
    const mergedTopics = Array.from(new Set([...target.topics, ...source.topics])).slice(0, 8);

    await this.store.db.transaction(
      'rw',
      [this.store.db.clusters, this.store.db.pages, this.store.db.nodes],
      async () => {
        await this.store.db.clusters.update(targetId, {
          pageIds: mergedPageIds,
          topics: mergedTopics,
          userRenamed: true,
          updatedAt: Date.now(),
        });
        await this.store.db.clusters.delete(sourceId);
        await this.store.db.pages
          .where('clusterId')
          .equals(sourceId)
          .modify({ clusterId: targetId });
        await this.store.db.nodes
          .where('clusterId')
          .equals(sourceId)
          .modify({ clusterId: targetId });
      },
    );
  }
}

export const graphEngine = new GraphEngine();
