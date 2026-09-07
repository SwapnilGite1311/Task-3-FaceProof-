'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { formatPercent } from '@faceproof/shared';
import { cn } from '@/lib/utils';

/**
 * A similarity readout. The number is the point, so it is large and monospaced;
 * the bar is a secondary cue. A threshold marker is drawn when one applies, so
 * "below threshold" is visible rather than merely stated.
 */
export function ScoreBar({
  label,
  value,
  threshold,
  hint,
  tone = 'mint',
  className,
}: {
  label: string;
  value: number | null | undefined;
  threshold?: number;
  hint?: string;
  tone?: 'mint' | 'iris' | 'amber';
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? Math.min(100, Math.max(0, value * 100)) : 0;

  const barColor =
    tone === 'iris' ? 'bg-iris-400' : tone === 'amber' ? 'bg-amber-warn' : 'bg-mint-400';

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        <span
          className={cn(
            'font-mono text-[19px] tabular-nums tracking-tight',
            known ? 'text-mist-50' : 'text-mist-600',
          )}
        >
          {known ? formatPercent(value) : '—'}
        </span>
      </div>

      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className={cn('h-full rounded-full', barColor)}
        />
        {typeof threshold === 'number' ? (
          <span
            aria-hidden
            title={`Threshold ${formatPercent(threshold, 0)}`}
            className="absolute top-0 h-full w-px bg-mist-200/50"
            style={{ left: `${Math.min(100, Math.max(0, threshold * 100))}%` }}
          />
        ) : null}
      </div>

      {hint ? <p className="mt-2 text-[12px] leading-relaxed text-mist-600">{hint}</p> : null}
    </div>
  );
}
