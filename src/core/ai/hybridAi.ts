import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
  type HybridParams,
  type Part,
  type SchemaRequest,
} from 'firebase/ai';
import type { ZodType } from 'zod';
import { HYBRID_ROUTING_TABLE } from '@/shared/constants';
import type {
  AiJobKind,
  AiSource,
  DeviceAiStatus,
  HybridMode,
  SettingsRecord,
} from '@/shared/types';
import { ensureFirebaseApp } from '@/core/firebase/config';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';
import {
  buildAskMemoryPrompt,
  buildChangeWatchDiffPrompt,
  buildClusterNamingPrompt,
  buildDecisionMatrixPrompt,
  buildDeepSummaryPrompt,
  buildImageUnderstandingPrompt,
  buildJourneySummaryPrompt,
  buildMemoryRadarPrompt,
  buildMergeExtractionsPrompt,
  buildPageExtractionPrompt,
  buildRepairPrompt,
  buildSensitiveDetectionPrompt,
  buildWeeklyRecapPrompt,
  chunkTextForExtraction,
  estimateTokens,
} from './prompts';
import {
  AskMemorySchema,
  ChangeWatchDiffSchema,
  ClusterNamingSchema,
  DecisionMatrixSchema,
  DeepSummarySchema,
  ImageDescriptionSchema,
  JourneySummarySchema,
  JSON_SCHEMAS,
  MemoryRadarSchema,
  PageExtractionSchema,
  SensitiveDetectionSchema,
  WeeklyRecapSchema,
  type AskMemoryOutput,
  type ChangeWatchDiffOutput,
  type ClusterNamingOutput,
  type DecisionMatrixOutput,
  type DeepSummaryOutput,
  type ImageDescriptionOutput,
  type JourneySummaryOutput,
  type MemoryRadarOutput,
  type PageExtractionOutput,
  type SensitiveDetectionOutput,
  type WeeklyRecapOutput,
} from './schemas';

export interface AiExecutionResult<T> {
  data: T;
  ranOn: AiSource;
  modeUsed: HybridMode;
  durationMs: number;
  promptVersion: string;
  repaired: boolean;
  cloudPayloadPreview?: string;
}

export interface ModelTransportRequest {
  jobKind: AiJobKind;
  mode: HybridMode;
  cloudModelName: string;
  prompt: string;
  inlineMedia?: { mimeType: string; dataBase64: string };
  jsonSchema: Record<string, unknown>;
  stream?: boolean;
  onToken?: (chunk: string) => void;
}

export interface ModelTransportResponse {
  text: string;
  ranOn: 'on_device' | 'cloud';
}

export interface ModelTransport {
  generate(request: ModelTransportRequest): Promise<ModelTransportResponse>;
}

function toSdkInferenceMode(mode: HybridMode): InferenceMode {
  switch (mode) {
    case 'only_on_device':
      return InferenceMode.ONLY_ON_DEVICE;
    case 'prefer_on_device':
      return InferenceMode.PREFER_ON_DEVICE;
    case 'prefer_in_cloud':
      return InferenceMode.PREFER_IN_CLOUD;
    case 'only_in_cloud':
      return InferenceMode.ONLY_IN_CLOUD;
  }
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/**
 * Default production transport backed by Firebase AI Logic Hybrid Inference (FR-AI-1).
 */
class FirebaseAiLogicTransport implements ModelTransport {
  private getModel(request: ModelTransportRequest): GenerativeModel {
    const { app } = ensureFirebaseApp();
    const ai = getAI(app, { backend: new GoogleAIBackend() });

    const hybridParams: HybridParams = {
      mode: toSdkInferenceMode(request.mode),
      onDeviceParams: {
        createOptions: request.inlineMedia
          ? {
              expectedInputs: [{ type: 'text' }, { type: 'image' }],
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            }
          : {
              expectedInputs: [{ type: 'text' }],
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            },
        promptOptions: {
          responseConstraint: request.jsonSchema,
        },
      },
      inCloudParams: {
        model: request.cloudModelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: request.jsonSchema as unknown as SchemaRequest,
          temperature: 0.2,
        },
      },
    };

    return getGenerativeModel(ai, hybridParams);
  }

  async generate(request: ModelTransportRequest): Promise<ModelTransportResponse> {
    const model = this.getModel(request);
    const parts: Array<string | Part> = [request.prompt];
    if (request.inlineMedia) {
      parts.push({
        inlineData: {
          mimeType: request.inlineMedia.mimeType,
          data: request.inlineMedia.dataBase64,
        },
      });
    }

    const timeoutMs = request.mode === 'only_on_device' ? 25_000 : 35_000;
    const runWithTimeout = <T,>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`AI inference timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

    if (request.stream && request.onToken) {
      const streamResult = await runWithTimeout(model.generateContentStream(parts));
      let fullText = '';
      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullText += chunkText;
          request.onToken(chunkText);
        }
      }
      const aggregated = await runWithTimeout(streamResult.response);
      const ranOn =
        aggregated.inferenceSource === InferenceSource.IN_CLOUD ? 'cloud' : 'on_device';
      return { text: fullText || aggregated.text(), ranOn };
    }

    const result = await runWithTimeout(model.generateContent(parts));
    const ranOn =
      result.response.inferenceSource === InferenceSource.IN_CLOUD ? 'cloud' : 'on_device';
    return { text: result.response.text(), ranOn };
  }
}

/**
 * Checks desktop Chrome version, Prompt API availability, and local storage headroom (FR-ON-2).
 */
export async function checkDeviceAiReadiness(): Promise<DeviceAiStatus> {
  let chromeVersion: number | null = null;
  if (typeof navigator !== 'undefined') {
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    if (match?.[1]) {
      chromeVersion = Number.parseInt(match[1], 10);
    }
  }
  const chromeSupported = chromeVersion !== null && chromeVersion >= 139;

  const globalApi = globalThis as unknown as {
    LanguageModel?: {
      availability?: (opts?: Record<string, unknown>) => Promise<string>;
    };
  };

  let availability: DeviceAiStatus['availability'] = 'unavailable';
  const promptApiAvailable = typeof globalApi.LanguageModel?.availability === 'function';
  if (promptApiAvailable) {
    try {
      const state = await globalApi.LanguageModel!.availability!({
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      if (
        state === 'available' ||
        state === 'downloadable' ||
        state === 'downloading' ||
        state === 'unavailable'
      ) {
        availability = state;
      } else if (state === 'readily') {
        availability = 'available';
      } else if (state === 'after-download') {
        availability = 'downloadable';
      }
    } catch {
      availability = 'unavailable';
    }
  }

  let availableStorageGb: number | null = null;
  let diskSpaceOk = true;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number' && typeof est.usage === 'number') {
        availableStorageGb = Number(((est.quota - est.usage) / 1024 ** 3).toFixed(1));
        diskSpaceOk = availableStorageGb >= 4;
      }
    } catch {
      diskSpaceOk = true;
    }
  }

  return {
    chromeVersion,
    chromeSupported,
    promptApiAvailable,
    availability,
    diskSpaceOk,
    availableStorageGb,
    ready: chromeSupported && promptApiAvailable && availability === 'available',
  };
}

/**
 * Must ONLY be called from an explicit user click (onboarding "Enable on-device AI" button, FR-ON-3).
 */
export async function triggerDeviceModelDownload(
  onDownloadProgress?: (progress0to1: number) => void,
): Promise<void> {
  const { app } = ensureFirebaseApp();
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
  });
  await model.initializeDeviceModel((progress) => {
    onDownloadProgress?.(progress);
  });
}

/**
 * Single unified Hybrid AI module for Trailmind (FR-AI-1 to FR-AI-7, Section 5).
 * Every AI call in the entire codebase routes through this class.
 */
export class TrailmindAI {
  private onDeviceBusy = false;
  private waitQueue: Array<() => void> = [];
  private userTyping = false;
  private videoPlaying = false;
  private batterySaver = false;
  private cloudCallsToday = 0;
  private cloudQuotaDay = new Date().toISOString().slice(0, 10);

  constructor(
    private readonly store: MemoryStore = memoryStore,
    private transport: ModelTransport = new FirebaseAiLogicTransport(),
  ) {}

  setTransport(transport: ModelTransport): void {
    this.transport = transport;
  }

  setActivitySignals(signals: {
    typing?: boolean;
    videoPlaying?: boolean;
    batterySaver?: boolean;
  }): void {
    if (typeof signals.typing === 'boolean') this.userTyping = signals.typing;
    if (typeof signals.videoPlaying === 'boolean') this.videoPlaying = signals.videoPlaying;
    if (typeof signals.batterySaver === 'boolean') this.batterySaver = signals.batterySaver;
  }

  isBackpressured(): boolean {
    return this.userTyping || this.videoPlaying || this.batterySaver;
  }

  /**
   * Resolves the effective InferenceMode for a job based on:
   * 1. Privacy lock (sensitive_detection is ALWAYS ONLY_ON_DEVICE; page_extraction is ONLY_ON_DEVICE unless explicit cloud fallback opt-in)
   * 2. Remote Config kill switch & mode table
   * 3. User's Cloud master switch & per-feature opt-in toggle (FR-PRV-7)
   * 4. Per-user daily cloud quota guard (SEC-6)
   */
  resolveEffectiveMode(
    jobKind: AiJobKind,
    settings: SettingsRecord,
    explicitCloudRequest = false,
  ): HybridMode {
    const rc = remoteConfigService.getValues();
    const policy = HYBRID_ROUTING_TABLE[jobKind];

    // Sensitive detection & live memory radar MUST NEVER leave the device under any setting or Remote Config value
    if (jobKind === 'sensitive_detection' || jobKind === 'memory_radar') {
      return 'only_on_device';
    }

    // Check daily quota reset
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.cloudQuotaDay) {
      this.cloudQuotaDay = today;
      this.cloudCallsToday = 0;
    }

    const cloudAllowedGlobally =
      !rc.cloudKillSwitch &&
      settings.cloud.masterEnabled &&
      this.cloudCallsToday < rc.cloudDailyQuotaPerUser;

    if (!cloudAllowedGlobally) {
      return 'only_on_device';
    }

    // Page extraction stays ONLY_ON_DEVICE unless user explicitly enabled opt-in cloud fallback (FR-ON-7)
    if (jobKind === 'page_extraction') {
      return settings.cloud.cloudExtractionFallback ? 'prefer_on_device' : 'only_on_device';
    }

    // Per-feature cloud opt-in checks (FR-PRV-7)
    if (jobKind === 'ask_memory') {
      if (explicitCloudRequest && settings.cloud.cloudAnswers) return 'prefer_in_cloud';
      return settings.cloud.cloudAnswers ? rc.modes[jobKind] : 'only_on_device';
    }
    if (jobKind === 'deep_summary') {
      return settings.cloud.cloudDeepSummary ? 'prefer_in_cloud' : 'only_on_device';
    }
    if (jobKind === 'decision_matrix') {
      if (explicitCloudRequest && (settings.cloud.cloudDeepSummary || settings.cloud.cloudAnswers)) {
        return 'prefer_in_cloud';
      }
      return 'only_on_device';
    }
    if (jobKind === 'weekly_recap') {
      if (explicitCloudRequest && settings.cloud.cloudRecapPolish) return 'prefer_in_cloud';
      return settings.cloud.cloudRecapPolish ? rc.modes[jobKind] : 'only_on_device';
    }
    if (jobKind === 'heavy_media_pdf') {
      return settings.cloud.cloudMediaPdf && explicitCloudRequest
        ? 'prefer_in_cloud'
        : 'only_on_device';
    }

    if (policy.lockedOnDevice) return 'only_on_device';
    return rc.modes[jobKind] ?? policy.defaultMode;
  }

  private async acquireOnDeviceSlot(isBackground: boolean): Promise<void> {
    if (isBackground && this.isBackpressured()) {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
    if (!this.onDeviceBusy) {
      this.onDeviceBusy = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.onDeviceBusy = true;
  }

  private releaseOnDeviceSlot(): void {
    this.onDeviceBusy = false;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  /**
   * Core structured execution pipeline:
   * - resolves mode through routing table + Remote Config + privacy switches
   * - enforces max 1 concurrent on-device job (FR-AI-7)
   * - validates JSON against Zod schema with single repair retry (FR-AI-3, NFR-RL-4)
   * - logs routing outcome + cloud payload preview (never on-device content) to `routing_log` (FR-AI-5)
   */
  async runStructuredJob<T>(options: {
    jobKind: AiJobKind;
    prompt: string;
    schema: ZodType<T>;
    jsonSchema: Record<string, unknown>;
    inlineMedia?: { mimeType: string; dataBase64: string };
    stream?: boolean;
    onToken?: (chunk: string) => void;
    explicitCloudRequest?: boolean;
    cloudPreviewText?: string;
    isBackground?: boolean;
  }): Promise<AiExecutionResult<T>> {
    const started = performance.now();
    const settings = await this.store.getSettings();
    const rc = remoteConfigService.getValues();
    const effectiveMode = this.resolveEffectiveMode(
      options.jobKind,
      settings,
      options.explicitCloudRequest,
    );
    const tokensEstimated = estimateTokens(options.prompt);
    const promptVersion = rc.promptSchemaVersion;

    const needsSlot = effectiveMode === 'only_on_device' || effectiveMode === 'prefer_on_device';
    if (needsSlot) {
      await this.acquireOnDeviceSlot(Boolean(options.isBackground));
    }

    let repaired = false;
    try {
      const response = await this.transport.generate({
        jobKind: options.jobKind,
        mode: effectiveMode,
        cloudModelName: rc.cloudModelName,
        prompt: options.prompt,
        inlineMedia: options.inlineMedia,
        jsonSchema: options.jsonSchema,
        stream: options.stream,
        onToken: options.onToken,
      });

      const parseAttempt = this.tryParseWithSchema(response.text, options.schema);
      let finalData: T;
      let finalRanOn: 'on_device' | 'cloud' = response.ranOn;

      if (parseAttempt.ok) {
        finalData = parseAttempt.data;
      } else {
        // Single repair retry (FR-AI-3, NFR-RL-4)
        repaired = true;
        const repairPrompt = buildRepairPrompt(
          response.text,
          parseAttempt.error,
          JSON.stringify(options.jsonSchema),
        );
        const repairRes = await this.transport.generate({
          jobKind: options.jobKind,
          mode: effectiveMode,
          cloudModelName: rc.cloudModelName,
          prompt: repairPrompt,
          jsonSchema: options.jsonSchema,
        });
        finalRanOn = repairRes.ranOn;
        const repairedAttempt = this.tryParseWithSchema(repairRes.text, options.schema);
        if (!repairedAttempt.ok) {
          throw new Error(`Schema validation failed after repair retry: ${repairedAttempt.error}`);
        }
        finalData = repairedAttempt.data;
      }

      if (finalRanOn === 'cloud') {
        this.cloudCallsToday++;
      }

      const durationMs = Math.round(performance.now() - started);
      const cloudPayloadPreview =
        finalRanOn === 'cloud'
          ? (options.cloudPreviewText ?? options.prompt).slice(0, 600)
          : undefined;

      await this.store.logRoutingOutcome({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        jobKind: options.jobKind,
        mode: effectiveMode,
        ranOn: finalRanOn,
        ms: durationMs,
        tokensEstimated,
        cloudPayloadPreview,
        promptVersion,
      });

      return {
        data: finalData,
        ranOn: finalRanOn,
        modeUsed: effectiveMode,
        durationMs,
        promptVersion,
        repaired,
        cloudPayloadPreview,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      await this.store.logRoutingOutcome({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        jobKind: options.jobKind,
        mode: effectiveMode,
        ranOn: 'failed',
        ms: durationMs,
        tokensEstimated,
        promptVersion,
        errorCode: err instanceof Error ? err.message.slice(0, 120) : 'unknown_error',
      });
      throw err;
    } finally {
      if (needsSlot) {
        this.releaseOnDeviceSlot();
      }
    }
  }

  private tryParseWithSchema<T>(
    rawText: string,
    schema: ZodType<T>,
  ): { ok: true; data: T } | { ok: false; error: string } {
    try {
      const jsonStr = stripJsonFences(rawText);
      const parsed = JSON.parse(jsonStr);
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return { ok: true, data: validated.data };
      }
      return {
        ok: false,
        error: validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }

  // ---- High-level typed job methods ----

  /**
   * Extracts structured topics, entities, facts, type, price, language.
   * Long pages (> 2,500 tokens) are chunked, extracted per chunk, and merged in one final call (FR-EX-1, FR-EX-2).
   */
  async extractPage(input: {
    url: string;
    title: string;
    text: string;
    isBackground?: boolean;
  }): Promise<AiExecutionResult<PageExtractionOutput>> {
    const chunks = chunkTextForExtraction(input.text);
    if (chunks.length <= 1) {
      return this.runStructuredJob({
        jobKind: 'page_extraction',
        prompt: buildPageExtractionPrompt({
          url: input.url,
          title: input.title,
          textChunk: chunks[0] ?? input.title,
        }),
        schema: PageExtractionSchema,
        jsonSchema: JSON_SCHEMAS.page_extraction as unknown as Record<string, unknown>,
        isBackground: input.isBackground,
      });
    }

    const partials: PageExtractionOutput[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkResult = await this.runStructuredJob({
        jobKind: 'page_extraction',
        prompt: buildPageExtractionPrompt({
          url: input.url,
          title: input.title,
          textChunk: chunks[i]!,
          chunkIndex: i,
          totalChunks: chunks.length,
        }),
        schema: PageExtractionSchema,
        jsonSchema: JSON_SCHEMAS.page_extraction as unknown as Record<string, unknown>,
        isBackground: input.isBackground,
      });
      partials.push(chunkResult.data);
    }

    return this.runStructuredJob({
      jobKind: 'page_extraction',
      prompt: buildMergeExtractionsPrompt(input.title, input.url, partials),
      schema: PageExtractionSchema,
      jsonSchema: JSON_SCHEMAS.page_extraction as unknown as Record<string, unknown>,
      isBackground: input.isBackground,
    });
  }

  async detectSensitivePage(input: {
    domain: string;
    title: string;
    snippet: string;
  }): Promise<AiExecutionResult<SensitiveDetectionOutput>> {
    return this.runStructuredJob({
      jobKind: 'sensitive_detection',
      prompt: buildSensitiveDetectionPrompt(input),
      schema: SensitiveDetectionSchema,
      jsonSchema: JSON_SCHEMAS.sensitive_detection as unknown as Record<string, unknown>,
    });
  }

  async nameCluster(input: {
    topics: string[];
    sampleTitles: string[];
  }): Promise<AiExecutionResult<ClusterNamingOutput>> {
    return this.runStructuredJob({
      jobKind: 'cluster_naming',
      prompt: buildClusterNamingPrompt(input),
      schema: ClusterNamingSchema,
      jsonSchema: JSON_SCHEMAS.cluster_naming as unknown as Record<string, unknown>,
      cloudPreviewText: `Topics: ${input.topics.join(', ')} | Titles: ${input.sampleTitles.slice(0, 5).join(', ')}`,
      isBackground: true,
    });
  }

  async askMemory(input: {
    question: string;
    passages: Array<{ pageId: string; chunkId: string; title: string; domain: string; text: string }>;
    followUpContext?: { previousQuestion: string; previousAnswer: string };
    explicitCloudRequest?: boolean;
    onToken?: (chunk: string) => void;
  }): Promise<AiExecutionResult<AskMemoryOutput>> {
    const cloudPreview = `Question: "${input.question}" | Passages (${input.passages.length}): ${input.passages
      .map((p) => `${p.title} (${p.text.slice(0, 80)}...)`)
      .join(' ; ')}`;

    return this.runStructuredJob({
      jobKind: 'ask_memory',
      prompt: buildAskMemoryPrompt(input),
      schema: AskMemorySchema,
      jsonSchema: JSON_SCHEMAS.ask_memory as unknown as Record<string, unknown>,
      stream: Boolean(input.onToken),
      onToken: input.onToken,
      explicitCloudRequest: input.explicitCloudRequest,
      cloudPreviewText: cloudPreview,
    });
  }

  async summarizeJourney(input: {
    entryQuery?: string;
    pageTitles: string[];
    domains: string[];
  }): Promise<AiExecutionResult<JourneySummaryOutput>> {
    return this.runStructuredJob({
      jobKind: 'loop_journey_summary',
      prompt: buildJourneySummaryPrompt(input),
      schema: JourneySummarySchema,
      jsonSchema: JSON_SCHEMAS.loop_journey_summary as unknown as Record<string, unknown>,
      cloudPreviewText: `Query: ${input.entryQuery ?? 'none'} | Pages: ${input.pageTitles.slice(0, 8).join(' -> ')}`,
      isBackground: true,
    });
  }

  async summarizeChangeDiff(input: {
    title: string;
    url: string;
    oldSnippet: string;
    newSnippet: string;
  }): Promise<AiExecutionResult<ChangeWatchDiffOutput>> {
    return this.runStructuredJob({
      jobKind: 'change_watch_diff',
      prompt: buildChangeWatchDiffPrompt(input),
      schema: ChangeWatchDiffSchema,
      jsonSchema: JSON_SCHEMAS.change_watch_diff as unknown as Record<string, unknown>,
      cloudPreviewText: `Diff for ${input.title}: old(${input.oldSnippet.length} chars) vs new(${input.newSnippet.length} chars)`,
      isBackground: true,
    });
  }

  async describeImage(input: {
    mimeType: 'image/jpeg' | 'image/png';
    dataBase64: string;
    alt?: string;
  }): Promise<AiExecutionResult<ImageDescriptionOutput>> {
    return this.runStructuredJob({
      jobKind: 'image_understanding',
      prompt: buildImageUnderstandingPrompt(input.alt),
      schema: ImageDescriptionSchema,
      jsonSchema: JSON_SCHEMAS.image_understanding as unknown as Record<string, unknown>,
      inlineMedia: { mimeType: input.mimeType, dataBase64: input.dataBase64 },
      cloudPreviewText: `Inline image (${input.mimeType}, alt="${input.alt ?? ''}")`,
      isBackground: true,
    });
  }

  async generateWeeklyRecap(input: {
    statsJson: string;
    polishWithCloud?: boolean;
  }): Promise<AiExecutionResult<WeeklyRecapOutput>> {
    return this.runStructuredJob({
      jobKind: 'weekly_recap',
      prompt: buildWeeklyRecapPrompt(input.statsJson),
      schema: WeeklyRecapSchema,
      jsonSchema: JSON_SCHEMAS.weekly_recap as unknown as Record<string, unknown>,
      explicitCloudRequest: input.polishWithCloud,
      cloudPreviewText: `Aggregated weekly stats (no page text): ${input.statsJson.slice(0, 500)}`,
    });
  }

  async generateDeepSummary(input: {
    topic: string;
    facts: string[];
  }): Promise<AiExecutionResult<DeepSummaryOutput>> {
    return this.runStructuredJob({
      jobKind: 'deep_summary',
      prompt: buildDeepSummaryPrompt(input.topic, input.facts),
      schema: DeepSummarySchema,
      jsonSchema: JSON_SCHEMAS.deep_summary as unknown as Record<string, unknown>,
      explicitCloudRequest: true,
      cloudPreviewText: `Topic "${input.topic}" (${input.facts.length} extracted facts, no raw pages): ${input.facts
        .slice(0, 5)
        .join(' | ')}`,
    });
  }

  /**
   * Ambient Contradiction & Price-vs-Memory Radar (strictly ONLY_ON_DEVICE — zero cloud bytes).
   */
  async runMemoryRadar(input: {
    currentTitle: string;
    currentDomain: string;
    currentExcerpt: string;
    rememberedItems: Array<{
      pageId: string;
      title: string;
      domain: string;
      dateStr: string;
      facts: string[];
    }>;
  }): Promise<AiExecutionResult<MemoryRadarOutput>> {
    return this.runStructuredJob({
      jobKind: 'memory_radar',
      prompt: buildMemoryRadarPrompt(input),
      schema: MemoryRadarSchema,
      jsonSchema: JSON_SCHEMAS.memory_radar as unknown as Record<string, unknown>,
      isBackground: true,
    });
  }

  /**
   * Hybrid Decision Matrix: small clusters run free on-device via Gemini Nano;
   * large multi-week clusters escalate extracted facts-only to Cloud Gemini via Firebase AI Logic + App Check.
   */
  async generateDecisionMatrix(input: {
    clusterName: string;
    items: Array<{
      pageId: string;
      title: string;
      domain: string;
      price?: string;
      summary: string;
      facts: string[];
    }>;
    escalateToCloud: boolean;
  }): Promise<AiExecutionResult<DecisionMatrixOutput>> {
    const cloudPreview = `Decision Matrix for "${input.clusterName}" (${input.items.length} options, extracted facts only — 0 raw pages): ${input.items
      .slice(0, 6)
      .map((i) => `${i.title}${i.price ? ` (${i.price})` : ''}`)
      .join(' | ')}`;

    return this.runStructuredJob({
      jobKind: 'decision_matrix',
      prompt: buildDecisionMatrixPrompt(input),
      schema: DecisionMatrixSchema,
      jsonSchema: JSON_SCHEMAS.decision_matrix as unknown as Record<string, unknown>,
      explicitCloudRequest: input.escalateToCloud,
      cloudPreviewText: cloudPreview,
    });
  }
}

export const trailmindAI = new TrailmindAI();
