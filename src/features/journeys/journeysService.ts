import type { JourneyRecord, PageRecord } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { parseSearchQueryFromUrl } from '@/core/backfill/searchParser';
import { buildSessionsFromVisits } from '@/core/backfill/sessionizer';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Journeys feature (FR-JR-1 to FR-JR-6):
 * Builds one journey per browsing session with branch points, generates 2-sentence outcome summaries on-device,
 * links multi-day journeys in the same cluster within 7 days, and resumes journeys in Chrome tab groups.
 */
export class JourneysService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  async rebuildJourneys(options?: { summarizeWithAi?: boolean }): Promise<JourneyRecord[]> {
    const [visits, pages, existingJourneys, settings] = await Promise.all([
      this.store.listAllVisits(),
      this.store.listPages(),
      this.store.listJourneys(),
      this.store.getSettings(),
    ]);

    const pageMap = new Map<string, PageRecord>(pages.map((p) => [p.id, p]));
    const existingById = new Map<string, JourneyRecord>(existingJourneys.map((j) => [j.id, j]));

    const rawVisits = visits
      .filter((v) => pageMap.has(v.pageId))
      .map((v) => ({
        visitId: v.id,
        pageId: v.pageId,
        url: pageMap.get(v.pageId)!.url,
        time: v.time,
        referringVisitId: v.referrerVisitId,
        transition: v.transition,
      }));

    const sessions = buildSessionsFromVisits(rawVisits);
    const journeys: JourneyRecord[] = [];

    for (const session of sessions) {
      if (session.pageIds.length === 0) continue;
      const sessionPages = session.pageIds
        .map((pid) => pageMap.get(pid))
        .filter((p): p is PageRecord => Boolean(p));
      if (sessionPages.length === 0) continue;

      // Determine dominant cluster for multi-day linking (FR-JR-5)
      const clusterCounts = new Map<string, number>();
      for (const p of sessionPages) {
        if (!p.clusterId) continue;
        clusterCounts.set(p.clusterId, (clusterCounts.get(p.clusterId) ?? 0) + 1);
      }
      const dominantClusterId = Array.from(clusterCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

      // Check if entry page is a search query
      const firstPage = sessionPages[0]!;
      const lastPage = sessionPages[sessionPages.length - 1]!;
      const parsedSearch = parseSearchQueryFromUrl(firstPage.url, settings.customSearchPatterns);
      const entryQuery = parsedSearch?.query;

      const journeyId = `jrn_${session.start}_${session.entryPageId}`;
      const prev = existingById.get(journeyId);

      let name =
        prev?.name ||
        (entryQuery
          ? entryQuery.slice(0, 50)
          : firstPage.englishTopics[0] || firstPage.title.slice(0, 50));
      let outcome =
        prev?.outcome ||
        `${entryQuery ? `Searched "${entryQuery}", ` : ''}visited ${sessionPages.length} page${sessionPages.length === 1 ? '' : 's'} across ${new Set(sessionPages.map((p) => p.domain)).size} site${new Set(sessionPages.map((p) => p.domain)).size === 1 ? '' : 's'}, and ended on ${lastPage.title}.`;
      let aiSource = prev?.aiSource;

      if (options?.summarizeWithAi && !prev?.outcome && sessionPages.length >= 2) {
        try {
          const res = await this.ai.summarizeJourney({
            entryQuery,
            pageTitles: sessionPages.map((p) => p.title),
            domains: sessionPages.map((p) => p.domain),
          });
          name = res.data.name;
          outcome = res.data.outcome;
          aiSource = res.ranOn;
        } catch {
          // Keep deterministic summary
        }
      }

      journeys.push({
        id: journeyId,
        start: session.start,
        end: session.end,
        entryPageId: session.entryPageId,
        exitPageId: session.exitPageId,
        entryQuery,
        pageIds: session.pageIds.slice(0, 60),
        branches: session.branches,
        name,
        outcome,
        state: prev?.state ?? 'active',
        clusterId: dominantClusterId,
        linkedJourneyIds: [],
        aiSource,
        updatedAt: Date.now(),
      });
    }

    // Link journeys continuing the same task across days (same cluster, within 7 days: FR-JR-5)
    for (let i = 0; i < journeys.length; i++) {
      const a = journeys[i]!;
      if (!a.clusterId) continue;
      for (let j = i + 1; j < journeys.length; j++) {
        const b = journeys[j]!;
        if (b.clusterId !== a.clusterId) continue;
        const gap = Math.abs(b.start - a.end);
        if (gap <= SEVEN_DAYS_MS) {
          a.linkedJourneyIds.push(b.id);
          b.linkedJourneyIds.push(a.id);
        }
      }
    }

    if (journeys.length > 0) {
      await this.store.putJourneys(journeys);
      await this.store.putNodes(
        journeys.map((j) => ({
          id: `journey:${j.id}`,
          kind: 'journey',
          label: j.name,
          clusterId: j.clusterId,
          weight: Math.min(5, 1 + j.pageIds.length * 0.3),
          refId: j.id,
          firstSeen: j.start,
          lastSeen: j.end,
        })),
      );
    }

    return journeys.sort((a, b) => b.end - a.end);
  }

  async setJourneyState(journeyId: string, state: JourneyRecord['state']): Promise<void> {
    await this.store.db.journeys.update(journeyId, { state, updatedAt: Date.now() });
  }

  /**
   * Reopens the last N tabs of a journey inside a named Chrome tab group (FR-JR-4).
   */
  async resumeJourneyInTabGroup(
    journeyId: string,
    maxTabs = 6,
  ): Promise<{ groupId: number | null; openedCount: number }> {
    const journey = await this.store.db.journeys.get(journeyId);
    if (!journey) return { groupId: null, openedCount: 0 };

    const targetPageIds = journey.pageIds.slice(-maxTabs);
    const urls: string[] = [];
    for (const pid of targetPageIds) {
      const page = await this.store.getPage(pid);
      if (page?.url) urls.push(page.url);
    }
    if (urls.length === 0) return { groupId: null, openedCount: 0 };

    const createdTabIds: number[] = [];
    for (let i = 0; i < urls.length; i++) {
      const tab = await chrome.tabs.create({ url: urls[i], active: i === urls.length - 1 });
      if (typeof tab.id === 'number') createdTabIds.push(tab.id);
    }

    let groupId: number | null = null;
    if (createdTabIds.length > 0 && chrome.tabs?.group) {
      groupId = await chrome.tabs.group({ tabIds: createdTabIds as [number, ...number[]] });
      if (chrome.tabGroups?.update) {
        await chrome.tabGroups.update(groupId, {
          title: journey.name.slice(0, 28),
          color: 'blue',
        });
      }
    }

    return { groupId, openedCount: createdTabIds.length };
  }
}

export const journeysService = new JourneysService();
