import type { ExtensionMessage } from '@/shared/types';
import {
  checkDeviceAiReadiness,
  trailmindAI,
  triggerDeviceModelDownload,
} from '@/core/ai/hybridAi';
import { backfillService } from '@/core/backfill/historyImporter';
import { pageIngestionService } from '@/core/capture/pageIngestion';
import { ensureFirebaseApp } from '@/core/firebase/config';
import { remoteConfigService } from '@/core/firebase/remoteConfig';
import { graphEngine } from '@/core/graph/graphEngine';
import { memoryStore } from '@/core/store/memoryStore';
import { askMemoryService } from '@/features/ask/askService';
import { changeWatchService } from '@/features/changeWatch/changeWatchService';
import { decisionMatrixService } from '@/features/decisions/decisionMatrixService';
import { journeysService } from '@/features/journeys/journeysService';
import { openLoopsService } from '@/features/loops/openLoopsService';
import { weeklyRecapService } from '@/features/recap/weeklyRecapService';
import { seenBeforeService } from '@/features/seenBefore/seenBeforeService';

let initialized = false;
let queueProcessing = false;

async function ensureReady(): Promise<void> {
  if (initialized) return;
  await memoryStore.init();
  ensureFirebaseApp();
  await remoteConfigService.init(true);
  initialized = true;
}

/**
 * Processes queued persistent jobs from IndexedDB (live extractions first, then idle backfill fetches).
 * Survives service worker and browser restarts (NFR-RL-1, FR-EX-3).
 */
async function processNextQueuedJob(): Promise<{ processed: boolean; jobKind?: string }> {
  if (queueProcessing) return { processed: false };
  queueProcessing = true;
  try {
    await ensureReady();
    if (trailmindAI.isBackpressured()) {
      return { processed: false };
    }

    const job = await memoryStore.getNextQueuedJob();
    if (!job) return { processed: false };

    await memoryStore.updateJob(job.id, { state: 'running', attempts: job.attempts + 1 });

    try {
      if (job.kind === 'extract_page') {
        const ok = await pageIngestionService.extractAndEmbedPage(
          job.payloadRef,
          job.priority < 50,
        );
        await memoryStore.updateJob(job.id, { state: ok ? 'done' : 'failed' });
        await graphEngine.rebuildGraphAndClusters({ nameWithAi: false });
        await openLoopsService.refreshOpenLoops();
      } else if (job.kind === 'backfill_fetch') {
        const outcome = await backfillService.fetchAndEnrichSinglePage(job.payloadRef);
        if (outcome === 'rate_limited' || outcome === 'paused') {
          // Put back into queue for next tick
          await memoryStore.updateJob(job.id, { state: 'queued' });
        } else {
          await memoryStore.updateJob(job.id, { state: 'done' });
        }
      } else if (job.kind === 'recluster') {
        await graphEngine.rebuildGraphAndClusters({ nameWithAi: true });
        await journeysService.rebuildJourneys({ summarizeWithAi: true });
        await openLoopsService.refreshOpenLoops();
        await memoryStore.updateJob(job.id, { state: 'done' });
      } else if (job.kind === 'check_watch') {
        await changeWatchService.checkWatch(job.payloadRef);
        await memoryStore.updateJob(job.id, { state: 'done' });
      } else if (job.kind === 'weekly_recap') {
        await weeklyRecapService.generateRecap();
        await memoryStore.updateJob(job.id, { state: 'done' });
      }
      return { processed: true, jobKind: job.kind };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Job execution error';
      const nextState = job.attempts + 1 >= 3 ? 'failed' : 'queued';
      await memoryStore.updateJob(job.id, { state: nextState, error: msg });
      return { processed: true, jobKind: job.kind };
    }
  } finally {
    queueProcessing = false;
  }
}

async function handleOffscreenMessage(message: ExtensionMessage & { target?: string; senderTabId?: number; incognito?: boolean }): Promise<unknown> {
  await ensureReady();

  switch (message.type) {
    case 'CAPTURE_PAGE': {
      const outcome = await pageIngestionService.ingestLiveCapture(message.payload, {
        incognito: message.incognito,
        tabId: message.senderTabId,
        extractNow: false,
      });
      if (outcome.recorded) {
        void processNextQueuedJob();
      }
      return outcome;
    }

    case 'CAPTURE_HIGHLIGHT': {
      const fact = await pageIngestionService.captureHighlight(message.payload);
      return { ok: true, fact };
    }

    case 'CHECK_SEEN_BEFORE': {
      return seenBeforeService.checkPage(message.payload);
    }

    case 'ASK_MEMORY': {
      return askMemoryService.ask({
        question: message.payload.question,
        useCloud: message.payload.useCloud,
        followUpContext: message.payload.followUpContext,
      });
    }

    case 'USER_ACTIVITY': {
      trailmindAI.setActivitySignals({
        typing: message.payload.typing,
        videoPlaying: message.payload.videoPlaying,
      });
      return { ok: true };
    }

    case 'PAUSE_BACKFILL': {
      backfillService.setPaused(message.payload.paused);
      await memoryStore.saveSettings({ backfillPaused: message.payload.paused });
      return backfillService.getProgress();
    }

    case 'GET_BACKFILL_PROGRESS': {
      return backfillService.getProgress();
    }

    case 'CHECK_DEVICE_AI': {
      return checkDeviceAiReadiness();
    }

    case 'INITIALIZE_DEVICE_AI': {
      await triggerDeviceModelDownload();
      return checkDeviceAiReadiness();
    }

    case 'GET_REMOTE_CONFIG': {
      return remoteConfigService.getValues();
    }

    case 'REFRESH_REMOTE_CONFIG': {
      return remoteConfigService.init(true);
    }

    case 'RUN_QUEUE_TICK': {
      return processNextQueuedJob();
    }

    case 'BUILD_DECISION_MATRIX': {
      return decisionMatrixService.buildMatrix(message.payload);
    }

    default:
      return { ignored: true };
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') return false;
    handleOffscreenMessage(message)
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  });
}

void ensureReady();
