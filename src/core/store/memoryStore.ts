import {
  createDefaultSettings,
  MAX_SNAPSHOTS_PER_PAGE,
  SCHEMA_VERSION,
} from '@/shared/constants';
import type {
  ChunkRecord,
  ClusterRecord,
  EmbeddingRecord,
  FactRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  JobRecord,
  JourneyRecord,
  LoopRecord,
  PageRecord,
  RecapRecord,
  RoutingLogRecord,
  SettingsRecord,
  SkippedDomainRecord,
  SnapshotRecord,
  StoredChunkRecord,
  StoredFactRecord,
  StoredPageRecord,
  StoredRecapRecord,
  StoredSnapshotRecord,
  VisitRecord,
  WatchRecord,
} from '@/shared/types';
import { CryptoService, cryptoService } from '@/core/crypto/encryption';
import { db as defaultDb, TrailmindDB } from './db';

export interface PortableMemoryDump {
  format: 'trailmind-export';
  schemaVersion: number;
  exportedAt: number;
  pages: PageRecord[];
  visits: VisitRecord[];
  snapshots: SnapshotRecord[];
  chunks: ChunkRecord[];
  facts: FactRecord[];
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  embeddings: EmbeddingRecord[];
  clusters: ClusterRecord[];
  journeys: JourneyRecord[];
  loops: LoopRecord[];
  watches: WatchRecord[];
  recaps: RecapRecord[];
  settings: SettingsRecord;
}

export class MemoryStore {
  constructor(
    public readonly db: TrailmindDB = defaultDb,
    public readonly crypto: CryptoService = cryptoService,
  ) {}

  async init(): Promise<void> {
    await this.crypto.init();
    const existing = await this.db.settings.get('singleton');
    if (!existing) {
      await this.db.settings.put(createDefaultSettings());
    }
  }

  // ---- Settings ----

  async getSettings(): Promise<SettingsRecord> {
    const record = await this.db.settings.get('singleton');
    if (!record) {
      const defaults = createDefaultSettings();
      await this.db.settings.put(defaults);
      return defaults;
    }
    return {
      ...createDefaultSettings(),
      ...record,
      cloud: { ...createDefaultSettings().cloud, ...(record.cloud ?? {}) },
    };
  }

  async saveSettings(patch: Partial<SettingsRecord>): Promise<SettingsRecord> {
    const current = await this.getSettings();
    const updated: SettingsRecord = {
      ...current,
      ...patch,
      id: 'singleton',
      cloud: patch.cloud ? { ...current.cloud, ...patch.cloud } : current.cloud,
      updatedAt: Date.now(),
    };
    await this.db.settings.put(updated);
    return updated;
  }

  // ---- Pages (encrypted summary) ----

  private async encryptPage(page: PageRecord): Promise<StoredPageRecord> {
    const { summary, ...rest } = page;
    const summaryEnc = await this.crypto.encryptString(summary);
    return { ...rest, summaryEnc };
  }

  private async decryptPage(stored: StoredPageRecord): Promise<PageRecord> {
    const { summaryEnc, ...rest } = stored;
    const summary = await this.crypto.decryptString(summaryEnc);
    return { ...rest, summary };
  }

  async putPage(page: PageRecord): Promise<void> {
    const stored = await this.encryptPage({ ...page, updatedAt: page.updatedAt || Date.now() });
    await this.db.pages.put(stored);
  }

  async putPagesBulk(pages: PageRecord[]): Promise<void> {
    const encrypted = await Promise.all(pages.map((p) => this.encryptPage(p)));
    await this.db.pages.bulkPut(encrypted);
  }

  async getPage(id: string): Promise<PageRecord | undefined> {
    const stored = await this.db.pages.get(id);
    return stored ? this.decryptPage(stored) : undefined;
  }

  async getPageByCanonicalUrl(canonicalUrl: string): Promise<PageRecord | undefined> {
    const stored = await this.db.pages.where('canonicalUrl').equals(canonicalUrl).first();
    return stored ? this.decryptPage(stored) : undefined;
  }

  async listPages(): Promise<PageRecord[]> {
    const rows = await this.db.pages.orderBy('lastSeen').reverse().toArray();
    return Promise.all(rows.map((r) => this.decryptPage(r)));
  }

  // ---- Visits ----

  async putVisit(visit: VisitRecord): Promise<void> {
    await this.db.visits.put(visit);
  }

  async putVisitsBulk(visits: VisitRecord[]): Promise<void> {
    await this.db.visits.bulkPut(visits);
  }

  async listVisitsForPage(pageId: string): Promise<VisitRecord[]> {
    return this.db.visits.where('pageId').equals(pageId).sortBy('time');
  }

  async listVisitsInRange(startMs: number, endMs: number): Promise<VisitRecord[]> {
    return this.db.visits.where('time').between(startMs, endMs, true, true).toArray();
  }

  async listAllVisits(): Promise<VisitRecord[]> {
    return this.db.visits.orderBy('time').toArray();
  }

  // ---- Snapshots (encrypted text, hash deduped, max 5 versions per URL: FR-SN-1, FR-SN-2) ----

  private async encryptSnapshot(snapshot: SnapshotRecord): Promise<StoredSnapshotRecord> {
    const { text, sanitizedHtml, ...rest } = snapshot;
    const textEnc = await this.crypto.encryptString(text);
    const sanitizedHtmlEnc = sanitizedHtml
      ? await this.crypto.encryptString(sanitizedHtml)
      : undefined;
    return { ...rest, textEnc, sanitizedHtmlEnc };
  }

  private async decryptSnapshot(stored: StoredSnapshotRecord): Promise<SnapshotRecord> {
    const { textEnc, sanitizedHtmlEnc, ...rest } = stored;
    const text = await this.crypto.decryptString(textEnc);
    const sanitizedHtml = sanitizedHtmlEnc
      ? await this.crypto.decryptString(sanitizedHtmlEnc)
      : undefined;
    return { ...rest, text, sanitizedHtml };
  }

  async saveSnapshotVersion(
    snapshot: SnapshotRecord,
  ): Promise<{ saved: boolean; snapshot: SnapshotRecord }> {
    const existing = await this.db.snapshots
      .where('pageId')
      .equals(snapshot.pageId)
      .sortBy('capturedAt');

    const latest = existing[existing.length - 1];
    if (latest && latest.contentHash === snapshot.contentHash) {
      return { saved: false, snapshot: await this.decryptSnapshot(latest) };
    }

    const stored = await this.encryptSnapshot(snapshot);
    await this.db.transaction('rw', [this.db.snapshots], async () => {
      await this.db.snapshots.put(stored);
      const updated = await this.db.snapshots
        .where('pageId')
        .equals(snapshot.pageId)
        .sortBy('capturedAt');
      if (updated.length > MAX_SNAPSHOTS_PER_PAGE) {
        const toRemove = updated.slice(0, updated.length - MAX_SNAPSHOTS_PER_PAGE);
        await this.db.snapshots.bulkDelete(toRemove.map((s) => s.id));
      }
    });

    await this.enforceStorageBudget();
    return { saved: true, snapshot };
  }

  async listSnapshotsForPage(pageId: string): Promise<SnapshotRecord[]> {
    const rows = await this.db.snapshots.where('pageId').equals(pageId).sortBy('capturedAt');
    return Promise.all(rows.reverse().map((r) => this.decryptSnapshot(r)));
  }

  async getLatestSnapshot(pageId: string): Promise<SnapshotRecord | undefined> {
    const list = await this.listSnapshotsForPage(pageId);
    return list[0];
  }

  async updateSnapshotScreenshot(snapshotId: string, screenshotPng: string): Promise<void> {
    await this.db.snapshots.update(snapshotId, {
      screenshotPng,
      byteSize: screenshotPng.length,
    });
  }

  // ---- Chunks (encrypted text) ----

  async putChunks(chunks: ChunkRecord[]): Promise<void> {
    const stored: StoredChunkRecord[] = await Promise.all(
      chunks.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );
    await this.db.chunks.bulkPut(stored);
  }

  async replaceChunksForPage(pageId: string, chunks: ChunkRecord[]): Promise<void> {
    const stored: StoredChunkRecord[] = await Promise.all(
      chunks.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );
    await this.db.transaction('rw', [this.db.chunks], async () => {
      await this.db.chunks.where('pageId').equals(pageId).delete();
      if (stored.length > 0) {
        await this.db.chunks.bulkPut(stored);
      }
    });
  }

  async listChunksForPage(pageId: string): Promise<ChunkRecord[]> {
    const rows = await this.db.chunks.where('pageId').equals(pageId).sortBy('index');
    return Promise.all(
      rows.map(async ({ textEnc, ...rest }) => ({
        ...rest,
        text: await this.crypto.decryptString(textEnc),
      })),
    );
  }

  async listAllChunks(): Promise<ChunkRecord[]> {
    const rows = await this.db.chunks.toArray();
    return Promise.all(
      rows.map(async ({ textEnc, ...rest }) => ({
        ...rest,
        text: await this.crypto.decryptString(textEnc),
      })),
    );
  }

  // ---- Facts (encrypted text) ----

  async putFact(fact: FactRecord): Promise<void> {
    const { text, ...rest } = fact;
    const stored: StoredFactRecord = {
      ...rest,
      textEnc: await this.crypto.encryptString(text),
    };
    await this.db.facts.put(stored);
  }

  async replaceExtractedFactsForPage(pageId: string, facts: FactRecord[]): Promise<void> {
    const stored: StoredFactRecord[] = await Promise.all(
      facts.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );
    await this.db.transaction('rw', [this.db.facts], async () => {
      // Preserve user highlights when refreshing AI-extracted facts
      await this.db.facts
        .where('pageId')
        .equals(pageId)
        .filter((f) => !f.highlight)
        .delete();
      if (stored.length > 0) {
        await this.db.facts.bulkPut(stored);
      }
    });
  }

  async listFactsForPage(pageId: string): Promise<FactRecord[]> {
    const rows = await this.db.facts.where('pageId').equals(pageId).toArray();
    return Promise.all(
      rows.map(async ({ textEnc, ...rest }) => ({
        ...rest,
        text: await this.crypto.decryptString(textEnc),
      })),
    );
  }

  async listAllFacts(): Promise<FactRecord[]> {
    const rows = await this.db.facts.toArray();
    return Promise.all(
      rows.map(async ({ textEnc, ...rest }) => ({
        ...rest,
        text: await this.crypto.decryptString(textEnc),
      })),
    );
  }

  // ---- Embeddings ----

  async putEmbeddings(embeddings: EmbeddingRecord[]): Promise<void> {
    await this.db.embeddings.bulkPut(embeddings);
  }

  async replaceEmbeddingsForPage(pageId: string, embeddings: EmbeddingRecord[]): Promise<void> {
    await this.db.transaction('rw', [this.db.embeddings], async () => {
      await this.db.embeddings.where('pageId').equals(pageId).delete();
      if (embeddings.length > 0) {
        await this.db.embeddings.bulkPut(embeddings);
      }
    });
  }

  async listAllEmbeddings(): Promise<EmbeddingRecord[]> {
    return this.db.embeddings.toArray();
  }

  // ---- Graph nodes, edges, clusters ----

  async putNodes(nodes: GraphNodeRecord[]): Promise<void> {
    await this.db.nodes.bulkPut(nodes);
  }

  async putEdges(edges: GraphEdgeRecord[]): Promise<void> {
    await this.db.edges.bulkPut(edges);
  }

  async listNodes(): Promise<GraphNodeRecord[]> {
    return this.db.nodes.toArray();
  }

  async listEdges(): Promise<GraphEdgeRecord[]> {
    return this.db.edges.toArray();
  }

  async putClusters(clusters: ClusterRecord[]): Promise<void> {
    await this.db.clusters.bulkPut(clusters);
  }

  async listClusters(): Promise<ClusterRecord[]> {
    return this.db.clusters.toArray();
  }

  // ---- Journeys, Loops, Watches, Recaps ----

  async putJourney(journey: JourneyRecord): Promise<void> {
    await this.db.journeys.put(journey);
  }

  async putJourneys(journeys: JourneyRecord[]): Promise<void> {
    await this.db.journeys.bulkPut(journeys);
  }

  async listJourneys(): Promise<JourneyRecord[]> {
    return this.db.journeys.orderBy('end').reverse().toArray();
  }

  async putLoop(loop: LoopRecord): Promise<void> {
    await this.db.loops.put(loop);
  }

  async putLoops(loops: LoopRecord[]): Promise<void> {
    await this.db.loops.bulkPut(loops);
  }

  async listLoops(): Promise<LoopRecord[]> {
    return this.db.loops.orderBy('createdAt').reverse().toArray();
  }

  async putWatch(watch: WatchRecord): Promise<void> {
    await this.db.watches.put(watch);
  }

  async listWatches(): Promise<WatchRecord[]> {
    return this.db.watches.orderBy('lastCheck').reverse().toArray();
  }

  async deleteWatch(id: string): Promise<void> {
    await this.db.watches.delete(id);
  }

  async putRecap(recap: RecapRecord): Promise<void> {
    const { text, ...rest } = recap;
    const stored: StoredRecapRecord = {
      ...rest,
      textEnc: await this.crypto.encryptString(text),
    };
    await this.db.recaps.put(stored);
  }

  async listRecaps(): Promise<RecapRecord[]> {
    const rows = await this.db.recaps.orderBy('startDate').reverse().toArray();
    return Promise.all(
      rows.map(async ({ textEnc, ...rest }) => ({
        ...rest,
        text: await this.crypto.decryptString(textEnc),
      })),
    );
  }

  // ---- Jobs & Routing Log & Skipped Domains ----

  async enqueueJob(job: JobRecord): Promise<void> {
    await this.db.jobs.put(job);
  }

  async getNextQueuedJob(): Promise<JobRecord | undefined> {
    const queued = await this.db.jobs.where('state').equals('queued').toArray();
    queued.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    return queued[0];
  }

  async updateJob(id: string, patch: Partial<JobRecord>): Promise<void> {
    await this.db.jobs.update(id, { ...patch, updatedAt: Date.now() });
  }

  async listJobs(limit = 100): Promise<JobRecord[]> {
    return this.db.jobs.orderBy('updatedAt').reverse().limit(limit).toArray();
  }

  async logRoutingOutcome(entry: RoutingLogRecord): Promise<void> {
    await this.db.routing_log.put(entry);
  }

  async listRoutingLog(limit = 500): Promise<RoutingLogRecord[]> {
    return this.db.routing_log.orderBy('timestamp').reverse().limit(limit).toArray();
  }

  async recordSkippedDomain(
    domain: string,
    reason: 'sensitive_page' | 'excluded_domain',
  ): Promise<void> {
    const id = `${reason}:${domain}`;
    const existing = await this.db.skipped_domains.get(id);
    await this.db.skipped_domains.put({
      id,
      domain,
      reason,
      count: (existing?.count ?? 0) + 1,
      lastSkippedAt: Date.now(),
    });
  }

  async listSkippedDomains(): Promise<SkippedDomainRecord[]> {
    return this.db.skipped_domains.orderBy('lastSkippedAt').reverse().toArray();
  }

  // ---- Storage Budget & Pruning (FR-ST-3) ----

  async estimateStorageBytes(): Promise<{
    totalBytes: number;
    snapshotBytes: number;
    pageCount: number;
    snapshotCount: number;
    factCount: number;
    embeddingCount: number;
  }> {
    const [snapshots, pageCount, factCount, embeddingCount] = await Promise.all([
      this.db.snapshots.toArray(),
      this.db.pages.count(),
      this.db.facts.count(),
      this.db.embeddings.count(),
    ]);
    const snapshotBytes = snapshots.reduce((sum, s) => sum + (s.byteSize || 0), 0);
    const metadataEstimate = pageCount * 2048 + factCount * 512 + embeddingCount * 600;
    return {
      totalBytes: snapshotBytes + metadataEstimate,
      snapshotBytes,
      pageCount,
      snapshotCount: snapshots.length,
      factCount,
      embeddingCount,
    };
  }

  /**
   * Prunes oldest snapshot bodies first while preserving page metadata (FR-ST-3).
   */
  async enforceStorageBudget(budgetBytesOverride?: number): Promise<{ prunedSnapshots: number }> {
    const settings = await this.getSettings();
    const budgetBytes = budgetBytesOverride ?? settings.storageBudgetMb * 1024 * 1024;
    const stats = await this.estimateStorageBytes();
    if (stats.totalBytes <= budgetBytes) {
      return { prunedSnapshots: 0 };
    }

    const ordered = await this.db.snapshots.orderBy('capturedAt').toArray();
    let currentBytes = stats.totalBytes;
    const idsToDelete: string[] = [];

    for (const snap of ordered) {
      if (currentBytes <= budgetBytes) break;
      idsToDelete.push(snap.id);
      currentBytes -= snap.byteSize || 1024;
    }

    if (idsToDelete.length > 0) {
      await this.db.transaction('rw', [this.db.snapshots, this.db.chunks], async () => {
        await this.db.snapshots.bulkDelete(idsToDelete);
        await this.db.chunks.where('snapshotId').anyOf(idsToDelete).delete();
      });
    }

    return { prunedSnapshots: idsToDelete.length };
  }

  // ---- Complete, Immediate Forget Operations (FR-PRV-3, FR-PRV-4, FR-PRV-9) ----

  async forgetPages(pageIds: string[]): Promise<number> {
    if (pageIds.length === 0) return 0;
    const idSet = new Set(pageIds);
    const nodeIds = pageIds.map((pid) => `page:${pid}`);

    await this.db.transaction(
      'rw',
      [
        this.db.pages,
        this.db.visits,
        this.db.snapshots,
        this.db.chunks,
        this.db.facts,
        this.db.embeddings,
        this.db.nodes,
        this.db.edges,
        this.db.loops,
        this.db.watches,
        this.db.journeys,
        this.db.clusters,
        this.db.jobs,
      ],
      async () => {
        await this.db.pages.bulkDelete(pageIds);
        await this.db.visits.where('pageId').anyOf(pageIds).delete();
        await this.db.snapshots.where('pageId').anyOf(pageIds).delete();
        await this.db.chunks.where('pageId').anyOf(pageIds).delete();
        await this.db.facts.where('pageId').anyOf(pageIds).delete();
        await this.db.embeddings.where('pageId').anyOf(pageIds).delete();
        await this.db.watches.where('pageId').anyOf(pageIds).delete();
        await this.db.nodes.bulkDelete(nodeIds);
        await this.db.nodes
          .filter((n) => Boolean(n.refId && idSet.has(n.refId)))
          .delete();
        await this.db.edges
          .filter(
            (e) =>
              nodeIds.includes(e.from) ||
              nodeIds.includes(e.to) ||
              idSet.has(e.from) ||
              idSet.has(e.to),
          )
          .delete();

        // Remove references from loops, journeys, clusters
        const loops = await this.db.loops.toArray();
        for (const loop of loops) {
          const remaining = loop.pageIds.filter((pid) => !idSet.has(pid));
          if (remaining.length === 0) {
            await this.db.loops.delete(loop.id);
          } else if (remaining.length !== loop.pageIds.length) {
            await this.db.loops.update(loop.id, { pageIds: remaining });
          }
        }

        const journeys = await this.db.journeys.toArray();
        for (const j of journeys) {
          const remaining = j.pageIds.filter((pid) => !idSet.has(pid));
          if (remaining.length === 0) {
            await this.db.journeys.delete(j.id);
          } else if (remaining.length !== j.pageIds.length) {
            await this.db.journeys.update(j.id, { pageIds: remaining });
          }
        }

        const clusters = await this.db.clusters.toArray();
        for (const c of clusters) {
          const remaining = c.pageIds.filter((pid) => !idSet.has(pid));
          if (remaining.length === 0) {
            await this.db.clusters.delete(c.id);
          } else if (remaining.length !== c.pageIds.length) {
            await this.db.clusters.update(c.id, { pageIds: remaining });
          }
        }

        await this.db.jobs.filter((job) => idSet.has(job.payloadRef)).delete();
      },
    );

    return pageIds.length;
  }

  async forgetDomain(domain: string): Promise<number> {
    const normalized = domain.toLowerCase().replace(/^www\./, '');
    const matching = await this.db.pages
      .filter((p) => {
        const d = p.domain.toLowerCase().replace(/^www\./, '');
        return d === normalized || d.endsWith(`.${normalized}`);
      })
      .toArray();
    return this.forgetPages(matching.map((p) => p.id));
  }

  async forgetTopic(topic: string): Promise<number> {
    const needle = topic.toLowerCase();
    const matching = await this.db.pages
      .filter(
        (p) =>
          p.topics.some((t) => t.toLowerCase() === needle) ||
          p.englishTopics.some((t) => t.toLowerCase() === needle),
      )
      .toArray();
    const removed = await this.forgetPages(matching.map((p) => p.id));
    await this.db.nodes
      .where('kind')
      .equals('topic')
      .filter((n) => n.label.toLowerCase() === needle)
      .delete();
    return removed;
  }

  async forgetCluster(clusterId: string): Promise<number> {
    const pages = await this.db.pages.where('clusterId').equals(clusterId).toArray();
    const removed = await this.forgetPages(pages.map((p) => p.id));
    await this.db.clusters.delete(clusterId);
    return removed;
  }

  async forgetDateRange(startMs: number, endMs: number): Promise<number> {
    const visitsInRange = await this.listVisitsInRange(startMs, endMs);
    const affectedPageIds = new Set<string>(visitsInRange.map((v) => v.pageId));

    const pagesInRange = await this.db.pages
      .filter((p) => p.lastSeen >= startMs && p.lastSeen <= endMs)
      .toArray();
    for (const p of pagesInRange) {
      affectedPageIds.add(p.id);
    }

    await this.db.visits.bulkDelete(visitsInRange.map((v) => v.id));

    const pagesToDelete: string[] = [];
    for (const pid of affectedPageIds) {
      const remainingVisits = await this.db.visits.where('pageId').equals(pid).count();
      if (remainingVisits === 0) {
        pagesToDelete.push(pid);
      }
    }

    return this.forgetPages(pagesToDelete);
  }

  async forgetLastMinutes(minutes: number): Promise<number> {
    const now = Date.now();
    return this.forgetDateRange(now - minutes * 60 * 1000, now + 1000);
  }

  async autoDeleteOlderThan(days: number): Promise<number> {
    if (days <= 0) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.forgetDateRange(0, cutoff);
  }

  async forgetEverything(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.pages,
        this.db.visits,
        this.db.snapshots,
        this.db.chunks,
        this.db.facts,
        this.db.nodes,
        this.db.edges,
        this.db.embeddings,
        this.db.clusters,
        this.db.journeys,
        this.db.loops,
        this.db.watches,
        this.db.recaps,
        this.db.jobs,
        this.db.routing_log,
        this.db.skipped_domains,
        this.db.sync_meta,
      ],
      async () => {
        await Promise.all([
          this.db.pages.clear(),
          this.db.visits.clear(),
          this.db.snapshots.clear(),
          this.db.chunks.clear(),
          this.db.facts.clear(),
          this.db.nodes.clear(),
          this.db.edges.clear(),
          this.db.embeddings.clear(),
          this.db.clusters.clear(),
          this.db.journeys.clear(),
          this.db.loops.clear(),
          this.db.watches.clear(),
          this.db.recaps.clear(),
          this.db.jobs.clear(),
          this.db.routing_log.clear(),
          this.db.skipped_domains.clear(),
          this.db.sync_meta.clear(),
        ]);
      },
    );
  }

  // ---- Full Portable JSON Export / Import (FR-EXP-4, FR-EXP-5) ----

  async exportPortableJson(): Promise<PortableMemoryDump> {
    const [
      pages,
      visits,
      rawSnapshots,
      chunks,
      facts,
      nodes,
      edges,
      embeddings,
      clusters,
      journeys,
      loops,
      watches,
      recaps,
      settings,
    ] = await Promise.all([
      this.listPages(),
      this.listAllVisits(),
      this.db.snapshots.toArray(),
      this.listAllChunks(),
      this.listAllFacts(),
      this.listNodes(),
      this.listEdges(),
      this.listAllEmbeddings(),
      this.listClusters(),
      this.listJourneys(),
      this.listLoops(),
      this.listWatches(),
      this.listRecaps(),
      this.getSettings(),
    ]);

    const snapshots = await Promise.all(rawSnapshots.map((s) => this.decryptSnapshot(s)));

    return {
      format: 'trailmind-export',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      pages,
      visits,
      snapshots,
      chunks,
      facts,
      nodes,
      edges,
      embeddings,
      clusters,
      journeys,
      loops,
      watches,
      recaps,
      settings,
    };
  }

  async importPortableJson(dump: PortableMemoryDump): Promise<{
    pagesImported: number;
    snapshotsImported: number;
    factsImported: number;
  }> {
    if (dump.format !== 'trailmind-export' || !Array.isArray(dump.pages)) {
      throw new Error('Invalid Trailmind JSON export file.');
    }

    const encPages = await Promise.all(dump.pages.map((p) => this.encryptPage(p)));
    const encSnapshots = await Promise.all(dump.snapshots.map((s) => this.encryptSnapshot(s)));
    const encChunks: StoredChunkRecord[] = await Promise.all(
      dump.chunks.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );
    const encFacts: StoredFactRecord[] = await Promise.all(
      dump.facts.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );
    const encRecaps: StoredRecapRecord[] = await Promise.all(
      dump.recaps.map(async ({ text, ...rest }) => ({
        ...rest,
        textEnc: await this.crypto.encryptString(text),
      })),
    );

    await this.db.transaction(
      'rw',
      [
        this.db.pages,
        this.db.visits,
        this.db.snapshots,
        this.db.chunks,
        this.db.facts,
        this.db.nodes,
        this.db.edges,
        this.db.embeddings,
        this.db.clusters,
        this.db.journeys,
        this.db.loops,
        this.db.watches,
        this.db.recaps,
        this.db.settings,
      ],
      async () => {
        if (encPages.length) await this.db.pages.bulkPut(encPages);
        if (dump.visits.length) await this.db.visits.bulkPut(dump.visits);
        if (encSnapshots.length) await this.db.snapshots.bulkPut(encSnapshots);
        if (encChunks.length) await this.db.chunks.bulkPut(encChunks);
        if (encFacts.length) await this.db.facts.bulkPut(encFacts);
        if (dump.nodes.length) await this.db.nodes.bulkPut(dump.nodes);
        if (dump.edges.length) await this.db.edges.bulkPut(dump.edges);
        if (dump.embeddings.length) await this.db.embeddings.bulkPut(dump.embeddings);
        if (dump.clusters.length) await this.db.clusters.bulkPut(dump.clusters);
        if (dump.journeys.length) await this.db.journeys.bulkPut(dump.journeys);
        if (dump.loops.length) await this.db.loops.bulkPut(dump.loops);
        if (dump.watches.length) await this.db.watches.bulkPut(dump.watches);
        if (encRecaps.length) await this.db.recaps.bulkPut(encRecaps);
        if (dump.settings) await this.db.settings.put({ ...dump.settings, id: 'singleton' });
      },
    );

    return {
      pagesImported: dump.pages.length,
      snapshotsImported: dump.snapshots.length,
      factsImported: dump.facts.length,
    };
  }
}

export const memoryStore = new MemoryStore();
