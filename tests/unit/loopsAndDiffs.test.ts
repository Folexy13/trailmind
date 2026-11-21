import { describe, expect, it } from 'vitest';
import type { PageRecord, VisitRecord } from '@/shared/types';
import { TrailmindAI, type ModelTransport } from '@/core/ai/hybridAi';
import { CryptoService } from '@/core/crypto/encryption';
import { TrailmindDB } from '@/core/store/db';
import { MemoryStore } from '@/core/store/memoryStore';
import {
  ChangeWatchService,
  computeMeaningfulDiff,
  isWithinQuietHours,
} from '@/features/changeWatch/changeWatchService';
import { detectOpenLoops } from '@/features/loops/openLoopsService';

function makePage(overrides: Partial<PageRecord> & { id: string }): PageRecord {
  const now = Date.now();
  return {
    url: `https://example.com/${overrides.id}`,
    canonicalUrl: `https://example.com/${overrides.id}`,
    domain: 'example.com',
    title: `Page ${overrides.id}`,
    type: 'article',
    summary: 'Summary',
    language: 'en',
    topics: ['Topic'],
    englishTopics: ['Topic'],
    entities: [],
    firstSeen: now - 3600_000,
    lastSeen: now - 3600_000,
    status: 'full',
    promptVersion: '1.0.0',
    updatedAt: now,
    ...overrides,
  };
}

describe('Open Loops detection (FR-OL-1..FR-OL-7)', () => {
  it('detects half-read articles, unfinished 3-product comparisons, abandoned forms, and untouched bookmarks', () => {
    const now = Date.now();
    const pages: PageRecord[] = [
      makePage({ id: 'half_read', type: 'article', title: 'Deep Rust Async Guide' }),
      makePage({
        id: 'prod_1',
        type: 'product',
        clusterId: 'clu_laptops',
        title: 'MacBook Air M4',
        price: { amount: 1099, currency: 'USD', raw: '$1,099' },
      }),
      makePage({
        id: 'prod_2',
        type: 'product',
        clusterId: 'clu_laptops',
        title: 'ThinkPad X1 Carbon',
        price: { amount: 1399, currency: 'USD', raw: '$1,399' },
      }),
      makePage({
        id: 'prod_3',
        type: 'product',
        clusterId: 'clu_laptops',
        title: 'Framework 13',
        price: { amount: 1149, currency: 'USD', raw: '$1,149' },
      }),
      makePage({
        id: 'form_1',
        url: 'https://events.example.com/signup',
        canonicalUrl: 'https://events.example.com/signup',
        type: 'other',
        title: 'Speaker Signup Form',
      }),
      makePage({
        id: 'saved_1',
        domain: 'github.com',
        type: 'tool',
        title: 'awesome-web-ai',
        bookmarked: true,
        starred: true,
      }),
    ];

    const visits: VisitRecord[] = [
      { id: 'v1', pageId: 'half_read', time: now - 5000, activeMs: 95_000, maxScroll: 35, transition: 'link', sessionId: 's1' },
      { id: 'v2', pageId: 'prod_1', time: now - 4000, activeMs: 80_000, maxScroll: 80, transition: 'link', sessionId: 's2' },
      { id: 'v3', pageId: 'prod_2', time: now - 3000, activeMs: 80_000, maxScroll: 80, transition: 'link', sessionId: 's2' },
      { id: 'v4', pageId: 'prod_3', time: now - 2000, activeMs: 80_000, maxScroll: 80, transition: 'link', sessionId: 's2' },
      { id: 'v5', pageId: 'form_1', time: now - 1500, activeMs: 70_000, maxScroll: 60, transition: 'link', sessionId: 's3', hadForm: true, formSubmitted: false },
      { id: 'v6', pageId: 'saved_1', time: now - 1000, activeMs: 30_000, maxScroll: 80, transition: 'link', sessionId: 's4' },
    ];

    const loops = detectOpenLoops({ pages, visits, dismissedKinds: [], now });
    expect(loops.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['reading', 'comparing', 'form', 'saved']),
    );

    const compareLoop = loops.find((l) => l.kind === 'comparing');
    expect(compareLoop?.comparisonRows).toHaveLength(3);
    expect(compareLoop?.comparisonRows?.map((r) => r.price?.raw)).toEqual(
      expect.arrayContaining(['$1,099', '$1,399', '$1,149']),
    );
  });

  it('suppresses comparison loop when checkout page was visited', () => {
    const now = Date.now();
    const pages: PageRecord[] = [
      makePage({ id: 'p1', domain: 'shop.dev', type: 'product', clusterId: 'c1', price: { amount: 100, currency: 'USD', raw: '$100' } }),
      makePage({ id: 'p2', domain: 'shop.dev', type: 'product', clusterId: 'c1', price: { amount: 120, currency: 'USD', raw: '$120' } }),
      makePage({ id: 'p3', domain: 'shop.dev', type: 'product', clusterId: 'c1', price: { amount: 140, currency: 'USD', raw: '$140' } }),
      makePage({ id: 'co', domain: 'shop.dev', url: 'https://shop.dev/checkout', canonicalUrl: 'https://shop.dev/checkout', title: 'Order Confirmed' }),
    ];
    const loops = detectOpenLoops({ pages, visits: [], dismissedKinds: [], now });
    expect(loops.some((l) => l.kind === 'comparing')).toBe(false);
  });
});

describe('Change Watch noise filtering, price drop & dead link detection (FR-CW-4..8, FR-SN-4)', () => {
  it('ignores ticking clocks, dates, and view counters (FR-CW-5)', () => {
    const oldText =
      'API Reference Documentation. Updated 5 minutes ago on Nov 19, 2026 at 10:15 AM. 1,245 views. The endpoint returns JSON payloads encrypted with AES-GCM 256.';
    const newText =
      'API Reference Documentation. Updated 12 minutes ago on Nov 20, 2026 at 11:42 PM. 1,302 views. The endpoint returns JSON payloads encrypted with AES-GCM 256.';
    const diff = computeMeaningfulDiff(oldText, newText);
    expect(diff.meaningful).toBe(false);
  });

  it('detects price drops, respects price target and quiet hours, and flags dead links (FR-CW-4, FR-CW-6, FR-CW-8, FR-SN-4)', async () => {
    const db = new TrailmindDB(`WatchTest_${crypto.randomUUID()}`);
    const store = new MemoryStore(db, new CryptoService());
    await store.init();

    const mockTransport: ModelTransport = {
      async generate() {
        return {
          text: JSON.stringify({
            changed: true,
            summary: 'Price dropped from $1,299 to $1,099.',
            kind: 'price',
            old_value: '$1,299',
            new_value: '$1,099',
          }),
          ranOn: 'on_device',
        };
      },
    };
    const ai = new TrailmindAI(store, mockTransport);
    const svc = new ChangeWatchService(store, ai);

    await store.putPage(
      makePage({
        id: 'pg_laptop',
        url: 'https://store.example.com/macbook',
        canonicalUrl: 'https://store.example.com/macbook',
        title: 'MacBook Air M4',
        type: 'product',
        price: { amount: 1299, currency: 'USD', raw: '$1,299' },
      }),
    );
    await store.saveSnapshotVersion({
      id: 'snap_init',
      pageId: 'pg_laptop',
      capturedAt: Date.now() - 3600_000,
      contentHash: 'h_init',
      title: 'MacBook Air M4',
      text: 'MacBook Air 15 M4 laptop with 24GB unified memory. Current price: $1,299 in stock.',
      images: [],
      byteSize: 120,
    });

    const watch = await svc.addWatch({
      pageId: 'pg_laptop',
      url: 'https://store.example.com/macbook',
      title: 'MacBook Air M4',
      priceTarget: 1150,
    });

    // Daytime check with price dropped below target ($1,099 <= $1,150)
    const daytime = new Date(2026, 10, 20, 14, 0, 0);
    const res = await svc.checkWatch(watch.id, {
      fetchedStatus: 200,
      fetchedHtml:
        '<html><body><article><h1>MacBook Air M4</h1><p>MacBook Air 15 M4 laptop with 24GB unified memory. Current price: $1,099 in stock.</p></article></body></html>',
      now: daytime,
    });
    expect(res.changed).toBe(true);
    expect(res.notified).toBe(true);
    expect(res.change?.summary).toContain('$1,299');
    expect(res.change?.summary).toContain('$1,099');

    // Quiet hours verification (22:00 - 08:00)
    expect(isWithinQuietHours(new Date(2026, 10, 20, 23, 30, 0), 22, 8)).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 10, 20, 14, 0, 0), 22, 8)).toBe(false);

    // Dead link 404 marks page status='gone' while keeping snapshot (FR-SN-4)
    const deadRes = await svc.checkWatch(watch.id, {
      fetchedStatus: 404,
      fetchedHtml: '',
      now: daytime,
    });
    expect(deadRes.changed).toBe(true);
    expect(deadRes.change?.kind).toBe('removed');
    const updatedPage = await store.getPage('pg_laptop');
    expect(updatedPage?.status).toBe('gone');
    const keptSnap = await store.getLatestSnapshot('pg_laptop');
    expect(keptSnap?.text).toContain('MacBook Air');

    await db.delete();
  });
});
