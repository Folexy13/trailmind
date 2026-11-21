export type PageType =
  | 'article'
  | 'docs'
  | 'product'
  | 'thread'
  | 'video'
  | 'search_results'
  | 'tool'
  | 'other';

export type PageStatus = 'full' | 'metadata_only' | 'gone';

export type EntityKind = 'person' | 'org' | 'product' | 'place' | 'tech' | 'other';

export type NodeKind =
  | 'search'
  | 'page'
  | 'site'
  | 'topic'
  | 'entity'
  | 'journey'
  | 'highlight';

export type EdgeKind =
  | 'search-to-result'
  | 'page-to-page'
  | 'page-to-topic'
  | 'page-to-entity'
  | 'topic-to-topic'
  | 'same-session';

export type LoopKind = 'reading' | 'comparing' | 'form' | 'saved';
export type LoopState = 'open' | 'done' | 'snoozed' | 'dismissed';
export type JourneyState = 'active' | 'done' | 'pinned';
export type JobState = 'queued' | 'running' | 'done' | 'failed';
export type AiSource = 'on_device' | 'cloud' | 'failed';

export type HybridMode =
  | 'only_on_device'
  | 'prefer_on_device'
  | 'prefer_in_cloud'
  | 'only_in_cloud';

export type AiJobKind =
  | 'page_extraction'
  | 'sensitive_detection'
  | 'cluster_naming'
  | 'ask_memory'
  | 'loop_journey_summary'
  | 'change_watch_diff'
  | 'image_understanding'
  | 'heavy_media_pdf'
  | 'deep_summary'
  | 'weekly_recap'
  | 'memory_radar'
  | 'decision_matrix';

export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
}

export interface PriceInfo {
  amount: number;
  currency: string;
  raw: string;
}

export interface ExtractedEntity {
  name: string;
  canonicalName: string;
  kind: EntityKind;
}

export interface PageRecord {
  id: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  type: PageType;
  summary: string;
  language: string;
  topics: string[];
  englishTopics: string[];
  entities: ExtractedEntity[];
  price?: PriceInfo;
  firstSeen: number;
  lastSeen: number;
  status: PageStatus;
  promptVersion: string;
  clusterId?: string;
  bookmarked?: boolean;
  starred?: boolean;
  aiSource?: AiSource;
  updatedAt: number;
}

export interface StoredPageRecord extends Omit<PageRecord, 'summary'> {
  summaryEnc: EncryptedBlob | string;
}

export interface VisitRecord {
  id: string;
  pageId: string;
  time: number;
  activeMs: number;
  maxScroll: number;
  referrerVisitId?: string;
  referrerUrl?: string;
  transition: string;
  sessionId: string;
  hadForm?: boolean;
  formSubmitted?: boolean;
}

export interface CapturedImage {
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  alt?: string;
  width: number;
  height: number;
  dataBase64?: string;
  description?: string;
}

export interface SnapshotRecord {
  id: string;
  pageId: string;
  capturedAt: number;
  contentHash: string;
  title: string;
  text: string;
  sanitizedHtml?: string;
  images: CapturedImage[];
  screenshotPng?: string;
  byteSize: number;
}

export interface StoredSnapshotRecord extends Omit<SnapshotRecord, 'text' | 'sanitizedHtml'> {
  textEnc: EncryptedBlob | string;
  sanitizedHtmlEnc?: EncryptedBlob | string;
}

export interface ChunkRecord {
  id: string;
  pageId: string;
  snapshotId: string;
  index: number;
  text: string;
  tokenEstimate: number;
}

export interface StoredChunkRecord extends Omit<ChunkRecord, 'text'> {
  textEnc: EncryptedBlob | string;
}

export interface FactRecord {
  id: string;
  pageId: string;
  chunkId?: string;
  text: string;
  fromImage: boolean;
  highlight: boolean;
  createdAt: number;
}

export interface StoredFactRecord extends Omit<FactRecord, 'text'> {
  textEnc: EncryptedBlob | string;
}

export interface GraphNodeRecord {
  id: string;
  kind: NodeKind;
  label: string;
  clusterId?: string;
  weight: number;
  refId?: string;
  firstSeen: number;
  lastSeen: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface GraphEdgeRecord {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  firstSeen: number;
}

export interface EmbeddingRecord {
  id: string;
  ownerId: string;
  ownerKind: 'page' | 'chunk' | 'fact';
  pageId: string;
  vector: number[];
  scale: number;
  dim: number;
}

export interface ClusterRecord {
  id: string;
  name: string;
  summary: string;
  userRenamed: boolean;
  pinned: boolean;
  hidden: boolean;
  color: string;
  pageIds: string[];
  topics: string[];
  aiSource?: AiSource;
  createdAt: number;
  updatedAt: number;
}

export interface JourneyBranch {
  fromPageId: string;
  toPageIds: string[];
}

export interface JourneyRecord {
  id: string;
  start: number;
  end: number;
  entryPageId: string;
  exitPageId: string;
  entryQuery?: string;
  pageIds: string[];
  branches: JourneyBranch[];
  name: string;
  outcome: string;
  state: JourneyState;
  clusterId?: string;
  linkedJourneyIds: string[];
  aiSource?: AiSource;
  updatedAt: number;
}

export interface ComparisonRow {
  pageId: string;
  title: string;
  domain: string;
  url: string;
  price?: PriceInfo;
  summary: string;
}

export interface LoopRecord {
  id: string;
  kind: LoopKind;
  pageIds: string[];
  clusterId?: string;
  reason: string;
  state: LoopState;
  snoozeUntil?: number;
  importance: number;
  createdAt: number;
  updatedAt: number;
  comparisonRows?: ComparisonRow[];
}

export interface WatchChange {
  id: string;
  detectedAt: number;
  summary: string;
  kind: 'price' | 'content' | 'availability' | 'removed';
  oldValue?: string;
  newValue?: string;
  aiSource: AiSource;
}

export interface WatchRecord {
  id: string;
  pageId: string;
  url: string;
  title: string;
  intervalHours: number;
  priceTarget?: number;
  priceCurrency?: string;
  lastCheck: number;
  lastHash?: string;
  lastText?: string;
  lastPrice?: number;
  changes: WatchChange[];
  enabled: boolean;
  suggested: boolean;
  createdAt: number;
}

export interface WeeklyRecapStats {
  pagesRead: number;
  totalActiveMinutes: number;
  topTopics: Array<{ topic: string; count: number }>;
  newEntities: Array<{ name: string; kind: EntityKind }>;
  timeByCluster: Array<{ clusterId: string; clusterName: string; minutes: number; color: string }>;
  journeysCompleted: number;
  openLoopsCount: number;
  changesDetected: number;
}

export interface RecapRecord {
  id: string;
  week: string;
  startDate: number;
  endDate: number;
  stats: WeeklyRecapStats;
  text: string;
  aiSource: AiSource;
  createdAt: number;
}

export interface StoredRecapRecord extends Omit<RecapRecord, 'text'> {
  textEnc: EncryptedBlob | string;
}

export interface CustomSearchPattern {
  id: string;
  name: string;
  hostPattern: string;
  queryParam: string;
}

export interface CloudSettings {
  masterEnabled: boolean;
  cloudAnswers: boolean;
  cloudExtractionFallback: boolean;
  cloudDeepSummary: boolean;
  cloudRecapPolish: boolean;
  cloudMediaPdf: boolean;
}

export interface SettingsRecord {
  id: 'singleton';
  onboardingCompleted: boolean;
  demoMode: boolean;
  exclusions: string[];
  capturePausedGlobal: boolean;
  capturePausedUntil?: number;
  pausedTabIds: number[];
  minVisibleSeconds: number;
  minScrollPercent: number;
  captureImages: boolean;
  backfillEnabled: boolean;
  backfillPaused: boolean;
  backfillDays: 7 | 30 | 90;
  backfillDomainDelayMs: number;
  backfillMaxParallel: number;
  cloud: CloudSettings;
  seenBeforeEnabled: boolean;
  seenBeforeThreshold: number;
  seenBeforeDisabledDomains: string[];
  changeWatchIntervalHours: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  notificationsEnabled: boolean;
  weeklyRecapDay: number;
  weeklyRecapHour: number;
  storageBudgetMb: number;
  autoDeleteDays: 0 | 30 | 90 | 365;
  dismissedLoopKinds: LoopKind[];
  lockEnabled: boolean;
  lockWebAuthnCredentialId?: string;
  syncEnabled: boolean;
  syncUserEmail?: string;
  syncUserUid?: string;
  syncLastAt?: number;
  notionToken?: string;
  notionParentPageId?: string;
  customSearchPatterns: CustomSearchPattern[];
  anonymousStatsEnabled: boolean;
  theme: 'system' | 'light' | 'dark';
  updatedAt: number;
}

export interface JobRecord {
  id: string;
  kind:
    | 'extract_page'
    | 'backfill_fetch'
    | 'embed_page'
    | 'recluster'
    | 'check_watch'
    | 'weekly_recap'
    | 'describe_images';
  priority: number;
  state: JobState;
  attempts: number;
  payloadRef: string;
  payload?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface RoutingLogRecord {
  id: string;
  timestamp: number;
  jobKind: AiJobKind;
  mode: HybridMode;
  ranOn: AiSource;
  ms: number;
  tokensEstimated: number;
  cloudPayloadPreview?: string;
  promptVersion: string;
  errorCode?: string;
}

export interface SkippedDomainRecord {
  id: string;
  domain: string;
  reason: 'sensitive_page' | 'excluded_domain';
  count: number;
  lastSkippedAt: number;
}

export interface SyncMetaRecord {
  key: string;
  collection: string;
  recordId: string;
  versionVector: Record<string, number>;
  updatedAt: number;
  deleted: boolean;
}

export interface Citation {
  pageId: string;
  chunkId?: string;
  title: string;
  url: string;
  excerpt: string;
  textFragmentUrl: string;
  status: PageStatus;
}

export interface AskAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  hasAnswer: boolean;
  aiSource: AiSource;
  latencyMs: number;
  instantPages: PageRecord[];
  retrievedPassages: Array<{
    pageId: string;
    chunkId: string;
    title: string;
    url: string;
    text: string;
    score: number;
  }>;
  cloudPayloadPreview?: string;
}

export interface RadarAlert {
  kind: 'price_better' | 'conflict' | 'update';
  headline: string;
  detail: string;
  sourcePageId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDate: number;
  savingsText?: string;
  aiSource: AiSource;
}

export interface SeenBeforeMatch {
  kind: 'exact_revisit' | 'related' | 'radar_price' | 'radar_conflict' | 'radar_update';
  message: string;
  pageId?: string;
  lastVisitedAt?: number;
  activeMinutes?: number;
  maxScrollPercent?: number;
  clusterName?: string;
  clusterId?: string;
  radarAlert?: RadarAlert;
  relatedPages: Array<{
    pageId: string;
    title: string;
    url: string;
    domain: string;
    similarity: number;
  }>;
  lookupMs: number;
}

export interface DecisionOptionRow {
  option: string;
  priceOrCost: string;
  pros: string[];
  cons: string[];
  verdict: string;
  sourcePageIds: string[];
  sourceUrls: Array<{ pageId: string; title: string; url: string }>;
}

export interface DecisionMatrixResult {
  clusterId: string;
  clusterName: string;
  title: string;
  summary: string;
  recommendedOption: string;
  options: DecisionOptionRow[];
  openQuestions: string[];
  aiSource: AiSource;
  escalatedToCloud: boolean;
  escalationReason: string;
  factsAnalyzed: number;
  pagesAnalyzed: number;
  estimatedTokens: number;
  cloudPayloadPreview?: string;
  generatedAt: number;
}

export interface TabRescueItem {
  tabId: number;
  url: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  clusterLabel: string;
  isDuplicate: boolean;
  alreadyInMemory: boolean;
  pinned: boolean;
  active: boolean;
}

export interface TabRescuePlan {
  totalOpenTabs: number;
  rescuableTabs: TabRescueItem[];
  duplicateCount: number;
  alreadySavedCount: number;
  estimatedRamMb: number;
  groups: Array<{
    label: string;
    tabIds: number[];
    tabs: TabRescueItem[];
  }>;
}

export interface TabRescueOutcome {
  archivedCount: number;
  closedCount: number;
  journeysCreated: number;
  estimatedRamFreedMb: number;
  journeyIds: string[];
}

export interface DeviceAiStatus {
  chromeVersion: number | null;
  chromeSupported: boolean;
  promptApiAvailable: boolean;
  availability: 'available' | 'downloadable' | 'downloading' | 'unavailable';
  diskSpaceOk: boolean;
  availableStorageGb: number | null;
  ready: boolean;
}

export interface BackfillProgress {
  running: boolean;
  paused: boolean;
  total: number;
  done: number;
  enriched: number;
  metadataOnly: number;
  skipped: number;
  estimatedMinutesLeft: number;
}

export interface RemoteConfigValues {
  cloudKillSwitch: boolean;
  cloudModelName: string;
  modes: Record<AiJobKind, HybridMode>;
  seenBeforeThreshold: number;
  backfillDomainDelayMs: number;
  backfillMaxParallel: number;
  changeWatchIntervalHours: number;
  cloudDailyQuotaPerUser: number;
  promptSchemaVersion: string;
  promptTemplates: Record<string, string>;
  source: 'default' | 'remote' | 'cache';
  lastFetchedAt?: number;
}

export type ExtensionMessage =
  | { type: 'CAPTURE_PAGE'; payload: PageCapturePayload }
  | { type: 'CAPTURE_HIGHLIGHT'; payload: { url: string; title: string; text: string } }
  | { type: 'FORM_SUBMITTED'; payload: { url: string } }
  | { type: 'USER_ACTIVITY'; payload: { typing: boolean; videoPlaying: boolean } }
  | { type: 'CHECK_SEEN_BEFORE'; payload: { url: string; title: string; textSample: string } }
  | { type: 'ASK_MEMORY'; payload: { question: string; useCloud?: boolean; followUpContext?: { previousQuestion: string; previousAnswer: string } } }
  | { type: 'OPEN_SIDE_PANEL'; payload?: { tab?: string; pageId?: string; clusterId?: string } }
  | { type: 'START_BACKFILL'; payload: { days: 7 | 30 | 90 } }
  | { type: 'PAUSE_BACKFILL'; payload: { paused: boolean } }
  | { type: 'GET_BACKFILL_PROGRESS' }
  | { type: 'FORGET_RECENT'; payload: { minutes: number } }
  | { type: 'WATCH_CURRENT_PAGE'; payload: { url: string; title: string; priceTarget?: number } }
  | { type: 'RESUME_JOURNEY'; payload: { journeyId: string; maxTabs?: number } }
  | { type: 'CAPTURE_STAR_SCREENSHOT'; payload: { pageId: string; tabId?: number } }
  | { type: 'CHECK_DEVICE_AI' }
  | { type: 'INITIALIZE_DEVICE_AI' }
  | { type: 'GET_REMOTE_CONFIG' }
  | { type: 'REFRESH_REMOTE_CONFIG' }
  | { type: 'RUN_QUEUE_TICK' }
  | { type: 'TOGGLE_SEARCH_OVERLAY' }
  | { type: 'GET_POPUP_SUMMARY'; payload?: { tabId?: number; url?: string } }
  | { type: 'SCAN_TAB_GRAVEYARD' }
  | { type: 'EXECUTE_TAB_RESCUE'; payload: { tabIds: number[]; closeTabs: boolean } }
  | { type: 'BUILD_DECISION_MATRIX'; payload: { clusterId: string; forceCloud?: boolean } };

export interface PageCapturePayload {
  url: string;
  title: string;
  text: string;
  sanitizedHtml?: string;
  activeMs: number;
  maxScroll: number;
  referrerUrl?: string;
  hadForm?: boolean;
  formSubmitted?: boolean;
  images: CapturedImage[];
  sensitiveSignals: {
    hasPasswordField: boolean;
    hasPaymentField: boolean;
    looksLikeLogin: boolean;
    looksLikeMedical: boolean;
    looksLikeAdult: boolean;
  };
}
