'use client';

import * as React from 'react';
import {
  VERIFICATION_EVENTS,
  applyStageState,
  type AnyVerificationEvent,
  type VerificationDto,
} from '@faceproof/shared';
import { ApiError, eventStreamUrlFor, fetchVerification } from '@/lib/api';

export type StreamStatus = 'connecting' | 'live' | 'closed' | 'error';

export interface StreamState {
  verification: VerificationDto | null;
  events: AnyVerificationEvent[];
  status: StreamStatus;
  loadError: string | null;
  finished: boolean;
}

const TERMINAL_EVENTS = new Set(['verification.completed', 'verification.failed']);

/**
 * Subscribes to the API's server-sent event stream and folds each event into a
 * local copy of the verification.
 *
 * The stream is the source of truth while a job runs: nothing is animated ahead
 * of the backend, and no stage is marked complete until the backend says so.
 * The browser replays from `Last-Event-ID` automatically after a dropped
 * connection, and the API serves the full history from its event log, so a
 * reconnect (or a page opened late) lands in exactly the same state.
 */
export function useVerificationStream(id: string): StreamState {
  const [verification, setVerification] = React.useState<VerificationDto | null>(null);
  const [events, setEvents] = React.useState<AnyVerificationEvent[]>([]);
  const [status, setStatus] = React.useState<StreamStatus>('connecting');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState(false);

  const seenSeq = React.useRef<Set<number>>(new Set());

  // Initial snapshot: covers the case where the job finished before the page
  // was opened, and gives the UI its image metadata immediately.
  React.useEffect(() => {
    let cancelled = false;

    void fetchVerification(id)
      .then((dto) => {
        if (cancelled) return;
        setVerification(dto);
        if (dto.status !== 'pending' && dto.status !== 'processing') setFinished(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiError ? error.message : 'This verification could not be loaded.',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  React.useEffect(() => {
    if (loadError) return undefined;

    const source = new EventSource(eventStreamUrlFor(id));
    let closed = false;

    const handle = (raw: MessageEvent<string>) => {
      let event: AnyVerificationEvent;
      try {
        event = JSON.parse(raw.data) as AnyVerificationEvent;
      } catch {
        return;
      }

      // Replay after a reconnect can repeat events; ignore ones already folded.
      if (seenSeq.current.has(event.seq)) return;
      seenSeq.current.add(event.seq);

      setEvents((previous) => [...previous, event]);
      setVerification((previous) => (previous ? reduce(previous, event) : previous));

      if (TERMINAL_EVENTS.has(event.name)) {
        setFinished(true);
        // Re-read the authoritative record once, so anything the stream did not
        // carry (row-level fields, final timestamps) is exact.
        void fetchVerification(id)
          .then((dto) => setVerification(dto))
          .catch(() => undefined)
          .finally(() => {
            if (!closed) {
              closed = true;
              source.close();
              setStatus('closed');
            }
          });
      }
    };

    source.onopen = () => setStatus('live');
    source.onerror = () => {
      // EventSource reconnects on its own unless it was closed deliberately.
      setStatus((previous) => (previous === 'closed' ? previous : 'error'));
    };

    for (const name of VERIFICATION_EVENTS) {
      source.addEventListener(name, handle as EventListener);
    }

    return () => {
      closed = true;
      source.close();
    };
  }, [id, loadError]);

  return { verification, events, status, loadError, finished };
}

/** Folds a single event into the local verification snapshot. */
function reduce(current: VerificationDto, event: AnyVerificationEvent): VerificationDto {
  switch (event.name) {
    case 'image.analyzed':
      return { ...current, image: event.data.image };

    case 'stage.updated':
      return {
        ...current,
        status: current.status === 'pending' ? 'processing' : current.status,
        stages: applyStageState(current.stages, event.data.stage, {
          state: event.data.state,
          detail: event.data.detail ?? null,
          error: event.data.error ?? null,
        }),
      };

    case 'face.detected':
      return { ...current, face: event.data.face };

    case 'face.encoded':
      return { ...current, encoding: event.data.encoding };

    case 'reverse-search.completed':
      return { ...current, reverseSearch: event.data.search };

    case 'match.found':
    case 'match.not-found':
      return { ...current, match: event.data.match };

    case 'evidence.created':
      return { ...current, evidence: event.data.evidence };

    case 'evidence.hashed':
      return { ...current, evidenceHash: event.data.evidenceHash };

    case 'blockchain.confirmed':
      return { ...current, blockchain: event.data.blockchain };

    case 'verification.completed':
      return { ...current, status: event.data.status };

    case 'verification.failed':
      return {
        ...current,
        status: 'failed',
        error: event.data.message,
        errorCode: event.data.code,
      };

    default:
      return current;
  }
}
