'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus, X } from 'lucide-react';
import { PIPELINE_STAGES, type StageState, type StageStatusDto } from '@faceproof/shared';
import { cn } from '@/lib/utils';

const STATE_TONE: Record<StageState, string> = {
  pending: 'text-mist-600',
  processing: 'text-mint-300',
  completed: 'text-mint-400',
  failed: 'text-rose-fail',
  skipped: 'text-mist-600',
};

function StageMarker({ state }: { state: StageState }) {
  if (state === 'completed') {
    return (
      <span className="grid size-7 place-items-center rounded-full border border-mint-500/40 bg-mint-500/12 text-mint-400">
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (state === 'failed') {
    return (
      <span className="grid size-7 place-items-center rounded-full border border-rose-fail/40 bg-rose-fail/12 text-rose-fail">
        <X className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (state === 'skipped') {
    return (
      <span className="grid size-7 place-items-center rounded-full border border-[var(--hairline-strong)] bg-ink-850 text-mist-600">
        <Minus className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (state === 'processing') {
    return (
      <span
        className="relative grid size-7 place-items-center rounded-full border border-mint-400/50 bg-mint-500/10"
        style={{ animation: 'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite' }}
      >
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-mint-300 motion-safe:animate-spin" />
        <span className="size-1.5 rounded-full bg-mint-300" />
      </span>
    );
  }

  return (
    <span className="grid size-7 place-items-center rounded-full border border-[var(--hairline)] bg-ink-900">
      <span className="size-1.5 rounded-full bg-mist-600" />
    </span>
  );
}

/**
 * The live pipeline. Every state shown here comes from a backend event — the
 * component has no timers and no optimistic transitions of its own.
 */
export function PipelineTimeline({
  stages,
  className,
}: {
  stages: StageStatusDto[];
  className?: string;
}) {
  return (
    <ol className={cn('relative', className)}>
      {PIPELINE_STAGES.map((definition, index) => {
        const stage =
          stages.find((entry) => entry.id === definition.id) ??
          ({ id: definition.id, state: 'pending' } as StageStatusDto);

        const isLast = index === PIPELINE_STAGES.length - 1;
        const connectorLit = stage.state === 'completed';

        return (
          <li key={definition.id} className="relative flex gap-4 pb-1">
            {/* marker column with connector */}
            <div className="relative flex flex-col items-center">
              <StageMarker state={stage.state} />
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    'w-px flex-1 transition-colors duration-500',
                    connectorLit ? 'bg-mint-500/35' : 'bg-[var(--hairline)]',
                  )}
                  style={{ minHeight: 28 }}
                />
              ) : null}
            </div>

            <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-6')}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="hash text-[11px] text-mist-600">{definition.ordinal}</span>
                <span
                  className={cn(
                    'text-[12.5px] font-medium tracking-[0.13em] transition-colors',
                    stage.state === 'pending' || stage.state === 'skipped'
                      ? 'text-mist-500'
                      : 'text-mist-50',
                  )}
                >
                  {definition.label}
                </span>
                {stage.state === 'processing' ? (
                  <span className="text-[11px] tracking-wide text-mint-300">running</span>
                ) : null}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${stage.state}-${stage.detail ?? ''}-${stage.error ?? ''}`}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="mt-1.5"
                >
                  {stage.error ? (
                    <p className="text-[13px] leading-relaxed text-rose-fail">{stage.error}</p>
                  ) : stage.detail ? (
                    <p className={cn('text-[13px] leading-relaxed', STATE_TONE[stage.state])}>
                      {stage.detail}
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-mist-600">
                      {definition.description}
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
