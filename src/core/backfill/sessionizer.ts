import { SESSION_GAP_MS } from '@/shared/constants';
import type { JourneyBranch, VisitRecord } from '@/shared/types';

export interface RawHistoryVisit {
  visitId: string;
  pageId: string;
  url: string;
  time: number;
  referringVisitId?: string;
  transition: string;
}

export interface BrowsingSession {
  id: string;
  start: number;
  end: number;
  visits: VisitRecord[];
  pageIds: string[];
  entryPageId: string;
  exitPageId: string;
  branches: JourneyBranch[];
}

/**
 * Splits chronological visits into sessions: any gap of 30 minutes or more starts a new session (FR-BF-4).
 * Computes referrer-driven branch points for Journey replay (FR-JR-1).
 */
export function buildSessionsFromVisits(
  rawVisits: RawHistoryVisit[],
  gapMs = SESSION_GAP_MS,
): BrowsingSession[] {
  if (rawVisits.length === 0) return [];

  const sorted = [...rawVisits].sort((a, b) => a.time - b.time);
  const groups: RawHistoryVisit[][] = [];
  let current: RawHistoryVisit[] = [];

  for (const visit of sorted) {
    const prev = current[current.length - 1];
    if (prev && visit.time - prev.time >= gapMs) {
      groups.push(current);
      current = [visit];
    } else {
      current.push(visit);
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, index) => {
    const start = group[0]!.time;
    const end = group[group.length - 1]!.time;
    const sessionId = `ses_${start}_${index}`;

    const visitIdToPageId = new Map<string, string>();
    const visits: VisitRecord[] = group.map((v) => {
      visitIdToPageId.set(v.visitId, v.pageId);
      return {
        id: v.visitId,
        pageId: v.pageId,
        time: v.time,
        activeMs: 0,
        maxScroll: 0,
        referrerVisitId: v.referringVisitId && v.referringVisitId !== '0' ? v.referringVisitId : undefined,
        transition: v.transition || 'link',
        sessionId,
      };
    });

    // Preserve visit order while deduplicating consecutive identical pages
    const orderedPageIds: string[] = [];
    for (const v of visits) {
      if (orderedPageIds[orderedPageIds.length - 1] !== v.pageId) {
        orderedPageIds.push(v.pageId);
      }
    }

    // Build branch map: any page whose visit spawned >= 2 distinct child pages
    const childrenByParent = new Map<string, Set<string>>();
    for (const v of visits) {
      if (!v.referrerVisitId) continue;
      const parentPageId = visitIdToPageId.get(v.referrerVisitId);
      if (!parentPageId || parentPageId === v.pageId) continue;
      const set = childrenByParent.get(parentPageId) ?? new Set<string>();
      set.add(v.pageId);
      childrenByParent.set(parentPageId, set);
    }

    const branches: JourneyBranch[] = [];
    for (const [fromPageId, toSet] of childrenByParent.entries()) {
      if (toSet.size >= 2) {
        branches.push({ fromPageId, toPageIds: Array.from(toSet) });
      }
    }

    return {
      id: sessionId,
      start,
      end,
      visits,
      pageIds: orderedPageIds,
      entryPageId: orderedPageIds[0]!,
      exitPageId: orderedPageIds[orderedPageIds.length - 1]!,
      branches,
    };
  });
}
