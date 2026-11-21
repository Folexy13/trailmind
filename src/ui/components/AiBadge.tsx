import { Cloud, Cpu, AlertTriangle } from 'lucide-react';
import type { AiSource } from '@/shared/types';

interface AiBadgeProps {
  source?: AiSource;
  compact?: boolean;
}

/**
 * Displays a clear On-device or Cloud badge beside every AI-generated output (FR-AI-4, NFR-UX-4).
 */
export function AiBadge({ source = 'on_device', compact = false }: AiBadgeProps) {
  if (source === 'cloud') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        title="Computed with Gemini in the cloud via Firebase AI Logic"
      >
        <Cloud className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{compact ? 'Cloud' : 'Cloud · Gemini'}</span>
      </span>
    );
  }

  if (source === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
        title="AI job failed and is queued for retry"
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>Failed</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
      title="Computed privately on your device with Gemini Nano"
    >
      <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{compact ? 'On device' : 'On device · Nano'}</span>
    </span>
  );
}
