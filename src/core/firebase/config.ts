import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

export interface FirebaseEnvConfig {
  options: FirebaseOptions;
  appCheckDebugToken?: string;
  recaptchaSiteKey?: string;
  configured: boolean;
}

let cachedApp: FirebaseApp | null = null;
let cachedAppCheck: AppCheck | null = null;

export function getFirebaseEnvConfig(): FirebaseEnvConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const apiKey = env.VITE_FIREBASE_API_KEY ?? '';
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? '';
  const appId = env.VITE_FIREBASE_APP_ID ?? '';

  const configured = Boolean(
    apiKey &&
      projectId &&
      appId &&
      !apiKey.startsWith('your-') &&
      !projectId.startsWith('your-'),
  );

  return {
    options: {
      apiKey: apiKey || 'local-only-placeholder',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: projectId || 'trailmind-local',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
      appId: appId || '1:000000000000:web:local',
    },
    appCheckDebugToken: env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || undefined,
    recaptchaSiteKey: env.VITE_FIREBASE_RECAPTCHA_SITE_KEY || undefined,
    configured,
  };
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseEnvConfig().configured;
}

/**
 * Initializes the singleton Firebase App and enforces Firebase App Check (FR-FB-1, SEC-6).
 * Supports debug tokens for local development and hackathon judge testing.
 * Runs in the offscreen document or extension page — never in the MV3 service worker.
 */
export function ensureFirebaseApp(): { app: FirebaseApp; appCheck: AppCheck | null; configured: boolean } {
  const envConfig = getFirebaseEnvConfig();

  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(envConfig.options);
  }

  if (!cachedAppCheck && envConfig.configured && typeof self !== 'undefined') {
    const globalSelf = self as unknown as Record<string, unknown>;
    if (envConfig.appCheckDebugToken) {
      // Enable Firebase App Check debug provider with explicit judge/dev debug token (FR-FB-1)
      globalSelf.FIREBASE_APPCHECK_DEBUG_TOKEN = envConfig.appCheckDebugToken;
    }

    try {
      if (envConfig.recaptchaSiteKey) {
        cachedAppCheck = initializeAppCheck(cachedApp, {
          provider: new ReCaptchaEnterpriseProvider(envConfig.recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } else if (envConfig.appCheckDebugToken) {
        // In extension origins where reCAPTCHA Enterprise cannot embed, use CustomProvider
        // backed by the configured debug token or Firebase debug endpoint.
        const debugToken = envConfig.appCheckDebugToken;
        cachedAppCheck = initializeAppCheck(cachedApp, {
          provider: new CustomProvider({
            getToken: async () => ({
              token: debugToken,
              expireTimeMillis: Date.now() + 55 * 60 * 1000,
            }),
          }),
          isTokenAutoRefreshEnabled: true,
        });
      }
    } catch (err) {
      console.warn('Trailmind App Check initialization skipped:', err);
    }
  }

  return { app: cachedApp, appCheck: cachedAppCheck, configured: envConfig.configured };
}

export function getAppCheckStatus(): {
  configured: boolean;
  enforced: boolean;
  mode: 'recaptcha_enterprise' | 'debug_token' | 'unconfigured';
} {
  const envConfig = getFirebaseEnvConfig();
  if (!envConfig.configured) {
    return { configured: false, enforced: false, mode: 'unconfigured' };
  }
  if (envConfig.recaptchaSiteKey) {
    return { configured: true, enforced: Boolean(cachedAppCheck), mode: 'recaptcha_enterprise' };
  }
  if (envConfig.appCheckDebugToken) {
    return { configured: true, enforced: Boolean(cachedAppCheck), mode: 'debug_token' };
  }
  return { configured: true, enforced: false, mode: 'unconfigured' };
}
