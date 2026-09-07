'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn, groupHash } from '@/lib/utils';

/**
 * Renders a hash so a person can actually compare it against another one:
 * monospace, grouped into blocks of eight, with a copy affordance.
 */
export function HashValue({
  value,
  className,
  truncate = false,
  grouped = true,
  label,
}: {
  value: string | null | undefined;
  className?: string;
  truncate?: boolean;
  grouped?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(timeout.current), []);

  if (!value) {
    return <span className={cn('hash text-mist-600', className)}>—</span>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the value is still selectable by hand.
    }
  };

  const display = truncate
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : grouped
      ? groupHash(value).join(' ')
      : value;

  return (
    <span className={cn('group inline-flex items-start gap-2', className)}>
      <span className="hash leading-relaxed">{display}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${label ?? 'value'}`}
        className={cn(
          'mt-px shrink-0 rounded p-1 text-mist-600 transition-colors',
          'hover:text-mint-400 focus-visible:text-mint-400',
          copied && 'text-mint-400',
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
