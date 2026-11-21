import JSZip from 'jszip';
import type { FactRecord, PageRecord } from '@/shared/types';
import { memoryStore, type MemoryStore, type PortableMemoryDump } from '@/core/store/memoryStore';

function slugifyFilename(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  );
}

function yamlEscape(val: string): string {
  return JSON.stringify(val);
}

/**
 * Formats one page into Obsidian-ready Markdown with YAML frontmatter and `[[wiki links]]` (FR-EXP-1, FR-EXP-2).
 */
export function renderPageToObsidianMarkdown(
  page: PageRecord,
  facts: FactRecord[],
  relatedPageTitles: string[],
  snapshotText?: string,
): string {
  const topics = page.englishTopics.length ? page.englishTopics : page.topics;
  const entities = page.entities.map((e) => e.canonicalName);

  const frontmatter = [
    '---',
    `title: ${yamlEscape(page.title)}`,
    `url: ${yamlEscape(page.url)}`,
    `domain: ${yamlEscape(page.domain)}`,
    `type: ${yamlEscape(page.type)}`,
    `status: ${yamlEscape(page.status)}`,
    `first_seen: ${yamlEscape(new Date(page.firstSeen).toISOString())}`,
    `last_seen: ${yamlEscape(new Date(page.lastSeen).toISOString())}`,
    `topics: [${topics.map(yamlEscape).join(', ')}]`,
    `entities: [${entities.map(yamlEscape).join(', ')}]`,
    ...(page.price ? [`price: ${yamlEscape(page.price.raw)}`] : []),
    '---',
  ].join('\n');

  const wikiTopics = topics.map((t) => `[[Topics/${t}|${t}]]`).join(', ');
  const wikiEntities = entities.map((e) => `[[Entities/${e}|${e}]]`).join(', ');
  const wikiRelated = relatedPageTitles.map((t) => `- [[Pages/${t}|${t}]]`).join('\n');

  const highlights = facts.filter((f) => f.highlight);
  const extractedFacts = facts.filter((f) => !f.highlight);

  const sections: string[] = [
    frontmatter,
    '',
    `# ${page.title}`,
    '',
    `> ${page.summary || 'Metadata-only browsing memory entry.'}`,
    '',
    `- **Source:** [${page.domain}](${page.url})`,
    ...(wikiTopics ? [`- **Topics:** ${wikiTopics}`] : []),
    ...(wikiEntities ? [`- **Entities:** ${wikiEntities}`] : []),
  ];

  if (extractedFacts.length > 0) {
    sections.push('', '## Key Facts', ...extractedFacts.map((f) => `- ${f.text}`));
  }

  if (highlights.length > 0) {
    sections.push('', '## Highlights', ...highlights.map((h) => `> ${h.text}`));
  }

  if (wikiRelated) {
    sections.push('', '## Related Memory Pages', wikiRelated);
  }

  if (snapshotText) {
    sections.push('', '## Saved Snapshot Excerpt', '', snapshotText.slice(0, 4000));
  }

  return sections.join('\n') + '\n';
}

/**
 * Export & Import service (FR-EXP-1 to FR-EXP-5):
 *  - Markdown + Obsidian wiki-link ZIP (cluster, journey, or full memory)
 *  - Notion export via user's own Notion integration token
 *  - Full portable JSON export & round-trip import
 */
export class ExportService {
  constructor(private readonly store: MemoryStore = memoryStore) {}

  async exportObsidianZip(scope: {
    kind: 'all' | 'cluster' | 'journey';
    id?: string;
  }): Promise<{ blob: Blob; fileCount: number; filename: string; fileNames: string[] }> {
    const [allPages, allFacts, allClusters, allJourneys] = await Promise.all([
      this.store.listPages(),
      this.store.listAllFacts(),
      this.store.listClusters(),
      this.store.listJourneys(),
    ]);

    let targetPages: PageRecord[] = allPages;
    let exportLabel = 'trailmind-memory';

    if (scope.kind === 'cluster' && scope.id) {
      const cluster = allClusters.find((c) => c.id === scope.id);
      targetPages = allPages.filter((p) => p.clusterId === scope.id);
      exportLabel = `trailmind-cluster-${slugifyFilename(cluster?.name ?? scope.id)}`;
    } else if (scope.kind === 'journey' && scope.id) {
      const journey = allJourneys.find((j) => j.id === scope.id);
      const idSet = new Set(journey?.pageIds ?? []);
      targetPages = allPages.filter((p) => idSet.has(p.id));
      exportLabel = `trailmind-journey-${slugifyFilename(journey?.name ?? scope.id)}`;
    }

    const factsByPage = new Map<string, FactRecord[]>();
    for (const f of allFacts) {
      const list = factsByPage.get(f.pageId) ?? [];
      list.push(f);
      factsByPage.set(f.pageId, list);
    }

    const pagesByCluster = new Map<string, PageRecord[]>();
    for (const p of targetPages) {
      if (!p.clusterId) continue;
      const list = pagesByCluster.get(p.clusterId) ?? [];
      list.push(p);
      pagesByCluster.set(p.clusterId, list);
    }

    const zip = new JSZip();
    const fileNames: string[] = [];
    const topicToPages = new Map<string, string[]>();
    const entityToPages = new Map<string, string[]>();

    for (const page of targetPages) {
      const snapshot = await this.store.getLatestSnapshot(page.id);
      const siblings = (page.clusterId ? (pagesByCluster.get(page.clusterId) ?? []) : [])
        .filter((s) => s.id !== page.id)
        .slice(0, 6)
        .map((s) => s.title);

      const md = renderPageToObsidianMarkdown(
        page,
        factsByPage.get(page.id) ?? [],
        siblings,
        snapshot?.text,
      );
      const filePath = `Pages/${slugifyFilename(page.title)}-${page.id.slice(-4)}.md`;
      zip.file(filePath, md);
      fileNames.push(filePath);

      for (const topic of page.englishTopics.length ? page.englishTopics : page.topics) {
        const list = topicToPages.get(topic) ?? [];
        list.push(page.title);
        topicToPages.set(topic, list);
      }
      for (const ent of page.entities) {
        const list = entityToPages.get(ent.canonicalName) ?? [];
        list.push(page.title);
        entityToPages.set(ent.canonicalName, list);
      }
    }

    // Topic hub notes so Obsidian's Graph View shows topic connections (FR-EXP-2)
    for (const [topic, titles] of topicToPages.entries()) {
      const path = `Topics/${slugifyFilename(topic)}.md`;
      const content = `# ${topic}\n\n## Pages\n${titles.map((t) => `- [[Pages/${t}|${t}]]`).join('\n')}\n`;
      zip.file(path, content);
      fileNames.push(path);
    }

    // Entity hub notes
    for (const [entity, titles] of entityToPages.entries()) {
      const path = `Entities/${slugifyFilename(entity)}.md`;
      const content = `# ${entity}\n\n## Mentioned On\n${titles.map((t) => `- [[Pages/${t}|${t}]]`).join('\n')}\n`;
      zip.file(path, content);
      fileNames.push(path);
    }

    // Index MOC (Map of Content)
    const indexMd =
      `# Trailmind Memory Export\n\nExported on ${new Date().toISOString()}.\n\n` +
      `## Topics (${topicToPages.size})\n` +
      Array.from(topicToPages.keys())
        .map((t) => `- [[Topics/${slugifyFilename(t)}|${t}]]`)
        .join('\n') +
      '\n';
    zip.file('Index.md', indexMd);
    fileNames.push('Index.md');

    const blob = await zip.generateAsync({ type: 'blob' });
    return {
      blob,
      fileCount: fileNames.length,
      filename: `${exportLabel}.zip`,
      fileNames,
    };
  }

  /**
   * Exports selected pages to a user's Notion page via their Notion integration token (FR-EXP-3).
   */
  async exportToNotion(options: {
    token: string;
    parentPageId: string;
    pageIds?: string[];
    fetchImpl?: typeof fetch;
  }): Promise<{ createdCount: number; createdUrls: string[] }> {
    const fetchFn = options.fetchImpl ?? fetch;
    const allPages = await this.store.listPages();
    const targetPages = options.pageIds
      ? allPages.filter((p) => options.pageIds!.includes(p.id))
      : allPages.slice(0, 25);

    const createdUrls: string[] = [];

    for (const page of targetPages) {
      const facts = await this.store.listFactsForPage(page.id);
      const children: Array<Record<string, unknown>> = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: page.summary || page.url, link: { url: page.url } },
              },
            ],
          },
        },
        ...facts.slice(0, 8).map((f) => ({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: f.text.slice(0, 1800) } }],
          },
        })),
      ];

      const res = await fetchFn('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          parent: { page_id: options.parentPageId },
          properties: {
            title: {
              title: [{ text: { content: page.title.slice(0, 200) } }],
            },
          },
          children,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Notion export failed (${res.status}): ${errBody.slice(0, 160)}`);
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) createdUrls.push(data.url);
    }

    return { createdCount: createdUrls.length, createdUrls };
  }

  async exportFullJson(): Promise<string> {
    const dump = await this.store.exportPortableJson();
    return JSON.stringify(dump, null, 2);
  }

  async importFullJson(jsonString: string): Promise<{
    pagesImported: number;
    snapshotsImported: number;
    factsImported: number;
  }> {
    const parsed = JSON.parse(jsonString) as PortableMemoryDump;
    return this.store.importPortableJson(parsed);
  }
}

export const exportService = new ExportService();
