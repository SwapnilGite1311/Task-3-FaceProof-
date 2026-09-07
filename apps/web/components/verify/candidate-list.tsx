'use client';

import * as React from 'react';
import { ChevronDown, ExternalLink, ImageOff } from 'lucide-react';
import { formatPercent, type AnalysedCandidate, type ReverseSearchSummary } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { cn, pluralize } from '@/lib/utils';

const INITIAL_VISIBLE = 6;

/**
 * Everything the reverse-image search actually returned, with the measured
 * score for each candidate. Showing the rejects — including the ones whose
 * images could not be downloaded — is what makes the "best match" claim
 * checkable rather than asserted.
 */
export function CandidateList({
  search,
  candidates,
  bestMatchUrl,
  className,
}: {
  search: ReverseSearchSummary | null;
  candidates: AnalysedCandidate[];
  bestMatchUrl?: string | undefined;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? candidates : candidates.slice(0, INITIAL_VISIBLE);
  const hidden = candidates.length - visible.length;

  return (
    <Panel className={className}>
      <PanelHeader
        eyebrow="Step 04 · Reverse image search"
        title={
          search
            ? `${search.totalResults} ${pluralize(search.totalResults, 'candidate')} found`
            : 'Reverse image search'
        }
        action={search ? <Badge tone="neutral">{search.provider}</Badge> : null}
      />

      {search && search.totalResults === 0 ? (
        <PanelBody>
          <p className="text-[14px] leading-relaxed text-mist-300">
            {search.note ??
              'The provider completed the search successfully but found no public copies of this image.'}
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-mist-600">
            An empty result set is a real outcome, not a failure. Images that have never been
            published, or that a crawler has not indexed, genuinely have no public source to find.
          </p>
        </PanelBody>
      ) : (
        <>
          <ul className="divide-y divide-[var(--hairline)]">
            {visible.map((candidate, index) => (
              <CandidateRow
                key={`${candidate.sourceUrl}-${index}`}
                candidate={candidate}
                rank={index + 1}
                isBest={candidate.sourceUrl === bestMatchUrl}
              />
            ))}
          </ul>

          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex w-full items-center justify-center gap-2 border-t border-[var(--hairline)] py-3.5 text-[13px] text-mist-400 transition-colors hover:bg-white/[0.03] hover:text-mist-100"
            >
              Show {hidden} more {pluralize(hidden, 'candidate')}
              <ChevronDown className="size-3.5" />
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function CandidateRow({
  candidate,
  rank,
  isBest,
}: {
  candidate: AnalysedCandidate;
  rank: number;
  isBest: boolean;
}) {
  const thumbnail = candidate.thumbnailUrl ?? candidate.imageUrl;

  return (
    <li
      className={cn(
        'flex gap-4 px-5 py-4 transition-colors sm:px-6',
        isBest ? 'bg-mint-500/[0.05]' : 'hover:bg-white/[0.02]',
      )}
    >
      <span className="hash w-6 shrink-0 pt-1 text-mist-600">
        {String(rank).padStart(2, '0')}
      </span>

      <div className="size-14 shrink-0 overflow-hidden rounded-md border border-[var(--hairline)] bg-ink-950">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-mist-600">
            <ImageOff className="size-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {candidate.platform ? (
            <Badge tone={isBest ? 'success' : 'info'}>{candidate.platform}</Badge>
          ) : (
            <span className="text-[12px] text-mist-500">{candidate.domain ?? 'unknown host'}</span>
          )}
          {candidate.handle ? (
            <span className="font-mono text-[12px] text-mist-300">{candidate.handle}</span>
          ) : null}
          {isBest ? <Badge tone="success">Best match</Badge> : null}
        </div>

        {candidate.title ? (
          <p className="mt-1.5 truncate text-[13.5px] text-mist-200" title={candidate.title}>
            {candidate.title}
          </p>
        ) : null}

        <a
          href={candidate.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-flex max-w-full items-center gap-1.5 text-[12px] text-mist-500 transition-colors hover:text-mint-400"
        >
          <span className="truncate font-mono">{candidate.sourceUrl}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>

        {candidate.unavailableReason ? (
          <p className="mt-1.5 text-[12px] text-amber-warn/80">{candidate.unavailableReason}</p>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            'font-mono text-[15px] tabular-nums',
            isBest ? 'text-mint-300' : candidate.imageFetched ? 'text-mist-200' : 'text-mist-600',
          )}
        >
          {formatPercent(candidate.confidence, 1)}
        </div>
        <div className="label mt-0.5">confidence</div>

        {candidate.imageFetched ? (
          <div className="mt-2 space-y-0.5 text-[11px] text-mist-600">
            <div>vis {formatPercent(candidate.visualSimilarity, 0)}</div>
            <div>face {formatPercent(candidate.faceSimilarity, 0)}</div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
