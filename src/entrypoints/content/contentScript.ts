import type { AskAnswer, PageCapturePayload, SeenBeforeMatch } from '@/shared/types';
import {
  captureSignificantImages,
  extractReadableDocument,
} from '@/core/capture/readabilityExtractor';
import { isRecordableUrl } from '@/core/capture/urlPrivacy';

/**
 * Trailmind MV3 Content Script (injected at document_idle; < 20ms main-thread overhead: NFR-PF-1).
 * SECURITY INVARIANT (FR-CAP-4): NEVER reads input.value, textarea.value, select.value, passwords, or payment fields.
 */
(() => {
  if (!isRecordableUrl(window.location.href)) return;

  let currentUrl = window.location.href;
  let visibleMs = 0;
  let lastTick = document.visibilityState === 'visible' ? Date.now() : 0;
  let maxScroll = 0;
  let capturedForCurrentUrl = false;
  let formSubmitted = false;
  let typingTimeout: number | undefined;
  let seenChipHost: HTMLElement | null = null;
  let overlayHost: HTMLElement | null = null;

  function computeScrollPercent(): number {
    const docEl = document.documentElement;
    const scrollTop = window.scrollY || docEl.scrollTop || 0;
    const totalScrollable = Math.max(1, docEl.scrollHeight - window.innerHeight);
    return Math.min(100, Math.round(((scrollTop + window.innerHeight) / (totalScrollable + window.innerHeight)) * 100));
  }

  function sendMessage<T>(msg: unknown): Promise<T | null> {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response: { ok?: boolean; data?: T } | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve(null);
            return;
          }
          resolve(response.data ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function triggerCaptureIfReady(): Promise<void> {
    if (capturedForCurrentUrl) return;
    if (visibleMs < 20_000 && maxScroll < 30) return;

    capturedForCurrentUrl = true;
    const extracted = extractReadableDocument(document);
    if (!extracted.text || extracted.text.length < 80) return;

    const images = captureSignificantImages(document, 3);
    const payload: PageCapturePayload = {
      url: window.location.href,
      title: extracted.title,
      text: extracted.text,
      sanitizedHtml: extracted.sanitizedHtml,
      activeMs: visibleMs,
      maxScroll,
      referrerUrl: document.referrer || undefined,
      hadForm: extracted.hadForm,
      formSubmitted,
      images,
      sensitiveSignals: extracted.sensitiveSignals,
    };

    await sendMessage({ type: 'CAPTURE_PAGE', payload });
  }

  // Track visibility & active time (FR-CAP-1, FR-CAP-5)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastTick = Date.now();
    } else if (lastTick > 0) {
      visibleMs += Date.now() - lastTick;
      lastTick = 0;
    }
  });

  window.setInterval(() => {
    if (document.visibilityState === 'visible' && lastTick > 0) {
      const now = Date.now();
      visibleMs += now - lastTick;
      lastTick = now;
      if (!capturedForCurrentUrl && visibleMs >= 20_000) {
        void triggerCaptureIfReady();
      }
    }
  }, 4000);

  // Track scroll depth passively (FR-CAP-1, FR-CAP-5)
  window.addEventListener(
    'scroll',
    () => {
      const pct = computeScrollPercent();
      if (pct > maxScroll) maxScroll = pct;
      if (!capturedForCurrentUrl && maxScroll >= 30) {
        void triggerCaptureIfReady();
      }
    },
    { passive: true },
  );

  // Detect form submission without ever reading field values (FR-CAP-4, FR-OL-3)
  document.addEventListener(
    'submit',
    () => {
      formSubmitted = true;
      void sendMessage({ type: 'FORM_SUBMITTED', payload: { url: window.location.href } });
    },
    true,
  );

  // Signal typing / video playback for AI backpressure (FR-AI-7, NFR-PF-11)
  function emitActivity(typing: boolean): void {
    const videos = Array.from(document.querySelectorAll('video'));
    const videoPlaying = videos.some((v) => !v.paused && !v.ended && v.readyState > 2);
    void sendMessage({ type: 'USER_ACTIVITY', payload: { typing, videoPlaying } });
  }

  document.addEventListener(
    'keydown',
    (e) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isEditable) {
        emitActivity(true);
        window.clearTimeout(typingTimeout);
        typingTimeout = window.setTimeout(() => emitActivity(false), 4000);
      }
    },
    { passive: true },
  );

  // ---- "Seen Before" In-Page Shadow DOM Chip (FR-SB-1 to FR-SB-5) ----

  function removeSeenChip(): void {
    seenChipHost?.remove();
    seenChipHost = null;
  }

  function renderSeenChip(match: SeenBeforeMatch): void {
    removeSeenChip();
    const host = document.createElement('div');
    host.id = 'trailmind-seen-before-host';
    host.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483640;font-family:system-ui,-apple-system,sans-serif;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const isPriceRadar = match.kind === 'radar_price';
    const isConflictRadar = match.kind === 'radar_conflict' || match.kind === 'radar_update';

    const bg = isPriceRadar ? '#064e3b' : isConflictRadar ? '#78350f' : '#0f172a';
    const border = isPriceRadar ? '#10b981' : isConflictRadar ? '#f59e0b' : '#334155';
    const dotColor = isPriceRadar ? '#34d399' : isConflictRadar ? '#fbbf24' : '#38bdf8';

    const chip = document.createElement('div');
    chip.setAttribute('role', 'status');
    chip.style.cssText = `display:flex;align-items:flex-start;gap:8px;padding:10px 14px;border-radius:14px;background:${bg};color:#f8fafc;border:1px solid ${border};box-shadow:0 10px 28px rgba(15,23,42,0.4);font-size:12px;line-height:1.35;max-width:380px;`;

    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;margin-top:4px;border-radius:50%;background:${dotColor};flex-shrink:0;`;

    const contentWrap = document.createElement('div');
    contentWrap.style.cssText = 'flex:1;min-width:0;';

    if (match.radarAlert) {
      const headline = document.createElement('div');
      headline.textContent = `${isPriceRadar ? 'Price Radar' : 'Memory Radar'}: ${match.radarAlert.headline}`;
      headline.style.cssText = 'font-weight:700;font-size:12px;margin-bottom:2px;color:#ffffff;';

      const detail = document.createElement('div');
      detail.textContent = match.radarAlert.detail;
      detail.style.cssText = 'font-size:11px;color:#e2e8f0;margin-bottom:6px;';

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.textContent = isPriceRadar
        ? `Open cheaper source (${match.radarAlert.sourceTitle.slice(0, 28)}) →`
        : `Inspect remembered page →`;
      actionBtn.style.cssText =
        'background:rgba(255,255,255,0.16);border:none;border-radius:8px;color:#ffffff;font:inherit;font-size:11px;font-weight:600;cursor:pointer;padding:4px 8px;';
      actionBtn.addEventListener('click', () => {
        if (isPriceRadar && match.radarAlert?.sourceUrl) {
          window.open(match.radarAlert.sourceUrl, '_blank', 'noopener,noreferrer');
        } else {
          void sendMessage({
            type: 'OPEN_SIDE_PANEL',
            payload: { tab: 'graph', pageId: match.pageId, clusterId: match.clusterId },
          });
        }
      });

      contentWrap.append(headline, detail, actionBtn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = match.message;
      btn.style.cssText =
        'background:none;border:none;color:#f8fafc;font:inherit;cursor:pointer;text-align:left;padding:0;';
      btn.addEventListener('click', () => {
        void sendMessage({
          type: 'OPEN_SIDE_PANEL',
          payload: { tab: 'graph', pageId: match.pageId, clusterId: match.clusterId },
        });
      });
      contentWrap.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss Trailmind suggestion');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'background:none;border:none;color:#cbd5e1;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;';
    closeBtn.addEventListener('click', () => removeSeenChip());

    chip.append(dot, contentWrap, closeBtn);
    shadow.appendChild(chip);
    document.documentElement.appendChild(host);
    seenChipHost = host;
  }

  async function runSeenBeforeLookup(): Promise<void> {
    const sampleText = (document.body?.innerText || '').slice(0, 6000);
    if (sampleText.length < 100) return;
    const match = await sendMessage<SeenBeforeMatch>({
      type: 'CHECK_SEEN_BEFORE',
      payload: {
        url: window.location.href,
        title: document.title,
        textSample: sampleText,
      },
    });
    if (match) {
      renderSeenChip(match);
    }
  }

  // ---- Alt+M Ask Memory Search Overlay (FR-ASK-1, FR-ASK-4, FR-ASK-8) ----

  function closeSearchOverlay(): void {
    overlayHost?.remove();
    overlayHost = null;
  }

  function toggleSearchOverlay(): void {
    if (overlayHost) {
      closeSearchOverlay();
      return;
    }

    const host = document.createElement('div');
    host.id = 'trailmind-ask-overlay-host';
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483645;display:flex;align-items:flex-start;justify-content:center;padding-top:10vh;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,sans-serif;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ask Trailmind Memory');
    panel.style.cssText =
      'width:min(620px,92vw);max-height:76vh;overflow:auto;background:#ffffff;color:#0f172a;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);border:1px solid #cbd5e1;padding:16px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Ask your browsing memory… (e.g. "which repo for auth?" or "what did I read Tuesday?")';
    input.style.cssText =
      'flex:1;padding:10px 12px;border:1px solid #94a3b8;border-radius:10px;font-size:14px;outline:none;';

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.textContent = 'Ask';
    askBtn.style.cssText =
      'padding:10px 16px;border-radius:10px;border:none;background:#2563eb;color:#fff;font-weight:600;font-size:13px;cursor:pointer;';

    const escBtn = document.createElement('button');
    escBtn.type = 'button';
    escBtn.textContent = 'Esc';
    escBtn.style.cssText =
      'padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;font-size:12px;cursor:pointer;';
    escBtn.addEventListener('click', closeSearchOverlay);

    const resultsArea = document.createElement('div');
    resultsArea.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;';
    resultsArea.textContent = 'Private search over your local Trailmind memory. Press Enter to ask.';

    let lastContext: { previousQuestion: string; previousAnswer: string } | undefined;

    async function runAsk(): Promise<void> {
      const q = input.value.trim();
      if (!q) return;
      resultsArea.textContent = 'Searching local memory…';
      const ans = await sendMessage<AskAnswer>({
        type: 'ASK_MEMORY',
        payload: { question: q, followUpContext: lastContext },
      });
      if (!ans) {
        resultsArea.textContent = 'Could not reach Trailmind background pipeline.';
        return;
      }
      lastContext = { previousQuestion: q, previousAnswer: ans.answer };

      resultsArea.textContent = '';

      const badgeRow = document.createElement('div');
      badgeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
      const badge = document.createElement('span');
      badge.textContent = ans.aiSource === 'cloud' ? 'Cloud Gemini' : 'On device · Gemini Nano';
      badge.style.cssText =
        'display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;' +
        (ans.aiSource === 'cloud'
          ? 'background:#fef3c7;color:#92400e;'
          : 'background:#dcfce7;color:#166534;');
      const timing = document.createElement('span');
      timing.textContent = `${ans.latencyMs} ms`;
      timing.style.cssText = 'font-size:11px;color:#64748b;';
      badgeRow.append(badge, timing);

      // Render model answer STRICTLY as textContent, never innerHTML (SEC-4)
      const answerPara = document.createElement('p');
      answerPara.textContent = ans.answer;
      answerPara.style.cssText = 'margin:0 0 12px 0;white-space:pre-wrap;color:#0f172a;';

      resultsArea.append(badgeRow, answerPara);

      if (ans.citations.length > 0) {
        const citTitle = document.createElement('div');
        citTitle.textContent = 'Citations';
        citTitle.style.cssText = 'font-weight:600;font-size:12px;color:#334155;margin-bottom:6px;';
        resultsArea.appendChild(citTitle);

        ans.citations.forEach((cit, idx) => {
          const link = document.createElement('a');
          link.href = cit.status === 'gone' ? chrome.runtime.getURL(`app.html#snapshot/${cit.pageId}`) : cit.textFragmentUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `[${idx + 1}] ${cit.title}${cit.status === 'gone' ? ' (Page gone — open snapshot)' : ''}`;
          link.style.cssText =
            'display:block;padding:6px 8px;margin-bottom:4px;border-radius:8px;background:#f8fafc;color:#1d4ed8;text-decoration:none;font-size:12px;border:1px solid #e2e8f0;';
          resultsArea.appendChild(link);
        });
      }
    }

    askBtn.addEventListener('click', () => void runAsk());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void runAsk();
      if (e.key === 'Escape') closeSearchOverlay();
    });
    host.addEventListener('click', (e) => {
      if (e.target === host) closeSearchOverlay();
    });

    header.append(input, askBtn, escBtn);
    panel.append(header, resultsArea);
    shadow.appendChild(panel);
    document.documentElement.appendChild(host);
    overlayHost = host;
    input.focus();
  }

  // ---- Highlight Capture (Alt+H, FR-CAP-6) ----

  async function captureCurrentSelection(): Promise<void> {
    const selectedText = window.getSelection()?.toString().trim() ?? '';
    if (selectedText.length < 5) return;
    await sendMessage({
      type: 'CAPTURE_HIGHLIGHT',
      payload: {
        url: window.location.href,
        title: document.title,
        text: selectedText,
      },
    });
    renderSeenChip({
      kind: 'exact_revisit',
      message: 'Highlight saved to your Trailmind memory',
      relatedPages: [],
      lookupMs: 0,
    });
  }

  // ---- SPA navigation tracking (FR-CAP-9) ----

  function handleUrlChange(): void {
    if (window.location.href === currentUrl) return;
    currentUrl = window.location.href;
    visibleMs = 0;
    lastTick = document.visibilityState === 'visible' ? Date.now() : 0;
    maxScroll = 0;
    capturedForCurrentUrl = false;
    formSubmitted = false;
    removeSeenChip();
    window.setTimeout(() => void runSeenBeforeLookup(), 600);
  }

  const origPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPushState(...args);
    handleUrlChange();
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    origReplaceState(...args);
    handleUrlChange();
  };
  window.addEventListener('popstate', handleUrlChange);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TOGGLE_SEARCH_OVERLAY') {
      toggleSearchOverlay();
    } else if (msg?.type === 'REQUEST_HIGHLIGHT_CAPTURE') {
      void captureCurrentSelection();
    }
  });

  // Trigger Seen-Before lookup gently after document_idle
  window.setTimeout(() => void runSeenBeforeLookup(), 500);
})();
