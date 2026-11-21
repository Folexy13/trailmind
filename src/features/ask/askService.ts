import MiniSearch from 'minisearch';
import type { AskAnswer, Citation, PageRecord, PageType } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { embeddingEngine, type EmbeddingEngine } from '@/core/embeddings/embeddingEngine';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import { parseTimeExpression } from '@/features/timeQuestions/timeQuestionsService';

export interface ParsedQuestionFilters {
  cleanedQuery: string;
  domain?: string;
  pageType?: PageType;
  dateStartMs?: number;
  dateEndMs?: number;
  datePhrase?: string;
}

const SITE_ALIASES: Record<string, string> = {
  github: 'github.com',
  'stack overflow': 'stackoverflow.com',
  stackoverflow: 'stackoverflow.com',
  youtube: 'youtube.com',
  reddit: 'reddit.com',
  medium: 'medium.com',
  wikipedia: 'wikipedia.org',
  amazon: 'amazon.',
  jumia: 'jumia.',
  firebase: 'firebase.google.com',
  mdn: 'developer.mozilla.org',
};

const TYPE_KEYWORDS: Array<{ regex: RegExp; type: PageType }> = [
  { regex: /\b(product|laptop|phone|item|price|buy|shopping)\b/i, type: 'product' },
  { regex: /\b(docs|documentation|api reference|manual)\b/i, type: 'docs' },
  { regex: /\b(video|youtube|watch)\b/i, type: 'video' },
  { regex: /\b(thread|discussion|forum|reddit|issue)\b/i, type: 'thread' },
  { regex: /\b(article|blog|post|essay|news)\b/i, type: 'article' },
  { regex: /\b(tool|calculator|app|utility)\b/i, type: 'tool' },
];

/**
 * Extracts structured filters (dates, sites, page types) from a natural-language question (FR-ASK-3).
 */
export function parseQuestionFilters(
  question: string,
  referenceDate = new Date(),
): ParsedQuestionFilters {
  const cleanedQuery = question.trim();
  let domain: string | undefined;
  let pageType: PageType | undefined;

  // Match explicit "on GitHub", "from mdn", "on amazon.com"
  const siteMatch = cleanedQuery.match(
    /\b(?:on|from|at)\s+([a-z0-9-]+(?:\.[a-z]{2,})?|stack overflow)\b/i,
  );
  if (siteMatch?.[1]) {
    const rawSite = siteMatch[1].toLowerCase();
    if (SITE_ALIASES[rawSite]) {
      domain = SITE_ALIASES[rawSite];
    } else if (rawSite.includes('.')) {
      domain = rawSite;
    }
  } else {
    // Also detect well-known site names mentioned anywhere ("GitHub repo last Tuesday")
    for (const [alias, mapped] of Object.entries(SITE_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`, 'i').test(cleanedQuery)) {
        domain = mapped;
        break;
      }
    }
  }

  for (const rule of TYPE_KEYWORDS) {
    if (rule.regex.test(cleanedQuery)) {
      pageType = rule.type;
      break;
    }
  }

  const timeParsed = parseTimeExpression(cleanedQuery, referenceDate);

  return {
    cleanedQuery,
    domain,
    pageType,
    dateStartMs: timeParsed?.startMs,
    dateEndMs: timeParsed?.endMs,
    datePhrase: timeParsed?.matchedText,
  };
}

/**
 * Builds a Chrome Text Fragment URL (`#:~:text=...`) to scroll directly to and highlight a cited passage (FR-ASK-5).
 */
export function buildTextFragmentUrl(baseUrl: string, excerpt: string): string {
  const cleanExcerpt = excerpt
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 12)
    .join(' ');
  if (!cleanExcerpt) return baseUrl;
  const withoutHash = baseUrl.split('#')[0] ?? baseUrl;
  return `${withoutHash}#:~:text=${encodeURIComponent(cleanExcerpt)}`;
}

/**
 * Fuses two ranked ID lists using Reciprocal Rank Fusion (RRF, k = 60) (FR-ASK-2).
 */
export function reciprocalRankFusion(
  bm25Ids: string[],
  vectorIds: string[],
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  bm25Ids.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
  });
  vectorIds.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
  });

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for', 'of', 'from',
  'with', 'by', 'about', 'as', 'into', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'their', 'it', 'its', 'this', 'that',
  'these', 'those', 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'any', 'here', 'there', 'open', 'opened', 'opening',
  'compare', 'show', 'find', 'tell', 'give', 'list', 'look', 'looked', 'looking',
  'read', 'reading', 'saw', 'see', 'seen', 'visited', 'visit', 'page', 'pages', 'site', 'sites',
  'someone', 'recommend', 'recommended', 'last', 'week', 'day', 'month', 'today', 'yesterday',
]);

const QUERY_SYNONYMS: Record<string, string[]> = {
  repo: ['github', 'repository'],
  repos: ['github', 'repository'],
  repository: ['github', 'repo'],
  repositories: ['github', 'repo'],
  video: ['youtube', 'vimeo'],
  videos: ['youtube', 'vimeo'],
  hackathon: ['devpost', 'hackathon'],
};

function extractContentQuery(rawQuery: string): string {
  const tokens = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\s-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !QUERY_STOPWORDS.has(t));
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const syns = QUERY_SYNONYMS[token];
    if (syns) expanded.push(...syns);
  }
  return Array.from(new Set(expanded)).join(' ').trim();
}

interface IndexedPassage {
  id: string;
  pageId: string;
  title: string;
  domain: string;
  url: string;
  text: string;
  topics: string;
}

/**
 * Ask Your Memory engine: hybrid BM25 + int8 vector search fused by RRF, instant page results,
 * streamed cited answers, follow-ups, honest "no answer" handling, and omnibox search (FR-ASK-1..FR-ASK-10).
 */
export class AskMemoryService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
    private readonly embeddings: EmbeddingEngine = embeddingEngine,
  ) {}

  /**
   * Executes fast instant retrieval (BM25 + vector RRF, top 8 passages + ranked pages) (< 300ms, FR-ASK-2, FR-ASK-8).
   */
  async retrievePassages(
    question: string,
    referenceDate = new Date(),
  ): Promise<{
    filters: ParsedQuestionFilters;
    instantPages: PageRecord[];
    passages: Array<{
      pageId: string;
      chunkId: string;
      title: string;
      domain: string;
      url: string;
      text: string;
      score: number;
    }>;
  }> {
    const filters = parseQuestionFilters(question, referenceDate);
    const [allPages, allChunks, allFacts] = await Promise.all([
      this.store.listPages(),
      this.store.listAllChunks(),
      this.store.listAllFacts(),
    ]);

    // Apply parsed filters (domain, date window, type)
    let candidatePages = allPages.filter((page) => {
      if (filters.domain && !page.domain.toLowerCase().includes(filters.domain.toLowerCase())) {
        return false;
      }
      if (
        filters.dateStartMs !== undefined &&
        filters.dateEndMs !== undefined &&
        (page.lastSeen < filters.dateStartMs || page.firstSeen > filters.dateEndMs)
      ) {
        return false;
      }
      return true;
    });

    // Apply type filter if it doesn't zero out results completely
    if (filters.pageType) {
      const typed = candidatePages.filter((p) => p.type === filters.pageType);
      if (typed.length > 0) candidatePages = typed;
    }

    const pageMap = new Map(candidatePages.map((p) => [p.id, p]));
    const allowedPageIds = new Set(candidatePages.map((p) => p.id));

    // Construct searchable passage corpus (chunks + facts + page summaries)
    const docs: IndexedPassage[] = [];
    const docById = new Map<string, IndexedPassage>();

    for (const chunk of allChunks) {
      const page = pageMap.get(chunk.pageId);
      if (!page) continue;
      const doc: IndexedPassage = {
        id: chunk.id,
        pageId: page.id,
        title: page.title,
        domain: page.domain,
        url: page.url,
        text: chunk.text,
        topics: page.englishTopics.join(' '),
      };
      docs.push(doc);
      docById.set(doc.id, doc);
    }

    for (const fact of allFacts) {
      const page = pageMap.get(fact.pageId);
      if (!page) continue;
      const doc: IndexedPassage = {
        id: fact.id,
        pageId: page.id,
        title: page.title,
        domain: page.domain,
        url: page.url,
        text: fact.text,
        topics: page.englishTopics.join(' '),
      };
      docs.push(doc);
      docById.set(doc.id, doc);
    }

    for (const page of candidatePages) {
      const doc: IndexedPassage = {
        id: page.id,
        pageId: page.id,
        title: page.title,
        domain: page.domain,
        url: page.url,
        text: `${page.title}. ${page.summary}`,
        topics: [...page.topics, ...page.englishTopics].join(' '),
      };
      docs.push(doc);
      docById.set(doc.id, doc);
    }

    // 1. BM25 keyword search via MiniSearch (strip stop-words so "the"/"at"/"I" never match random pages)
    const contentQuery = extractContentQuery(filters.cleanedQuery) || filters.cleanedQuery;
    const mini = new MiniSearch<IndexedPassage>({
      fields: ['title', 'text', 'topics', 'domain'],
      storeFields: ['pageId'],
      searchOptions: {
        boost: { title: 2.5, topics: 1.8, text: 1.2 },
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'OR',
      },
    });
    if (docs.length > 0) {
      mini.addAll(docs);
    }
    const bm25Hits = mini
      .search(contentQuery)
      .filter((h) => h.score >= 1.2)
      .slice(0, 24);
    const bm25Ids = bm25Hits.map((h) => String(h.id));

    // 2. Local int8 vector search
    const vectorHits = await this.embeddings.searchSimilar(contentQuery, {
      topK: 24,
      allowedPageIds,
      minSimilarity: 0.22,
    });
    const vectorIds = vectorHits.map((h) => h.ownerId).filter((id) => docById.has(id));

    // 3. Reciprocal Rank Fusion -> top 8 unique passages (FR-ASK-2)
    const fused = reciprocalRankFusion(bm25Ids, vectorIds);
    const seenContentKey = new Set<string>();
    const passages: Array<{
      pageId: string;
      chunkId: string;
      title: string;
      domain: string;
      url: string;
      text: string;
      score: number;
    }> = [];

    for (const entry of fused) {
      if (passages.length >= 8) break;
      const d = docById.get(entry.id);
      if (!d) continue;
      // Collapse duplicate Google search reloads that share the exact same domain + title
      const dedupeKey = `${d.domain}|${d.title.trim().toLowerCase()}`;
      if (seenContentKey.has(dedupeKey)) continue;
      seenContentKey.add(dedupeKey);
      passages.push({
        pageId: d.pageId,
        chunkId: d.id,
        title: d.title,
        domain: d.domain,
        url: d.url,
        text: d.text,
        score: entry.score,
      });
    }

    // Derive ranked unique pages for instant results list (FR-ASK-8)
    const seenPageIds = new Set<string>();
    const instantPages: PageRecord[] = [];
    for (const p of passages) {
      if (seenPageIds.has(p.pageId)) continue;
      const page = pageMap.get(p.pageId);
      if (page) {
        seenPageIds.add(p.pageId);
        instantPages.push(page);
      }
    }

    return { filters, instantPages, passages };
  }

  /**
   * Answers a user question over retrieved passages with citations and honest no-answer handling (FR-ASK-4..FR-ASK-9).
   */
  async ask(options: {
    question: string;
    useCloud?: boolean;
    followUpContext?: { previousQuestion: string; previousAnswer: string };
    onInstantPages?: (pages: PageRecord[]) => void;
    onToken?: (chunk: string) => void;
    referenceDate?: Date;
  }): Promise<AskAnswer> {
    const started = performance.now();
    const { instantPages, passages } = await this.retrievePassages(
      options.question,
      options.referenceDate,
    );

    options.onInstantPages?.(instantPages);

    if (passages.length === 0) {
      return {
        question: options.question,
        answer:
          'I could not find anything in your saved browsing memory matching that question. Try broadening your terms or checking another date range.',
        citations: [],
        confidence: 'none',
        hasAnswer: false,
        aiSource: 'on_device',
        latencyMs: Math.round(performance.now() - started),
        instantPages: [],
        retrievedPassages: [],
      };
    }

    const pageMap = new Map(instantPages.map((p) => [p.id, p]));
    const passageMap = new Map(passages.map((p) => [p.chunkId, p]));

    try {
      const aiRes = await this.ai.askMemory({
        question: options.question,
        passages: passages.map((p) => ({
          pageId: p.pageId,
          chunkId: p.chunkId,
          title: p.title,
          domain: p.domain,
          text: p.text.slice(0, 900),
        })),
        followUpContext: options.followUpContext,
        explicitCloudRequest: options.useCloud,
        onToken: options.onToken,
      });

      const citations: Citation[] = [];
      for (const rawCit of aiRes.data.citations) {
        const page = pageMap.get(rawCit.page_id) ?? (await this.store.getPage(rawCit.page_id));
        if (!page) continue;
        const passage = rawCit.passage_id ? passageMap.get(rawCit.passage_id) : undefined;
        const excerpt = rawCit.excerpt || passage?.text.slice(0, 180) || page.summary;
        citations.push({
          pageId: page.id,
          chunkId: rawCit.passage_id,
          title: page.title,
          url: page.url,
          excerpt,
          textFragmentUrl: buildTextFragmentUrl(page.url, excerpt),
          status: page.status,
        });
      }

      return {
        question: options.question,
        answer: aiRes.data.answer,
        citations,
        confidence: aiRes.data.confidence,
        hasAnswer: aiRes.data.has_answer,
        aiSource: aiRes.ranOn,
        latencyMs: Math.round(performance.now() - started),
        instantPages,
        retrievedPassages: passages,
        cloudPayloadPreview: aiRes.cloudPayloadPreview,
      };
    } catch {
      // Graceful fallback when Gemini Nano is unavailable & cloud is disabled (NFR-RL-3):
      // present direct extractive passage matches with citations instead of showing an error stack trace.
      const top = passages.slice(0, 3);
      const citations: Citation[] = top.map((p) => {
        const page = pageMap.get(p.pageId);
        const excerpt = p.text.slice(0, 180);
        return {
          pageId: p.pageId,
          chunkId: p.chunkId,
          title: p.title,
          url: p.url,
          excerpt,
          textFragmentUrl: buildTextFragmentUrl(p.url, excerpt),
          status: page?.status ?? 'metadata_only',
        };
      });

      return {
        question: options.question,
        answer:
          `On-device Gemini Nano is not active yet, so here are the closest matching passages from your local memory:\n` +
          top.map((p, idx) => `[${idx + 1}] ${p.title}: ${p.text.slice(0, 160)}`).join('\n'),
        citations,
        confidence: 'low',
        hasAnswer: top.length > 0,
        aiSource: 'on_device',
        latencyMs: Math.round(performance.now() - started),
        instantPages,
        retrievedPassages: passages,
      };
    }
  }

  /**
   * Generates Chrome Omnibox `tm <query>` suggestions (FR-ASK-10).
   */
  async getOmniboxSuggestions(
    query: string,
  ): Promise<Array<{ content: string; description: string }>> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const { instantPages } = await this.retrievePassages(trimmed);
    return instantPages.slice(0, 5).map((p) => ({
      content: p.url,
      description: `${p.title.replace(/[&<>]/g, '')} — ${p.domain}`,
    }));
  }
}

export const askMemoryService = new AskMemoryService();
