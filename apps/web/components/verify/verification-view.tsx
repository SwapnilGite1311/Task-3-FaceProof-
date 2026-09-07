'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  Download,
  Loader2,
  Radio,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { formatDateTimeUTC } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { HashValue } from '@/components/ui/hash-value';
import { useVerificationStream } from '@/hooks/use-verification-stream';
import { certificateUrlFor, imageUrlFor } from '@/lib/api';
import { PipelineTimeline } from './pipeline-timeline';
import { LiveLog } from './live-log';
import { FacePanel } from './face-panel';
import { CandidateList } from './candidate-list';
import { MatchPanel } from './match-panel';
import { EvidencePanel } from './evidence-panel';
import { BlockchainPanel } from './blockchain-panel';
import { ProofCheck } from './proof-check';
import { cn } from '@/lib/utils';

export function VerificationView({ id }: { id: string }) {
  const { verification, events, status, loadError, finished } = useVerificationStream(id);

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
        <Panel className="border-rose-fail/25 p-8 text-center">
          <CircleX className="mx-auto size-8 text-rose-fail" strokeWidth={1.5} />
          <h1 className="mt-5 text-xl font-medium text-mist-50">Verification unavailable</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-mist-400">{loadError}</p>
          <Button asChild variant="outline" className="mt-7">
            <Link href="/verify">
              <ArrowLeft />
              Start a new verification
            </Link>
          </Button>
        </Panel>
      </div>
    );
  }

  if (!verification) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Skeleton className="h-9 w-72" />
        <div className="mt-10 grid gap-6 lg:grid-cols-[380px_1fr]">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  const scanning = verification.stages.some(
    (stage) => stage.id === 'face_detection' && stage.state === 'processing',
  );
  const running = !finished;
  const failed = verification.status === 'failed';
  const noMatch = verification.status === 'completed_no_match';
  const succeeded = verification.status === 'completed';

  const failedStage = verification.stages.find((stage) => stage.state === 'failed');

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="flex flex-wrap items-center gap-3">
          <div className="label">Verification</div>
          <HashValue value={verification.id} grouped={false} label="verification id" />
          {verification.demo ? <Badge tone="warn">Demo record</Badge> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <h1
            className={cn(
              'text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em]',
              failed ? 'text-rose-fail' : 'text-mist-50',
            )}
          >
            {running
              ? 'Verification in progress'
              : failed
                ? 'Verification failed'
                : noMatch
                  ? 'Complete — no reliable match'
                  : 'Verification complete'}
          </h1>

          <div className="flex items-center gap-2">
            {running ? (
              status === 'live' ? (
                <Badge tone="success">
                  <Radio className="size-3 animate-pulse" />
                  Live
                </Badge>
              ) : status === 'error' ? (
                <Badge tone="warn">
                  <WifiOff className="size-3" />
                  Reconnecting
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <Loader2 className="size-3 animate-spin" />
                  Connecting
                </Badge>
              )
            ) : succeeded ? (
              <Badge tone="success">
                <CircleCheck className="size-3" />
                Anchored
              </Badge>
            ) : noMatch ? (
              <Badge tone="warn">
                <TriangleAlert className="size-3" />
                No match
              </Badge>
            ) : (
              <Badge tone="fail">
                <CircleX className="size-3" />
                Failed
              </Badge>
            )}
          </div>
        </div>

        <p className="mt-3 text-[13.5px] text-mist-500">
          Started {formatDateTimeUTC(verification.createdAt)}
          {verification.completedAt
            ? ` · finished ${formatDateTimeUTC(verification.completedAt)}`
            : ''}
        </p>
      </header>

      {/* ── Failure banner ─────────────────────────────────────────────────── */}
      {failed ? (
        <Panel className="mb-8 border-rose-fail/25 bg-rose-fail/[0.04]">
          <PanelBody>
            <div className="flex gap-4">
              <CircleX className="mt-0.5 size-5 shrink-0 text-rose-fail" strokeWidth={1.5} />
              <div className="min-w-0">
                <h2 className="text-[15px] font-medium text-mist-50">
                  {failedStage
                    ? `The pipeline stopped at ${failedStage.id.replace(/_/g, ' ')}`
                    : 'The pipeline stopped'}
                </h2>
                <p className="mt-2 text-[14px] leading-relaxed text-mist-200">
                  {verification.error ?? 'An unexpected error occurred.'}
                </p>
                {failedStage?.detail ? (
                  <p className="mt-3 text-[13px] leading-relaxed text-mist-500">
                    {failedStage.detail}
                  </p>
                ) : null}
                {verification.errorCode ? (
                  <p className="mt-3 font-mono text-[12px] text-mist-600">
                    {verification.errorCode}
                  </p>
                ) : null}
                <p className="mt-4 text-[12.5px] leading-relaxed text-mist-600">
                  Nothing downstream of this stage ran, so no result is being reported as
                  successful. Whatever the earlier stages did produce is shown below.
                </p>
              </div>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr] lg:items-start">
        {/* ── Pipeline column ──────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-24">
          <Panel>
            <PanelHeader
              eyebrow="Live pipeline"
              title="Verification stages"
              action={
                <span className="hash text-[11px] text-mist-600">
                  {verification.stages.filter((stage) => stage.state === 'completed').length}/8
                </span>
              }
            />
            <PanelBody>
              <PipelineTimeline stages={verification.stages} />
            </PanelBody>
          </Panel>

          <div className="mt-4">
            <div className="label mb-2 px-1">Event stream</div>
            <LiveLog events={events} />
          </div>
        </div>

        {/* ── Results column ───────────────────────────────────────────────── */}
        <div className="space-y-6">
          <FacePanel
            imageUrl={imageUrlFor(verification.id)}
            image={verification.image}
            face={verification.face}
            encoding={verification.encoding}
            scanning={scanning}
          />

          {verification.match ? (
            <MatchPanel
              match={verification.match}
              originalImageUrl={imageUrlFor(verification.id)}
            />
          ) : null}

          {verification.reverseSearch ? (
            <CandidateList
              search={verification.reverseSearch}
              candidates={verification.match?.candidates ?? []}
              bestMatchUrl={verification.match?.bestMatch?.sourceUrl}
            />
          ) : null}

          {verification.evidenceHash ? (
            <EvidencePanel
              verificationId={verification.id}
              evidence={verification.evidence}
              evidenceHash={verification.evidenceHash}
            />
          ) : null}

          {verification.blockchain ? (
            <BlockchainPanel
              record={verification.blockchain}
              evidenceHash={verification.evidenceHash}
            />
          ) : null}

          {finished && verification.evidenceHash ? (
            <ProofCheck verificationId={verification.id} />
          ) : null}

          {finished ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--hairline)] bg-gradient-to-br from-mint-500/[0.05] to-transparent p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[15px] font-medium text-mist-50">
                  Download the evidence certificate
                </h2>
                <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-mist-500">
                  A tamper-evident digital evidence record — not a legal proof of identity.
                </p>
              </div>
              <Button asChild className="shrink-0">
                <a href={certificateUrlFor(verification.id)} target="_blank" rel="noopener noreferrer">
                  <Download />
                  Download PDF
                </a>
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild variant="ghost">
              <Link href="/verify">
                <ArrowLeft />
                New verification
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
