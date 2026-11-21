import { HYBRID_ROUTING_TABLE } from '@/shared/constants';
import type { AiJobKind } from '@/shared/types';

/**
 * Help, Hybrid Routing Table, Shortcuts, and Gemini Nano Troubleshooting guide (FR-SET-2, FR-SET-3).
 */
export function HelpPanel() {
  const jobs = Object.keys(HYBRID_ROUTING_TABLE) as AiJobKind[];

  return (
    <div className="space-y-5 text-xs">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">How Trailmind Hybrid AI works</h2>
        <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-300">
          Trailmind routes every AI job through one module built on{' '}
          <strong>Firebase AI Logic hybrid inference</strong>. Routine per-page reading and
          sensitive-page classification run strictly on-device via Chrome&apos;s built-in Gemini
          Nano (<code>ONLY_ON_DEVICE</code>), keeping private browsing local and free. Heavy,
          opt-in synthesis (cross-month summaries, PDFs, optional cloud polish) falls back to Gemini
          in the cloud with Firebase App Check enforced and every cloud payload visible in the
          Routing Inspector.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-3">AI Job</th>
                <th className="py-2 pr-3">InferenceMode</th>
                <th className="py-2">Why it runs there</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((job) => {
                const entry = HYBRID_ROUTING_TABLE[job];
                return (
                  <tr key={job}>
                    <td className="py-2 pr-3 font-medium">{entry.label}</td>
                    <td className="py-2 pr-3 font-mono">{entry.defaultMode.toUpperCase()}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{entry.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Keyboard Shortcuts (FR-SET-2)</h3>
        <p className="mt-1 text-slate-500">
          Customize anytime at <code>chrome://extensions/shortcuts</code>.
        </p>
        <ul className="mt-2 space-y-1.5">
          <li>
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">Alt+M</kbd>{' '}
            — Open Ask Your Memory overlay on any page
          </li>
          <li>
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">Alt+G</kbd>{' '}
            — Open the Knowledge Graph side panel
          </li>
          <li>
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">Alt+H</kbd>{' '}
            — Save selected text as a Highlight fact
          </li>
          <li>
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">tm &lt;query&gt;</kbd>{' '}
            — Search memory straight from the Chrome address bar
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold">Troubleshooting Gemini Nano setup</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-slate-600 dark:text-slate-300">
          <li>Use desktop Chrome 139 or newer with at least 4 GB free disk space.</li>
          <li>
            Visit <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, set to{' '}
            <strong>Enabled</strong>, and restart Chrome.
          </li>
          <li>
            Open Onboarding and click <strong>Enable on-device AI</strong> (Chrome requires a user
            click to start the model download via <code>initializeDeviceModel()</code>).
          </li>
          <li>
            Check download status at <code>chrome://on-device-internals</code> if needed.
          </li>
        </ol>
      </section>
    </div>
  );
}
