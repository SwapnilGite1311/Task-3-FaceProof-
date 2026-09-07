import { EventEmitter } from 'node:events';
import type {
  AnyVerificationEvent,
  VerificationEventName,
  VerificationEventPayloads,
} from '@faceproof/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

/**
 * Verification event bus.
 *
 * Every event is written to the database *before* it is broadcast, so a client
 * that connects late — or reconnects after a dropped SSE stream — can replay
 * the full history from its last sequence number and end up in exactly the same
 * state as a client that was connected from the start. The frontend therefore
 * never has to guess or animate progress it has not actually been told about.
 */
const bus = new EventEmitter();
// One SSE consumer per open tab, plus internal listeners. Raise the default 10.
bus.setMaxListeners(0);

const CHANNEL = 'verification-event';

/**
 * Per-verification write queue. Sequence numbers must be gap-free and strictly
 * increasing, so emissions for the same verification are serialised.
 */
const queues = new Map<string, Promise<void>>();
const counters = new Map<string, number>();

async function nextSequence(verificationId: string): Promise<number> {
  const cached = counters.get(verificationId);
  if (cached !== undefined) {
    const next = cached + 1;
    counters.set(verificationId, next);
    return next;
  }

  const last = await prisma.verificationEvent.findFirst({
    where: { verificationId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });

  const next = (last?.seq ?? 0) + 1;
  counters.set(verificationId, next);
  return next;
}

export function emitVerificationEvent<N extends VerificationEventName>(
  verificationId: string,
  name: N,
  data: VerificationEventPayloads[N],
): Promise<void> {
  const previous = queues.get(verificationId) ?? Promise.resolve();

  const task = previous
    .catch(() => undefined)
    .then(async () => {
      const seq = await nextSequence(verificationId);
      const event = {
        seq,
        name,
        verificationId,
        at: new Date().toISOString(),
        data,
      } as AnyVerificationEvent;

      try {
        await prisma.verificationEvent.create({
          data: {
            verificationId,
            seq,
            name,
            data: data as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // A failure to persist must not silence the live stream; the client
        // still gets the event, it just cannot be replayed after a reconnect.
        logger.warn({ err: error, verificationId, name }, 'Failed to persist verification event');
      }

      bus.emit(CHANNEL, event);
      bus.emit(`${CHANNEL}:${verificationId}`, event);
    });

  queues.set(verificationId, task);
  return task;
}

export type EventHandler = (event: AnyVerificationEvent) => void;

export function subscribe(verificationId: string, handler: EventHandler): () => void {
  const channel = `${CHANNEL}:${verificationId}`;
  bus.on(channel, handler);
  return () => {
    bus.off(channel, handler);
  };
}

/** Every event recorded for a verification after `afterSeq`, in order. */
export async function replayEvents(
  verificationId: string,
  afterSeq = 0,
): Promise<AnyVerificationEvent[]> {
  const rows = await prisma.verificationEvent.findMany({
    where: { verificationId, seq: { gt: afterSeq } },
    orderBy: { seq: 'asc' },
  });

  return rows.map(
    (row) =>
      ({
        seq: row.seq,
        name: row.name as VerificationEventName,
        verificationId: row.verificationId,
        at: row.createdAt.toISOString(),
        data: row.data,
      }) as AnyVerificationEvent,
  );
}

/** Frees the in-memory sequence counter once a job is finished. */
export function releaseEventCounter(verificationId: string): void {
  counters.delete(verificationId);
  queues.delete(verificationId);
}

/** Waits for all queued writes for a verification to settle. */
export async function flushEvents(verificationId: string): Promise<void> {
  await (queues.get(verificationId) ?? Promise.resolve());
}
