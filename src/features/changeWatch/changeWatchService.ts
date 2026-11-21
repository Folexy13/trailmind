import DiffMatchPatch from 'diff-match-patch';
import type { WatchChange, WatchRecord } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { sha256Hex } from '@/core/crypto/encryption';
import { pageIdFromCanonicalUrl } from '@/core/capture/pageIngestion';
import { extractReadableFromHtml } from '@/core/capture/readabilityExtractor';
import { canonicalizeUrl } from '@/core/capture/urlPrivacy';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const PRICE_REGEX = /(?:₦|NGN|\$|USD|€|EUR|£|GBP)\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/;

/**
 * Strips noisy dynamic tokens (timestamps, clocks, live view counters, "updated X mins ago")
 * before diffing so Change Watch never triggers on ticking clocks (FR-CW-5).
 */
export function normalizeTextForDiff(text: string): string {
  return text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|utc|gmt|wat|est|pst)?\b/gi, '[TIME]')
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      '[DATE]',
    )
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?Z?)?\b/g, '[DATE]')
    .replace(/\b\d+(?:,\d{3})*\s+(?:views|visitors|online|comments|likes|shares)\b/gi, '[COUNTER]')
    .replace(/\b(?:updated|posted|checked)\s+\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago\b/gi, '[RELTIME]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractPriceFromText(text: string): { amount: number; raw: string } | null {
  const match = text.match(PRICE_REGEX);
  if (!match?.[1]) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, raw: match[0] };
}

export interface MeaningfulDiffResult {
  meaningful: boolean;
  changeRatio: number;
  oldExcerpt: string;
  newExcerpt: string;
  oldPrice?: { amount: number; raw: string };
  newPrice?: { amount: number; raw: string };
}

/**
 * Computes a noise-filtered diff between old and new snapshot main text (FR-CW-5).
 */
export function computeMeaningfulDiff(
  oldText: string,
  newText: string,
  minChangeRatio = 0.03,
): MeaningfulDiffResult {
  const cleanOld = normalizeTextForDiff(oldText);
  const cleanNew = normalizeTextForDiff(newText);

  const oldPrice = extractPriceFromText(oldText) ?? undefined;
  const newPrice = extractPriceFromText(newText) ?? undefined;
  const priceChanged =
    Boolean(oldPrice && newPrice && Math.abs(oldPrice.amount - newPrice.amount) > 0.001);

  if (cleanOld === cleanNew && !priceChanged) {
    return { meaningful: false, changeRatio: 0, oldExcerpt: '', newExcerpt: '' };
  }

  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(cleanOld.slice(0, 12000), cleanNew.slice(0, 12000));
  dmp.diff_cleanupSemantic(diffs);

  let changedChars = 0;
  const removedParts: string[] = [];
  const addedParts: string[] = [];

  for (const [op, chunk] of diffs) {
    if (op === -1) {
      changedChars += chunk.length;
      removedParts.push(chunk);
    } else if (op === 1) {
      changedChars += chunk.length;
      addedParts.push(chunk);
    }
  }

  const baseLen = Math.max(1, cleanOld.length + cleanNew.length);
  const changeRatio = changedChars / baseLen;
  const meaningful = priceChanged || (changeRatio >= minChangeRatio && changedChars >= 25);

  return {
    meaningful,
    changeRatio,
    oldExcerpt: removedParts.join(' ... ').slice(0, 1500) || cleanOld.slice(0, 600),
    newExcerpt: addedParts.join(' ... ').slice(0, 1500) || cleanNew.slice(0, 600),
    oldPrice,
    newPrice,
  };
}

export function isWithinQuietHours(
  date: Date,
  quietStartHour: number,
  quietEndHour: number,
): boolean {
  const hour = date.getHours();
  if (quietStartHour === quietEndHour) return false;
  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }
  // Overnight window (e.g., 22 -> 8)
  return hour >= quietStartHour || hour < quietEndHour;
}

/**
 * Change Watch feature (FR-CW-1 to FR-CW-8):
 * Auto-suggests watches, creates manual watches, checks on schedule with credentials omitted,
 * filters noise, summarizes diffs on-device, respects price targets and quiet hours.
 */
export class ChangeWatchService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  /**
   * Auto-suggests watches for pages visited >= 3 times in 14 days OR product pages with a price (FR-CW-1).
   */
  async computeSuggestions(): Promise<
    Array<{ pageId: string; url: string; title: string; reason: string; price?: number; currency?: string }>
  > {
    const now = Date.now();
    const [pages, visits, existingWatches] = await Promise.all([
      this.store.listPages(),
      this.store.listVisitsInRange(now - FOURTEEN_DAYS_MS, now),
      this.store.listWatches(),
    ]);

    const watchedPageIds = new Set(existingWatches.map((w) => w.pageId));
    const recentVisitsCount = new Map<string, number>();
    for (const v of visits) {
      recentVisitsCount.set(v.pageId, (recentVisitsCount.get(v.pageId) ?? 0) + 1);
    }

    const suggestions: Array<{
      pageId: string;
      url: string;
      title: string;
      reason: string;
      price?: number;
      currency?: string;
    }> = [];

    for (const page of pages) {
      if (watchedPageIds.has(page.id) || page.status === 'gone') continue;
      const count = recentVisitsCount.get(page.id) ?? 0;
      if (count >= 3) {
        suggestions.push({
          pageId: page.id,
          url: page.url,
          title: page.title,
          reason: `Visited ${count} times in the last 14 days`,
          price: page.price?.amount,
          currency: page.price?.currency,
        });
      } else if (page.type === 'product' && page.price) {
        suggestions.push({
          pageId: page.id,
          url: page.url,
          title: page.title,
          reason: `Product page (${page.price.raw}) — track price drops`,
          price: page.price.amount,
          currency: page.price.currency,
        });
      }
    }

    return suggestions.slice(0, 12);
  }

  async addWatch(input: {
    url: string;
    title: string;
    pageId?: string;
    intervalHours?: number;
    priceTarget?: number;
    priceCurrency?: string;
  }): Promise<WatchRecord> {
    const canonical = canonicalizeUrl(input.url);
    const pageId = input.pageId ?? (await pageIdFromCanonicalUrl(canonical));
    const settings = await this.store.getSettings();
    const rc = remoteConfigService.getValues();
    const snapshot = await this.store.getLatestSnapshot(pageId);
    const page = await this.store.getPage(pageId);

    const watch: WatchRecord = {
      id: `watch_${pageId}`,
      pageId,
      url: input.url,
      title: input.title || page?.title || canonical,
      intervalHours:
        input.intervalHours ?? settings.changeWatchIntervalHours ?? rc.changeWatchIntervalHours ?? 12,
      priceTarget: input.priceTarget,
      priceCurrency: input.priceCurrency ?? page?.price?.currency,
      lastCheck: Date.now(),
      lastHash: snapshot?.contentHash,
      lastText: snapshot?.text.slice(0, 12000),
      lastPrice: page?.price?.amount,
      changes: [],
      enabled: true,
      suggested: false,
      createdAt: Date.now(),
    };

    await this.store.putWatch(watch);
    return watch;
  }

  /**
   * Checks one watched page against a freshly fetched copy (or injected HTML for tests) (FR-CW-3..FR-CW-8).
   */
  async checkWatch(
    watchId: string,
    options?: { fetchImpl?: typeof fetch; fetchedHtml?: string; fetchedStatus?: number; now?: Date },
  ): Promise<{ changed: boolean; notified: boolean; change?: WatchChange }> {
    const watch = await this.store.db.watches.get(watchId);
    if (!watch || !watch.enabled) return { changed: false, notified: false };

    const nowDate = options?.now ?? new Date();
    let status = options?.fetchedStatus ?? 200;
    let html = options?.fetchedHtml ?? '';

    if (options?.fetchedHtml === undefined) {
      const fetchFn = options?.fetchImpl ?? fetch;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        const res = await fetchFn(watch.url, { credentials: 'omit', signal: controller.signal });
        clearTimeout(timer);
        status = res.status;
        html = res.ok ? await res.text() : '';
      } catch {
        status = 0;
      }
    }

    // Dead link detection (FR-SN-4, FR-CW-4)
    if (status === 404 || status === 410 || status === 0) {
      const page = await this.store.getPage(watch.pageId);
      if (page && page.status !== 'gone') {
        await this.store.putPage({ ...page, status: 'gone', updatedAt: nowDate.getTime() });
      }
      const change: WatchChange = {
        id: `chg_${crypto.randomUUID().slice(0, 10)}`,
        detectedAt: nowDate.getTime(),
        summary: `Page is no longer available (HTTP ${status || 'unreachable'}); your saved snapshot is kept.`,
        kind: 'removed',
        aiSource: 'on_device',
      };
      watch.changes = [change, ...watch.changes].slice(0, 20);
      watch.lastCheck = nowDate.getTime();
      await this.store.putWatch(watch);
      const notified = await this.maybeNotify(watch, change, nowDate);
      return { changed: true, notified, change };
    }

    const parsed = extractReadableFromHtml(html, watch.url);
    const newText = parsed.text;
    const newHash = await sha256Hex(newText);

    if (!watch.lastText) {
      watch.lastText = newText.slice(0, 12000);
      watch.lastHash = newHash;
      watch.lastPrice = extractPriceFromText(newText)?.amount ?? watch.lastPrice;
      watch.lastCheck = nowDate.getTime();
      await this.store.putWatch(watch);
      return { changed: false, notified: false };
    }

    const diff = computeMeaningfulDiff(watch.lastText, newText);
    watch.lastCheck = nowDate.getTime();

    if (!diff.meaningful) {
      await this.store.putWatch(watch);
      return { changed: false, notified: false };
    }

    // Price target check (FR-CW-8): if a price target is set and price is still above target, record but do not alert
    const newPriceNum = diff.newPrice?.amount;
    const belowTarget =
      watch.priceTarget === undefined ||
      (newPriceNum !== undefined && newPriceNum <= watch.priceTarget);

    let change: WatchChange;
    try {
      const aiDiff = await this.ai.summarizeChangeDiff({
        title: watch.title,
        url: watch.url,
        oldSnippet: diff.oldExcerpt,
        newSnippet: diff.newExcerpt,
      });
      if (!aiDiff.data.changed) {
        await this.store.putWatch(watch);
        return { changed: false, notified: false };
      }
      change = {
        id: `chg_${crypto.randomUUID().slice(0, 10)}`,
        detectedAt: nowDate.getTime(),
        summary: aiDiff.data.summary,
        kind: aiDiff.data.kind,
        oldValue: aiDiff.data.old_value ?? diff.oldPrice?.raw,
        newValue: aiDiff.data.new_value ?? diff.newPrice?.raw,
        aiSource: aiDiff.ranOn,
      };
    } catch {
      const summary =
        diff.oldPrice && diff.newPrice && diff.oldPrice.amount !== diff.newPrice.amount
          ? `Price ${diff.newPrice.amount < diff.oldPrice.amount ? 'dropped' : 'changed'} from ${diff.oldPrice.raw} to ${diff.newPrice.raw}.`
          : `Content updated on ${watch.title}.`;
      change = {
        id: `chg_${crypto.randomUUID().slice(0, 10)}`,
        detectedAt: nowDate.getTime(),
        summary,
        kind: diff.oldPrice && diff.newPrice ? 'price' : 'content',
        oldValue: diff.oldPrice?.raw,
        newValue: diff.newPrice?.raw,
        aiSource: 'on_device',
      };
    }

    watch.lastText = newText.slice(0, 12000);
    watch.lastHash = newHash;
    if (newPriceNum !== undefined) watch.lastPrice = newPriceNum;
    watch.changes = [change, ...watch.changes].slice(0, 20);
    await this.store.putWatch(watch);

    // Also store a new snapshot version so history is preserved
    await this.store.saveSnapshotVersion({
      id: `snap_${crypto.randomUUID().slice(0, 12)}`,
      pageId: watch.pageId,
      capturedAt: nowDate.getTime(),
      contentHash: newHash,
      title: parsed.title || watch.title,
      text: newText,
      sanitizedHtml: parsed.sanitizedHtml,
      images: [],
      byteSize: newText.length * 2,
    });

    const notified = belowTarget ? await this.maybeNotify(watch, change, nowDate) : false;
    return { changed: true, notified, change };
  }

  private async maybeNotify(
    watch: WatchRecord,
    change: WatchChange,
    nowDate: Date,
  ): Promise<boolean> {
    const settings = await this.store.getSettings();
    if (!settings.notificationsEnabled) return false;
    if (isWithinQuietHours(nowDate, settings.quietHoursStart, settings.quietHoursEnd)) {
      return false;
    }

    const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
    if (chromeApi?.notifications?.create) {
      chromeApi.notifications.create(`tm_watch_${watch.id}_${change.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `Trailmind Change Watch: ${watch.title.slice(0, 48)}`,
        message: change.summary,
      });
    }
    return true;
  }
}

export const changeWatchService = new ChangeWatchService();
