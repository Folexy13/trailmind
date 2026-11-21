import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Cloud,
  Copy,
  Cpu,
  ExternalLink,
  Radar,
  Scale,
  Sparkles,
} from 'lucide-react';
import type { DecisionMatrixResult, RadarAlert } from '@/shared/types';
import {
  decisionMatrixService,
  type DecisionCandidateCluster,
} from '@/features/decisions/decisionMatrixService';
import { memoryRadarService } from '@/features/seenBefore/memoryRadarService';
import { seenBeforeService } from '@/features/seenBefore/seenBeforeService';
import { AiBadge } from './AiBadge';

interface DecisionsPanelProps {
  initialClusterId?: string;
}

/**
 * Hybrid Decision Matrix + Live Ambient Memory Radar Studio:
 *  1. Auto-detects multi-page research clusters and builds cited side-by-side Decision Matrices
 *     (On-Device Gemini Nano for small clusters, Facts-Only Cloud Gemini escalation for large clusters).
 *  2. Lets users & judges test the Ambient Contradiction & Price-vs-Memory Radar on any snippet/price.
 */
export function DecisionsPanel({ initialClusterId }: DecisionsPanelProps) {
  const [candidates, setCandidates] = useState<DecisionCandidateCluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string>(initialClusterId ?? '');
  const [matrix, setMatrix] = useState<DecisionMatrixResult | null>(null);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);

  // Cloud escalation preview confirmation
  const [pendingCloudBrief, setPendingCloudBrief] = useState<{
    clusterId: string;
    clusterName: string;
    itemCount: number;
    estimatedTokens: number;
    previewLines: string[];
  } | null>(null);

  // Ambient Memory Radar tester
  const [radarUrl, setRadarUrl] = useState('');
  const [radarTitle, setRadarTitle] = useState('');
  const [radarText, setRadarText] = useState('');
  const [radarResult, setRadarResult] = useState<RadarAlert | null>(null);
  const [radarStatus, setRadarStatus] = useState('');
  const [checkingRadar, setCheckingRadar] = useState(false);

  useEffect(() => {
    void decisionMatrixService.listDecisionCandidates().then((list) => {
      setCandidates(list);
      if (initialClusterId) {
        setSelectedClusterId(initialClusterId);
        void runBuild(initialClusterId, false);
      } else if (list[0]) {
        setSelectedClusterId(list[0].cluster.id);
      }
    });
  }, [initialClusterId]);

  async function runBuild(clusterId: string, forceCloud: boolean) {
    if (!clusterId) return;
    setBuilding(true);
    setPendingCloudBrief(null);
    try {
      const res = await decisionMatrixService.buildMatrix({ clusterId, forceCloud });
      setMatrix(res);
    } finally {
      setBuilding(false);
    }
  }

  async function requestCloudEscalation(clusterId: string) {
    const brief = await decisionMatrixService.buildClusterFactBrief(clusterId);
    setPendingCloudBrief({
      clusterId,
      clusterName: brief.cluster.name,
      itemCount: brief.items.length,
      estimatedTokens: brief.estimatedTokens,
      previewLines: brief.items
        .slice(0, 6)
        .map((i) => `${i.title}${i.price ? ` (${i.price})` : ''} — ${i.facts[0] ?? i.summary.slice(0, 80)}`),
    });
  }

  async function handleCopyMarkdown() {
    if (!matrix) return;
    const md = decisionMatrixService.renderMatrixMarkdown(matrix);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleTestRadar(e: FormEvent) {
    e.preventDefault();
    setCheckingRadar(true);
    setRadarResult(null);
    setRadarStatus('');
    try {
      const match = await seenBeforeService.checkPage({
        url: radarUrl.trim(),
        title: radarTitle.trim(),
        textSample: radarText.trim(),
      });
      if (match?.radarAlert) {
        setRadarResult(match.radarAlert);
      } else {
        // Also test direct MemoryRadarService with price + facts
        const direct = await memoryRadarService.analyzeLivePage({
          url: radarUrl.trim(),
          title: radarTitle.trim(),
          textSample: radarText.trim(),
          relatedPageIds: match?.relatedPages.map((p) => p.pageId) ?? [],
        });
        if (direct) {
          setRadarResult(direct);
        } else {
          setRadarStatus(
            'No price savings or factual contradiction detected against your current saved memory.',
          );
        }
      }
    } finally {
      setCheckingRadar(false);
    }
  }

  return (
    <div className="space-y-5 text-xs">
      {/* Section 1: Hybrid Decision Matrix */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Scale className="h-4 w-4 text-blue-600" /> Hybrid Decision Matrix
            </h2>
            <p className="mt-0.5 text-slate-500">
              Turns any researched cluster into a cited pros/cons &amp; price matrix from only the
              pages you read. Small clusters run free <strong>On-Device (Gemini Nano)</strong>;
              large multi-week clusters escalate <strong>facts-only</strong> to{' '}
              <strong>Cloud Gemini</strong>.
            </p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-slate-500 dark:border-slate-700">
            Browse 2+ pages in any topic cluster to build a Decision Matrix.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {candidates.slice(0, 6).map((cand) => {
                const selected = selectedClusterId === cand.cluster.id;
                return (
                  <button
                    key={cand.cluster.id}
                    type="button"
                    onClick={() => setSelectedClusterId(cand.cluster.id)}
                    className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/40'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate font-semibold">{cand.cluster.name}</span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          cand.recommendedTier === 'cloud_escalation'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {cand.recommendedTier === 'cloud_escalation' ? (
                          <>
                            <Cloud className="h-2.5 w-2.5" /> Cloud scale
                          </>
                        ) : (
                          <>
                            <Cpu className="h-2.5 w-2.5" /> On-device
                          </>
                        )}
                      </span>
                    </div>
                    <span className="mt-1 text-[11px] text-slate-500">
                      {cand.pageCount} pages · ~{cand.estimatedTokens.toLocaleString()} tokens
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={building || !selectedClusterId}
                onClick={() => void runBuild(selectedClusterId, false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {building ? 'Building matrix…' : 'Build Decision Matrix (Hybrid Auto)'}
              </button>
              <button
                type="button"
                disabled={building || !selectedClusterId}
                onClick={() => void requestCloudEscalation(selectedClusterId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <Cloud className="h-3.5 w-3.5" /> Escalate Full Cluster to Cloud (Facts Only)
              </button>
            </div>
          </>
        )}

        {/* Transparent Cloud Escalation Preview Dialog */}
        {pendingCloudBrief && (
          <div
            role="dialog"
            aria-label="Confirm facts-only cloud decision matrix payload"
            className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-800 dark:bg-amber-950/50"
          >
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              Facts-Only Cloud Escalation Preview — {pendingCloudBrief.clusterName}
            </div>
            <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
              Sending <strong>{pendingCloudBrief.itemCount} distilled option summaries/facts</strong>{' '}
              (~{pendingCloudBrief.estimatedTokens.toLocaleString()} tokens · 0 raw HTML pages · 0
              cookies) via Firebase AI Logic + App Check. Requires Cloud AI enabled in Settings.
            </p>
            <ul className="my-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-4 text-[11px] text-amber-900 dark:text-amber-200">
              {pendingCloudBrief.previewLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCloudBrief(null)}
                className="rounded-lg border border-amber-400 px-3 py-1 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runBuild(pendingCloudBrief.clusterId, true)}
                className="rounded-lg bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
              >
                Synthesize in Cloud Gemini
              </button>
            </div>
          </div>
        )}

        {/* Rendered Decision Matrix */}
        {matrix && (
          <div className="mt-3 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold">{matrix.title}</h3>
                  <AiBadge source={matrix.aiSource} />
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{matrix.summary}</p>
                <p className="mt-1 text-[11px] text-slate-500">{matrix.escalationReason}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyMarkdown()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied!' : 'Copy Markdown'}
              </button>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              <strong>Recommended based on your reading:</strong> {matrix.recommendedOption}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-3">Option</th>
                    <th className="py-2 pr-3">Price / Cost</th>
                    <th className="py-2 pr-3">Pros (from your reading)</th>
                    <th className="py-2 pr-3">Cons / Risks</th>
                    <th className="py-2 pr-3">Verdict</th>
                    <th className="py-2">Sources</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {matrix.options.map((row, idx) => (
                    <tr key={`${row.option}_${idx}`} className="align-top">
                      <td className="py-2.5 pr-3 font-semibold">{row.option}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap font-semibold text-emerald-700 dark:text-emerald-400">
                        {row.priceOrCost}
                      </td>
                      <td className="py-2.5 pr-3">
                        <ul className="list-disc space-y-0.5 pl-3.5">
                          {row.pros.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-400">
                        <ul className="list-disc space-y-0.5 pl-3.5">
                          {row.cons.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-2.5 pr-3">{row.verdict}</td>
                      <td className="py-2.5">
                        <div className="flex flex-col gap-1">
                          {row.sourceUrls.map((src) => (
                            <a
                              key={src.pageId}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="max-w-[120px] truncate">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {matrix.openQuestions.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Open questions before deciding
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600 dark:text-slate-300">
                  {matrix.openQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2: Ambient Contradiction & Price-vs-Memory Radar Live Tester */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Radar className="h-4 w-4 text-emerald-600" /> Ambient Contradiction &amp; Price Radar
              <AiBadge source="on_device" compact />
            </h2>
            <p className="mt-0.5 text-slate-500">
              Runs automatically on every webpage you visit (strictly <code>ONLY_ON_DEVICE</code>).
              Spots lower prices you already saw elsewhere or claims that contradict facts in your
              memory. Test it live right here:
            </p>
          </div>
        </div>

        <form onSubmit={handleTestRadar} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="url"
              value={radarUrl}
              onChange={(e) => setRadarUrl(e.target.value)}
              placeholder="Simulated webpage URL"
              aria-label="Simulated webpage URL"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              value={radarTitle}
              onChange={(e) => setRadarTitle(e.target.value)}
              placeholder="Simulated webpage title"
              aria-label="Simulated webpage title"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <textarea
            rows={2}
            value={radarText}
            onChange={(e) => setRadarText(e.target.value)}
            placeholder="Paste a product price or technical claim to cross-check against your saved memory…"
            aria-label="Simulated page excerpt"
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="submit"
            disabled={checkingRadar}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Radar className="h-3.5 w-3.5" />
            {checkingRadar ? 'Scanning memory on-device…' : 'Check Against My Memory (On-Device)'}
          </button>
        </form>

        {radarResult && (
          <div
            role="status"
            className={`rounded-xl border p-3.5 ${
              radarResult.kind === 'price_better'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="h-4 w-4" /> {radarResult.headline}
              </span>
              <AiBadge source={radarResult.aiSource} compact />
            </div>
            <p className="mt-1">{radarResult.detail}</p>
            <a
              href={radarResult.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-semibold underline"
            >
              <ExternalLink className="h-3 w-3" /> Open remembered source: {radarResult.sourceTitle}
            </a>
          </div>
        )}

        {radarStatus && <p className="text-slate-500">{radarStatus}</p>}
      </section>
    </div>
  );
}
