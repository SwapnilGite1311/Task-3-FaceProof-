'use client';

import * as React from 'react';
import { CircleCheck, CircleX, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { formatDateTimeUTC, type VerificationProofCheck } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataRow, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { HashValue } from '@/components/ui/hash-value';
import { ApiError, fetchProofCheck } from '@/lib/api';
import { cn } from '@/lib/utils';

const VERDICT_COPY: Record<
  VerificationProofCheck['verdict'],
  { label: string; tone: 'success' | 'fail' | 'warn'; body: string }
> = {
  VALID: {
    label: 'Valid',
    tone: 'success',
    body: 'The stored evidence document hashes to the digest recorded in the FaceProof contract. The record has not been altered since it was anchored.',
  },
  TAMPERED: {
    label: 'Tampered',
    tone: 'fail',
    body: 'The stored evidence no longer reproduces the anchored hash. Something has been changed after the fact.',
  },
  NOT_ANCHORED: {
    label: 'Not anchored',
    tone: 'warn',
    body: 'No record for this evidence hash exists in the contract, so there is no independent timestamp for it.',
  },
  UNVERIFIABLE: {
    label: 'Unverifiable',
    tone: 'warn',
    body: 'The check could not be completed. See the notes below for the reason.',
  },
};

/**
 * Runs the API's independent re-verification: recompute the hash from the
 * stored document, then read the contract over RPC. Deliberately a user-driven
 * action rather than something shown as already-true.
 */
export function ProofCheck({
  verificationId,
  className,
}: {
  verificationId: string;
  className?: string;
}) {
  const [result, setResult] = React.useState<VerificationProofCheck | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchProofCheck(verificationId));
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'The verification check could not be run.',
      );
    } finally {
      setLoading(false);
    }
  };

  const verdict = result ? VERDICT_COPY[result.verdict] : null;

  return (
    <Panel
      className={cn(
        className,
        result?.verdict === 'VALID' && 'border-mint-500/20',
        result?.verdict === 'TAMPERED' && 'border-rose-fail/25',
      )}
    >
      <PanelHeader
        eyebrow="Independent check"
        title="Re-verify this record"
        action={
          verdict ? (
            <Badge tone={verdict.tone}>
              {result?.verdict === 'VALID' ? (
                <CircleCheck className="size-3" />
              ) : result?.verdict === 'TAMPERED' ? (
                <CircleX className="size-3" />
              ) : (
                <TriangleAlert className="size-3" />
              )}
              {verdict.label}
            </Badge>
          ) : null
        }
      />

      <PanelBody className="space-y-5">
        <p className="text-[13.5px] leading-relaxed text-mist-400">
          This recomputes the SHA-256 of the stored evidence document from scratch and reads the
          FaceProof contract directly over RPC. It does not trust the hash stored in the database.
        </p>

        {error ? (
          <p className="rounded-lg border border-rose-fail/25 bg-rose-fail/[0.06] p-3.5 text-[13px] text-rose-fail">
            {error}
          </p>
        ) : null}

        {result ? (
          <>
            <p
              className={cn(
                'rounded-lg border p-3.5 text-[13.5px] leading-relaxed',
                result.verdict === 'VALID'
                  ? 'border-mint-500/25 bg-mint-500/[0.06] text-mint-300'
                  : result.verdict === 'TAMPERED'
                    ? 'border-rose-fail/25 bg-rose-fail/[0.06] text-rose-fail'
                    : 'border-amber-warn/25 bg-amber-warn/[0.06] text-amber-warn',
              )}
            >
              {verdict?.body}
            </p>

            <dl>
              <DataRow label="Stored hash" align="start">
                <HashValue value={result.evidenceHashStored} label="stored hash" />
              </DataRow>
              <DataRow label="Recomputed hash" align="start">
                <HashValue value={result.evidenceHashRecomputed} label="recomputed hash" />
              </DataRow>
              <DataRow label="Hashes agree">
                <span className={result.evidenceHashMatches ? 'text-mint-400' : 'text-rose-fail'}>
                  {result.evidenceHashMatches ? 'Yes' : 'No'}
                </span>
              </DataRow>
              <DataRow label="Found on chain">
                <span className={result.onChainFound ? 'text-mint-400' : 'text-amber-warn'}>
                  {result.onChainFound ? 'Yes' : 'No'}
                </span>
              </DataRow>
              {result.onChainTimestamp ? (
                <DataRow label="Block timestamp">
                  {formatDateTimeUTC(result.onChainTimestamp)}
                </DataRow>
              ) : null}
              {result.onChainVerifier ? (
                <DataRow label="Anchored by" align="start">
                  <HashValue
                    value={result.onChainVerifier}
                    grouped={false}
                    label="verifier address"
                  />
                </DataRow>
              ) : null}
              <DataRow label="Checked at">{formatDateTimeUTC(result.checkedAt)}</DataRow>
            </dl>

            {result.notes.length > 0 ? (
              <ul className="space-y-2 border-t border-[var(--hairline)] pt-4">
                {result.notes.map((note) => (
                  <li key={note} className="text-[12.5px] leading-relaxed text-mist-500">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        <Button onClick={run} disabled={loading} variant={result ? 'outline' : 'primary'}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              Checking…
            </>
          ) : (
            <>
              <ShieldCheck />
              {result ? 'Check again' : 'Run independent check'}
            </>
          )}
        </Button>
      </PanelBody>
    </Panel>
  );
}
