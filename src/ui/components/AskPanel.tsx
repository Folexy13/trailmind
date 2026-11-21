import { useEffect, useState, type FormEvent } from 'react';
import { Calendar, Cloud, ExternalLink, FileText, Search, Send } from 'lucide-react';
import type { AskAnswer, PageRecord } from '@/shared/types';
import { memoryStore } from '@/core/store/memoryStore';
import { askMemoryService } from '@/features/ask/askService';
import {
  timeQuestionsService,
  type DayViewHourSlot,
  type TimeQuestionAnswer,
} from '@/features/timeQuestions/timeQuestionsService';
import { AiBadge } from './AiBadge';

interface AskPanelProps {
  initialQuery?: string;
  onOpenSnapshot: (pageId: string) => void;
}

export function AskPanel({ initialQuery = '', onOpenSnapshot }: AskPanelProps) {
  const [question, setQuestion] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [instantPages, setInstantPages] = useState<PageRecord[]>([]);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [timeAnswer, setTimeAnswer] = useState<TimeQuestionAnswer | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [starterPrompts, setStarterPrompts] = useState<string[]>([
    'What was I reading in the last week?',
    'What did I browse yesterday?',
  ]);

  // Cloud confirmation dialog (FR-ASK-9)
  const [cloudConfirmOpen, setCloudConfirmOpen] = useState(false);

  // Day view hour-by-hour strip (FR-TQ-3)
  const [showDayView, setShowDayView] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [daySlots, setDaySlots] = useState<DayViewHourSlot[]>([]);

  useEffect(() => {
    void (async () => {
      const pages = await memoryStore.listPages();
      // Build tailored starter prompts from the user's actual top sites & topics
      const domainCounts = new Map<string, number>();
      const topicCounts = new Map<string, number>();
      for (const p of pages) {
        if (p.type === 'search_results') continue;
        const cleanDomain = p.domain.replace(/^www\./, '');
        if (cleanDomain) domainCounts.set(cleanDomain, (domainCounts.get(cleanDomain) ?? 0) + 1);
        for (const t of p.englishTopics.length ? p.englishTopics : p.topics) {
          topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
        }
      }
      const topDomains = Array.from(domainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([d]) => d);
      const topTopic = Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

      const tailored: string[] = ['What was I reading in the last week?'];
      if (topTopic) tailored.push(`Summarize what I read about ${topTopic}`);
      if (topDomains[0]) tailored.push(`What did I look at on ${topDomains[0]}?`);
      if (topDomains[1]) tailored.push(`Find pages I visited on ${topDomains[1]}`);
      setStarterPrompts(tailored);
    })();
  }, []);

  useEffect(() => {
    if (showDayView) {
      const [y, m, d] = selectedDay.split('-').map(Number);
      const dateObj = new Date(y || 2026, (m || 1) - 1, d || 1);
      void timeQuestionsService.buildDayView(dateObj).then(setDaySlots);
    }
  }, [showDayView, selectedDay]);

  async function runQuestion(
    q: string,
    options?: { useCloud?: boolean; followUpContext?: { previousQuestion: string; previousAnswer: string } },
  ) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setTimeAnswer(null);

    try {
      const looksLikeTimeQuestion =
        /\b(what was i doing|what did i read|what did i browse|yesterday|last week|last weekend|tuesday|monday|wednesday|thursday|friday|saturday|sunday|in october|in november|hours? ago|this morning)\b/i.test(
          trimmed,
        );

      if (looksLikeTimeQuestion && !options?.followUpContext && !options?.useCloud) {
        const tAns = await timeQuestionsService.answerTimeQuestion(trimmed);
        if (tAns) {
          setTimeAnswer(tAns);
          setInstantPages(tAns.pages);
          setAnswer(null);
          return;
        }
      }

      const res = await askMemoryService.ask({
        question: trimmed,
        useCloud: options?.useCloud,
        followUpContext: options?.followUpContext,
        onInstantPages: (pages) => setInstantPages(pages),
      });
      setAnswer(res);
      setInstantPages(res.instantPages);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery) {
      void runQuestion(initialQuery);
    }
  }, [initialQuery]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runQuestion(question);
  }

  function handleFollowUpSubmit(e: FormEvent) {
    e.preventDefault();
    if (!answer || !followUp.trim()) return;
    const nextQ = followUp.trim();
    setQuestion(nextQ);
    setFollowUp('');
    void runQuestion(nextQ, {
      followUpContext: { previousQuestion: answer.question, previousAnswer: answer.answer },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="Ask your browsing memory"
            placeholder='Ask anything… e.g. "which repo for auth?" or "what was I doing Tuesday?"'
            className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Ask
        </button>
        <button
          type="button"
          onClick={() => setShowDayView((v) => !v)}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
        >
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          Day view
        </button>
      </form>

      {/* Plain-language explainer + tailored starter prompts */}
      {!answer && !timeAnswer && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ask a question about anything you&apos;ve read or searched. Trailmind finds matching
            passages in your local memory, cites the exact source, and answers privately on-device.
          </p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setQuestion(prompt);
                  void runQuestion(prompt);
                }}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600 hover:border-blue-400 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hour-by-hour Day View Strip (FR-TQ-3) */}
      {showDayView && (
        <section
          aria-label="Hour-by-hour day view"
          className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">Day view (hour by hour)</h3>
            <input
              type="date"
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              aria-label="Select date for day view"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
            {daySlots.filter((s) => s.visits.length > 0).length === 0 ? (
              <p className="py-4 text-center text-slate-500">No visits recorded on this date.</p>
            ) : (
              daySlots
                .filter((s) => s.visits.length > 0)
                .map((slot) => (
                  <div key={slot.hour} className="flex items-start gap-3">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-slate-500">
                      {slot.label}
                    </span>
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {slot.visits.map((v) => (
                        <a
                          key={v.visitId}
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: v.clusterColor ?? '#2563eb' }}
                          />
                          <span className="max-w-[180px] truncate">{v.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </section>
      )}

      {/* Time Question Answer (FR-TQ-1, FR-TQ-2) */}
      {timeAnswer && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              Time window: {timeAnswer.window.matchedText} ({timeAnswer.window.label})
            </span>
            <AiBadge source={timeAnswer.aiSource} />
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{timeAnswer.summary}</p>
        </section>
      )}

      {/* Streamed / Cited Answer (FR-ASK-4, FR-ASK-5, FR-ASK-7) */}
      {(loading || answer) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Answer
              </h3>
              {answer && <AiBadge source={answer.aiSource} />}
              {answer && (
                <span className="text-[11px] text-slate-400">
                  {answer.latencyMs} ms · confidence: {answer.confidence}
                </span>
              )}
            </div>

            {answer && (
              <button
                type="button"
                onClick={() => setCloudConfirmOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <Cloud className="h-3 w-3" aria-hidden="true" /> Ask cloud
              </button>
            )}
          </div>

          {loading ? (
            <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
              Synthesizing answer privately on your device…
            </p>
          ) : answer ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900 dark:text-slate-100">
                {answer.answer}
              </p>

              {/* Citations with Text-Fragment jump + Snapshot fallback (FR-ASK-5) */}
              {answer.citations.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500">Cited passages</div>
                  {answer.citations.map((cit, idx) => (
                    <div
                      key={`${cit.pageId}_${idx}`}
                      className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/70"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          [{idx + 1}] {cit.title}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-400">
                          “{cit.excerpt}”
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {cit.status === 'gone' ? (
                          <button
                            type="button"
                            onClick={() => onOpenSnapshot(cit.pageId)}
                            className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white"
                          >
                            <FileText className="h-3 w-3" /> Open snapshot
                          </button>
                        ) : (
                          <>
                            <a
                              href={cit.textFragmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                            >
                              <ExternalLink className="h-3 w-3" /> Jump
                            </a>
                            <button
                              type="button"
                              onClick={() => onOpenSnapshot(cit.pageId)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-white dark:border-slate-700"
                            >
                              Snapshot
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Follow-up single-turn rebuild (FR-ASK-6) */}
              <form onSubmit={handleFollowUpSubmit} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="Ask a follow-up question…"
                  aria-label="Follow-up question"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                >
                  Follow up
                </button>
              </form>
            </>
          ) : null}
        </section>
      )}

      {/* Ask Cloud Transparency Confirmation Dialog (FR-ASK-9) */}
      {cloudConfirmOpen && answer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm cloud question payload"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs dark:border-amber-800 dark:bg-amber-950/60"
        >
          <h4 className="font-semibold text-amber-900 dark:text-amber-200">
            Review exact passages before sending to Cloud Gemini
          </h4>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Only these {answer.retrievedPassages.length} retrieved passages and your question will be
            sent (never your full history). Requires Cloud master switch + Cloud answers enabled in
            Settings.
          </p>
          <ul className="my-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-4 text-[11px] text-amber-900 dark:text-amber-200">
            {answer.retrievedPassages.slice(0, 6).map((p) => (
              <li key={p.chunkId}>
                <strong>{p.title}:</strong> {p.text.slice(0, 100)}…
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCloudConfirmOpen(false)}
              className="rounded-lg border border-amber-400 px-3 py-1.5 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setCloudConfirmOpen(false);
                void runQuestion(answer.question, { useCloud: true });
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
            >
              Send & answer in cloud
            </button>
          </div>
        </div>
      )}

      {/* Instant Matching Pages List (FR-ASK-8) */}
      {instantPages.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-2 text-xs font-semibold text-slate-500">
            Matching pages ({instantPages.length})
          </h3>
          <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
            {instantPages.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {p.title}
                  </a>
                  <span className="text-[11px] text-slate-500">
                    {p.domain} · {new Date(p.lastSeen).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenSnapshot(p.id)}
                  className="shrink-0 rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50 dark:border-slate-700"
                >
                  Snapshot
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
