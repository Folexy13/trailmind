import type { RecapRecord, WeeklyRecapStats } from '@/shared/types';
import { trailmindAI, type TrailmindAI } from '@/core/ai/hybridAi';
import { memoryStore, type MemoryStore } from '@/core/store/memoryStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getIsoWeekLabel(date = new Date()): string {
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${temp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Weekly Recap feature (FR-WR-1 to FR-WR-5):
 * Aggregates top 3 topics, newly discovered tools/entities, time by cluster, completed journeys,
 * open loops, and change-watch alerts. Generates narrative on-device, with optional cloud polish
 * that sends ONLY aggregated stats (zero page text or URLs).
 */
export class WeeklyRecapService {
  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly ai: TrailmindAI = trailmindAI,
  ) {}

  async buildWeeklyStats(endDateMs = Date.now()): Promise<{
    startDate: number;
    endDate: number;
    stats: WeeklyRecapStats;
  }> {
    const startDate = endDateMs - SEVEN_DAYS_MS;
    const [pages, visits, clusters, journeys, loops, watches] = await Promise.all([
      this.store.listPages(),
      this.store.listVisitsInRange(startDate, endDateMs),
      this.store.listClusters(),
      this.store.listJourneys(),
      this.store.listLoops(),
      this.store.listWatches(),
    ]);

    const visitedPageIds = new Set(visits.map((v) => v.pageId));
    const weekPages = pages.filter(
      (p) => visitedPageIds.has(p.id) || (p.lastSeen >= startDate && p.lastSeen <= endDateMs),
    );
    const priorPages = pages.filter((p) => p.firstSeen < startDate);

    // Top 3 topics
    const topicCounts = new Map<string, number>();
    for (const p of weekPages) {
      for (const topic of p.englishTopics.length ? p.englishTopics : p.topics) {
        const clean = topic.trim();
        if (!clean) continue;
        topicCounts.set(clean, (topicCounts.get(clean) ?? 0) + 1);
      }
    }
    const topTopics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, count]) => ({ topic, count }));

    // New tools/entities discovered this week
    const oldEntitySet = new Set<string>();
    for (const p of priorPages) {
      for (const e of p.entities) {
        oldEntitySet.add(e.canonicalName.toLowerCase());
      }
    }
    const newEntitiesMap = new Map<string, { name: string; kind: (typeof weekPages)[number]['entities'][number]['kind'] }>();
    for (const p of weekPages) {
      for (const e of p.entities) {
        const key = e.canonicalName.toLowerCase();
        if (!oldEntitySet.has(key) && !newEntitiesMap.has(key)) {
          newEntitiesMap.set(key, { name: e.canonicalName, kind: e.kind });
        }
      }
    }
    const newEntities = Array.from(newEntitiesMap.values()).slice(0, 8);

    // Time spent by cluster
    const clusterMap = new Map(clusters.map((c) => [c.id, c]));
    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const minutesByCluster = new Map<string, number>();
    let totalActiveMs = 0;

    for (const v of visits) {
      const ms = Math.max(30_000, v.activeMs || 60_000);
      totalActiveMs += ms;
      const page = pageMap.get(v.pageId);
      const cid = page?.clusterId ?? 'uncategorized';
      minutesByCluster.set(cid, (minutesByCluster.get(cid) ?? 0) + ms / 60_000);
    }

    const timeByCluster = Array.from(minutesByCluster.entries())
      .map(([clusterId, mins]) => {
        const c = clusterMap.get(clusterId);
        return {
          clusterId,
          clusterName: c?.name ?? 'General Reading',
          minutes: Math.max(1, Math.round(mins)),
          color: c?.color ?? '#64748b',
        };
      })
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6);

    const journeysCompleted = journeys.filter(
      (j) => j.end >= startDate && j.end <= endDateMs,
    ).length;
    const openLoopsCount = loops.filter((l) => l.state === 'open').length;
    const changesDetected = watches.reduce(
      (sum, w) =>
        sum + w.changes.filter((c) => c.detectedAt >= startDate && c.detectedAt <= endDateMs).length,
      0,
    );

    return {
      startDate,
      endDate: endDateMs,
      stats: {
        pagesRead: weekPages.length,
        totalActiveMinutes: Math.max(1, Math.round(totalActiveMs / 60_000)),
        topTopics,
        newEntities,
        timeByCluster,
        journeysCompleted,
        openLoopsCount,
        changesDetected,
      },
    };
  }

  /**
   * Generates and persists a weekly recap (FR-WR-1, FR-WR-2).
   * Notice `statsJson` contains zero page URLs or raw page text — safe for optional cloud polish.
   */
  async generateRecap(options?: {
    endDateMs?: number;
    polishWithCloud?: boolean;
  }): Promise<RecapRecord> {
    const endDateMs = options?.endDateMs ?? Date.now();
    const week = getIsoWeekLabel(new Date(endDateMs));
    const { startDate, endDate, stats } = await this.buildWeeklyStats(endDateMs);

    const statsPayloadForAi = JSON.stringify({
      week,
      pagesRead: stats.pagesRead,
      totalActiveMinutes: stats.totalActiveMinutes,
      topTopics: stats.topTopics,
      newEntities: stats.newEntities.map((e) => e.name),
      timeByCluster: stats.timeByCluster.map((c) => ({
        topic: c.clusterName,
        minutes: c.minutes,
      })),
      journeysCompleted: stats.journeysCompleted,
      openLoopsCount: stats.openLoopsCount,
      changesDetected: stats.changesDetected,
    });

    let text: string;
    let aiSource: RecapRecord['aiSource'] = 'on_device';

    try {
      const res = await this.ai.generateWeeklyRecap({
        statsJson: statsPayloadForAi,
        polishWithCloud: options?.polishWithCloud,
      });
      text = `${res.data.headline}\n\n${res.data.narrative}\n\n${res.data.highlights.map((h) => `• ${h}`).join('\n')}`;
      aiSource = res.ranOn;
    } catch {
      const topTopicText =
        stats.topTopics.map((t) => `${t.topic} (${t.count})`).join(', ') || 'general browsing';
      const newEntText =
        stats.newEntities.slice(0, 4).map((e) => e.name).join(', ') || 'no new entities yet';
      text =
        `Week ${week} Browsing Recap\n\n` +
        `You explored ${stats.pagesRead} pages across ${stats.totalActiveMinutes} active minutes, focusing most on ${topTopicText}. ` +
        `New discoveries included ${newEntText}. ` +
        `You logged ${stats.journeysCompleted} research journeys, have ${stats.openLoopsCount} open loops waiting, and detected ${stats.changesDetected} watched page changes.`;
    }

    const recap: RecapRecord = {
      id: `recap_${week}`,
      week,
      startDate,
      endDate,
      stats,
      text,
      aiSource,
      createdAt: Date.now(),
    };

    await this.store.putRecap(recap);
    return recap;
  }

  /**
   * Renders a privacy-safe PNG share card (1200x630) with ZERO page URLs (FR-WR-5).
   */
  renderShareCardDataUrl(recap: RecapRecord): string | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 1200, 630);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1200, 630);

    // Header
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('TRAILMIND · WEEKLY MEMORY RECAP', 64, 78);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText(`Week ${recap.week}`, 64, 140);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(
      `${recap.stats.pagesRead} pages read · ${recap.stats.totalActiveMinutes} active min · ${recap.stats.journeysCompleted} journeys`,
      64,
      184,
    );

    // Top topics bars (no URLs!)
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('Top Focus Areas', 64, 260);

    const maxMins = Math.max(1, ...recap.stats.timeByCluster.map((c) => c.minutes));
    recap.stats.timeByCluster.slice(0, 4).forEach((item, idx) => {
      const y = 308 + idx * 58;
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(item.clusterName.slice(0, 26), 64, y);

      const barX = 380;
      const barW = Math.max(24, Math.round((item.minutes / maxMins) * 620));
      ctx.fillStyle = item.color || '#2563eb';
      ctx.fillRect(barX, y - 20, barW, 24);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(`${item.minutes}m`, barX + barW + 14, y - 1);
    });

    // Footer privacy pledge
    ctx.fillStyle = '#64748b';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(
      'Generated privately on-device · Zero URLs included · Trailmind',
      64,
      584,
    );

    return canvas.toDataURL('image/png');
  }
}

export const weeklyRecapService = new WeeklyRecapService();
