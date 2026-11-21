import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { CapturedImage } from '@/shared/types';

export interface ExtractedDocument {
  title: string;
  text: string;
  sanitizedHtml: string;
  hadForm: boolean;
  sensitiveSignals: {
    hasPasswordField: boolean;
    hasPaymentField: boolean;
    looksLikeLogin: boolean;
    looksLikeMedical: boolean;
    looksLikeAdult: boolean;
  };
}

/**
 * Strips form elements, nav, ads, scripts, and comments from a cloned DOM before readability parsing.
 * SECURITY INVARIANT (FR-CAP-4): Never reads input/textarea/select values or form contents.
 */
function sanitizeCloneForExtraction(doc: Document): {
  clone: Document;
  hadForm: boolean;
  sensitiveSignals: ExtractedDocument['sensitiveSignals'];
} {
  const hasPasswordField = doc.querySelector('input[type="password"]') !== null;
  const hasPaymentField =
    doc.querySelector(
      'input[autocomplete*="cc-"], input[name*="cardnumber" i], input[name*="cvv" i], input[name*="cvc" i], input[name*="creditcard" i]',
    ) !== null;
  const hadForm = doc.querySelector('form') !== null;

  const metaRating =
    doc.querySelector('meta[name="rating"]')?.getAttribute('content')?.toLowerCase() ?? '';
  const looksLikeAdult = metaRating === 'adult' || metaRating === 'rta-5042-1996-1400-1577-rta';

  const titleLower = (doc.title || '').toLowerCase();
  const looksLikeLogin =
    hasPasswordField && /\b(sign in|log in|login|authenticate)\b/i.test(titleLower);
  const looksLikeMedical =
    /\b(patient portal|lab results|test results|mychart|medical record)\b/i.test(titleLower);

  const clone = doc.cloneNode(true) as Document;

  // Strip interactive form controls, nav, ads, comments, and scripts completely
  const removeSelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'input',
    'textarea',
    'select',
    'nav',
    'footer',
    '[role="navigation"]',
    '[role="banner"]',
    '[aria-label*="advertisement" i]',
    '.advertisement',
    '.ad-slot',
    '.ads',
    '#comments',
    '.comments',
    '.comment-section',
  ];
  clone.querySelectorAll(removeSelectors.join(',')).forEach((el) => el.remove());

  return {
    clone,
    hadForm,
    sensitiveSignals: {
      hasPasswordField,
      hasPaymentField,
      looksLikeLogin,
      looksLikeMedical,
      looksLikeAdult,
    },
  };
}

/**
 * Extracts readable article/page text and DOMPurify-sanitized HTML using Mozilla Readability (FR-CAP-2, SEC-5).
 */
export function extractReadableDocument(doc: Document): ExtractedDocument {
  const { clone, hadForm, sensitiveSignals } = sanitizeCloneForExtraction(doc);

  let title = doc.title?.trim() || '';
  let text = '';
  let rawHtml = '';

  try {
    const reader = new Readability(clone, { charThreshold: 120 });
    const parsed = reader.parse();
    if (parsed) {
      title = parsed.title?.trim() || title;
      text = (parsed.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      rawHtml = parsed.content || '';
    }
  } catch {
    // Fall back to cleaned body text
  }

  if (!text) {
    const bodyClone = clone.body;
    text = (bodyClone?.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    rawHtml = bodyClone?.innerHTML || '';
  }

  const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  });

  return {
    title: title || 'Untitled Page',
    text,
    sanitizedHtml,
    hadForm,
    sensitiveSignals,
  };
}

/**
 * Parses an HTML string (used by the background backfill re-fetcher in the offscreen document).
 */
export function extractReadableFromHtml(html: string, url: string): ExtractedDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  // Set base URL so Readability resolves relative links cleanly
  const base = doc.createElement('base');
  base.href = url;
  doc.head.appendChild(base);
  return extractReadableDocument(doc);
}

/**
 * Extracts up to 3 chart/diagram JPEG or PNG images larger than 200x200 px for on-device Nano description (FR-CAP-7).
 */
export function captureSignificantImages(doc: Document, maxImages = 3): CapturedImage[] {
  const imgs = Array.from(doc.querySelectorAll('img'));
  const results: CapturedImage[] = [];

  for (const img of imgs) {
    if (results.length >= maxImages) break;
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (width <= 200 || height <= 200) continue;

    const src = img.currentSrc || img.src || '';
    const alt = img.alt?.trim() || '';
    const looksUseful =
      /\b(chart|graph|diagram|architecture|table|benchmark|plot|figure|screenshot)\b/i.test(
        `${alt} ${src}`,
      ) ||
      (width >= 350 && height >= 240);
    if (!looksUseful) continue;

    const mimeType: 'image/jpeg' | 'image/png' | null =
      src.startsWith('data:image/png') || /\.png(\?|$)/i.test(src)
        ? 'image/png'
        : src.startsWith('data:image/jpeg') || /\.(jpe?g)(\?|$)/i.test(src)
          ? 'image/jpeg'
          : 'image/png';

    let dataBase64: string | undefined;
    try {
      const canvas = doc.createElement('canvas');
      const maxDim = 768;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL(mimeType, 0.8);
        dataBase64 = dataUrl.split(',')[1];
      }
    } catch {
      // Cross-origin tainted canvas: skip binary capture safely
      dataBase64 = undefined;
    }

    if (dataBase64) {
      results.push({
        id: crypto.randomUUID(),
        mimeType,
        alt,
        width,
        height,
        dataBase64,
      });
    }
  }

  return results;
}
