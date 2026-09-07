'use client';

import { CircleCheck, CircleX, ExternalLink, Loader2 } from 'lucide-react';
import { formatDateTimeUTC, type BlockchainRecordDto } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataRow, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { HashValue } from '@/components/ui/hash-value';
import { cn } from '@/lib/utils';

export function BlockchainPanel({
  record,
  evidenceHash,
  className,
}: {
  record: BlockchainRecordDto | null;
  evidenceHash: string | null;
  className?: string;
}) {
  if (!record) {
    return (
      <Panel className={className}>
        <PanelHeader eyebrow="Step 07 · Blockchain anchor" title="Not anchored" />
        <PanelBody>
          <p className="text-[14px] leading-relaxed text-mist-400">
            No transaction has been submitted for this verification, so the evidence carries no
            independent timestamp.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const confirmed = record.status === 'confirmed';
  const failed = record.status === 'failed';

  return (
    <Panel
      className={cn(
        className,
        confirmed && 'border-mint-500/20',
        failed && 'border-rose-fail/25',
      )}
    >
      <PanelHeader
        eyebrow="Step 07 · Blockchain anchor"
        title="Blockchain proof"
        action={
          confirmed ? (
            <Badge tone="success">
              <CircleCheck className="size-3" />
              Anchored
            </Badge>
          ) : failed ? (
            <Badge tone="fail">
              <CircleX className="size-3" />
              Failed
            </Badge>
          ) : (
            <Badge tone="warn">
              <Loader2 className="size-3 animate-spin" />
              Submitting
            </Badge>
          )
        }
      />

      <PanelBody className="py-2">
        <dl>
          <DataRow label="Network">
            <span className="text-mist-100">{record.network}</span>
            <span className="ml-2 text-mist-500">chain id {record.chainId}</span>
          </DataRow>

          <DataRow label="Evidence hash" align="start">
            <HashValue value={evidenceHash ?? record.evidenceHash} label="evidence hash" />
          </DataRow>

          <DataRow label="Transaction" align="start">
            {record.transactionHash ? (
              <HashValue value={record.transactionHash} label="transaction hash" />
            ) : (
              <span className="text-mist-600">—</span>
            )}
          </DataRow>

          <DataRow label="Block">
            <span className="font-mono text-[13px] tabular-nums text-mist-100">
              {record.blockNumber ?? 'pending'}
            </span>
            {record.confirmations !== null ? (
              <span className="ml-3 text-[12.5px] text-mist-500">
                {record.confirmations} confirmation{record.confirmations === 1 ? '' : 's'}
              </span>
            ) : null}
          </DataRow>

          <DataRow label="Timestamp">
            <span className="text-mist-100">{formatDateTimeUTC(record.timestamp)}</span>
          </DataRow>

          {record.gasUsed ? (
            <DataRow label="Gas used">
              <span className="font-mono text-[13px] tabular-nums text-mist-300">
                {record.gasUsed}
              </span>
            </DataRow>
          ) : null}

          <DataRow label="Contract" align="start">
            <HashValue value={record.contractAddress} grouped={false} label="contract address" />
          </DataRow>
        </dl>

        {record.error ? (
          <p className="mt-4 rounded-lg border border-rose-fail/25 bg-rose-fail/[0.06] p-3.5 text-[13px] leading-relaxed text-rose-fail">
            {record.error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          {record.transactionHash && record.explorerTxUrl ? (
            <Button asChild variant={confirmed ? 'primary' : 'outline'}>
              <a href={record.explorerTxUrl} target="_blank" rel="noopener noreferrer">
                View transaction
                <ExternalLink />
              </a>
            </Button>
          ) : null}
          {record.contractAddress && record.explorerContractUrl ? (
            <Button asChild variant="ghost">
              <a href={record.explorerContractUrl} target="_blank" rel="noopener noreferrer">
                View contract
                <ExternalLink />
              </a>
            </Button>
          ) : null}
        </div>

        {!record.explorerTxUrl ? (
          <p className="mt-4 text-[12.5px] leading-relaxed text-amber-warn/90">
            This network has no public block explorer, so the transaction cannot be opened in one.
            The record is still a real on-chain transaction and the independent check below reads it
            back directly from the contract.
          </p>
        ) : null}

        <p className="mt-5 text-[12px] leading-relaxed text-mist-600">
          Only the evidence hash, the platform label, the public post URL and the block timestamp
          are written on chain. No image, no face embedding and no personal data is ever sent to
          the blockchain.
        </p>
      </PanelBody>
    </Panel>
  );
}
