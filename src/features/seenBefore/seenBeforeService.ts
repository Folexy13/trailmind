import type { SeenBeforeMatch } from '@/shared/types';
import {
  canonicalizeUrl,
  extractDomain,
  isDomainExcluded,
  isRecordableUrl,
} from '@/core/capture/urlPrivacy';
import { embeddingEngine, type EmbeddingEngine } from '@/core/embeddings/embeddingEngine';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import { memoryRadarService, type MemoryRadarService } from './memoryRadarService';

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * "Seen before" badge engine (FR-SB-1 to FR-SB-5, NFR-PF-9).
 * Runs in < 500ms: checks exact revisit stats first, then embeds first 1,000 words and
 * compares against local int8 vector index using the Remote Config similarity threshold (default 0.78).
 */
export class SeenBeforeService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly embeddings: EmbeddingEngine = embeddingEngine,
    private readonly radar: MemoryRadarService = memoryRadarService,
  ) {}

  async checkPage(input: {
    url: string;
    title: string;
    textSample: string;
  }): Promise<SeenBeforeMatch | null> {
    const started = performance.now();
    if (!isRecordableUrl(input.url)) return null;

    const settings = await this.store.getSettings();
    if (!settings.seenBeforeEnabled) return null;

    const domain = extractDomain(input.url);
    if (
      isDomainExcluded(domain, settings.exclusions) ||
      isDomainExcluded(domain, settings.seenBeforeDisabledDomains)
    ) {
      return null;
    }

    const canonical = canonicalizeUrl(input.url);
    const existingPage = await this.store.getPageByCanonicalUrl(canonical);

    // 1. Exact revisit match (FR-SB-4): "You read this on 12 Nov, 4 minutes, 80% read"
    if (existingPage) {
      const visits = await this.store.listVisitsForPage(existingPage.id);
      const lastVisit = visits[visits.length - 1];
      const totalActiveMins = Math.max(
        1,
        Math.round(visits.reduce((s, v) => s + v.activeMs, 0) / 60_000),
      );
      const maxScroll = Math.max(0, ...visits.map((v) => v.maxScroll));
      const dateStr = formatShortDate(lastVisit?.time ?? existingPage.lastSeen);
      const cluster = existingPage.clusterId
        ? await this.store.db.clusters.get(existingPage.clusterId)
        : undefined;

      return {
        kind: 'exact_revisit',
        message: `You read this on ${dateStr}, ${totalActiveMins} min, ${maxScroll}% read`,
        pageId: existingPage.id,
        lastVisitedAt: lastVisit?.time ?? existingPage.lastSeen,
        activeMinutes: totalActiveMins,
        maxScrollPercent: maxScroll,
        clusterId: cluster?.id,
        clusterName: cluster?.name,
        relatedPages: [],
        lookupMs: Math.round(performance.now() - started),
      };
    }

    // 2. Semantic similarity match over first 1,000 words (FR-SB-1, FR-SB-2)
    const firstThousandWords = `${input.title}. ${input.textSample}`
      .split(/\s+/)
      .slice(0, 1000)
      .join(' ');
    if (firstThousandWords.trim().length < 40) return null;

    const rcThreshold = remoteConfigService.getValues().seenBeforeThreshold;
    const threshold = settings.seenBeforeThreshold || rcThreshold || 0.78;

    const hits = await this.embeddings.searchSimilar(firstThousandWords, {
      topK: 10,
      ownerKinds: ['page', 'fact'],
      minSimilarity: threshold,
    });

    if (hits.length === 0) return null;

    const uniquePageIds: Array<{ pageId: string; similarity: number }> = [];
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h.pageId)) continue;
      seen.add(h.pageId);
      uniquePageIds.push({ pageId: h.pageId, similarity: h.similarity });
    }

    const relatedPages: SeenBeforeMatch['relatedPages'] = [];
    let dominantClusterId: string | undefined;
    for (const item of uniquePageIds.slice(0, 5)) {
      const page = await this.store.getPage(item.pageId);
      if (!page) continue;
      if (!dominantClusterId && page.clusterId) dominantClusterId = page.clusterId;
      relatedPages.push({
        pageId: page.id,
        title: page.title,
        url: page.url,
        domain: page.domain,
        similarity: Number(item.similarity.toFixed(2)),
      });
    }

    if (relatedPages.length === 0) {
      // Even without embedding hits, run the fast (<5ms) deterministic Price-vs-Memory check
      const priceOnlyRadar = await this.radar.analyzeLivePage({
        url: input.url,
        title: input.title,
        textSample: firstThousandWords,
        relatedPageIds: [],
      });
      if (priceOnlyRadar) {
        return {
          kind: 'radar_price',
          message: `${priceOnlyRadar.headline} — ${priceOnlyRadar.detail}`,
          pageId: priceOnlyRadar.sourcePageId,
          radarAlert: priceOnlyRadar,
          relatedPages: [],
          lookupMs: Math.round(performance.now() - started),
        };
      }
      return null;
    }

    // 3. Ambient Contradiction & Price-vs-Memory Radar (ONLY_ON_DEVICE)
    const radarAlert = await this.radar.analyzeLivePage({
      url: input.url,
      title: input.title,
      textSample: firstThousandWords,
      relatedPageIds: relatedPages.map((p) => p.pageId),
    });

    const cluster = dominantClusterId
      ? await this.store.db.clusters.get(dominantClusterId)
      : undefined;

    if (radarAlert) {
      const kind =
        radarAlert.kind === 'price_better'
          ? 'radar_price'
          : radarAlert.kind === 'conflict'
            ? 'radar_conflict'
            : 'radar_update';
      return {
        kind,
        message: `${radarAlert.headline} — ${radarAlert.detail}`,
        pageId: radarAlert.sourcePageId,
        clusterId: cluster?.id,
        clusterName: cluster?.name,
        radarAlert,
        relatedPages,
        lookupMs: Math.round(performance.now() - started),
      };
    }

    const topicLabel = cluster?.name || relatedPages[0]?.domain || 'this topic';

    return {
      kind: 'related',
      message: `Related to ${relatedPages.length} page${relatedPages.length === 1 ? '' : 's'} you read about ${topicLabel}`,
      clusterId: cluster?.id,
      clusterName: cluster?.name,
      relatedPages,
      lookupMs: Math.round(performance.now() - started),
    };
  }
}

export const seenBeforeService = new SeenBeforeService();
