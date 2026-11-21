import Dexie, { type Table } from 'dexie';
import type {
  ClusterRecord,
  EmbeddingRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  JobRecord,
  JourneyRecord,
  LoopRecord,
  RoutingLogRecord,
  SettingsRecord,
  SkippedDomainRecord,
  StoredChunkRecord,
  StoredFactRecord,
  StoredPageRecord,
  StoredRecapRecord,
  StoredSnapshotRecord,
  SyncMetaRecord,
  VisitRecord,
  WatchRecord,
} from '@/shared/types';

/**
 * Trailmind IndexedDB schema via Dexie (FR-ST-2, FR-ST-5).
 * Explicitly defines v1 -> v2 upgrade path so migrations are verified in tests.
 */
export class TrailmindDB extends Dexie {
  pages!: Table<StoredPageRecord, string>;
  visits!: Table<VisitRecord, string>;
  snapshots!: Table<StoredSnapshotRecord, string>;
  chunks!: Table<StoredChunkRecord, string>;
  facts!: Table<StoredFactRecord, string>;
  nodes!: Table<GraphNodeRecord, string>;
  edges!: Table<GraphEdgeRecord, string>;
  embeddings!: Table<EmbeddingRecord, string>;
  clusters!: Table<ClusterRecord, string>;
  journeys!: Table<JourneyRecord, string>;
  loops!: Table<LoopRecord, string>;
  watches!: Table<WatchRecord, string>;
  recaps!: Table<StoredRecapRecord, string>;
  settings!: Table<SettingsRecord, string>;
  jobs!: Table<JobRecord, string>;
  routing_log!: Table<RoutingLogRecord, string>;
  skipped_domains!: Table<SkippedDomainRecord, string>;
  sync_meta!: Table<SyncMetaRecord, string>;

  constructor(name = 'TrailmindDB') {
    super(name);

    // Schema v1: initial core tables
    this.version(1).stores({
      pages: 'id, canonicalUrl, domain, type, status, clusterId, firstSeen, lastSeen',
      visits: 'id, pageId, time, sessionId',
      snapshots: 'id, pageId, capturedAt, contentHash',
      chunks: 'id, pageId, snapshotId, index',
      facts: 'id, pageId, chunkId, highlight, fromImage',
      nodes: 'id, kind, clusterId, refId, lastSeen',
      edges: 'id, from, to, kind, firstSeen',
      embeddings: 'id, ownerId, ownerKind, pageId',
      clusters: 'id, name, pinned, hidden, updatedAt',
      journeys: 'id, start, end, state, clusterId',
      loops: 'id, kind, state, clusterId, snoozeUntil, createdAt',
      watches: 'id, pageId, enabled, lastCheck',
      recaps: 'id, week, startDate, createdAt',
      settings: 'id',
      jobs: 'id, kind, state, priority, createdAt',
      routing_log: 'id, timestamp, jobKind, ranOn',
    });

    // Schema v2: adds skipped_domains, sync_meta, compound indexes, and updates legacy pages
    this.version(2)
      .stores({
        pages:
          'id, canonicalUrl, domain, type, status, clusterId, firstSeen, lastSeen, updatedAt, *topics, *englishTopics',
        visits: 'id, pageId, time, sessionId, [pageId+time]',
        snapshots: 'id, pageId, capturedAt, contentHash, [pageId+capturedAt]',
        chunks: 'id, pageId, snapshotId, index',
        facts: 'id, pageId, chunkId, highlight, fromImage, createdAt',
        nodes: 'id, kind, clusterId, refId, lastSeen',
        edges: 'id, from, to, kind, firstSeen, [from+to+kind]',
        embeddings: 'id, ownerId, ownerKind, pageId',
        clusters: 'id, name, pinned, hidden, updatedAt',
        journeys: 'id, start, end, state, clusterId, updatedAt',
        loops: 'id, kind, state, clusterId, snoozeUntil, createdAt',
        watches: 'id, pageId, enabled, suggested, lastCheck',
        recaps: 'id, week, startDate, createdAt',
        settings: 'id',
        jobs: 'id, kind, state, priority, [state+priority], createdAt',
        routing_log: 'id, timestamp, jobKind, ranOn',
        skipped_domains: 'id, domain, reason, lastSkippedAt',
        sync_meta: 'key, collection, recordId, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('pages')
          .toCollection()
          .modify((page: Record<string, unknown>) => {
            if (!Array.isArray(page.topics)) page.topics = [];
            if (!Array.isArray(page.englishTopics)) page.englishTopics = page.topics;
            if (!Array.isArray(page.entities)) page.entities = [];
            if (typeof page.updatedAt !== 'number') {
              page.updatedAt = (page.lastSeen as number) || Date.now();
            }
          });

        await tx
          .table('facts')
          .toCollection()
          .modify((fact: Record<string, unknown>) => {
            if (typeof fact.createdAt !== 'number') {
              fact.createdAt = Date.now();
            }
          });
      });
  }
}

export const db = new TrailmindDB();
