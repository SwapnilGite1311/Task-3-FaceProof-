'use client';

import * as React from 'react';
import { ChevronDown, Download, FileJson } from 'lucide-react';
import type { EvidenceDocument } from '@faceproof/shared';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { HashValue } from '@/components/ui/hash-value';
import { evidenceUrlFor } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Shows the exact document that was hashed, so the digest can be reproduced by
 * hand. The canonical bytes are fetched from the API rather than re-serialised
 * in the browser — a locally re-encoded copy would not necessarily be
 * byte-identical, which would defeat the point.
 */
export function EvidencePanel({
  verificationId,
  evidence,
  evidenceHash,
  className,
}: {
  verificationId: string;
  evidence: EvidenceDocument | null;
  evidenceHash: string | null;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [canonical, setCanonical] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const reveal = async () => {
    setOpen((previous) => !previous);
    if (canonical || loading) return;

    setLoading(true);
    try {
      const response = await fetch(evidenceUrlFor(verificationId), { cache: 'no-store' });
      setCanonical(
        response.ok ? await response.text() : 'The canonical document could not be loaded.',
      );
    } catch {
      setCanonical('The canonical document could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel className={className}>
      <PanelHeader
        eyebrow="Step 06 · Evidence"
        title="Canonical evidence document"
        action={
          <Button asChild size="sm" variant="ghost">
            <a href={evidenceUrlFor(verificationId)} target="_blank" rel="noopener noreferrer">
              <Download />
              JSON
            </a>
          </Button>
        }
      />

      <PanelBody className="space-y-5">
        <div>
          <div className="label mb-2">Evidence SHA-256</div>
          <HashValue value={evidenceHash} label="evidence hash" />
        </div>

        {evidence ? (
          <p className="text-[13px] leading-relaxed text-mist-500">
            Serialised with sorted keys, no whitespace and scores quantised to six decimals, then
            hashed. Reproduce it yourself with{' '}
            <span className="hash">curl … /evidence | sha256sum</span> — the result must equal the
            digest above and the value recorded on chain.
          </p>
        ) : (
          <p className="text-[13px] text-mist-500">No evidence document has been generated yet.</p>
        )}

        {evidence ? (
          <div>
            <button
              type="button"
              onClick={reveal}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-[13px] text-mist-300 transition-colors hover:bg-white/[0.05]"
              aria-expanded={open}
            >
              <span className="flex items-center gap-2">
                <FileJson className="size-4 text-mist-500" />
                {open ? 'Hide' : 'Show'} the exact bytes that were hashed
              </span>
              <ChevronDown
                className={cn('size-4 transition-transform', open && 'rotate-180')}
              />
            </button>

            {open ? (
              <pre className="panel-inset mt-3 max-h-80 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-mist-300">
                {loading ? 'Loading…' : (canonical ?? '')}
              </pre>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
