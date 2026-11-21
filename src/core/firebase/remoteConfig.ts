import {
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
  type RemoteConfig,
} from 'firebase/remote-config';
import { DEFAULT_PROMPT_VERSION, HYBRID_ROUTING_TABLE } from '@/shared/constants';
import type { AiJobKind, HybridMode, RemoteConfigValues } from '@/shared/types';
import { ensureFirebaseApp } from './config';

/**
 * Bundled Remote Config defaults so Trailmind works offline and on first run (FR-FB-2, FR-FB-3, FR-FB-4).
 */
export const BUNDLED_REMOTE_CONFIG_DEFAULTS: Record<string, string | number | boolean> = {
  cloud_kill_switch: false,
  cloud_model_name: 'gemini-3.5-flash-lite',
  mode_page_extraction: 'only_on_device',
  mode_sensitive_detection: 'only_on_device',
  mode_cluster_naming: 'prefer_on_device',
  mode_ask_memory: 'prefer_on_device',
  mode_loop_journey_summary: 'prefer_on_device',
  mode_change_watch_diff: 'prefer_on_device',
  mode_image_understanding: 'prefer_on_device',
  mode_heavy_media_pdf: 'prefer_in_cloud',
  mode_deep_summary: 'prefer_in_cloud',
  mode_weekly_recap: 'prefer_on_device',
  mode_memory_radar: 'only_on_device',
  mode_decision_matrix: 'prefer_on_device',
  seen_before_threshold: 0.78,
  backfill_domain_delay_ms: 5000,
  backfill_max_parallel: 4,
  change_watch_interval_hours: 12,
  cloud_daily_quota_per_user: 50,
  prompt_schema_version: DEFAULT_PROMPT_VERSION,
  prompt_templates_json: '{}',
};

const VALID_MODES: ReadonlySet<string> = new Set([
  'only_on_device',
  'prefer_on_device',
  'prefer_in_cloud',
  'only_in_cloud',
]);

function coerceMode(job: AiJobKind, raw: string): HybridMode {
  // Enforce privacy invariant: page_extraction and sensitive_detection can NEVER be routed to cloud via Remote Config.
  if (HYBRID_ROUTING_TABLE[job].lockedOnDevice) {
    return 'only_on_device';
  }
  if (VALID_MODES.has(raw)) {
    return raw as HybridMode;
  }
  return HYBRID_ROUTING_TABLE[job].defaultMode;
}

export function getBundledRemoteConfigValues(): RemoteConfigValues {
  const modes = {} as Record<AiJobKind, HybridMode>;
  for (const job of Object.keys(HYBRID_ROUTING_TABLE) as AiJobKind[]) {
    const key = `mode_${job}`;
    modes[job] = coerceMode(job, String(BUNDLED_REMOTE_CONFIG_DEFAULTS[key] ?? ''));
  }
  return {
    cloudKillSwitch: Boolean(BUNDLED_REMOTE_CONFIG_DEFAULTS.cloud_kill_switch),
    cloudModelName: String(BUNDLED_REMOTE_CONFIG_DEFAULTS.cloud_model_name),
    modes,
    seenBeforeThreshold: Number(BUNDLED_REMOTE_CONFIG_DEFAULTS.seen_before_threshold),
    backfillDomainDelayMs: Number(BUNDLED_REMOTE_CONFIG_DEFAULTS.backfill_domain_delay_ms),
    backfillMaxParallel: Number(BUNDLED_REMOTE_CONFIG_DEFAULTS.backfill_max_parallel),
    changeWatchIntervalHours: Number(BUNDLED_REMOTE_CONFIG_DEFAULTS.change_watch_interval_hours),
    cloudDailyQuotaPerUser: Number(BUNDLED_REMOTE_CONFIG_DEFAULTS.cloud_daily_quota_per_user),
    promptSchemaVersion: String(BUNDLED_REMOTE_CONFIG_DEFAULTS.prompt_schema_version),
    promptTemplates: {},
    source: 'default',
  };
}

export class RemoteConfigService {
  private rc: RemoteConfig | null = null;
  private cached: RemoteConfigValues = getBundledRemoteConfigValues();

  async init(fetchNow = true): Promise<RemoteConfigValues> {
    const { app, configured } = ensureFirebaseApp();
    if (!configured || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      this.cached = getBundledRemoteConfigValues();
      return this.cached;
    }

    try {
      if (!this.rc) {
        this.rc = getRemoteConfig(app);
        this.rc.settings = {
          minimumFetchIntervalMillis: 5 * 60 * 1000,
          fetchTimeoutMillis: 10_000,
        };
        this.rc.defaultConfig = BUNDLED_REMOTE_CONFIG_DEFAULTS;
      }

      if (fetchNow) {
        const activated = await fetchAndActivate(this.rc);
        this.cached = this.readSnapshot(activated ? 'remote' : 'cache');
      } else {
        this.cached = this.readSnapshot('default');
      }
    } catch {
      // Offline or unconfigured: silently stay on bundled defaults (FR-FB-3)
      this.cached = getBundledRemoteConfigValues();
    }

    return this.cached;
  }

  private readSnapshot(source: 'default' | 'remote' | 'cache'): RemoteConfigValues {
    if (!this.rc) return getBundledRemoteConfigValues();

    const modes = {} as Record<AiJobKind, HybridMode>;
    for (const job of Object.keys(HYBRID_ROUTING_TABLE) as AiJobKind[]) {
      modes[job] = coerceMode(job, getString(this.rc, `mode_${job}`));
    }

    let promptTemplates: Record<string, string> = {};
    try {
      const parsed = JSON.parse(getString(this.rc, 'prompt_templates_json') || '{}');
      if (parsed && typeof parsed === 'object') {
        promptTemplates = parsed as Record<string, string>;
      }
    } catch {
      promptTemplates = {};
    }

    return {
      cloudKillSwitch: getBoolean(this.rc, 'cloud_kill_switch'),
      cloudModelName: getString(this.rc, 'cloud_model_name') || 'gemini-3.5-flash-lite',
      modes,
      seenBeforeThreshold: getNumber(this.rc, 'seen_before_threshold') || 0.78,
      backfillDomainDelayMs: getNumber(this.rc, 'backfill_domain_delay_ms') || 5000,
      backfillMaxParallel: getNumber(this.rc, 'backfill_max_parallel') || 4,
      changeWatchIntervalHours: getNumber(this.rc, 'change_watch_interval_hours') || 12,
      cloudDailyQuotaPerUser: getNumber(this.rc, 'cloud_daily_quota_per_user') || 50,
      promptSchemaVersion:
        getString(this.rc, 'prompt_schema_version') || DEFAULT_PROMPT_VERSION,
      promptTemplates,
      source,
      lastFetchedAt: Date.now(),
    };
  }

  getValues(): RemoteConfigValues {
    return this.cached;
  }

  setValuesForTesting(overrides: Partial<RemoteConfigValues>): void {
    this.cached = {
      ...this.cached,
      ...overrides,
      modes: { ...this.cached.modes, ...(overrides.modes ?? {}) },
    };
  }
}

export const remoteConfigService = new RemoteConfigService();
