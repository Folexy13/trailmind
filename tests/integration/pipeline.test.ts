import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { TrailmindAI, type ModelTransport, type ModelTransportRequest } from '@/core/ai/hybridAi';
import { BackfillService } from '@/core/backfill/historyImporter';
import { PageIngestionService } from '@/core/capture/pageIngestion';
import { CryptoService } from '@/core/crypto/encryption';
import { EmbeddingEngine } from '@/core/embeddings/embeddingEngine';
import { GraphEngine } from '@/core/graph/graphEngine';
import { TrailmindDB } from '@/core/store/db';
import { MemoryStore } from '@/core/store/memoryStore';
import { AskMemoryService } from '@/features/ask/askService';
import { ExportService } from '@/features/export/exportService';
import { WeeklyRecapService } from '@/features/recap/weeklyRecapService';
import { SeenBeforeService } from '@/features/seenBefore/seenBeforeService';

describe('Full Trailmind end-to-end pipeline integration (NFR-MT-2)', () => {
  it('runs capture -> repair retry -> multilingual clustering -> Ask RRF -> Seen Before -> Obsidian ZIP -> zero cloud leak', async () => {
    const db = new TrailmindDB(`IntegrationDB_${crypto.randomUUID()}`);
    const cryptoSvc = new CryptoService();
    const store = new MemoryStore(db, cryptoSvc);
    await store.init();

    const embeddings = new EmbeddingEngine(store);
    embeddings.setUseTransformers(false);

    let brokenOnce = true;
    const seenModes: string[] = [];

    const mockedTransport: ModelTransport = {
      async generate(req: ModelTransportRequest) {
        seenModes.push(`${req.jobKind}:${req.mode}`);
        if (req.jobKind === 'page_extraction') {
          if (brokenOnce) {
            brokenOnce = false;
            return { text: '{ broken json', ranOn: 'on_device' };
          }
          const isFrench = req.prompt.includes('blog.dev.fr');
          const isYoruba = req.prompt.includes('techyoruba.ng');
          return {
            text: JSON.stringify({
              title: isFrench
                ? 'IA hybride dans Chrome'
                : isYoruba
                  ? 'Ìmọ̀ Ẹ̀rọ AI Lórí Ẹ̀rọ Rẹ'
                  : 'Firebase Hybrid AI Architecture',
              summary: 'Hybrid inference runs Gemini Nano locally on-device for privacy.',
              type: 'article',
              topics: isFrench ? ['IA Hybride'] : isYoruba ? ['AI Lórí Ẹ̀rọ'] : ['Hybrid AI'],
              english_topics: ['Hybrid AI', 'Firebase AI Logic'],
              entities: [{ name: 'Google Firebase', kind: 'tech' }],
              facts: ['Gemini Nano processes private pages locally with ONLY_ON_DEVICE.'],
              price: null,
              language: isFrench ? 'fr' : isYoruba ? 'yo' : 'en',
            }),
            ranOn: 'on_device',
          };
        }

        if (req.jobKind === 'ask_memory') {
          const match = req.prompt.match(/page_id=(\S+)\s+passage_id=(\S+)/);
          return {
            text: JSON.stringify({
              answer: 'Gemini Nano processes private pages locally with ONLY_ON_DEVICE.',
              citations: match ? [{ page_id: match[1]!, passage_id: match[2]!, excerpt: 'Gemini Nano processes private pages locally' }] : [],
              confidence: 'high',
              has_answer: true,
            }),
            ranOn: 'on_device',
          };
        }

        if (req.jobKind === 'weekly_recap') {
          return {
            text: JSON.stringify({
              headline: 'Focused week on Hybrid AI',
              narrative: 'You read 3 multilingual articles on on-device AI.',
              highlights: ['Explored Hybrid AI across English, French, and Yoruba.'],
            }),
            ranOn: 'on_device',
          };
        }

        return { text: JSON.stringify({ name: 'Hybrid AI', summary: 'Local AI cluster' }), ranOn: 'on_device' };
      },
    };

    const ai = new TrailmindAI(store, mockedTransport);
    const ingestion = new PageIngestionService(store, ai, embeddings);
    const graph = new GraphEngine(store, ai);
    const ask = new AskMemoryService(store, ai, embeddings);
    const seenBefore = new SeenBeforeService(store, embeddings);
    const exporter = new ExportService(store);
    const recapSvc = new WeeklyRecapService(store, ai);

    // 1. Ingest English, French, and Yoruba pages on the same topic (FR-EX-6)
    const urls = [
      ['https://firebase.google.com/docs/hybrid', 'Firebase Hybrid AI Architecture', 'Gemini Nano runs on-device via Firebase AI Logic with ONLY_ON_DEVICE for complete privacy.'],
      ['https://blog.dev.fr/ia-hybride', 'IA hybride dans Chrome', 'Gemini Nano tourne localement dans Chrome pour protéger la vie privée.'],
      ['https://techyoruba.ng/ai-lori-ero', 'Ìmọ̀ Ẹ̀rọ AI Lórí Ẹ̀rọ Rẹ', 'Gemini Nano ń ṣiṣẹ́ lórí ẹ̀rọ olùmúlò láìfi àṣírí ránṣẹ́ sí cloud.'],
    ] as const;

    for (const [url, title, text] of urls) {
      const res = await ingestion.ingestLiveCapture(
        {
          url,
          title,
          text,
          activeMs: 45_000,
          maxScroll: 75,
          images: [],
          sensitiveSignals: {
            hasPasswordField: false,
            hasPaymentField: false,
            looksLikeLogin: false,
            looksLikeMedical: false,
            looksLikeAdult: false,
          },
        },
        { extractNow: true },
      );
      expect(res.recorded).toBe(true);
      expect(res.extracted).toBe(true);
    }

    // Incognito tab is strictly rejected (FR-CAP-3)
    const incog = await ingestion.ingestLiveCapture(
      {
        url: 'https://example.com/private',
        title: 'Private',
        text: 'Never store this incognito page',
        activeMs: 50_000,
        maxScroll: 80,
        images: [],
        sensitiveSignals: {
          hasPasswordField: false,
          hasPaymentField: false,
          looksLikeLogin: false,
          looksLikeMedical: false,
          looksLikeAdult: false,
        },
      },
      { incognito: true },
    );
    expect(incog.recorded).toBe(false);
    expect(incog.reason).toBe('incognito_tab');

    // 2. Cluster multilingual pages together & verify user rename survives re-clustering (FR-EX-6, FR-GR-10)
    const { clusters } = await graph.rebuildGraphAndClusters({ nameWithAi: false });
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.pageIds.length).toBe(3);

    await graph.renameCluster(clusters[0]!.id, 'My Custom Hybrid AI Hub');
    const reclustered = await graph.rebuildGraphAndClusters({ nameWithAi: false });
    expect(reclustered.clusters[0]?.name).toBe('My Custom Hybrid AI Hub');

    // 3. Ask Your Memory: hybrid RRF + citation + Text Fragment URL + 0 cloud calls (FR-ASK-2..5, FR-PRV-7)
    const answer = await ask.ask({ question: 'How does Gemini Nano handle private pages?' });
    expect(answer.hasAnswer).toBe(true);
    expect(answer.aiSource).toBe('on_device');
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations[0]?.textFragmentUrl).toContain('#:~:text=');

    // Verify ZERO cloud calls occurred while Cloud Master Switch is off (FR-PRV-7)
    const logs = await store.listRoutingLog(100);
    expect(logs.filter((l) => l.ranOn === 'cloud')).toHaveLength(0);
    expect(seenModes.every((m) => m.endsWith(':only_on_device'))).toBe(true);

    // 4. Seen Before exact revisit check (< 500ms, FR-SB-1, FR-SB-4)
    const sb = await seenBefore.checkPage({
      url: 'https://firebase.google.com/docs/hybrid',
      title: 'Firebase Hybrid AI Architecture',
      textSample: 'Gemini Nano runs on-device',
    });
    expect(sb?.kind).toBe('exact_revisit');
    expect(sb?.lookupMs).toBeLessThan(500);
    expect(sb?.message).toContain('75% read');

    // 5. Obsidian Markdown ZIP export (FR-EXP-1, FR-EXP-2)
    const exported = await exporter.exportObsidianZip({ kind: 'all' });
    expect(exported.fileCount).toBeGreaterThanOrEqual(5);
    const loadedZip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const indexContent = await loadedZip.file('Index.md')?.async('string');
    expect(indexContent).toContain('[[Topics/');

    // 6. Weekly recap generation (FR-WR-1, FR-WR-2)
    const recap = await recapSvc.generateRecap();
    expect(recap.aiSource).toBe('on_device');
    expect(recap.stats.pagesRead).toBe(3);

    await db.delete();
  });

  it('imports 500 history visits into metadata graph quickly and omits credentials on backfill fetch (FR-BF-2, SEC-8)', async () => {
    const db = new TrailmindDB(`BackfillDB_${crypto.randomUUID()}`);
    const store = new MemoryStore(db, new CryptoService());
    await store.init();

    const backfill = new BackfillService(store);
    const baseTime = Date.now() - 10 * 24 * 3600_000;
    const historyItems = Array.from({ length: 100 }, (_, i) => ({
      url: `https://site${i % 10}.example.org/article-${i}`,
      title: `Article ${i}`,
      lastVisitTime: baseTime + i * 60_000,
      visits: Array.from({ length: 5 }, (__, j) => ({
        visitId: `v_${i}_${j}`,
        visitTime: baseTime + i * 60_000 + j * 10_000,
        transition: 'link',
      })),
    }));

    const importRes = await backfill.importHistoryItems(historyItems, [
      { url: 'https://site0.example.org/article-0', title: 'Bookmarked Article 0' },
    ]);
    expect(importRes.pagesCreated).toBe(100);
    expect(importRes.visitsCreated).toBe(500);
    expect(importRes.bookmarksTagged).toBe(1);
    expect(importRes.durationMs).toBeLessThan(5000);

    // Verify background fetch uses credentials: 'omit' (SEC-8)
    let capturedCredentials: RequestCredentials | undefined;
    const pages = await store.listPages();
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedCredentials = init?.credentials;
      return new Response(
        '<html><head><title>Fetched Article</title></head><body><article><h1>Fetched</h1><p>' +
          'Long readable body paragraph for testing background fetch parsing in Trailmind. '.repeat(10) +
          '</p></article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }) as typeof fetch;

    await backfill.fetchAndEnrichSinglePage(pages[0]!.id, fakeFetch);
    expect(capturedCredentials).toBe('omit');

    await db.delete();
  });
});
