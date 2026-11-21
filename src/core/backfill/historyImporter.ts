import { DEFAULT_PROMPT_VERSION } from '@/shared/constants';
import type {
  BackfillProgress,
  ChunkRecord,
  GraphEdgeRecord,
  GraphNodeRecord,
  PageRecord,
  SnapshotRecord,
} from '@/shared/types';
import { chunkTextForExtraction, estimateTokens } from '@/core/ai/prompts';
import { sha256Hex } from '@/core/crypto/encryption';
import { pageIngestionService, pageIdFromCanonicalUrl } from '@/core/capture/pageIngestion';
import { extractReadableFromHtml } from '@/core/capture/readabilityExtractor';
import {
  canonicalizeUrl,
  evaluateSensitiveHeuristics,
  extractDomain,
  isDomainExcluded,
  isRecordableUrl,
} from '@/core/capture/urlPrivacy';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import { parseSearchQueryFromUrl } from './searchParser';
import { buildSessionsFromVisits, type RawHistoryVisit } from './sessionizer';

export interface HistoryItemInput {
  url: string;
  title?: string;
  lastVisitTime?: number;
  visits: Array<{
    visitId: string;
    visitTime?: number;
    referringVisitId?: string;
    transition?: string;
  }>;
}

export interface BookmarkInput {
  url: string;
  title?: string;
  dateAdded?: number;
}

const PAYWALL_OR_LOGIN_MARKERS = [
  /sign in to continue/i,
  /log in to view/i,
  /subscribe to read/i,
  /create a free account to continue/i,
  /enable javascript to run this app/i,
  /you need to enable javascript/i,
];

/**
 * Classifies whether a fetched HTML response is usable public content or should stay metadata_only (FR-BF-7).
 */
export function classifyFetchedHtml(
  status: number,
  contentType: string,
  extractedText: string,
): 'ok' | 'metadata_only' | 'gone' {
  if (status === 404 || status === 410) return 'gone';
  if (status < 200 || status >= 300) return 'metadata_only';
  if (!contentType.toLowerCase().includes('text/html')) return 'metadata_only';
  const trimmed = extractedText.trim();
  // Empty JS SPA shell or login wall
  if (trimmed.length < 180) return 'metadata_only';
  for (const marker of PAYWALL_OR_LOGIN_MARKERS) {
    if (marker.test(trimmed.slice(0, 800)) && trimmed.length < 900) {
      return 'metadata_only';
    }
  }
  return 'ok';
}

/**
 * History importer & rate-limited background backfill re-fetcher (FR-BF-1 to FR-BF-10, SEC-8).
 */
export class BackfillService {
  private progress: BackfillProgress = {
    running: false,
    paused: false,
    total: 0,
    done: 0,
    enriched: 0,
    metadataOnly: 0,
    skipped: 0,
    estimatedMinutesLeft: 0,
  };
  private domainLastFetch = new Map<string, number>();
  private activeFetches = 0;

  constructor(private readonly store: MemoryStore = memoryStore) {}

  getProgress(): BackfillProgress {
    return { ...this.progress };
  }

  setPaused(paused: boolean): void {
    this.progress.paused = paused;
  }

  /**
   * Imports Chrome history + bookmarks and constructs the instant metadata graph (< 60s for 5,000 visits, FR-BF-1..FR-BF-4, FR-BF-10).
   */
  async importHistoryItems(
    items: HistoryItemInput[],
    bookmarks: BookmarkInput[] = [],
  ): Promise<{
    pagesCreated: number;
    visitsCreated: number;
    sessionsCreated: number;
    searchesCreated: number;
    bookmarksTagged: number;
    durationMs: number;
  }> {
    const started = performance.now();
    const settings = await this.store.getSettings();

    const bookmarkedCanonicalUrls = new Set<string>();
    for (const bm of bookmarks) {
      if (isRecordableUrl(bm.url) && !isDomainExcluded(bm.url, settings.exclusions)) {
        bookmarkedCanonicalUrls.add(canonicalizeUrl(bm.url));
      }
    }

    const pagesByCanonical = new Map<string, PageRecord>();
    const rawVisits: RawHistoryVisit[] = [];
    const searchNodes = new Map<string, GraphNodeRecord>();
    const siteNodes = new Map<string, GraphNodeRecord>();
    const pageNodes: GraphNodeRecord[] = [];
    const edges: GraphEdgeRecord[] = [];

    // Pre-seed pages from bookmarks even if outside history window (FR-BF-10)
    for (const bm of bookmarks) {
      if (!isRecordableUrl(bm.url)) continue;
      if (isDomainExcluded(bm.url, settings.exclusions)) continue;
      const canonical = canonicalizeUrl(bm.url);
      if (pagesByCanonical.has(canonical)) continue;
      const pageId = await pageIdFromCanonicalUrl(canonical);
      const domain = extractDomain(bm.url);
      const ts = bm.dateAdded ?? Date.now();
      pagesByCanonical.set(canonical, {
        id: pageId,
        url: bm.url,
        canonicalUrl: canonical,
        domain,
        title: bm.title?.trim() || domain,
        type: 'other',
        summary: '',
        language: 'en',
        topics: [],
        englishTopics: [],
        entities: [],
        firstSeen: ts,
        lastSeen: ts,
        status: 'metadata_only',
        promptVersion: DEFAULT_PROMPT_VERSION,
        bookmarked: true,
        updatedAt: ts,
      });
    }

    for (const item of items) {
      if (!isRecordableUrl(item.url)) continue;
      const domain = extractDomain(item.url);
      if (isDomainExcluded(domain, settings.exclusions)) {
        await this.store.recordSkippedDomain(domain, 'excluded_domain');
        continue;
      }

      const sensitive = evaluateSensitiveHeuristics({
        url: item.url,
        title: item.title ?? '',
      });
      if (sensitive.sensitive && !sensitive.needsModelConfirmation) {
        await this.store.recordSkippedDomain(domain, 'sensitive_page');
        continue;
      }

      const canonical = canonicalizeUrl(item.url);
      const pageId = await pageIdFromCanonicalUrl(canonical);
      const searchMatch = parseSearchQueryFromUrl(item.url, settings.customSearchPatterns);
      const visitTimes = item.visits
        .map((v) => v.visitTime ?? item.lastVisitTime ?? Date.now())
        .filter((t) => Number.isFinite(t));
      const firstSeen = visitTimes.length ? Math.min(...visitTimes) : (item.lastVisitTime ?? Date.now());
      const lastSeen = visitTimes.length ? Math.max(...visitTimes) : (item.lastVisitTime ?? Date.now());

      const existing = pagesByCanonical.get(canonical);
      if (existing) {
        existing.firstSeen = Math.min(existing.firstSeen, firstSeen);
        existing.lastSeen = Math.max(existing.lastSeen, lastSeen);
        if (item.title && item.title.length > existing.title.length) {
          existing.title = item.title;
        }
      } else {
        pagesByCanonical.set(canonical, {
          id: pageId,
          url: item.url,
          canonicalUrl: canonical,
          domain,
          title: item.title?.trim() || domain,
          type: searchMatch ? 'search_results' : 'other',
          summary: '',
          language: 'en',
          topics: [],
          englishTopics: [],
          entities: [],
          firstSeen,
          lastSeen,
          status: 'metadata_only',
          promptVersion: DEFAULT_PROMPT_VERSION,
          bookmarked: bookmarkedCanonicalUrls.has(canonical),
          updatedAt: lastSeen,
        });
      }

      if (searchMatch) {
        const searchId = `search:${searchMatch.normalizedQuery}`;
        const existingSearch = searchNodes.get(searchId);
        if (existingSearch) {
          existingSearch.weight += 1;
          existingSearch.lastSeen = Math.max(existingSearch.lastSeen, lastSeen);
        } else {
          searchNodes.set(searchId, {
            id: searchId,
            kind: 'search',
            label: searchMatch.query,
            weight: 1,
            refId: pageId,
            firstSeen,
            lastSeen,
            metadata: { engine: searchMatch.engine },
          });
        }
      }

      const siteId = `site:${domain}`;
      const existingSite = siteNodes.get(siteId);
      if (existingSite) {
        existingSite.weight += 1;
        existingSite.lastSeen = Math.max(existingSite.lastSeen, lastSeen);
      } else {
        siteNodes.set(siteId, {
          id: siteId,
          kind: 'site',
          label: domain,
          weight: 1,
          firstSeen,
          lastSeen,
        });
      }

      for (const v of item.visits) {
        rawVisits.push({
          visitId: v.visitId,
          pageId,
          url: item.url,
          time: v.visitTime ?? item.lastVisitTime ?? Date.now(),
          referringVisitId: v.referringVisitId,
          transition: v.transition ?? 'link',
        });
      }
    }

    const pages = Array.from(pagesByCanonical.values());
    const sessions = buildSessionsFromVisits(rawVisits);
    const allVisits = sessions.flatMap((s) => s.visits);

    for (const page of pages) {
      pageNodes.push({
        id: `page:${page.id}`,
        kind: 'page',
        label: page.title,
        weight: page.bookmarked ? 3 : 1,
        refId: page.id,
        firstSeen: page.firstSeen,
        lastSeen: page.lastSeen,
        metadata: {
          domain: page.domain,
          status: page.status,
          bookmarked: Boolean(page.bookmarked),
        },
      });
    }

    // Build session navigation & search-to-result edges (FR-BF-2, FR-GR-2)
    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const seenEdges = new Set<string>();
    const addEdge = (from: string, to: string, kind: GraphEdgeRecord['kind'], firstSeen: number) => {
      if (from === to) return;
      const id = `${kind}:${from}->${to}`;
      if (seenEdges.has(id)) return;
      seenEdges.add(id);
      edges.push({ id, from, to, kind, weight: 1, firstSeen });
    };

    for (const session of sessions) {
      let lastSearchNodeId: string | null = null;
      for (let i = 0; i < session.pageIds.length; i++) {
        const pid = session.pageIds[i]!;
        const page = pageMap.get(pid);
        if (!page) continue;

        const searchMatch = parseSearchQueryFromUrl(page.url, settings.customSearchPatterns);
        if (searchMatch) {
          lastSearchNodeId = `search:${searchMatch.normalizedQuery}`;
        } else if (lastSearchNodeId) {
          addEdge(lastSearchNodeId, `page:${pid}`, 'search-to-result', session.start);
        }

        if (i > 0) {
          const prevPid = session.pageIds[i - 1]!;
          addEdge(`page:${prevPid}`, `page:${pid}`, 'page-to-page', session.start);
        }
      }
    }

    await this.store.putPagesBulk(pages);
    await this.store.putVisitsBulk(allVisits);
    await this.store.putNodes([
      ...pageNodes,
      ...Array.from(siteNodes.values()),
      ...Array.from(searchNodes.values()),
    ]);
    await this.store.putEdges(edges);

    // Queue public non-search pages for idle-time backfill enrichment (low priority = 10)
    const eligibleForFetch = pages.filter((p) => p.type !== 'search_results' && p.status === 'metadata_only');
    for (const p of eligibleForFetch) {
      await this.store.enqueueJob({
        id: `job_backfill_${p.id}`,
        kind: 'backfill_fetch',
        priority: 10,
        state: 'queued',
        attempts: 0,
        payloadRef: p.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    this.progress = {
      running: eligibleForFetch.length > 0,
      paused: false,
      total: eligibleForFetch.length,
      done: 0,
      enriched: 0,
      metadataOnly: 0,
      skipped: 0,
      estimatedMinutesLeft: Math.ceil((eligibleForFetch.length * 4) / 60),
    };

    return {
      pagesCreated: pages.length,
      visitsCreated: allVisits.length,
      sessionsCreated: sessions.length,
      searchesCreated: searchNodes.size,
      bookmarksTagged: pages.filter((p) => p.bookmarked).length,
      durationMs: Math.round(performance.now() - started),
    };
  }

  /**
   * Reads history & bookmarks directly from Chrome extension APIs (FR-BF-1, FR-BF-10).
   */
  async importFromChromeHistory(days: 7 | 30 | 90): Promise<{
    pagesCreated: number;
    visitsCreated: number;
    sessionsCreated: number;
    searchesCreated: number;
    bookmarksTagged: number;
    durationMs: number;
  }> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const historyItems = await chrome.history.search({
      text: '',
      startTime,
      maxResults: 10000,
    });

    const inputs: HistoryItemInput[] = [];
    for (const item of historyItems) {
      if (!item.url) continue;
      const visits = await chrome.history.getVisits({ url: item.url });
      const filteredVisits = visits
        .filter((v) => (v.visitTime ?? 0) >= startTime)
        .map((v) => ({
          visitId: v.visitId,
          visitTime: v.visitTime,
          referringVisitId: v.referringVisitId,
          transition: v.transition,
        }));
      if (filteredVisits.length === 0) continue;
      inputs.push({
        url: item.url,
        title: item.title,
        lastVisitTime: item.lastVisitTime,
        visits: filteredVisits,
      });
    }

    const bookmarks: BookmarkInput[] = [];
    if (chrome.bookmarks?.getTree) {
      const tree = await chrome.bookmarks.getTree();
      const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
        for (const n of nodes) {
          if (n.url) {
            bookmarks.push({ url: n.url, title: n.title, dateAdded: n.dateAdded });
          }
          if (n.children) walk(n.children);
        }
      };
      walk(tree);
    }

    return this.importHistoryItems(inputs, bookmarks);
  }

  /**
   * Fetches one backfill URL with credentials omitted (SEC-8) and strict per-domain rate limiting (FR-BF-5, FR-BF-6).
   * Must run in the offscreen document where DOMParser is available.
   */
  async fetchAndEnrichSinglePage(
    pageId: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<'enriched' | 'metadata_only' | 'gone' | 'rate_limited' | 'paused'> {
    const settings = await this.store.getSettings();
    const rc = remoteConfigService.getValues();
    if (this.progress.paused || settings.backfillPaused) return 'paused';

    // Pause on battery saver if Battery API is available (FR-BF-6, NFR-PF-11)
    const navBattery = navigator as unknown as {
      getBattery?: () => Promise<{ charging: boolean; level: number }>;
    };
    if (navBattery.getBattery) {
      try {
        const battery = await navBattery.getBattery();
        if (!battery.charging && battery.level < 0.2) {
          return 'paused';
        }
      } catch {
        // Ignore battery API denial
      }
    }

    const maxParallel = rc.backfillMaxParallel || settings.backfillMaxParallel || 4;
    if (this.activeFetches >= maxParallel) return 'rate_limited';

    const page = await this.store.getPage(pageId);
    if (!page) return 'metadata_only';
    if (isDomainExcluded(page.domain, settings.exclusions)) {
      this.progress.skipped++;
      this.progress.done++;
      return 'metadata_only';
    }

    const domainDelayMs = rc.backfillDomainDelayMs || settings.backfillDomainDelayMs || 5000;
    const lastHit = this.domainLastFetch.get(page.domain) ?? 0;
    if (Date.now() - lastHit < domainDelayMs) {
      return 'rate_limited';
    }

    this.domainLastFetch.set(page.domain, Date.now());
    this.activeFetches++;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12_000);
      const res = await fetchImpl(page.url, {
        method: 'GET',
        credentials: 'omit', // SEC-8: never send user cookies
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') ?? '';
      const html = res.ok && contentType.includes('text/html') ? await res.text() : '';
      const extracted = html ? extractReadableFromHtml(html, page.url) : null;
      const verdict = classifyFetchedHtml(res.status, contentType, extracted?.text ?? '');

      if (verdict === 'gone') {
        await this.store.putPage({ ...page, status: 'gone', updatedAt: Date.now() });
        this.progress.done++;
        this.progress.metadataOnly++;
        return 'gone';
      }

      if (verdict === 'metadata_only' || !extracted) {
        await this.store.putPage({ ...page, status: 'metadata_only', updatedAt: Date.now() });
        this.progress.done++;
        this.progress.metadataOnly++;
        return 'metadata_only';
      }

      const contentHash = await sha256Hex(extracted.text);
      const snapshot: SnapshotRecord = {
        id: `snap_${crypto.randomUUID().slice(0, 12)}`,
        pageId: page.id,
        capturedAt: Date.now(),
        contentHash,
        title: extracted.title || page.title,
        text: extracted.text,
        sanitizedHtml: extracted.sanitizedHtml,
        images: [],
        byteSize: extracted.text.length * 2,
      };
      const { snapshot: savedSnap } = await this.store.saveSnapshotVersion(snapshot);

      const chunks: ChunkRecord[] = chunkTextForExtraction(extracted.text).map((txt, idx) => ({
        id: `chk_${page.id}_${idx}`,
        pageId: page.id,
        snapshotId: savedSnap.id,
        index: idx,
        text: txt,
        tokenEstimate: estimateTokens(txt),
      }));
      await this.store.replaceChunksForPage(page.id, chunks);

      const ok = await pageIngestionService.extractAndEmbedPage(page.id, true);
      this.progress.done++;
      if (ok) {
        this.progress.enriched++;
      } else {
        this.progress.metadataOnly++;
      }
      const left = Math.max(0, this.progress.total - this.progress.done);
      this.progress.estimatedMinutesLeft = Math.ceil((left * 4) / 60);
      if (left === 0) this.progress.running = false;
      return ok ? 'enriched' : 'metadata_only';
    } catch {
      this.progress.done++;
      this.progress.metadataOnly++;
      return 'metadata_only';
    } finally {
      this.activeFetches = Math.max(0, this.activeFetches - 1);
    }
  }
}

export const backfillService = new BackfillService();
