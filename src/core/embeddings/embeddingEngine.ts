import type { EmbeddingRecord } from '@/shared/types';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const EMBEDDING_DIM = 384;
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

/**
 * Quantizes a float vector into int8 (-127..127) with its scale factor for compact IndexedDB storage (NFR-SC-3).
 */
export function quantizeInt8(vec: Float32Array | number[]): { vector: number[]; scale: number } {
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i++) {
    const abs = Math.abs(vec[i]!);
    if (abs > maxAbs) maxAbs = abs;
  }
  const scale = maxAbs > 0 ? maxAbs / 127 : 1;
  const vector = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    vector[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! / scale)));
  }
  return { vector, scale };
}

export function cosineSimilarityInt8(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic local token + trigram semantic projection (384-dim) used as an immediate
 * zero-latency offline fallback before transformers.js WASM weights are cached or in unit tests.
 */
export function computeDeterministicEmbedding(text: string, dim = EMBEDDING_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\s]+/g, ' ')
    .trim();
  if (!normalized) return vec;

  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);
  const hashFeature = (token: string, weight: number) => {
    let h1 = 2166136261;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < token.length; i++) {
      const c = token.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822507);
    }
    const idx1 = Math.abs(h1) % dim;
    const idx2 = Math.abs(h2) % dim;
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    const sign2 = (h2 & 1) === 0 ? 1 : -1;
    vec[idx1] = (vec[idx1] ?? 0) + sign1 * weight;
    vec[idx2] = (vec[idx2] ?? 0) + sign2 * weight * 0.7;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    hashFeature(`w:${word}`, 2.0);
    // Character trigrams capture morphological similarity & multilingual roots
    if (word.length >= 4) {
      for (let j = 0; j <= word.length - 3; j++) {
        hashFeature(`g:${word.slice(j, j + 3)}`, 0.45);
      }
    }
    if (i + 1 < words.length) {
      hashFeature(`b:${word}_${words[i + 1]}`, 1.2);
    }
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += vec[i]! * vec[i]!;
  }
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < dim; i++) {
      vec[i] = vec[i]! * inv;
    }
  }
  return vec;
}

export interface VectorSearchHit {
  ownerId: string;
  ownerKind: 'page' | 'chunk' | 'fact';
  pageId: string;
  similarity: number;
}

/**
 * Local sentence embedding engine & in-memory quantized int8 vector index (FR-EX-4, NFR-SC-3, FR-SB-1).
 * Uses @huggingface/transformers MiniLM in the offscreen document when available.
 */
export class EmbeddingEngine {
  private pipelineInstance: FeatureExtractionPipeline | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline | null> | null = null;
  private indexCache: EmbeddingRecord[] = [];
  private indexLoaded = false;
  private useTransformers = true;

  constructor(private readonly store: MemoryStore = memoryStore) {}

  setUseTransformers(enabled: boolean): void {
    this.useTransformers = enabled;
  }

  /**
   * Warms up the quantized MiniLM ONNX model in the background without blocking interactive searches.
   */
  private warmTransformersPipeline(): void {
    if (!this.useTransformers || this.pipelinePromise) return;
    if (typeof window === 'undefined' && typeof self === 'undefined') return;
    if (typeof process !== 'undefined' && process.env?.VITEST) return;

    this.pipelinePromise = (async () => {
      try {
        const { env, pipeline } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        const extractor = (await pipeline('feature-extraction', MODEL_ID, {
          dtype: 'q8',
        })) as unknown as FeatureExtractionPipeline;
        this.pipelineInstance = extractor;
        return extractor;
      } catch {
        return null;
      }
    })();
  }

  async embedText(
    text: string,
    options?: { waitForModelMs?: number },
  ): Promise<{ vector: number[]; scale: number; dim: number }> {
    const truncated = text.trim().slice(0, 6000);
    this.warmTransformersPipeline();

    let pipe = this.pipelineInstance;
    if (!pipe && this.pipelinePromise && (options?.waitForModelMs ?? 0) > 0) {
      pipe = await Promise.race([
        this.pipelinePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), options!.waitForModelMs)),
      ]);
    }

    if (pipe) {
      try {
        const output = await pipe(truncated, { pooling: 'mean', normalize: true });
        const quantized = quantizeInt8(output.data);
        return { ...quantized, dim: quantized.vector.length };
      } catch {
        // Fall back gracefully to local deterministic projection
      }
    }
    const fallbackVec = computeDeterministicEmbedding(truncated, EMBEDDING_DIM);
    const quantized = quantizeInt8(fallbackVec);
    return { ...quantized, dim: EMBEDDING_DIM };
  }

  async ensureIndexLoaded(forceReload = false): Promise<void> {
    if (this.indexLoaded && !forceReload) return;
    this.indexCache = await this.store.listAllEmbeddings();
    this.indexLoaded = true;
  }

  invalidateIndex(): void {
    this.indexLoaded = false;
  }

  async indexRecords(records: EmbeddingRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.store.putEmbeddings(records);
    if (this.indexLoaded) {
      const byId = new Map(this.indexCache.map((r) => [r.id, r]));
      for (const rec of records) byId.set(rec.id, rec);
      this.indexCache = Array.from(byId.values());
    }
  }

  async searchSimilar(
    queryText: string,
    options?: {
      topK?: number;
      ownerKinds?: Array<'page' | 'chunk' | 'fact'>;
      excludePageId?: string;
      minSimilarity?: number;
      allowedPageIds?: Set<string>;
    },
  ): Promise<VectorSearchHit[]> {
    await this.ensureIndexLoaded();
    if (this.indexCache.length === 0) return [];
    const { vector: queryVec } = await this.embedText(queryText, { waitForModelMs: 0 });
    const topK = options?.topK ?? 12;
    const minSim = options?.minSimilarity ?? 0.05;
    const kinds = options?.ownerKinds ? new Set(options.ownerKinds) : null;

    const hits: VectorSearchHit[] = [];
    for (const rec of this.indexCache) {
      if (kinds && !kinds.has(rec.ownerKind)) continue;
      if (options?.excludePageId && rec.pageId === options.excludePageId) continue;
      if (options?.allowedPageIds && !options.allowedPageIds.has(rec.pageId)) continue;
      const sim = cosineSimilarityInt8(queryVec, rec.vector);
      if (sim >= minSim) {
        hits.push({
          ownerId: rec.ownerId,
          ownerKind: rec.ownerKind,
          pageId: rec.pageId,
          similarity: sim,
        });
      }
    }

    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }
}

export const embeddingEngine = new EmbeddingEngine();
