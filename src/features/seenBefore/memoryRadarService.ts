import type { PageRecord, RadarAlert } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { extractDomain } from '@/core/capture/urlPrivacy';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import { extractPriceFromText } from '@/features/changeWatch/changeWatchService';

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function tokenOverlapScore(a: string, b: string): number {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'inch', 'pro', 'new', 'buy', 'best']);
  const toSet = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stop.has(w)),
    );
  const setA = toSet(a);
  const setB = toSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared++;
  }
  return shared / Math.min(setA.size, setB.size);
}

/**
 * Ambient Contradiction & Price-vs-Memory Radar (strictly ONLY_ON_DEVICE):
 * Cross-checks the live page the user is reading right now against facts & prices
 * previously captured in their local encrypted memory.
 */
export class MemoryRadarService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  /**
   * 1. Instant deterministic Price-vs-Memory check (< 5 ms):
   *    If the live page lists a price higher than a remembered page for the same product,
   *    immediately alert the user with the exact savings and source link.
   */
  detectBetterPriceInMemory(input: {
    currentUrl: string;
    currentTitle: string;
    currentText: string;
    candidatePages: PageRecord[];
  }): RadarAlert | null {
    const livePrice = extractPriceFromText(`${input.currentTitle} ${input.currentText.slice(0, 2500)}`);
    if (!livePrice || livePrice.amount <= 0) return null;

    const currentDomain = extractDomain(input.currentUrl);
    let bestCheaper: { page: PageRecord; savings: number; overlap: number } | null = null;

    for (const page of input.candidatePages) {
      if (!page.price || page.price.amount <= 0) continue;
      // Same currency family check (rough prefix check on raw symbol)
      const liveSymbol = livePrice.raw.replace(/[0-9.,\s]/g, '');
      const memSymbol = page.price.raw.replace(/[0-9.,\s]/g, '');
      if (liveSymbol && memSymbol && liveSymbol !== memSymbol) continue;

      const overlap = tokenOverlapScore(input.currentTitle, page.title);
      if (overlap < 0.35) continue;

      const savings = livePrice.amount - page.price.amount;
      if (savings >= Math.max(10, livePrice.amount * 0.04)) {
        if (!bestCheaper || savings > bestCheaper.savings) {
          bestCheaper = { page, savings, overlap };
        }
      }
    }

    if (!bestCheaper) return null;

    const { page, savings } = bestCheaper;
    const symbol = page.price!.raw.replace(/[0-9.,\s]/g, '') || '$';
    const savingsText = `${symbol}${Math.round(savings).toLocaleString()}`;
    const sameSite = page.domain === currentDomain;

    return {
      kind: 'price_better',
      headline: `Save ${savingsText} vs. your memory`,
      detail: sameSite
        ? `You saw "${page.title}" for ${page.price!.raw} on ${formatShortDate(page.lastSeen)} (currently ${livePrice.raw}).`
        : `You saw "${page.title}" for ${page.price!.raw} on ${page.domain} on ${formatShortDate(page.lastSeen)} (currently ${livePrice.raw} here).`,
      sourcePageId: page.id,
      sourceTitle: page.title,
      sourceUrl: page.url,
      sourceDate: page.lastSeen,
      savingsText,
      aiSource: 'on_device',
    };
  }

  /**
   * 2. Full Ambient Radar analysis: deterministic price check first, then ONLY_ON_DEVICE
   *    Gemini Nano cross-page fact check against top 3 related pages.
   */
  async analyzeLivePage(input: {
    url: string;
    title: string;
    textSample: string;
    relatedPageIds: string[];
  }): Promise<RadarAlert | null> {
    const relatedPages = (
      await Promise.all(input.relatedPageIds.slice(0, 5).map((id) => this.store.getPage(id)))
    ).filter((p): p is PageRecord => Boolean(p));

    // Also include recent priced product pages for instant price-vs-memory spotting
    const allPages = await this.store.listPages();
    const pricedPages = allPages.filter((p) => Boolean(p.price) && p.url !== input.url);
    const priceCandidates = Array.from(
      new Map([...relatedPages, ...pricedPages].map((p) => [p.id, p])).values(),
    );

    const priceAlert = this.detectBetterPriceInMemory({
      currentUrl: input.url,
      currentTitle: input.title,
      currentText: input.textSample,
      candidatePages: priceCandidates,
    });
    if (priceAlert) return priceAlert;

    if (relatedPages.length === 0) return null;

    const rememberedItems: Array<{
      pageId: string;
      title: string;
      domain: string;
      dateStr: string;
      facts: string[];
    }> = [];

    for (const page of relatedPages.slice(0, 3)) {
      const facts = await this.store.listFactsForPage(page.id);
      const factTexts = facts.map((f) => f.text);
      if (factTexts.length === 0 && page.summary) {
        factTexts.push(page.summary);
      }
      if (factTexts.length === 0) continue;
      rememberedItems.push({
        pageId: page.id,
        title: page.title,
        domain: page.domain,
        dateStr: formatShortDate(page.lastSeen),
        facts: factTexts.slice(0, 5),
      });
    }

    if (rememberedItems.length === 0) return null;

    try {
      const res = await this.ai.runMemoryRadar({
        currentTitle: input.title,
        currentDomain: extractDomain(input.url),
        currentExcerpt: input.textSample.slice(0, 2000),
        rememberedItems,
      });

      if (!res.data.has_alert || res.data.kind === 'none') {
        return null;
      }

      const sourcePage =
        relatedPages.find((p) => p.id === res.data.source_page_id) ?? relatedPages[0]!;

      return {
        kind: res.data.kind,
        headline: res.data.headline || 'Memory Radar Alert',
        detail: res.data.detail,
        sourcePageId: sourcePage.id,
        sourceTitle: sourcePage.title,
        sourceUrl: sourcePage.url,
        sourceDate: sourcePage.lastSeen,
        aiSource: res.ranOn,
      };
    } catch {
      return null;
    }
  }
}

export const memoryRadarService = new MemoryRadarService();
