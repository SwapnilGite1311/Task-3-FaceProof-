'use client';

import { CircleAlert, ExternalLink, SearchX } from 'lucide-react';
import { formatPercent, type EvidenceStrength, type MatchAnalysis } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { ScoreBar } from './score-bar';
import { cn } from '@/lib/utils';

const STRENGTH_TONE: Record<EvidenceStrength, 'success' | 'info' | 'warn' | 'fail'> = {
  HIGH: 'success',
  MODERATE: 'info',
  LOW: 'warn',
  INSUFFICIENT: 'fail',
};

export function MatchPanel({
  match,
  originalImageUrl,
  className,
}: {
  match: MatchAnalysis;
  originalImageUrl: string;
  className?: string;
}) {
  const best = match.bestMatch;

  if (!best) {
    return (
      <Panel className={cn('border-amber-warn/20', className)}>
        <PanelHeader
          eyebrow="Step 05 · Social media verification"
          title="No reliable match found"
          action={<Badge tone="warn">Below threshold</Badge>}
        />
        <PanelBody>
          <div className="flex gap-4">
            <SearchX className="mt-0.5 size-5 shrink-0 text-amber-warn" strokeWidth={1.5} />
            <div className="min-w-0">
              <p className="text-[14px] leading-relaxed text-mist-200">
                {/* The backend's reason is already specific to what happened —
                    zero results, unreachable images, or scores below the bar —
                    so it is shown verbatim rather than paraphrased here. */}
                {match.rejectionReason ??
                  `No candidate met the configured verification threshold of ${formatPercent(
                    match.threshold,
                    0,
                  )}.`}
              </p>
              <p className="mt-4 text-[12.5px] leading-relaxed text-mist-600">
                No match has been manufactured to fill the gap. The evidence document records this
                outcome honestly and is anchored all the same, so the analysis itself is
                timestamped.
              </p>
            </div>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  const candidateImage = best.imageUrl ?? best.thumbnailUrl;

  return (
    <Panel className={className}>
      <PanelHeader
        eyebrow="Step 05 · Social media verification"
        title="Match found"
        action={
          <Badge tone={STRENGTH_TONE[match.evidenceStrength]}>
            {match.evidenceStrength} confidence
          </Badge>
        }
      />

      {/* Side-by-side comparison */}
      <div className="grid gap-px bg-[var(--hairline)] sm:grid-cols-2">
        <figure className="bg-ink-900 p-5">
          <figcaption className="label mb-3">Original</figcaption>
          <div className="aspect-square overflow-hidden rounded-lg border border-[var(--hairline)] bg-ink-950">
            <img
              src={originalImageUrl}
              alt="Submitted image"
              className="size-full object-contain"
            />
          </div>
        </figure>

        <figure className="bg-ink-900 p-5">
          <figcaption className="label mb-3 flex items-center justify-between">
            <span>Matched source</span>
            {best.platform ? <span className="text-mint-400">{best.platform}</span> : null}
          </figcaption>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-[var(--hairline)] bg-ink-950">
            {candidateImage ? (
              <img
                src={candidateImage}
                alt={best.title ?? 'Matched source image'}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="size-full object-contain"
              />
            ) : (
              <div className="grid size-full place-items-center px-6 text-center">
                <p className="text-[12.5px] leading-relaxed text-mist-600">
                  The platform did not expose a fetchable image for this post.
                </p>
              </div>
            )}
          </div>
          {best.handle ? (
            <p className="mt-3 font-mono text-[13px] text-mist-200">{best.handle}</p>
          ) : null}
        </figure>
      </div>

      <PanelBody className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <ScoreBar
            label="Visual similarity"
            value={best.visualSimilarity}
            hint="64-bit DCT perceptual hash agreement."
          />
          <ScoreBar
            label="Face similarity"
            value={best.faceSimilarity}
            tone="iris"
            hint={
              best.faceCosine !== undefined
                ? `Calibrated; raw cosine ${best.faceCosine.toFixed(4)}. 50% is the model's own decision boundary.`
                : 'No face was detected in the candidate image.'
            }
          />
          <ScoreBar
            label="Overall confidence"
            value={match.confidence}
            threshold={match.threshold}
            hint={`Threshold ${formatPercent(match.threshold, 0)}.`}
          />
        </div>

        <div className="panel-inset p-4">
          <div className="label mb-3">Why this candidate</div>
          <ul className="space-y-2">
            {best.matchReasons.map((reason) => (
              <li key={reason} className="flex gap-2.5 text-[13px] leading-relaxed text-mist-200">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-mint-400" />
                {reason}
              </li>
            ))}
          </ul>

          {best.warnings.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t border-[var(--hairline)] pt-3">
              {best.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex gap-2.5 text-[13px] leading-relaxed text-amber-warn"
                >
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="label mb-1.5">Source URL</div>
            <p className="hash truncate text-mist-300" title={best.sourceUrl}>
              {best.sourceUrl}
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <a href={best.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              Open original post
              <ExternalLink />
            </a>
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}
