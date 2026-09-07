'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Fingerprint, Globe, Hash, Link2, ScanFace } from 'lucide-react';
import { cn } from '@/lib/utils';

const NODES = [
  {
    id: 'face',
    label: 'FACE DETECTION',
    caption: 'SSD MobileNet V1 · bounding boxes',
    icon: ScanFace,
  },
  {
    id: 'search',
    label: 'REVERSE SEARCH',
    caption: 'Live provider query · public web',
    icon: Globe,
  },
  {
    id: 'match',
    label: 'SOCIAL MATCH',
    caption: 'Perceptual hash + face embedding',
    icon: Fingerprint,
  },
  {
    id: 'hash',
    label: 'EVIDENCE HASH',
    caption: 'Canonical JSON · SHA-256',
    icon: Hash,
  },
  {
    id: 'chain',
    label: 'BLOCKCHAIN PROOF',
    caption: 'Polygon Amoy · public transaction',
    icon: Link2,
  },
] as const;

/**
 * The vertical chain that appears on the landing page and the how-it-works
 * page. It is a diagram, not a progress indicator — the live pipeline on
 * /verify/[id] is driven by real backend events instead.
 */
export function PipelineChain({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn('relative', className)}>
      {/* The spine */}
      <div
        aria-hidden
        className="absolute left-[27px] top-8 bottom-8 w-px bg-gradient-to-b from-transparent via-[var(--hairline-strong)] to-transparent"
      />

      <ol className="relative space-y-3">
        {NODES.map((node, index) => {
          const Icon = node.icon;
          return (
            <motion.li
              key={node.id}
              // Animated on mount rather than on scroll: the chain sits above
              // the fold on the landing page, so intersection-based reveals
              // would leave it blank for a visitor who never scrolls.
              initial={reduceMotion ? false : { opacity: 0, y: 14 }}
              animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-4"
            >
              <div className="relative shrink-0">
                <div className="grid size-14 place-items-center rounded-xl border border-[var(--hairline)] bg-ink-900">
                  <Icon className="size-5 text-mint-400" strokeWidth={1.5} />
                </div>
                {/* scan sweep inside the tile */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                  <div
                    className="h-px w-full bg-gradient-to-r from-transparent via-mint-400/60 to-transparent"
                    style={{
                      animation: reduceMotion
                        ? undefined
                        : `scan 3.2s cubic-bezier(0.4,0,0.2,1) ${index * 0.4}s infinite`,
                    }}
                  />
                </div>
              </div>

              <div className="min-w-0 flex-1 border-b border-[var(--hairline)] pb-3">
                <div className="text-[12px] font-medium tracking-[0.16em] text-mist-100">
                  {node.label}
                </div>
                <div className="mt-1 text-[12.5px] text-mist-500">{node.caption}</div>
              </div>

              <div className="hash hidden shrink-0 text-mist-600 sm:block">
                {String(index + 1).padStart(2, '0')}
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
