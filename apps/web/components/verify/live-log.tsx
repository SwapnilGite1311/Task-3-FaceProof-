'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnyVerificationEvent } from '@faceproof/shared';
import { cn } from '@/lib/utils';

/**
 * Raw event feed.
 *
 * It exists so the pipeline is auditable while it runs: each line is an event
 * the backend actually emitted, with its sequence number, not a narration the
 * frontend made up.
 */
export function LiveLog({
  events,
  className,
}: {
  events: AnyVerificationEvent[];
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);

  React.useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [events.length]);

  const lines = React.useMemo(() => events.map(describe), [events]);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
      className={cn(
        'panel-inset max-h-64 overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed',
        className,
      )}
    >
      {lines.length === 0 ? (
        <p className="text-mist-600">Waiting for the first event…</p>
      ) : (
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.div
              key={line.seq}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="flex gap-3 py-0.5"
            >
              <span className="shrink-0 text-mist-600">
                {String(line.seq).padStart(3, '0')}
              </span>
              <span className="shrink-0 text-mist-600">{line.time}</span>
              <span className={cn('shrink-0 w-44 truncate', line.tone)}>{line.name}</span>
              <span className="min-w-0 flex-1 text-mist-400">{line.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

interface LogLine {
  seq: number;
  time: string;
  name: string;
  text: string;
  tone: string;
}

function describe(event: AnyVerificationEvent): LogLine {
  const time = event.at.slice(11, 19);
  const base = { seq: event.seq, time, name: event.name };

  switch (event.name) {
    case 'verification.created':
      return { ...base, text: 'Verification job created', tone: 'text-mist-300' };
    case 'image.analyzed':
      return {
        ...base,
        text: `${event.data.image.width}x${event.data.image.height} ${event.data.image.mimeType}`,
        tone: 'text-mist-300',
      };
    case 'face.detecting':
      return { ...base, text: 'Running the detector', tone: 'text-mint-300' };
    case 'face.detected':
      return {
        ...base,
        text: `${event.data.face.faceCount} face(s) in ${event.data.face.durationMs}ms`,
        tone: 'text-mint-400',
      };
    case 'face.not-detected':
      return { ...base, text: event.data.message, tone: 'text-rose-fail' };
    case 'face.encoding':
      return { ...base, text: 'Generating embedding', tone: 'text-mint-300' };
    case 'face.encoded':
      return {
        ...base,
        text: `${event.data.encoding.dimensions}-D ${event.data.encoding.model}`,
        tone: 'text-mint-400',
      };
    case 'reverse-search.started':
      return { ...base, text: `provider=${event.data.provider}`, tone: 'text-mint-300' };
    case 'reverse-search.progress':
      return { ...base, text: event.data.message, tone: 'text-mist-400' };
    case 'reverse-search.completed':
      return {
        ...base,
        text: `${event.data.search.totalResults} results (${event.data.search.socialResults} social) in ${event.data.search.durationMs}ms`,
        tone: 'text-mint-400',
      };
    case 'reverse-search.failed':
      return { ...base, text: event.data.message, tone: 'text-rose-fail' };
    case 'match.analyzing':
      return { ...base, text: event.data.message, tone: 'text-mist-400' };
    case 'match.found':
      return {
        ...base,
        text: `best=${event.data.match.bestMatch?.sourceUrl ?? 'n/a'} confidence=${(
          event.data.match.confidence * 100
        ).toFixed(1)}%`,
        tone: 'text-mint-400',
      };
    case 'match.not-found':
      return {
        ...base,
        text: `no candidate above ${(event.data.match.threshold * 100).toFixed(0)}%`,
        tone: 'text-amber-warn',
      };
    case 'evidence.created':
      return { ...base, text: 'Canonical evidence document built', tone: 'text-mist-300' };
    case 'evidence.hashed':
      return { ...base, text: `sha256=${event.data.evidenceHash}`, tone: 'text-mint-400' };
    case 'blockchain.submitting':
      return {
        ...base,
        text: `tx=${event.data.transactionHash ?? 'pending'}`,
        tone: 'text-mint-300',
      };
    case 'blockchain.confirmed':
      return {
        ...base,
        text: `block=${event.data.blockchain.blockNumber ?? '?'} gas=${event.data.blockchain.gasUsed ?? '?'}`,
        tone: 'text-mint-400',
      };
    case 'blockchain.failed':
      return { ...base, text: event.data.message, tone: 'text-rose-fail' };
    case 'verification.completed':
      return { ...base, text: `status=${event.data.status}`, tone: 'text-mint-400' };
    case 'verification.failed':
      return { ...base, text: `${event.data.code}: ${event.data.message}`, tone: 'text-rose-fail' };
    case 'stage.updated':
      return {
        ...base,
        text: `${event.data.stage} -> ${event.data.state}`,
        tone: 'text-mist-500',
      };
    default:
      return { ...base, text: '', tone: 'text-mist-500' };
  }
}
