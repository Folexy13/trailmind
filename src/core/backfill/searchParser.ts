import { DEFAULT_SEARCH_PATTERNS } from '@/shared/constants';
import type { CustomSearchPattern } from '@/shared/types';

export interface ParsedSearchQuery {
  engine: string;
  query: string;
  normalizedQuery: string;
}

/**
 * Extracts search queries from URLs of Google, Bing, DuckDuckGo, YouTube, GitHub,
 * Stack Overflow, Amazon, Jumia, plus any user-defined custom patterns (FR-BF-3).
 */
export function parseSearchQueryFromUrl(
  rawUrl: string,
  customPatterns: CustomSearchPattern[] = [],
): ParsedSearchQuery | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const patterns = [...DEFAULT_SEARCH_PATTERNS, ...customPatterns];

  for (const rule of patterns) {
    const hostNeedle = rule.hostPattern.toLowerCase();
    if (!host.includes(hostNeedle)) continue;

    // Avoid false positives on non-search pages for multi-purpose hosts like GitHub/Amazon/YouTube
    if (
      rule.id === 'github' &&
      !pathname.startsWith('/search') &&
      !parsed.searchParams.has(rule.queryParam)
    ) {
      continue;
    }
    if (rule.id === 'youtube' && !pathname.startsWith('/results')) {
      continue;
    }
    if (rule.id === 'amazon' && !pathname.startsWith('/s')) {
      continue;
    }
    if (rule.id === 'stackoverflow' && !pathname.startsWith('/search')) {
      continue;
    }
    if (rule.id === 'jumia' && !pathname.includes('catalog')) {
      continue;
    }

    const rawQuery = parsed.searchParams.get(rule.queryParam)?.trim();
    if (!rawQuery) continue;

    return {
      engine: rule.name,
      query: rawQuery,
      normalizedQuery: rawQuery.toLowerCase().replace(/\s+/g, ' '),
    };
  }

  return null;
}
