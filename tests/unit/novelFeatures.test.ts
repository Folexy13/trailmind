import { describe, expect, it } from 'vitest';
import type { PageRecord } from '@/shared/types';
import { TrailmindAI, type ModelTransport, type ModelTransportRequest } from '@/core/ai/hybridAi';
import { CryptoService } from '@/core/crypto/encryption';
import { GraphEngine } from '@/core/graph/graphEngine';
import { TrailmindDB } from '@/core/store/db';
import { MemoryStore } from '@/core/store/memoryStore';
import { DecisionMatrixService } from '@/features/decisions/decisionMatrixService';
import { MemoryRadarService } from '@/features/seenBefore/memoryRadarService';
import { TabRescueService } from '@/features/tabRescue/tabRescueService';

async function setup() {
  const db = new TrailmindDB(`NovelTest_${crypto.randomUUID()}`);
  const store = new MemoryStore(db, new CryptoService());
  await store.init();
  return { db, store };
}

function makePage(overrides: Partial<PageRecord> & { id: string }): PageRecord {
  const now = Date.now();
  return {
    url: `https://example.com/${overrides.id}`,
    canonicalUrl: `https://example.com/${overrides.id}`,
    domain: 'example.com',
    title: `Page ${overrides.id}`,
    type: 'product',
    summary: 'Summary',
    language: 'en',
    topics: ['Laptops'],
    englishTopics: ['Laptops'],
    entities: [],
    firstSeen: now - 86_400_000,
    lastSeen: now - 86_400_000,
    status: 'full',
    promptVersion: '1.0.0',
    updatedAt: now,
    ...overrides,
  };
}

describe('Tab Graveyard Rescue', () => {
  it('scans open tabs, detects duplicates & exclusions, archives into pinned Journeys, and closes only non-active non-pinned tabs', async () => {
    const { db, store } = await setup();
    const graph = new GraphEngine(store);
    const svc = new TabRescueService(store, graph);

    const plan = await svc.buildRescuePlanFromTabs([
      { id: 1, url: 'https://github.com/better-auth/better-auth', title: 'Better Auth', active: true },
      { id: 2, url: 'https://github.com/better-auth/better-auth?utm_source=twitter', title: 'Better Auth Dup' },
      { id: 3, url: 'https://github.com/firebase/agent-skills', title: 'Firebase Agent Skills' },
      { id: 4, url: 'https://mail.google.com/mail/u/0/', title: 'Gmail (excluded)' },
      { id: 5, url: 'https://secret.example.com', title: 'Incognito', incognito: true },
      { id: 6, url: 'https://docs.example.com/pinned', title: 'Pinned Doc', pinned: true },
    ]);

    // Excludes Gmail and incognito tab
    expect(plan.rescuableTabs.map((t) => t.tabId)).toEqual([1, 2, 3, 6]);
    expect(plan.duplicateCount).toBe(1);
    expect(plan.estimatedRamMb).toBe(2 * 75); // tabs 2 and 3 (non-active, non-pinned)

    let closedIds: number[] = [];
    const outcome = await svc.executeRescue(plan.rescuableTabs, {
      closeTabs: true,
      closeTabFn: async (ids) => {
        closedIds = ids;
      },
    });

    expect(outcome.archivedCount).toBe(4);
    expect(outcome.closedCount).toBe(2);
    expect(closedIds).toEqual([2, 3]); // active tab 1 & pinned tab 6 preserved!
    expect(outcome.journeysCreated).toBeGreaterThanOrEqual(2);

    const journeys = await store.listJourneys();
    expect(journeys.some((j) => j.name.startsWith('Rescued:'))).toBe(true);

    await db.delete();
  });
});

describe('Ambient Contradiction & Price-vs-Memory Radar (ONLY_ON_DEVICE)', () => {
  it('spots a cheaper price previously seen in memory with exact savings', async () => {
    const { db, store } = await setup();
    const radar = new MemoryRadarService(store);

    await store.putPage(
      makePage({
        id: 'pg_macbook_cheap',
        url: 'https://store-a.example.com/macbook-air-m4-15',
        canonicalUrl: 'https://store-a.example.com/macbook-air-m4-15',
        domain: 'store-a.example.com',
        title: 'Apple MacBook Air 15-inch M4 (24GB RAM)',
        price: { amount: 1099, currency: 'USD', raw: '$1,099' },
      }),
    );

    const alert = await radar.analyzeLivePage({
      url: 'https://store-b.example.com/macbook-air-m4',
      title: 'Apple MacBook Air 15-inch M4 24GB',
      textSample: 'Apple MacBook Air 15-inch M4 with 24GB unified memory. Buy now for $1,249.',
      relatedPageIds: ['pg_macbook_cheap'],
    });

    expect(alert).not.toBeNull();
    expect(alert?.kind).toBe('price_better');
    expect(alert?.savingsText).toBe('$150');
    expect(alert?.sourcePageId).toBe('pg_macbook_cheap');
    expect(alert?.aiSource).toBe('on_device');

    await db.delete();
  });

  it('runs cross-page contradiction checks strictly ONLY_ON_DEVICE even when cloud master switch is ON', async () => {
    const { db, store } = await setup();
    await store.saveSettings({
      cloud: {
        masterEnabled: true,
        cloudAnswers: true,
        cloudExtractionFallback: false,
        cloudDeepSummary: true,
        cloudRecapPolish: true,
        cloudMediaPdf: true,
      },
    });

    await store.putPage(
      makePage({
        id: 'pg_issue_412',
        url: 'https://github.com/org/lib/issues/412',
        canonicalUrl: 'https://github.com/org/lib/issues/412',
        domain: 'github.com',
        type: 'thread',
        title: 'GitHub Issue #412: Edge Runtime WebCrypto crash',
        summary: 'Edge Runtime breaks WebCrypto streams in v2.1.',
      }),
    );
    await store.putFact({
      id: 'fct_issue_412',
      pageId: 'pg_issue_412',
      text: 'Issue #412 reports Edge Runtime breaks WebCrypto streams in v2.1.',
      fromImage: false,
      highlight: false,
      createdAt: Date.now() - 86_400_000,
    });

    let observedMode = '';
    const transport: ModelTransport = {
      async generate(req: ModelTransportRequest) {
        observedMode = req.mode;
        return {
          text: JSON.stringify({
            has_alert: true,
            kind: 'conflict',
            headline: 'Conflicts with GitHub Issue #412',
            detail: 'This blog claims full Edge Runtime support, but Issue #412 you read notes WebCrypto streams crash in v2.1.',
            source_page_id: 'pg_issue_412',
          }),
          ranOn: 'on_device',
        };
      },
    };

    const ai = new TrailmindAI(store, transport);
    const radar = new MemoryRadarService(store, ai);

    const alert = await radar.analyzeLivePage({
      url: 'https://blog.example.com/lib-review',
      title: 'Why Lib works everywhere including Edge Runtime',
      textSample: 'Lib v2.1 supports Edge Runtime with zero WebCrypto issues.',
      relatedPageIds: ['pg_issue_412'],
    });

    // Privacy invariant: memory_radar MUST NEVER leave the device!
    expect(observedMode).toBe('only_on_device');
    expect(alert?.kind).toBe('conflict');
    expect(alert?.headline).toContain('Issue #412');

    await db.delete();
  });
});

describe('Hybrid Decision Matrix (On-Device Nano -> Facts-Only Cloud Escalation)', () => {
  it('runs small clusters on-device and escalates large clusters facts-only to cloud when enabled', async () => {
    const { db, store } = await setup();

    const pages: PageRecord[] = Array.from({ length: 8 }, (_, idx) =>
      makePage({
        id: `pg_opt_${idx}`,
        title: `Laptop Option ${idx + 1}`,
        clusterId: 'clu_laptops',
        price: { amount: 1000 + idx * 100, currency: 'USD', raw: `$${1000 + idx * 100}` },
        summary: `Specs for Laptop Option ${idx + 1}.`,
      }),
    );
    await store.putPagesBulk(pages);
    await store.putClusters([
      {
        id: 'clu_laptops',
        name: 'Laptop Comparison',
        summary: 'Comparing 8 developer laptops',
        userRenamed: false,
        pinned: false,
        hidden: false,
        color: '#2563eb',
        pageIds: pages.map((p) => p.id),
        topics: ['Laptops'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const modesSeen: string[] = [];
    const transport: ModelTransport = {
      async generate(req: ModelTransportRequest) {
        modesSeen.push(req.mode);
        return {
          text: JSON.stringify({
            title: 'Laptop Comparison Decision Matrix',
            summary: 'Comparison across researched laptops.',
            recommended_option: 'Laptop Option 1',
            options: [
              {
                option: 'Laptop Option 1',
                price_or_cost: '$1,000',
                pros: ['Lowest price'],
                cons: ['Base storage'],
                verdict: 'Best value',
                source_page_ids: ['pg_opt_0'],
              },
            ],
            open_questions: ['Do you need a dedicated GPU?'],
          }),
          ranOn: req.mode === 'prefer_in_cloud' ? 'cloud' : 'on_device',
        };
      },
    };

    const ai = new TrailmindAI(store, transport);
    const svc = new DecisionMatrixService(store, ai);

    // 1. With cloud master switch OFF (default): stays 100% on-device
    const localMatrix = await svc.buildMatrix({ clusterId: 'clu_laptops' });
    expect(localMatrix.aiSource).toBe('on_device');
    expect(localMatrix.escalatedToCloud).toBe(false);
    expect(modesSeen[0]).toBe('only_on_device');

    // 2. With cloud master + deep summary enabled: 8-page cluster auto-escalates facts-only to cloud!
    await store.saveSettings({
      cloud: {
        masterEnabled: true,
        cloudAnswers: true,
        cloudExtractionFallback: false,
        cloudDeepSummary: true,
        cloudRecapPolish: false,
        cloudMediaPdf: false,
      },
    });
    const cloudMatrix = await svc.buildMatrix({ clusterId: 'clu_laptops' });
    expect(cloudMatrix.aiSource).toBe('cloud');
    expect(cloudMatrix.escalatedToCloud).toBe(true);
    expect(modesSeen[1]).toBe('prefer_in_cloud');
    expect(cloudMatrix.cloudPayloadPreview).toContain('extracted facts only');

    const md = svc.renderMatrixMarkdown(cloudMatrix);
    expect(md).toContain('| Option | Price / Cost |');
    expect(md).toContain('Laptop Option 1');

    await db.delete();
  });
});
