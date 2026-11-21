import { DEFAULT_PROMPT_VERSION, MAX_FACTS_PER_PAGE } from '@/shared/constants';
import type {
  ChunkRecord,
  EmbeddingRecord,
  FactRecord,
  PageCapturePayload,
  PageRecord,
  SnapshotRecord,
  VisitRecord,
} from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { normalizeEntities } from '@/core/ai/entityNormalizer';
import { chunkTextForExtraction, estimateTokens } from '@/core/ai/prompts';
import { sha256Hex } from '@/core/crypto/encryption';
import { embeddingEngine, type EmbeddingEngine } from '@/core/embeddings/embeddingEngine';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import {
  canonicalizeUrl,
  evaluateSensitiveHeuristics,
  extractDomain,
  isDomainExcluded,
  isRecordableUrl,
} from './urlPrivacy';

export interface IngestionOutcome {
  recorded: boolean;
  reason?: string;
  pageId?: string;
  snapshotSaved?: boolean;
  extracted?: boolean;
}

/**
 * Generates a stable deterministic page ID from its canonical URL.
 */
export async function pageIdFromCanonicalUrl(canonicalUrl: string): Promise<string> {
  const hash = await sha256Hex(canonicalUrl);
  return `pg_${hash.slice(0, 16)}`;
}

/**
 * Core page ingestion & extraction pipeline (FR-CAP-1 to FR-CAP-9, FR-EX-1 to FR-EX-8).
 */
export class PageIngestionService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
    private readonly embeddings: EmbeddingEngine = embeddingEngine,
  ) {}

  async ingestLiveCapture(
    payload: PageCapturePayload,
    options?: { incognito?: boolean; tabId?: number; extractNow?: boolean },
  ): Promise<IngestionOutcome> {
    if (options?.incognito) {
      return { recorded: false, reason: 'incognito_tab' };
    }
    if (!isRecordableUrl(payload.url)) {
      return { recorded: false, reason: 'non_recordable_url' };
    }

    const settings = await this.store.getSettings();

    // Respect global / timed / per-tab pause (FR-CAP-10, FR-PRV-2)
    if (settings.capturePausedGlobal) {
      return { recorded: false, reason: 'paused_global' };
    }
    if (settings.capturePausedUntil && Date.now() < settings.capturePausedUntil) {
      return { recorded: false, reason: 'paused_timed' };
    }
    if (options?.tabId !== undefined && settings.pausedTabIds.includes(options.tabId)) {
      return { recorded: false, reason: 'paused_tab' };
    }

    const domain = extractDomain(payload.url);
    if (isDomainExcluded(domain, settings.exclusions)) {
      await this.store.recordSkippedDomain(domain, 'excluded_domain');
      return { recorded: false, reason: 'excluded_domain' };
    }

    // Sensitive page check (FR-PRV-6): heuristic first, optional ONLY_ON_DEVICE Nano confirmation
    const heuristic = evaluateSensitiveHeuristics({
      url: payload.url,
      title: payload.title,
      signals: payload.sensitiveSignals,
    });

    if (heuristic.sensitive) {
      if (heuristic.needsModelConfirmation) {
        try {
          const modelCheck = await this.ai.detectSensitivePage({
            domain,
            title: payload.title,
            snippet: payload.text.slice(0, 1200),
          });
          if (modelCheck.data.sensitive) {
            await this.store.recordSkippedDomain(domain, 'sensitive_page');
            return { recorded: false, reason: `sensitive:${modelCheck.data.category}` };
          }
        } catch {
          // Fail closed when heuristic flagged sensitivity and Nano is unavailable
          await this.store.recordSkippedDomain(domain, 'sensitive_page');
          return { recorded: false, reason: `sensitive:${heuristic.category}` };
        }
      } else {
        await this.store.recordSkippedDomain(domain, 'sensitive_page');
        return { recorded: false, reason: `sensitive:${heuristic.category}` };
      }
    }

    const canonicalUrl = canonicalizeUrl(payload.url);
    const pageId = await pageIdFromCanonicalUrl(canonicalUrl);
    const now = Date.now();
    const contentHash = await sha256Hex(payload.text || payload.title);

    const existingPage = await this.store.getPage(pageId);
    const page: PageRecord = existingPage
      ? {
          ...existingPage,
          title: payload.title || existingPage.title,
          lastSeen: now,
          updatedAt: now,
        }
      : {
          id: pageId,
          url: payload.url,
          canonicalUrl,
          domain,
          title: payload.title || domain,
          type: 'other',
          summary: payload.text.slice(0, 220),
          language: 'en',
          topics: [],
          englishTopics: [],
          entities: [],
          firstSeen: now,
          lastSeen: now,
          status: 'metadata_only',
          promptVersion: DEFAULT_PROMPT_VERSION,
          updatedAt: now,
        };

    await this.store.putPage(page);

    // Record visit telemetry (FR-CAP-5)
    const visit: VisitRecord = {
      id: `vis_${crypto.randomUUID().slice(0, 12)}`,
      pageId,
      time: now,
      activeMs: Math.max(0, Math.round(payload.activeMs)),
      maxScroll: Math.max(0, Math.min(100, Math.round(payload.maxScroll))),
      referrerUrl: payload.referrerUrl,
      transition: 'link',
      sessionId: `ses_${new Date(now).toISOString().slice(0, 13)}`,
      hadForm: payload.hadForm,
      formSubmitted: payload.formSubmitted,
    };
    await this.store.putVisit(visit);

    // Save snapshot only if content hash changed (FR-CAP-8, FR-SN-2)
    const snapshot: SnapshotRecord = {
      id: `snap_${crypto.randomUUID().slice(0, 12)}`,
      pageId,
      capturedAt: now,
      contentHash,
      title: page.title,
      text: payload.text,
      sanitizedHtml: payload.sanitizedHtml,
      images: settings.captureImages ? payload.images.slice(0, 3) : [],
      byteSize: (payload.text.length + (payload.sanitizedHtml?.length ?? 0)) * 2,
    };
    const { saved: snapshotSaved, snapshot: activeSnapshot } =
      await this.store.saveSnapshotVersion(snapshot);

    // Build chunks if snapshot changed or page has no chunks yet
    const existingChunks = await this.store.listChunksForPage(pageId);
    if (snapshotSaved || existingChunks.length === 0) {
      const textChunks = chunkTextForExtraction(payload.text);
      const chunkRecords: ChunkRecord[] = textChunks.map((chunkText, index) => ({
        id: `chk_${pageId}_${index}`,
        pageId,
        snapshotId: activeSnapshot.id,
        index,
        text: chunkText,
        tokenEstimate: estimateTokens(chunkText),
      }));
      await this.store.replaceChunksForPage(pageId, chunkRecords);
    }

    // Queue live extraction at high priority (100) vs backfill (10) (FR-EX-3)
    const needsExtraction = snapshotSaved || page.status !== 'full';
    if (needsExtraction) {
      if (options?.extractNow) {
        const extracted = await this.extractAndEmbedPage(pageId, false);
        return { recorded: true, pageId, snapshotSaved, extracted };
      }
      await this.store.enqueueJob({
        id: `job_extract_${pageId}`,
        kind: 'extract_page',
        priority: 100,
        state: 'queued',
        attempts: 0,
        payloadRef: pageId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { recorded: true, pageId, snapshotSaved, extracted: false };
  }

  /**
   * Runs AI extraction + entity normalization + image descriptions + local embeddings for a page (FR-EX-1..FR-EX-8).
   */
  async extractAndEmbedPage(pageId: string, isBackground = true): Promise<boolean> {
    const page = await this.store.getPage(pageId);
    if (!page) return false;
    const snapshot = await this.store.getLatestSnapshot(pageId);
    if (!snapshot || !snapshot.text.trim()) return false;

    const chunks = await this.store.listChunksForPage(pageId);

    try {
      const res = await this.ai.extractPage({
        url: page.url,
        title: page.title,
        text: snapshot.text,
        isBackground,
      });

      const normalizedEntities = normalizeEntities(res.data.entities);
      const englishTopics =
        res.data.english_topics && res.data.english_topics.length > 0
          ? res.data.english_topics
          : res.data.topics;

      const updatedPage: PageRecord = {
        ...page,
        title: res.data.title || page.title,
        summary: res.data.summary,
        type: res.data.type,
        topics: res.data.topics.slice(0, 5),
        englishTopics: englishTopics.slice(0, 5),
        entities: normalizedEntities,
        price: res.data.price ?? undefined,
        language: res.data.language || 'en',
        status: 'full', // Upgrades metadata_only -> full (FR-BF-8)
        promptVersion: res.promptVersion,
        aiSource: res.ranOn,
        updatedAt: Date.now(),
      };
      await this.store.putPage(updatedPage);

      const facts: FactRecord[] = res.data.facts.slice(0, MAX_FACTS_PER_PAGE).map((text, idx) => ({
        id: `fct_${pageId}_${idx}`,
        pageId,
        chunkId: chunks[0]?.id,
        text,
        fromImage: false,
        highlight: false,
        createdAt: Date.now(),
      }));

      // Describe captured charts/diagrams (FR-EX-7)
      for (const img of snapshot.images.slice(0, 3)) {
        if (!img.dataBase64) continue;
        try {
          const imgRes = await this.ai.describeImage({
            mimeType: img.mimeType,
            dataBase64: img.dataBase64,
            alt: img.alt,
          });
          const desc = imgRes.data.extracted_text
            ? `${imgRes.data.description} (${imgRes.data.extracted_text})`
            : imgRes.data.description;
          facts.push({
            id: `fct_img_${img.id}`,
            pageId,
            text: desc,
            fromImage: true,
            highlight: false,
            createdAt: Date.now(),
          });
        } catch {
          // Non-fatal: keep page extraction even if an image fails
        }
      }

      await this.store.replaceExtractedFactsForPage(pageId, facts);

      // Compute local quantized int8 embeddings for summary, facts, and chunks (FR-EX-4)
      const embeddingsToStore: EmbeddingRecord[] = [];
      const summaryVec = await this.embeddings.embedText(
        `${updatedPage.title}. ${updatedPage.summary}. ${updatedPage.englishTopics.join(', ')}`,
      );
      embeddingsToStore.push({
        id: `emb_page_${pageId}`,
        ownerId: pageId,
        ownerKind: 'page',
        pageId,
        ...summaryVec,
      });

      for (const fact of facts) {
        const factVec = await this.embeddings.embedText(fact.text);
        embeddingsToStore.push({
          id: `emb_fact_${fact.id}`,
          ownerId: fact.id,
          ownerKind: 'fact',
          pageId,
          ...factVec,
        });
      }

      for (const chunk of chunks) {
        const chunkVec = await this.embeddings.embedText(chunk.text);
        embeddingsToStore.push({
          id: `emb_chunk_${chunk.id}`,
          ownerId: chunk.id,
          ownerKind: 'chunk',
          pageId,
          ...chunkVec,
        });
      }

      await this.store.replaceEmbeddingsForPage(pageId, embeddingsToStore);
      this.embeddings.invalidateIndex();
      return true;
    } catch {
      // Graceful degrade: keep raw snapshot & metadata_only for later retry (FR-ON-7, NFR-RL-3)
      const summaryVec = await this.embeddings.embedText(
        `${page.title}. ${snapshot.text.slice(0, 1200)}`,
      );
      await this.store.putEmbeddings([
        {
          id: `emb_page_${pageId}`,
          ownerId: pageId,
          ownerKind: 'page',
          pageId,
          ...summaryVec,
        },
      ]);
      this.embeddings.invalidateIndex();
      return false;
    }
  }

  /**
   * Captures a user highlight (Alt+H) as a permanent highlight fact linked to the page (FR-CAP-6).
   */
  async captureHighlight(input: { url: string; title: string; text: string }): Promise<FactRecord> {
    const canonicalUrl = canonicalizeUrl(input.url);
    const pageId = await pageIdFromCanonicalUrl(canonicalUrl);
    const domain = extractDomain(input.url);
    const now = Date.now();

    const existing = await this.store.getPage(pageId);
    if (!existing) {
      await this.store.putPage({
        id: pageId,
        url: input.url,
        canonicalUrl,
        domain,
        title: input.title || domain,
        type: 'other',
        summary: input.text.slice(0, 200),
        language: 'en',
        topics: [],
        englishTopics: [],
        entities: [],
        firstSeen: now,
        lastSeen: now,
        status: 'metadata_only',
        promptVersion: DEFAULT_PROMPT_VERSION,
        updatedAt: now,
      });
    }

    const fact: FactRecord = {
      id: `hl_${crypto.randomUUID().slice(0, 12)}`,
      pageId,
      text: input.text.trim().slice(0, 600),
      fromImage: false,
      highlight: true,
      createdAt: now,
    };
    await this.store.putFact(fact);

    const vec = await this.embeddings.embedText(fact.text);
    await this.embeddings.indexRecords([
      {
        id: `emb_fact_${fact.id}`,
        ownerId: fact.id,
        ownerKind: 'fact',
        pageId,
        ...vec,
      },
    ]);

    await this.store.putNodes([
      {
        id: `highlight:${fact.id}`,
        kind: 'highlight',
        label: fact.text.slice(0, 80),
        weight: 2,
        refId: pageId,
        firstSeen: now,
        lastSeen: now,
      },
    ]);

    return fact;
  }
}

export const pageIngestionService = new PageIngestionService();
