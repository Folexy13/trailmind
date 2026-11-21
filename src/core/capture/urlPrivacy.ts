const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'si',
  // Volatile search-engine session & layout params that duplicate the same query URL
  'sca_esv',
  'ei',
  'ved',
  'oq',
  'gs_lcrp',
  'sclient',
  'sourceid',
  'aqs',
  'rlz',
  'bih',
  'biw',
  'dpr',
  'uact',
  'sxsrf',
  'sa',
  'pc',
  'form',
  'cvid',
  'client',
  'ie',
  'oe',
  'udm',
]);

const BLOCKED_PROTOCOLS = new Set([
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'devtools:',
  'file:',
  'view-source:',
  'data:',
  'blob:',
  'javascript:',
]);

export function isRecordableUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (BLOCKED_PROTOCOLS.has(parsed.protocol)) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Normalizes a URL for deduplication (strips tracking query params and fragments).
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    const toDelete: string[] = [];
    parsed.searchParams.forEach((_v, k) => {
      if (TRACKING_PARAMS.has(k.toLowerCase())) {
        toDelete.push(k);
      }
    });
    for (const k of toDelete) {
      parsed.searchParams.delete(k);
    }
    parsed.searchParams.sort();
    // Normalize trailing slash on non-root paths
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Matches a hostname or URL against a list of exclusion rules with wildcard support (FR-PRV-1).
 * Supports patterns like "*.bank.com", "mail.google.com", "example.com/*".
 */
export function isDomainExcluded(rawUrlOrDomain: string, exclusions: string[]): boolean {
  const domain = rawUrlOrDomain.includes('://')
    ? extractDomain(rawUrlOrDomain)
    : rawUrlOrDomain.toLowerCase().trim();
  if (!domain) return true;

  for (const rawPattern of exclusions) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) continue;

    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      if (domain === base || domain.endsWith(`.${base}`)) {
        return true;
      }
    } else if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${escaped}$`, 'i').test(domain)) {
        return true;
      }
    } else if (domain === pattern || domain === `www.${pattern}` || `www.${domain}` === pattern) {
      return true;
    }
  }

  return false;
}

const SENSITIVE_URL_PATTERNS: Array<{ pattern: RegExp; category: 'login' | 'payment' | 'medical' | 'adult' | 'banking' }> = [
  { pattern: /\/(login|signin|sign-in|auth|oauth|sso|forgot-password|reset-password|2fa|mfa)\b/i, category: 'login' },
  { pattern: /\/(checkout|payment|billing|card-details|pay-now|wire-transfer)\b/i, category: 'payment' },
  { pattern: /\/(lab-results|medical-record|patient-portal|prescription|my-health)\b/i, category: 'medical' },
  { pattern: /\b(pornhub|xvideos|xnxx|onlyfans|chaturbate|redtube|xhamster)\b/i, category: 'adult' },
  { pattern: /\b(onlinebanking|internetbanking|ebanking|netbanking|ibanking)\b/i, category: 'banking' },
];

const SENSITIVE_TITLE_PATTERNS: Array<{ pattern: RegExp; category: 'login' | 'payment' | 'medical' | 'adult' | 'banking' }> = [
  { pattern: /\b(sign in|log in|two-factor|verify your identity|enter password|reset password)\b/i, category: 'login' },
  { pattern: /\b(credit card|payment details|complete purchase|order confirmation|billing address)\b/i, category: 'payment' },
  { pattern: /\b(lab results|test results|blood test|patient portal|medical history|diagnosis report)\b/i, category: 'medical' },
  { pattern: /\b(account balance|checking account|savings account|wire transfer|statement)\b/i, category: 'banking' },
];

export interface SensitiveCheckResult {
  sensitive: boolean;
  category: 'none' | 'login' | 'payment' | 'medical' | 'adult' | 'banking';
  reason: string;
  needsModelConfirmation: boolean;
}

/**
 * Fast, deterministic local sensitive-page check (FR-PRV-6).
 * Runs before any content is stored and never reads form input values.
 */
export function evaluateSensitiveHeuristics(input: {
  url: string;
  title: string;
  signals?: {
    hasPasswordField?: boolean;
    hasPaymentField?: boolean;
    looksLikeLogin?: boolean;
    looksLikeMedical?: boolean;
    looksLikeAdult?: boolean;
  };
}): SensitiveCheckResult {
  if (input.signals?.hasPasswordField || input.signals?.looksLikeLogin) {
    return {
      sensitive: true,
      category: 'login',
      reason: 'Page contains password/login authentication form.',
      needsModelConfirmation: false,
    };
  }
  if (input.signals?.hasPaymentField) {
    return {
      sensitive: true,
      category: 'payment',
      reason: 'Page contains payment card input fields.',
      needsModelConfirmation: false,
    };
  }
  if (input.signals?.looksLikeMedical) {
    return {
      sensitive: true,
      category: 'medical',
      reason: 'Page appears to contain personal medical information.',
      needsModelConfirmation: true,
    };
  }
  if (input.signals?.looksLikeAdult) {
    return {
      sensitive: true,
      category: 'adult',
      reason: 'Page flagged as adult content.',
      needsModelConfirmation: false,
    };
  }

  for (const rule of SENSITIVE_URL_PATTERNS) {
    if (rule.pattern.test(input.url)) {
      return {
        sensitive: true,
        category: rule.category,
        reason: `URL matches sensitive ${rule.category} pattern.`,
        needsModelConfirmation: false,
      };
    }
  }

  for (const rule of SENSITIVE_TITLE_PATTERNS) {
    if (rule.pattern.test(input.title)) {
      return {
        sensitive: true,
        category: rule.category,
        reason: `Page title matches sensitive ${rule.category} pattern.`,
        needsModelConfirmation: true,
      };
    }
  }

  return {
    sensitive: false,
    category: 'none',
    reason: '',
    needsModelConfirmation: false,
  };
}
