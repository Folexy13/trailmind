import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import '@/ui/styles/global.css';

interface SnapshotPayload {
  title: string;
  url: string;
  capturedAt: number;
  status: string;
  sanitizedHtml?: string;
  text: string;
  screenshotPng?: string;
}

/**
 * Sandboxed Snapshot Reader (FR-SN-3, SEC-5).
 * Runs inside Manifest V3 `sandbox.pages` with zero Chrome extension privileges
 * and re-sanitizes HTML via DOMPurify before rendering.
 */
function SandboxedSnapshotReader() {
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'RENDER_SNAPSHOT' && event.data?.payload) {
        setSnapshot(event.data.payload as SnapshotPayload);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-slate-500">
        Waiting for decrypted snapshot content…
      </main>
    );
  }

  const safeHtml = snapshot.sanitizedHtml
    ? DOMPurify.sanitize(snapshot.sanitizedHtml, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
      })
    : '';

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
        <strong>Saved local copy</strong> · Captured on{' '}
        {new Date(snapshot.capturedAt).toLocaleString()}
        {snapshot.status === 'gone' && ' · Live page is gone (404/410), snapshot preserved'}
      </div>

      <h1 className="text-2xl font-bold tracking-tight">{snapshot.title}</h1>
      <p className="mt-1 break-all text-xs text-slate-500">{snapshot.url}</p>

      {snapshot.screenshotPng && (
        <figure className="my-6">
          <img
            src={snapshot.screenshotPng}
            alt={`Captured screenshot of ${snapshot.title}`}
            className="w-full rounded-xl border border-slate-200 shadow-sm dark:border-slate-800"
          />
        </figure>
      )}

      {safeHtml ? (
        <article
          className="prose prose-slate mt-6 max-w-none text-sm leading-7 dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <article className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-800 dark:text-slate-200">
          {snapshot.text}
        </article>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SandboxedSnapshotReader />
  </StrictMode>,
);
