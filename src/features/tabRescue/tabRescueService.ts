import { DEFAULT_PROMPT_VERSION } from '@/shared/constants';
import type {
  JourneyRecord,
  PageRecord,
  TabRescueItem,
  TabRescueOutcome,
  TabRescuePlan,
  VisitRecord,
} from '@/shared/types';
import { pageIdFromCanonicalUrl } from '@/core/capture/pageIngestion';
import {
  canonicalizeUrl,
  extractDomain,
  isDomainExcluded,
  isRecordableUrl,
} from '@/core/capture/urlPrivacy';
import { graphEngine, type GraphEngine } from '@/core/graph/graphEngine';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const AVG_RAM_MB_PER_TAB = 75;

export interface OpenTabInput {
  id: number;
  url: string;
  title?: string;
  pinned?: boolean;
  active?: boolean;
  incognito?: boolean;
}

function groupLabelForDomain(domain: string): string {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  const base = clean.split('.')[0] ?? clean;
  const known: Record<string, string> = {
    github: 'GitHub',
    youtube: 'YouTube',
    google: 'Google Search',
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    stackoverflow: 'Stack Overflow',
    linkedin: 'LinkedIn',
    upwork: 'Upwork',
    devpost: 'Devpost',
    firebase: 'Firebase',
    medium: 'Medium',
    reddit: 'Reddit',
    amazon: 'Amazon',
    jumia: 'Jumia',
  };
  return known[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));
}

/**
 * Tab Graveyard Rescue (1-Click Smart Tab Triage):
 * Scans open browser tabs, spots duplicates and already-saved pages, groups them by topic/site,
 * archives every rescued tab into encrypted IndexedDB + resumable Journeys, and closes them safely.
 */
export class TabRescueService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly graph: GraphEngine = graphEngine,
  ) {}

  async buildRescuePlanFromTabs(openTabs: OpenTabInput[]): Promise<TabRescuePlan> {
    const [settings, existingPages, existingClusters] = await Promise.all([
      this.store.getSettings(),
      this.store.listPages(),
      this.store.listClusters(),
    ]);

    const existingByCanonical = new Map(existingPages.map((p) => [p.canonicalUrl, p]));
    const clusterById = new Map(existingClusters.map((c) => [c.id, c.name]));

    const seenCanonicals = new Set<string>();
    const rescuableTabs: TabRescueItem[] = [];

    for (const tab of openTabs) {
      if (tab.incognito) continue;
      if (!tab.url || !isRecordableUrl(tab.url)) continue;
      const domain = extractDomain(tab.url);
      if (isDomainExcluded(domain, settings.exclusions)) continue;

      const canonicalUrl = canonicalizeUrl(tab.url);
      const isDuplicate = seenCanonicals.has(canonicalUrl);
      seenCanonicals.add(canonicalUrl);

      const savedPage = existingByCanonical.get(canonicalUrl);
      const alreadyInMemory = Boolean(savedPage);
      const clusterLabel =
        (savedPage?.clusterId && clusterById.get(savedPage.clusterId)) ||
        groupLabelForDomain(domain);

      rescuableTabs.push({
        tabId: tab.id,
        url: tab.url,
        canonicalUrl,
        title: tab.title?.trim() || domain,
        domain,
        clusterLabel,
        isDuplicate,
        alreadyInMemory,
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
      });
    }

    const groupsMap = new Map<string, TabRescueItem[]>();
    for (const item of rescuableTabs) {
      const arr = groupsMap.get(item.clusterLabel) ?? [];
      arr.push(item);
      groupsMap.set(item.clusterLabel, arr);
    }

    const groups = Array.from(groupsMap.entries())
      .map(([label, tabs]) => ({
        label,
        tabIds: tabs.map((t) => t.tabId),
        tabs,
      }))
      .sort((a, b) => b.tabs.length - a.tabs.length);

    const closeableCount = rescuableTabs.filter((t) => !t.pinned && !t.active).length;

    return {
      totalOpenTabs: openTabs.length,
      rescuableTabs,
      duplicateCount: rescuableTabs.filter((t) => t.isDuplicate).length,
      alreadySavedCount: rescuableTabs.filter((t) => t.alreadyInMemory).length,
      estimatedRamMb: closeableCount * AVG_RAM_MB_PER_TAB,
      groups,
    };
  }

  async scanCurrentChromeWindow(): Promise<TabRescuePlan> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const inputs: OpenTabInput[] = tabs
      .filter((t): t is chrome.tabs.Tab & { id: number; url: string } => typeof t.id === 'number' && Boolean(t.url))
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        pinned: t.pinned,
        active: t.active,
        incognito: t.incognito,
      }));
    return this.buildRescuePlanFromTabs(inputs);
  }

  /**
   * Archives the selected tabs into encrypted IndexedDB + creates resumable Journeys per group,
   * then optionally closes those tabs to reclaim RAM.
   */
  async executeRescue(
    selectedTabs: TabRescueItem[],
    options: { closeTabs: boolean; closeTabFn?: (tabIds: number[]) => Promise<void> },
  ): Promise<TabRescueOutcome> {
    if (selectedTabs.length === 0) {
      return {
        archivedCount: 0,
        closedCount: 0,
        journeysCreated: 0,
        estimatedRamFreedMb: 0,
        journeyIds: [],
      };
    }

    const now = Date.now();
    const groupsMap = new Map<string, TabRescueItem[]>();
    for (const tab of selectedTabs) {
      const list = groupsMap.get(tab.clusterLabel) ?? [];
      list.push(tab);
      groupsMap.set(tab.clusterLabel, list);
    }

    const archivedPages: PageRecord[] = [];
    const archivedVisits: VisitRecord[] = [];
    const createdJourneys: JourneyRecord[] = [];

    for (const [label, groupTabs] of groupsMap.entries()) {
      const uniquePageIds: string[] = [];
      const sessionId = `ses_rescue_${now}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

      for (const tab of groupTabs) {
        const pageId = await pageIdFromCanonicalUrl(tab.canonicalUrl);
        if (!uniquePageIds.includes(pageId)) uniquePageIds.push(pageId);

        const existing = await this.store.getPage(pageId);
        if (!existing) {
          archivedPages.push({
            id: pageId,
            url: tab.url,
            canonicalUrl: tab.canonicalUrl,
            domain: tab.domain,
            title: tab.title,
            type: 'other',
            summary: `Archived from open tab (${label}) via Tab Graveyard Rescue.`,
            language: 'en',
            topics: [label],
            englishTopics: [label],
            entities: [],
            firstSeen: now,
            lastSeen: now,
            status: 'metadata_only',
            promptVersion: DEFAULT_PROMPT_VERSION,
            updatedAt: now,
          });
        } else {
          archivedPages.push({ ...existing, lastSeen: now, updatedAt: now });
        }

        archivedVisits.push({
          id: `vis_rescue_${crypto.randomUUID().slice(0, 10)}`,
          pageId,
          time: now,
          activeMs: 15_000,
          maxScroll: 0,
          transition: 'tab_rescue',
          sessionId,
        });
      }

      if (uniquePageIds.length > 0) {
        const journey: JourneyRecord = {
          id: `jrn_rescue_${now}_${crypto.randomUUID().slice(0, 6)}`,
          start: now,
          end: now,
          entryPageId: uniquePageIds[0]!,
          exitPageId: uniquePageIds[uniquePageIds.length - 1]!,
          pageIds: uniquePageIds,
          branches: [],
          name: `Rescued: ${label} (${uniquePageIds.length} tabs)`,
          outcome: `Safely archived ${groupTabs.length} open tab${groupTabs.length === 1 ? '' : 's'} from ${label}. Click Resume anytime to reopen them as a Chrome Tab Group.`,
          state: 'pinned',
          linkedJourneyIds: [],
          aiSource: 'on_device',
          updatedAt: now,
        };
        createdJourneys.push(journey);
      }
    }

    if (archivedPages.length > 0) {
      await this.store.putPagesBulk(archivedPages);
    }
    if (archivedVisits.length > 0) {
      await this.store.putVisitsBulk(archivedVisits);
    }
    if (createdJourneys.length > 0) {
      await this.store.putJourneys(createdJourneys);
    }

    await this.graph.rebuildGraphAndClusters({ nameWithAi: false });

    let closedCount = 0;
    if (options.closeTabs) {
      const idsToClose = selectedTabs
        .filter((t) => !t.pinned && !t.active)
        .map((t) => t.tabId);
      if (idsToClose.length > 0) {
        if (options.closeTabFn) {
          await options.closeTabFn(idsToClose);
        } else if (typeof chrome !== 'undefined' && chrome.tabs?.remove) {
          await chrome.tabs.remove(idsToClose);
        }
        closedCount = idsToClose.length;
      }
    }

    return {
      archivedCount: selectedTabs.length,
      closedCount,
      journeysCreated: createdJourneys.length,
      estimatedRamFreedMb: closedCount * AVG_RAM_MB_PER_TAB,
      journeyIds: createdJourneys.map((j) => j.id),
    };
  }
}

export const tabRescueService = new TabRescueService();
