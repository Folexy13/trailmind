import type { ExtensionMessage } from '@/shared/types';
import { backfillService } from '@/core/backfill/historyImporter';
import { graphEngine } from '@/core/graph/graphEngine';
import { memoryStore } from '@/core/store/memoryStore';
import { askMemoryService } from '@/features/ask/askService';
import { changeWatchService } from '@/features/changeWatch/changeWatchService';
import { journeysService } from '@/features/journeys/journeysService';
import { openLoopsService } from '@/features/loops/openLoopsService';
import { tabRescueService } from '@/features/tabRescue/tabRescueService';

const OFFSCREEN_URL = 'offscreen.html';
const ALARM_QUEUE_TICK = 'tm_queue_tick';
const ALARM_CHANGE_WATCH = 'tm_change_watch';
const ALARM_WEEKLY_RECAP = 'tm_weekly_recap';
const ALARM_AUTO_DELETE = 'tm_auto_delete';
const ALARM_REMOTE_CONFIG = 'tm_remote_config';

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) return;
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existingContexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.WORKERS],
        justification:
          'Runs Firebase AI Logic hybrid inference, local sentence embeddings, and HTML readability parsing.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function forwardToOffscreen<T>(
  message: ExtensionMessage & { senderTabId?: number; incognito?: boolean },
): Promise<T> {
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    ...message,
    target: 'offscreen',
  })) as { ok: boolean; data?: T; error?: string } | undefined;

  if (!response?.ok) {
    throw new Error(response?.error ?? 'Offscreen pipeline error');
  }
  return response.data as T;
}

async function updateActionBadge(): Promise<void> {
  await memoryStore.init();
  const settings = await memoryStore.getSettings();
  const paused =
    settings.capturePausedGlobal ||
    Boolean(settings.capturePausedUntil && Date.now() < settings.capturePausedUntil);

  if (paused) {
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
    return;
  }

  const watches = await memoryStore.listWatches();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentChanges = watches.reduce(
    (sum, w) => sum + w.changes.filter((c) => c.detectedAt >= dayAgo).length,
    0,
  );
  if (recentChanges > 0) {
    await chrome.action.setBadgeText({ text: String(recentChanges) });
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function scheduleAlarms(): Promise<void> {
  const settings = await memoryStore.getSettings();
  await chrome.alarms.create(ALARM_QUEUE_TICK, { periodInMinutes: 1 });
  await chrome.alarms.create(ALARM_CHANGE_WATCH, {
    periodInMinutes: Math.max(60, (settings.changeWatchIntervalHours || 12) * 60),
  });
  await chrome.alarms.create(ALARM_WEEKLY_RECAP, { periodInMinutes: 60 });
  await chrome.alarms.create(ALARM_AUTO_DELETE, { periodInMinutes: 24 * 60 });
  await chrome.alarms.create(ALARM_REMOTE_CONFIG, { periodInMinutes: 360 });
}

// ---- Lifecycle hooks ----

chrome.runtime.onInstalled.addListener(async (details) => {
  await memoryStore.init();
  await scheduleAlarms();
  await updateActionBadge();

  // Set optional uninstall survey URL (FR-SET-4: sends zero browsing data)
  const surveyUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_UNINSTALL_SURVEY_URL;
  if (surveyUrl && surveyUrl.startsWith('https://')) {
    chrome.runtime.setUninstallURL(surveyUrl);
  }

  // Open welcome onboarding tab on first install (FR-ON-1)
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('app.html#onboarding') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await memoryStore.init();
  await scheduleAlarms();
  await updateActionBadge();
  // Resume persisted IndexedDB jobs after browser restart (NFR-RL-1)
  void forwardToOffscreen({ type: 'RUN_QUEUE_TICK' }).catch(() => undefined);
});

// ---- Alarms ----

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await memoryStore.init();

  if (alarm.name === ALARM_QUEUE_TICK) {
    // Only run backfill fetches while browser is idle (FR-BF-5)
    const idleState = chrome.idle?.queryState
      ? await new Promise<string>((resolve) => chrome.idle.queryState(60, resolve))
      : 'idle';
    if (idleState === 'idle' || idleState === 'locked') {
      void forwardToOffscreen({ type: 'RUN_QUEUE_TICK' }).catch(() => undefined);
    }
    await updateActionBadge();
  } else if (alarm.name === ALARM_CHANGE_WATCH) {
    const watches = await memoryStore.listWatches();
    for (const w of watches) {
      if (!w.enabled) continue;
      const due = Date.now() - w.lastCheck >= w.intervalHours * 60 * 60 * 1000;
      if (due) {
        await memoryStore.enqueueJob({
          id: `job_watch_${w.id}_${Date.now()}`,
          kind: 'check_watch',
          priority: 40,
          state: 'queued',
          attempts: 0,
          payloadRef: w.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    void forwardToOffscreen({ type: 'RUN_QUEUE_TICK' }).catch(() => undefined);
  } else if (alarm.name === ALARM_WEEKLY_RECAP) {
    const settings = await memoryStore.getSettings();
    const now = new Date();
    if (now.getDay() === settings.weeklyRecapDay && now.getHours() === settings.weeklyRecapHour) {
      await memoryStore.enqueueJob({
        id: `job_recap_${now.toISOString().slice(0, 10)}`,
        kind: 'weekly_recap',
        priority: 30,
        state: 'queued',
        attempts: 0,
        payloadRef: 'weekly',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      void forwardToOffscreen({ type: 'RUN_QUEUE_TICK' }).catch(() => undefined);
    }
  } else if (alarm.name === ALARM_AUTO_DELETE) {
    const settings = await memoryStore.getSettings();
    if (settings.autoDeleteDays > 0) {
      await memoryStore.autoDeleteOlderThan(settings.autoDeleteDays);
    }
  } else if (alarm.name === ALARM_REMOTE_CONFIG) {
    void forwardToOffscreen({ type: 'REFRESH_REMOTE_CONFIG' }).catch(() => undefined);
  }
});

// ---- Keyboard Shortcuts (FR-ASK-1, FR-CAP-6, FR-SET-2) ----

chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  if (command === 'open-search-overlay') {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_SEARCH_OVERLAY' }).catch(() => {
      // If on chrome:// page where content script can't inject, open side panel Ask tab instead
      if (activeTab.windowId !== undefined && chrome.sidePanel?.open) {
        void chrome.sidePanel.open({ windowId: activeTab.windowId });
      }
    });
  } else if (command === 'open-side-panel') {
    if (activeTab.windowId !== undefined && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: activeTab.windowId });
    }
  } else if (command === 'capture-highlight') {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'REQUEST_HIGHLIGHT_CAPTURE' }).catch(() => undefined);
  }
});

// ---- Omnibox `tm <query>` (FR-ASK-10) ----

if (chrome.omnibox) {
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    try {
      await memoryStore.init();
      const results = await askMemoryService.getOmniboxSuggestions(text);
      suggest(results);
    } catch {
      suggest([]);
    }
  });

  chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    const targetUrl =
      text.startsWith('http://') || text.startsWith('https://')
        ? text
        : chrome.runtime.getURL(`app.html#ask?q=${encodeURIComponent(text)}`);

    if (disposition === 'currentTab') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.update(tab.id, { url: targetUrl });
    } else {
      await chrome.tabs.create({ url: targetUrl });
    }
  });
}

// ---- Notification Click ----

chrome.notifications.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('app.html#watch') });
});

// ---- Message Router ----

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (!rawMessage || rawMessage.target === 'offscreen') return false;
  const message = rawMessage as ExtensionMessage;

  const handle = async (): Promise<unknown> => {
    await memoryStore.init();

    // Never record anything from incognito tabs (FR-CAP-3)
    if (sender.tab?.incognito && (message.type === 'CAPTURE_PAGE' || message.type === 'CAPTURE_HIGHLIGHT' || message.type === 'CHECK_SEEN_BEFORE')) {
      return { recorded: false, reason: 'incognito_tab' };
    }

    switch (message.type) {
      case 'CAPTURE_PAGE':
      case 'CAPTURE_HIGHLIGHT':
      case 'CHECK_SEEN_BEFORE':
      case 'ASK_MEMORY':
      case 'USER_ACTIVITY':
      case 'PAUSE_BACKFILL':
      case 'GET_BACKFILL_PROGRESS':
      case 'CHECK_DEVICE_AI':
      case 'INITIALIZE_DEVICE_AI':
      case 'GET_REMOTE_CONFIG':
      case 'REFRESH_REMOTE_CONFIG':
      case 'RUN_QUEUE_TICK':
      case 'BUILD_DECISION_MATRIX':
        return forwardToOffscreen({
          ...message,
          senderTabId: sender.tab?.id,
          incognito: sender.tab?.incognito,
        });

      case 'SCAN_TAB_GRAVEYARD': {
        return tabRescueService.scanCurrentChromeWindow();
      }

      case 'EXECUTE_TAB_RESCUE': {
        const plan = await tabRescueService.scanCurrentChromeWindow();
        const selectedSet = new Set(message.payload.tabIds);
        const chosen = plan.rescuableTabs.filter((t) => selectedSet.has(t.tabId));
        return tabRescueService.executeRescue(chosen, { closeTabs: message.payload.closeTabs });
      }

      case 'FORM_SUBMITTED': {
        const pages = await memoryStore.listPages();
        const match = pages.find((p) => p.url === message.payload.url);
        if (match) {
          const visits = await memoryStore.listVisitsForPage(match.id);
          const latest = visits[visits.length - 1];
          if (latest) {
            await memoryStore.db.visits.update(latest.id, { formSubmitted: true });
          }
        }
        return { ok: true };
      }

      case 'START_BACKFILL': {
        const res = await backfillService.importFromChromeHistory(message.payload.days);
        await graphEngine.rebuildGraphAndClusters({ nameWithAi: false });
        await journeysService.rebuildJourneys({ summarizeWithAi: false });
        await openLoopsService.refreshOpenLoops();
        void forwardToOffscreen({ type: 'RUN_QUEUE_TICK' }).catch(() => undefined);
        return res;
      }

      case 'FORGET_RECENT': {
        const removed = await memoryStore.forgetLastMinutes(message.payload.minutes);
        await graphEngine.rebuildGraphAndClusters({ nameWithAi: false });
        return { removed };
      }

      case 'WATCH_CURRENT_PAGE': {
        const watch = await changeWatchService.addWatch(message.payload);
        return { watch };
      }

      case 'RESUME_JOURNEY': {
        return journeysService.resumeJourneyInTabGroup(
          message.payload.journeyId,
          message.payload.maxTabs ?? 6,
        );
      }

      case 'CAPTURE_STAR_SCREENSHOT': {
        // Optional full-page visible tab PNG screenshot when user stars a page (FR-SN-5)
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        const snap = await memoryStore.getLatestSnapshot(message.payload.pageId);
        if (snap) {
          await memoryStore.updateSnapshotScreenshot(snap.id, dataUrl);
        }
        const page = await memoryStore.getPage(message.payload.pageId);
        if (page) {
          await memoryStore.putPage({ ...page, starred: true, updatedAt: Date.now() });
        }
        return { ok: true };
      }

      case 'OPEN_SIDE_PANEL': {
        const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
        if (windowId !== undefined && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId });
        }
        if (message.payload) {
          await chrome.storage.session?.set({ tm_panel_nav: message.payload }).catch(() => undefined);
        }
        return { ok: true };
      }

      case 'GET_POPUP_SUMMARY': {
        const [settings, pages, loops, watches] = await Promise.all([
          memoryStore.getSettings(),
          memoryStore.listPages(),
          memoryStore.listLoops(),
          memoryStore.listWatches(),
        ]);
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const todayCount = pages.filter((p) => p.lastSeen >= startOfToday.getTime()).length;
        const openLoopsCount = loops.filter((l) => l.state === 'open').length;
        const tabPaused =
          message.payload?.tabId !== undefined &&
          settings.pausedTabIds.includes(message.payload.tabId);
        await updateActionBadge();
        return {
          pausedGlobal: settings.capturePausedGlobal,
          pausedUntil: settings.capturePausedUntil,
          tabPaused,
          demoMode: settings.demoMode,
          todayCount,
          totalPages: pages.length,
          openLoopsCount,
          watchesCount: watches.filter((w) => w.enabled).length,
        };
      }

      default:
        return { ok: false };
    }
  };

  handle()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true;
});
