'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import type { FaceDetectionSummary } from '@faceproof/shared';
import { cn } from '@/lib/utils';

/**
 * The uploaded image with detection boxes drawn over it.
 *
 * Boxes are positioned from `relativeBox` (fractions of the image), so the
 * overlay stays correct at any rendered size without needing to know the
 * displayed dimensions.
 */
export function FacePreview({
  imageUrl,
  face,
  scanning = false,
  className,
  alt = 'Submitted image',
}: {
  imageUrl: string;
  face: FaceDetectionSummary | null;
  scanning?: boolean;
  className?: string;
  alt?: string;
}) {
  const [loaded, setLoaded] = React.useState(false);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--hairline)] bg-ink-950',
        className,
      )}
    >
      <img
        src={imageUrl}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={cn(
          'block size-full object-contain transition-opacity duration-500',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />

      {!loaded ? <div className="absolute inset-0 shimmer bg-white/[0.03]" /> : null}

      {/* Live scan sweep while detection is in flight. */}
      {scanning ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            initial={{ top: '-4%' }}
            animate={{ top: '104%' }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-mint-400/15 to-transparent"
          />
          <motion.div
            initial={{ top: '-4%' }}
            animate={{ top: '104%' }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-x-0 h-px bg-mint-400/70"
          />
        </div>
      ) : null}

      {/* Detection boxes */}
      {face?.faces.map((detected) => (
        <motion.div
          key={detected.index}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: detected.index * 0.08 }}
          className="pointer-events-none absolute"
          style={{
            left: `${detected.relativeBox.x * 100}%`,
            top: `${detected.relativeBox.y * 100}%`,
            width: `${detected.relativeBox.width * 100}%`,
            height: `${detected.relativeBox.height * 100}%`,
          }}
        >
          <div className="relative size-full rounded-[3px] shadow-[0_0_0_1px_rgba(78,233,198,0.55),0_0_28px_-6px_rgba(78,233,198,0.6)]">
            {/* corner ticks */}
            {(
              [
                'left-0 top-0 border-l-2 border-t-2',
                'right-0 top-0 border-r-2 border-t-2',
                'left-0 bottom-0 border-l-2 border-b-2',
                'right-0 bottom-0 border-r-2 border-b-2',
              ] as const
            ).map((position) => (
              <span
                key={position}
                className={cn('absolute size-3 border-mint-300', position)}
                aria-hidden
              />
            ))}

            <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-mint-400 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-950">
              FACE {String(detected.index + 1).padStart(2, '0')} ·{' '}
              {(detected.score * 100).toFixed(1)}%
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
