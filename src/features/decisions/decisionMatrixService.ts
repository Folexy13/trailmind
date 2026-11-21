import type {
  ClusterRecord,
  DecisionMatrixResult,
  DecisionOptionRow,
  PageRecord,
} from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { estimateTokens } from '@/core/ai/prompts';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const ON_DEVICE_PAGE_LIMIT = 6;
const ON_DEVICE_TOKEN_LIMIT = 4500;

export interface DecisionCandidateCluster {
  cluster: ClusterRecord;
  pageCount: number;
  factCount: number;
  estimatedTokens: number;
  recommendedTier: 'on_device' | 'cloud_escalation';
  reason: string;
}

/**
 * Hybrid Decision Matrix Engine:
 * Automatically detects decision-worthy clusters (>=3 researched pages) and builds a cited,
 * side-by-side decision matrix from ONLY what the user actually read.
 *
 * Signature Hybrid AI Split:
 *  - <= 6 pages and <= 4,500 tokens of facts -> runs 100% On-Device on Gemini Nano ($0 cost).
 *  - > 6 pages or > 4,500 tokens (or explicit escalation) -> escalates EXTRACTED FACTS ONLY
 *    (0 raw pages) to Cloud Gemini via Firebase AI Logic + App Check!
 */
export class DecisionMatrixService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  async listDecisionCandidates(): Promise<DecisionCandidateCluster[]> {
    const [clusters, pages, facts] = await Promise.all([
      this.store.listClusters(),
      this.store.listPages(),
      this.store.listAllFacts(),
    ]);

    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const factCountByPage = new Map<string, number>();
    for (const f of facts) {
      factCountByPage.set(f.pageId, (factCountByPage.get(f.pageId) ?? 0) + 1);
    }

    const candidates: DecisionCandidateCluster[] = [];
    for (const cluster of clusters) {
      if (cluster.hidden) continue;
      const clusterPages = cluster.pageIds
        .map((id) => pageMap.get(id))
        .filter((p): p is PageRecord => p !== undefined && p.type !== 'search_results');
      if (clusterPages.length < 2) continue;

      let factCount = 0;
      let charSum = 0;
      for (const p of clusterPages) {
        const fc = factCountByPage.get(p.id) ?? 0;
        factCount += fc;
        charSum += p.title.length + p.summary.length + fc * 110;
      }
      const estimatedTokens = Math.max(150, Math.ceil(charSum / 4));
      const needsCloud =
        clusterPages.length > ON_DEVICE_PAGE_LIMIT || estimatedTokens > ON_DEVICE_TOKEN_LIMIT;

      candidates.push({
        cluster,
        pageCount: clusterPages.length,
        factCount,
        estimatedTokens,
        recommendedTier: needsCloud ? 'cloud_escalation' : 'on_device',
        reason: needsCloud
          ? `${clusterPages.length} pages (~${estimatedTokens.toLocaleString()} tokens) — ideal for facts-only Cloud Gemini synthesis`
          : `${clusterPages.length} pages (~${estimatedTokens.toLocaleString()} tokens) — fits cleanly on-device in Gemini Nano`,
      });
    }

    return candidates.sort((a, b) => b.pageCount - a.pageCount);
  }

  /**
   * Builds a transparent preview of the exact facts that will be sent before running cloud escalation.
   */
  async buildClusterFactBrief(clusterId: string): Promise<{
    cluster: ClusterRecord;
    items: Array<{
      pageId: string;
      title: string;
      domain: string;
      url: string;
      price?: string;
      summary: string;
      facts: string[];
    }>;
    estimatedTokens: number;
    exceedsOnDeviceBudget: boolean;
  }> {
    const [cluster, pages, allFacts] = await Promise.all([
      this.store.db.clusters.get(clusterId),
      this.store.listPages(),
      this.store.listAllFacts(),
    ]);
    if (!cluster) {
      throw new Error(`Cluster "${clusterId}" not found.`);
    }

    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const factsByPage = new Map<string, string[]>();
    for (const f of allFacts) {
      const arr = factsByPage.get(f.pageId) ?? [];
      arr.push(f.text);
      factsByPage.set(f.pageId, arr);
    }

    const items = cluster.pageIds
      .map((id) => pageMap.get(id))
      .filter((p): p is PageRecord => p !== undefined && p.type !== 'search_results')
      .slice(0, 24)
      .map((p) => ({
        pageId: p.id,
        title: p.title,
        domain: p.domain,
        url: p.url,
        price: p.price?.raw,
        summary: p.summary || p.title,
        facts: (factsByPage.get(p.id) ?? []).slice(0, 5),
      }));

    const totalText = items
      .map((i) => `${i.title} ${i.summary} ${i.facts.join(' ')}`)
      .join('\n');
    const estimatedTokens = estimateTokens(totalText);
    const exceedsOnDeviceBudget =
      items.length > ON_DEVICE_PAGE_LIMIT || estimatedTokens > ON_DEVICE_TOKEN_LIMIT;

    return { cluster, items, estimatedTokens, exceedsOnDeviceBudget };
  }

  async buildMatrix(options: {
    clusterId: string;
    forceCloud?: boolean;
  }): Promise<DecisionMatrixResult> {
    const brief = await this.buildClusterFactBrief(options.clusterId);
    const settings = await this.store.getSettings();
    const pageById = new Map(brief.items.map((i) => [i.pageId, i]));

    const cloudEnabled =
      settings.cloud.masterEnabled &&
      (settings.cloud.cloudDeepSummary || settings.cloud.cloudAnswers);
    const shouldEscalate = Boolean(
      cloudEnabled && (options.forceCloud || brief.exceedsOnDeviceBudget),
    );

    const escalationReason = shouldEscalate
      ? `Escalated ${brief.items.length} options (~${brief.estimatedTokens.toLocaleString()} tokens of extracted facts only, 0 raw pages) to Cloud Gemini via Firebase AI Logic + App Check.`
      : brief.exceedsOnDeviceBudget && !cloudEnabled
        ? `Ran privately on-device over top ${Math.min(brief.items.length, 6)} options (enable Cloud AI in Settings to escalate all ${brief.items.length} options).`
        : `Ran 100% privately on-device with Gemini Nano (${brief.items.length} options, ~${brief.estimatedTokens.toLocaleString()} tokens, $0 cloud cost).`;

    const aiItems = shouldEscalate ? brief.items : brief.items.slice(0, ON_DEVICE_PAGE_LIMIT);
    const totalFacts = aiItems.reduce((s, i) => s + Math.max(1, i.facts.length), 0);

    try {
      const res = await this.ai.generateDecisionMatrix({
        clusterName: brief.cluster.name,
        items: aiItems,
        escalateToCloud: shouldEscalate,
      });

      const mappedOptions: DecisionOptionRow[] = res.data.options.map((opt) => {
        const sources = opt.source_page_ids
          .map((pid) => pageById.get(pid))
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .map((x) => ({ pageId: x.pageId, title: x.title, url: x.url }));

        return {
          option: opt.option,
          priceOrCost: opt.price_or_cost || '—',
          pros: opt.pros,
          cons: opt.cons,
          verdict: opt.verdict,
          sourcePageIds: opt.source_page_ids,
          sourceUrls: sources,
        };
      });

      return {
        clusterId: brief.cluster.id,
        clusterName: brief.cluster.name,
        title: res.data.title,
        summary: res.data.summary,
        recommendedOption: res.data.recommended_option,
        options: mappedOptions,
        openQuestions: res.data.open_questions,
        aiSource: res.ranOn,
        escalatedToCloud: res.ranOn === 'cloud',
        escalationReason,
        factsAnalyzed: totalFacts,
        pagesAnalyzed: aiItems.length,
        estimatedTokens: brief.estimatedTokens,
        cloudPayloadPreview: res.cloudPayloadPreview,
        generatedAt: Date.now(),
      };
    } catch {
      // Deterministic extractive matrix fallback when Nano is unavailable and cloud is off
      const fallbackOptions: DecisionOptionRow[] = aiItems.slice(0, 6).map((item) => ({
        option: item.title.slice(0, 64),
        priceOrCost: item.price ?? '—',
        pros: item.facts.length > 0 ? item.facts.slice(0, 2) : [item.summary.slice(0, 110)],
        cons: ['Compare details on source page'],
        verdict: `Researched on ${item.domain}`,
        sourcePageIds: [item.pageId],
        sourceUrls: [{ pageId: item.pageId, title: item.title, url: item.url }],
      }));

      return {
        clusterId: brief.cluster.id,
        clusterName: brief.cluster.name,
        title: `${brief.cluster.name} — Decision Matrix`,
        summary: `Structured comparison built locally from ${aiItems.length} pages you visited in "${brief.cluster.name}".`,
        recommendedOption: fallbackOptions[0]?.option ?? brief.cluster.name,
        options: fallbackOptions,
        openQuestions: [
          'Which constraint matters most right now: price, setup speed, or long-term maintenance?',
        ],
        aiSource: 'on_device',
        escalatedToCloud: false,
        escalationReason,
        factsAnalyzed: totalFacts,
        pagesAnalyzed: aiItems.length,
        estimatedTokens: brief.estimatedTokens,
        generatedAt: Date.now(),
      };
    }
  }

  /**
   * Renders a DecisionMatrixResult as clean GitHub-Flavored Markdown for one-click copy/export.
   */
  renderMatrixMarkdown(matrix: DecisionMatrixResult): string {
    const header = [
      `# ${matrix.title}`,
      '',
      `> ${matrix.summary}`,
      '',
      `**Recommended:** ${matrix.recommendedOption}  `,
      `**Computed on:** ${matrix.aiSource === 'cloud' ? 'Cloud · Gemini (Facts Only)' : 'On Device · Gemini Nano'}`,
      '',
      '| Option | Price / Cost | Pros (from your reading) | Cons / Risks | Verdict |',
      '| --- | --- | --- | --- | --- |',
    ];

    const rows = matrix.options.map(
      (opt) =>
        `| ${opt.option.replace(/\|/g, '/')} | ${opt.priceOrCost} | ${opt.pros.join('; ').replace(/\|/g, '/')} | ${opt.cons.join('; ').replace(/\|/g, '/')} | ${opt.verdict.replace(/\|/g, '/')} |`,
    );

    const footer =
      matrix.openQuestions.length > 0
        ? ['', '## Open Questions', ...matrix.openQuestions.map((q) => `- ${q}`)]
        : [];

    return [...header, ...rows, ...footer].join('\n') + '\n';
  }
}

export const decisionMatrixService = new DecisionMatrixService();
