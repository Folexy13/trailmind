import type { AiJobKind, CustomSearchPattern, HybridMode, SettingsRecord } from './types';

export const SCHEMA_VERSION = 2;
export const DEFAULT_PROMPT_VERSION = '1.0.0';
export const MAX_CHUNK_TOKENS = 2500;
export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN_ESTIMATE;
export const MAX_SNAPSHOTS_PER_PAGE = 5;
export const MAX_FACTS_PER_PAGE = 8;
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const PBKDF2_ITERATIONS = 600_000;

/**
 * Muted categorical palette tuned for contrast in both light and dark themes.
 */
export const CLUSTER_PALETTE = [
  '#2563eb', // blue
  '#0d9488', // teal
  '#d97706', // amber
  '#7c3aed', // violet
  '#e11d48', // rose
  '#059669', // emerald
  '#4f46e5', // indigo
  '#c2410c', // orange
  '#0284c7', // sky
  '#9333ea', // purple
];

/**
 * Pre-filled default exclusion list (FR-ON-5, FR-PRV-1):
 * banks, email, health, government ID portals, password managers, payment processors.
 */
export const DEFAULT_EXCLUSIONS: string[] = [
  // Banks & financial institutions
  '*.bank.com',
  '*.chase.com',
  '*.bankofamerica.com',
  '*.wellsfargo.com',
  '*.citibank.com',
  '*.hsbc.com',
  '*.barclays.co.uk',
  '*.gtbank.com',
  '*.accessbankplc.com',
  '*.zenithbank.com',
  '*.firstbanknigeria.com',
  '*.uba.com',
  '*.kuda.com',
  '*.paystack.com',
  '*.flutterwave.com',
  '*.stripe.com',
  '*.paypal.com',
  '*.wise.com',
  '*.revolut.com',
  // Email & private messaging
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  'mail.proton.me',
  '*.protonmail.com',
  'web.whatsapp.com',
  'web.telegram.org',
  // Health & medical portals
  '*.mychart.com',
  '*.nhs.uk',
  '*.medicare.gov',
  '*.webmd.com',
  '*.patient.info',
  // Government ID & tax portals
  '*.gov',
  '*.gov.uk',
  '*.gov.ng',
  '*.nimc.gov.ng',
  '*.irs.gov',
  '*.ssa.gov',
  // Password managers & auth vaults
  '*.1password.com',
  '*.bitwarden.com',
  '*.lastpass.com',
  '*.dashlane.com',
  '*.keepassxc.org',
  'passwords.google.com',
  // Local / browser internal
  'localhost',
  '127.0.0.1',
];

/**
 * Default search query URL patterns (FR-BF-3).
 */
export const DEFAULT_SEARCH_PATTERNS: CustomSearchPattern[] = [
  { id: 'google', name: 'Google', hostPattern: 'google.', queryParam: 'q' },
  { id: 'bing', name: 'Bing', hostPattern: 'bing.com', queryParam: 'q' },
  { id: 'ddg', name: 'DuckDuckGo', hostPattern: 'duckduckgo.com', queryParam: 'q' },
  { id: 'youtube', name: 'YouTube', hostPattern: 'youtube.com', queryParam: 'search_query' },
  { id: 'github', name: 'GitHub', hostPattern: 'github.com', queryParam: 'q' },
  { id: 'stackoverflow', name: 'Stack Overflow', hostPattern: 'stackoverflow.com', queryParam: 'q' },
  { id: 'amazon', name: 'Amazon', hostPattern: 'amazon.', queryParam: 'k' },
  { id: 'jumia', name: 'Jumia', hostPattern: 'jumia.', queryParam: 'q' },
];

/**
 * Canonical BRD Section 5 Hybrid Routing Table.
 */
export const HYBRID_ROUTING_TABLE: Record<
  AiJobKind,
  {
    defaultMode: HybridMode;
    lockedOnDevice: boolean;
    requiresCloudOptIn: boolean;
    reason: string;
    label: string;
  }
> = {
  page_extraction: {
    defaultMode: 'only_on_device',
    lockedOnDevice: true,
    requiresCloudOptIn: false,
    reason:
      'Runs on every page; content is private and must cost nothing. Never falls back to cloud.',
    label: 'Page extraction (topics, entities, facts)',
  },
  sensitive_detection: {
    defaultMode: 'only_on_device',
    lockedOnDevice: true,
    requiresCloudOptIn: false,
    reason: 'Decides whether a page is recorded at all; must never leave the device.',
    label: 'Sensitive page detection',
  },
  cluster_naming: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Input is extracted labels only, not raw pages; low sensitivity.',
    label: 'Cluster naming & summaries',
  },
  ask_memory: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Passages are private; cloud fallback runs only if the user opted into Cloud answers.',
    label: 'Ask your memory',
  },
  loop_journey_summary: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Small inputs, frequent background summaries.',
    label: 'Journey & open-loop summaries',
  },
  change_watch_diff: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Small text diff running in the background.',
    label: 'Change-watch diff summary',
  },
  image_understanding: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'JPEG and PNG charts/diagrams are supported on-device with Gemini Nano.',
    label: 'Image understanding (charts & diagrams)',
  },
  heavy_media_pdf: {
    defaultMode: 'prefer_in_cloud',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'PDFs, audio, and video are not supported on-device; opt-in per item.',
    label: 'PDF, audio & video analysis (opt-in)',
  },
  deep_summary: {
    defaultMode: 'prefer_in_cloud',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Exceeds the ~9,216-token on-device context budget; sends extracted facts only.',
    label: 'Cross-month / topic deep summary (opt-in)',
  },
  weekly_recap: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason: 'Built from local stats and facts; optional cloud polish sends stats only.',
    label: 'Weekly recap',
  },
  memory_radar: {
    defaultMode: 'only_on_device',
    lockedOnDevice: true,
    requiresCloudOptIn: false,
    reason:
      'Runs live on visited pages to spot contradictions or lower prices vs. your memory; strictly on-device.',
    label: 'Ambient contradiction & price radar',
  },
  decision_matrix: {
    defaultMode: 'prefer_on_device',
    lockedOnDevice: false,
    requiresCloudOptIn: true,
    reason:
      'Small comparisons (<=6 pages) run free on Gemini Nano; larger multi-week clusters escalate facts-only to Cloud Gemini.',
    label: 'Hybrid decision matrix',
  },
};

export function createDefaultSettings(): SettingsRecord {
  return {
    id: 'singleton',
    onboardingCompleted: false,
    demoMode: false,
    exclusions: [...DEFAULT_EXCLUSIONS],
    capturePausedGlobal: false,
    pausedTabIds: [],
    minVisibleSeconds: 20,
    minScrollPercent: 30,
    captureImages: true,
    backfillEnabled: true,
    backfillPaused: false,
    backfillDays: 30,
    backfillDomainDelayMs: 5000,
    backfillMaxParallel: 4,
    cloud: {
      masterEnabled: false,
      cloudAnswers: false,
      cloudExtractionFallback: false,
      cloudDeepSummary: false,
      cloudRecapPolish: false,
      cloudMediaPdf: false,
    },
    seenBeforeEnabled: true,
    seenBeforeThreshold: 0.78,
    seenBeforeDisabledDomains: [],
    changeWatchIntervalHours: 12,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    notificationsEnabled: true,
    weeklyRecapDay: 0, // Sunday
    weeklyRecapHour: 19, // 7 PM
    storageBudgetMb: 1024, // 1 GB default (FR-ST-3)
    autoDeleteDays: 0, // off
    dismissedLoopKinds: [],
    lockEnabled: false,
    syncEnabled: false,
    customSearchPatterns: [],
    anonymousStatsEnabled: false, // off by default (NFR-OB-2)
    theme: 'system',
    updatedAt: Date.now(),
  };
}
