import type { EntityKind, ExtractedEntity } from '@/shared/types';

/**
 * Curated alias dictionary for common technology, org, and product names (FR-EX-5).
 */
const ENTITY_ALIASES: Record<string, string> = {
  'google firebase': 'Firebase',
  'firebase ai': 'Firebase AI Logic',
  'vertex ai for firebase': 'Firebase AI Logic',
  'firebase vertex ai': 'Firebase AI Logic',
  'google chrome': 'Chrome',
  'chrome browser': 'Chrome',
  'gemini nano 4': 'Gemini Nano',
  'chrome gemini nano': 'Gemini Nano',
  'react.js': 'React',
  'reactjs': 'React',
  'next.js': 'Next.js',
  'nextjs': 'Next.js',
  'node.js': 'Node.js',
  'nodejs': 'Node.js',
  'typescript': 'TypeScript',
  'ts': 'TypeScript',
  'javascript': 'JavaScript',
  'js': 'JavaScript',
  'postgres': 'PostgreSQL',
  'postgresql': 'PostgreSQL',
  'github.com': 'GitHub',
  'stack overflow': 'Stack Overflow',
  'stackoverflow': 'Stack Overflow',
  'tailwindcss': 'Tailwind CSS',
  'tailwind': 'Tailwind CSS',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'supabase': 'Supabase',
  'apple macbook': 'MacBook',
  'macbook pro': 'MacBook Pro',
  'macbook air': 'MacBook Air',
  'thinkpad': 'ThinkPad',
  'lenovo thinkpad': 'ThinkPad',
  'vs code': 'VS Code',
  'visual studio code': 'VS Code',
};

function simpleSingularize(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies') && !word.endsWith('series')) {
    return `${word.slice(0, -3)}y`;
  }
  if (
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    !word.endsWith('us') &&
    !word.endsWith('is') &&
    !word.endsWith('js')
  ) {
    return word.slice(0, -1);
  }
  return word;
}

export function canonicalizeEntityName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^[@#]/, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return '';

  const lower = cleaned.toLowerCase();
  if (ENTITY_ALIASES[lower]) {
    return ENTITY_ALIASES[lower]!;
  }

  // Strip common vendor prefixes when the remainder is a known alias ("Google Firebase" -> "Firebase")
  const stripped = lower.replace(/^(google|microsoft|meta|amazon|apache|mozilla)\s+/, '');
  if (ENTITY_ALIASES[stripped]) {
    return ENTITY_ALIASES[stripped]!;
  }

  // Handle simple plural forms for single-word entities
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    const singular = simpleSingularize(lower);
    if (ENTITY_ALIASES[singular]) return ENTITY_ALIASES[singular]!;
    if (singular !== lower && cleaned === lower) {
      return singular.charAt(0).toUpperCase() + singular.slice(1);
    }
  }

  return cleaned;
}

export function entityKey(canonicalName: string): string {
  return canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalizes and deduplicates extracted entities across case, aliases, and simple plurals (FR-EX-5).
 */
export function normalizeEntities(
  rawEntities: Array<{ name: string; kind: EntityKind }>,
): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();

  for (const item of rawEntities) {
    const canonicalName = canonicalizeEntityName(item.name);
    if (!canonicalName) continue;
    const key = entityKey(canonicalName);
    if (!key) continue;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        name: canonicalName,
        canonicalName,
        kind: item.kind,
      });
    } else if (existing.kind === 'other' && item.kind !== 'other') {
      seen.set(key, { ...existing, kind: item.kind });
    }
  }

  return Array.from(seen.values());
}
