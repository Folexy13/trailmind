import * as chrono from 'chrono-node';
import type { AiSource, ClusterRecord, JourneyRecord, PageRecord, VisitRecord } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

export interface ParsedTimeWindow {
  startMs: number;
  endMs: number;
  matchedText: string;
  label: string;
}

export interface DayViewHourSlot {
  hour: number;
  label: string;
  visits: Array<{
    visitId: string;
    pageId: string;
    title: string;
    domain: string;
    url: string;
    time: number;
    activeMinutes: number;
    clusterColor?: string;
  }>;
}

export interface TimeQuestionAnswer {
  window: ParsedTimeWindow;
  summary: string;
  aiSource: AiSource;
  pages: PageRecord[];
  journeys: JourneyRecord[];
  clusters: ClusterRecord[];
  topFacts: string[];
}

/**
 * Parses natural-language time expressions in the user's local timezone (FR-TQ-1).
 * Handles: "Tuesday afternoon", "last weekend", "in October", "2 hours ago",
 * "yesterday morning", "last week", "this morning", "last month", etc.
 */
export function parseTimeExpression(
  input: string,
  referenceDate = new Date(),
): ParsedTimeWindow | null {
  const lower = input.toLowerCase();

  // Explicit helper for "last weekend" (Saturday 00:00 -> Sunday 23:59:59 of previous weekend)
  if (/\blast\s+weekend\b/.test(lower)) {
    const d = new Date(referenceDate);
    const day = d.getDay(); // 0=Sun..6=Sat
    const daysBackToSunday = day === 0 ? 7 : day;
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - daysBackToSunday);
    sunday.setHours(23, 59, 59, 999);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() - 1);
    saturday.setHours(0, 0, 0, 0);
    return {
      startMs: saturday.getTime(),
      endMs: sunday.getTime(),
      matchedText: 'last weekend',
      label: `${saturday.toLocaleDateString()} – ${sunday.toLocaleDateString()}`,
    };
  }

  // Explicit helper for "last week"
  if (/\blast\s+week\b/.test(lower)) {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    return {
      startMs: start.getTime(),
      endMs: end.getTime(),
      matchedText: 'last week',
      label: `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`,
    };
  }

  // Explicit helper for "last month"
  if (/\blast\s+month\b/.test(lower)) {
    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0, 23, 59, 59, 999);
    return {
      startMs: start.getTime(),
      endMs: end.getTime(),
      matchedText: 'last month',
      label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }

  // Explicit helper for "in <Month>" (e.g. "in October")
  const monthMatch = lower.match(
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i,
  );
  if (monthMatch?.[1]) {
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ];
    const monthIdx = months.indexOf(monthMatch[1].toLowerCase());
    let year = monthMatch[2] ? Number.parseInt(monthMatch[2], 10) : referenceDate.getFullYear();
    if (!monthMatch[2] && monthIdx > referenceDate.getMonth()) {
      year -= 1;
    }
    const start = new Date(year, monthIdx, 1, 0, 0, 0, 0);
    const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
    return {
      startMs: start.getTime(),
      endMs: end.getTime(),
      matchedText: monthMatch[0],
      label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }

  // General parsing via chrono-node
  const results = chrono.parse(input, referenceDate, { forwardDate: false });
  const first = results[0];
  if (!first) return null;

  const startDate = first.start.date();
  let startMs = startDate.getTime();
  let endMs: number;

  if (first.end) {
    endMs = first.end.date().getTime();
  } else {
    const matched = first.text.toLowerCase();
    if (/\bmorning\b/.test(matched)) {
      const s = new Date(startDate);
      s.setHours(6, 0, 0, 0);
      const e = new Date(startDate);
      e.setHours(12, 0, 0, 0);
      startMs = s.getTime();
      endMs = e.getTime();
    } else if (/\bafternoon\b/.test(matched)) {
      const s = new Date(startDate);
      s.setHours(12, 0, 0, 0);
      const e = new Date(startDate);
      e.setHours(18, 0, 0, 0);
      startMs = s.getTime();
      endMs = e.getTime();
    } else if (/\bevening\b|\bnight\b/.test(matched)) {
      const s = new Date(startDate);
      s.setHours(18, 0, 0, 0);
      const e = new Date(startDate);
      e.setHours(23, 59, 59, 999);
      startMs = s.getTime();
      endMs = e.getTime();
    } else if (/\bago\b/.test(matched)) {
      // Relative lookback ("2 hours ago", "30 minutes ago") -> window around that point up to now
      endMs = referenceDate.getTime();
    } else if (first.start.isCertain('hour')) {
      endMs = startMs + 60 * 60 * 1000;
    } else {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(startDate);
      e.setHours(23, 59, 59, 999);
      startMs = s.getTime();
      endMs = e.getTime();
    }
  }

  return {
    startMs,
    endMs,
    matchedText: first.text,
    label: `${new Date(startMs).toLocaleString()} – ${new Date(endMs).toLocaleString()}`,
  };
}

/**
 * Time Questions & Hour-by-Hour Day View service (FR-TQ-1 to FR-TQ-3).
 */
export class TimeQuestionsService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  async answerTimeQuestion(
    question: string,
    referenceDate = new Date(),
  ): Promise<TimeQuestionAnswer | null> {
    const window = parseTimeExpression(question, referenceDate);
    if (!window) return null;

    const [visits, allPages, allJourneys, allClusters, allFacts] = await Promise.all([
      this.store.listVisitsInRange(window.startMs, window.endMs),
      this.store.listPages(),
      this.store.listJourneys(),
      this.store.listClusters(),
      this.store.listAllFacts(),
    ]);

    const visitedPageIds = new Set(visits.map((v) => v.pageId));
    const pages = allPages.filter(
      (p) =>
        visitedPageIds.has(p.id) ||
        (p.lastSeen >= window.startMs && p.lastSeen <= window.endMs),
    );
    const pageIdSet = new Set(pages.map((p) => p.id));

    const journeys = allJourneys.filter(
      (j) => j.end >= window.startMs && j.start <= window.endMs,
    );
    const clusterIds = new Set(pages.map((p) => p.clusterId).filter(Boolean));
    const clusters = allClusters.filter((c) => clusterIds.has(c.id));
    const topFacts = allFacts
      .filter((f) => pageIdSet.has(f.pageId))
      .slice(0, 12)
      .map((f) => f.text);

    if (pages.length === 0) {
      return {
        window,
        summary: `No recorded browsing activity found for ${window.matchedText}.`,
        aiSource: 'on_device',
        pages: [],
        journeys: [],
        clusters: [],
        topFacts: [],
      };
    }

    try {
      const passages = pages.slice(0, 8).map((p) => ({
        pageId: p.id,
        chunkId: `time_${p.id}`,
        title: p.title,
        domain: p.domain,
        text: `${p.summary || p.title}. Topics: ${p.englishTopics.join(', ')}`,
      }));
      const res = await this.ai.askMemory({
        question: `Summarize what I was reading and working on during "${window.matchedText}" (${question}). Mention the main topics and sites.`,
        passages,
      });
      return {
        window,
        summary: res.data.answer,
        aiSource: res.ranOn,
        pages,
        journeys,
        clusters,
        topFacts,
      };
    } catch {
      const clusterNames = clusters.map((c) => c.name).slice(0, 3).join(', ');
      return {
        window,
        summary: `During ${window.matchedText}, you visited ${pages.length} page${pages.length === 1 ? '' : 's'}${clusterNames ? ` across ${clusterNames}` : ''}. Top pages: ${pages
          .slice(0, 3)
          .map((p) => p.title)
          .join('; ')}.`,
        aiSource: 'on_device',
        pages,
        journeys,
        clusters,
        topFacts,
      };
    }
  }

  /**
   * Builds an hour-by-hour "Day view" strip for any selected calendar date (FR-TQ-3).
   */
  async buildDayView(date: Date): Promise<DayViewHourSlot[]> {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    const [visits, pages, clusters] = await Promise.all([
      this.store.listVisitsInRange(start.getTime(), end.getTime()),
      this.store.listPages(),
      this.store.listClusters(),
    ]);

    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const clusterColorMap = new Map(clusters.map((c) => [c.id, c.color]));

    const slots: DayViewHourSlot[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      visits: [],
    }));

    const sortedVisits: VisitRecord[] = [...visits].sort((a, b) => a.time - b.time);
    for (const v of sortedVisits) {
      const page = pageMap.get(v.pageId);
      if (!page) continue;
      const hour = new Date(v.time).getHours();
      slots[hour]?.visits.push({
        visitId: v.id,
        pageId: page.id,
        title: page.title,
        domain: page.domain,
        url: page.url,
        time: v.time,
        activeMinutes: Math.max(1, Math.round(v.activeMs / 60000)),
        clusterColor: page.clusterId ? clusterColorMap.get(page.clusterId) : undefined,
      });
    }

    return slots;
  }
}

export const timeQuestionsService = new TimeQuestionsService();
