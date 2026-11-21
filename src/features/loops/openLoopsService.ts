import type { ComparisonRow, LoopKind, LoopRecord, PageRecord, VisitRecord } from '@/shared/types';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKOUT_PATTERN = /\/(checkout|order-confirm|order-complete|thank-you|receipt|payment-success)\b/i;

export interface LoopDetectionInput {
  pages: PageRecord[];
  visits: VisitRecord[];
  dismissedKinds: LoopKind[];
  now?: number;
}

/**
 * Pure deterministic open-loop detector covering all 4 loop types (FR-OL-1 to FR-OL-7):
 *  1. Half-read articles: maxScroll < 50% and activeMs > 60s, not revisited
 *  2. Unfinished comparisons: >= 3 product pages in same cluster within 7 days, no checkout/confirmation
 *  3. Abandoned forms: form page visited with no submit navigation (URL/event only, never field values)
 *  4. Saved but not used: starred GitHub repos & bookmarks never revisited
 */
export function detectOpenLoops(input: LoopDetectionInput): LoopRecord[] {
  const now = input.now ?? Date.now();
  const dismissedSet = new Set(input.dismissedKinds);
  const visitsByPage = new Map<string, VisitRecord[]>();

  for (const v of input.visits) {
    const arr = visitsByPage.get(v.pageId) ?? [];
    arr.push(v);
    visitsByPage.set(v.pageId, arr);
  }

  const loops: LoopRecord[] = [];

  // 1. Half-read articles (FR-OL-1)
  if (!dismissedSet.has('reading')) {
    for (const page of input.pages) {
      if (page.type !== 'article' && page.type !== 'docs' && page.type !== 'other') continue;
      const pageVisits = (visitsByPage.get(page.id) ?? []).sort((a, b) => a.time - b.time);
      if (pageVisits.length !== 1) continue; // Not revisited
      const onlyVisit = pageVisits[0]!;
      if (onlyVisit.maxScroll < 50 && onlyVisit.activeMs > 60_000) {
        const mins = Math.max(1, Math.round(onlyVisit.activeMs / 60_000));
        loops.push({
          id: `loop_reading_${page.id}`,
          kind: 'reading',
          pageIds: [page.id],
          clusterId: page.clusterId,
          reason: `Read ${onlyVisit.maxScroll}% (${mins} min) and never came back.`,
          state: 'open',
          importance: 0.75 + Math.min(0.25, onlyVisit.activeMs / 600_000),
          createdAt: onlyVisit.time,
          updatedAt: now,
        });
      }
    }
  }

  // 2. Unfinished product comparisons (FR-OL-2, FR-OL-7)
  if (!dismissedSet.has('comparing')) {
    const recentProductsByCluster = new Map<string, PageRecord[]>();
    const checkoutDomainsRecent = new Set<string>();

    for (const page of input.pages) {
      if (now - page.lastSeen > SEVEN_DAYS_MS) continue;
      if (CHECKOUT_PATTERN.test(page.url) || /order\s+confirmed|thank\s+you\s+for\s+your\s+order/i.test(page.title)) {
        checkoutDomainsRecent.add(page.domain);
      }
      if (page.type === 'product' || page.price) {
        const key = page.clusterId || `domain:${page.domain}`;
        const list = recentProductsByCluster.get(key) ?? [];
        list.push(page);
        recentProductsByCluster.set(key, list);
      }
    }

    for (const [clusterKey, products] of recentProductsByCluster.entries()) {
      if (products.length < 3) continue;
      const hadCheckout = products.some((p) => checkoutDomainsRecent.has(p.domain));
      if (hadCheckout) continue;

      const sortedProducts = [...products].sort((a, b) => b.lastSeen - a.lastSeen);
      const comparisonRows: ComparisonRow[] = sortedProducts.map((p) => ({
        pageId: p.id,
        title: p.title,
        domain: p.domain,
        url: p.url,
        price: p.price,
        summary: p.summary,
      }));

      loops.push({
        id: `loop_comparing_${clusterKey}`,
        kind: 'comparing',
        pageIds: sortedProducts.map((p) => p.id),
        clusterId: sortedProducts[0]?.clusterId,
        reason: `You compared ${sortedProducts.length} options in the last 7 days with no checkout.`,
        state: 'open',
        importance: 0.95 + Math.min(0.2, sortedProducts.length * 0.04),
        createdAt: sortedProducts[0]!.lastSeen,
        updatedAt: now,
        comparisonRows,
      });
    }
  }

  // 3. Abandoned forms (FR-OL-3 — only when live capture actually observed a <form> with no submit event;
  // never guess from imported Chrome history URLs where submit telemetry is unavailable)
  if (!dismissedSet.has('form')) {
    const seenFormKey = new Set<string>();
    for (const page of input.pages) {
      const pageVisits = visitsByPage.get(page.id) ?? [];
      const hadObservedForm = pageVisits.some((v) => v.hadForm === true);
      const submitted = pageVisits.some((v) => v.formSubmitted === true);
      if (hadObservedForm && !submitted && pageVisits.length > 0) {
        const dedupeKey = `${page.domain}|${page.title.trim().toLowerCase()}`;
        if (seenFormKey.has(dedupeKey)) continue;
        seenFormKey.add(dedupeKey);
        const latest = Math.max(...pageVisits.map((v) => v.time));
        loops.push({
          id: `loop_form_${page.id}`,
          kind: 'form',
          pageIds: [page.id],
          clusterId: page.clusterId,
          reason: `Opened form on ${page.domain} without submitting.`,
          state: 'open',
          importance: 0.7,
          createdAt: latest,
          updatedAt: now,
        });
      }
    }
  }

  // 4. Saved but not used (FR-OL-4 — bookmarks & starred GitHub repos never revisited, deduped by domain+title)
  if (!dismissedSet.has('saved')) {
    const seenSavedKey = new Set<string>();
    for (const page of input.pages) {
      const isSaved =
        Boolean(page.bookmarked) ||
        Boolean(page.starred) ||
        (page.domain.includes('github.com') && Boolean(page.starred));
      if (!isSaved) continue;
      const pageVisits = visitsByPage.get(page.id) ?? [];
      if (pageVisits.length <= 1) {
        const dedupeKey = `${page.domain}|${page.title.trim().toLowerCase()}`;
        if (seenSavedKey.has(dedupeKey)) continue;
        seenSavedKey.add(dedupeKey);
        loops.push({
          id: `loop_saved_${page.id}`,
          kind: 'saved',
          pageIds: [page.id],
          clusterId: page.clusterId,
          reason: page.domain.includes('github.com')
            ? 'Starred GitHub repository you have not revisited yet.'
            : 'Bookmarked page you saved and never revisited.',
          state: 'open',
          importance: 0.6,
          createdAt: page.firstSeen,
          updatedAt: now,
        });
      }
    }
  }

  // Rank by importance + recency (FR-OL-5)
  return loops.sort((a, b) => {
    const recencyA = Math.max(0, 1 - (now - a.createdAt) / (14 * 24 * 60 * 60 * 1000));
    const recencyB = Math.max(0, 1 - (now - b.createdAt) / (14 * 24 * 60 * 60 * 1000));
    return b.importance + recencyB * 0.4 - (a.importance + recencyA * 0.4);
  });
}

export class OpenLoopsService {
  constructor(private readonly store: MemoryStore = memoryStore) {}

  async refreshOpenLoops(): Promise<LoopRecord[]> {
    const [pages, visits, existingLoops, settings] = await Promise.all([
      this.store.listPages(),
      this.store.listAllVisits(),
      this.store.listLoops(),
      this.store.getSettings(),
    ]);

    const existingMap = new Map(existingLoops.map((l) => [l.id, l]));
    const detected = detectOpenLoops({
      pages,
      visits,
      dismissedKinds: settings.dismissedLoopKinds,
    });

    const now = Date.now();
    const merged: LoopRecord[] = detected.map((loop) => {
      const prev = existingMap.get(loop.id);
      if (!prev) return loop;
      // Wake up snoozed loops once snoozeUntil has passed
      const state =
        prev.state === 'snoozed' && prev.snoozeUntil && prev.snoozeUntil <= now
          ? 'open'
          : prev.state;
      return {
        ...loop,
        state,
        snoozeUntil: state === 'snoozed' ? prev.snoozeUntil : undefined,
      };
    });

    await this.store.db.transaction('rw', [this.store.db.loops], async () => {
      await this.store.db.loops.clear();
      if (merged.length > 0) {
        await this.store.db.loops.bulkPut(merged);
      }
    });

    return merged.filter((l) => l.state === 'open');
  }

  async markDone(loopId: string): Promise<void> {
    await this.store.db.loops.update(loopId, { state: 'done', updatedAt: Date.now() });
  }

  async snooze(loopId: string, duration: '1d' | '1w'): Promise<void> {
    const delta = duration === '1d' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    await this.store.db.loops.update(loopId, {
      state: 'snoozed',
      snoozeUntil: Date.now() + delta,
      updatedAt: Date.now(),
    });
  }

  async dismissKindForever(kind: LoopKind): Promise<void> {
    const settings = await this.store.getSettings();
    const nextDismissed = Array.from(new Set([...settings.dismissedLoopKinds, kind]));
    await this.store.saveSettings({ dismissedLoopKinds: nextDismissed });
    await this.store.db.loops.where('kind').equals(kind).modify({ state: 'dismissed' });
  }
}

export const openLoopsService = new OpenLoopsService();
