import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The single surface primitive: a hairline-bordered glass panel.
 * Everything in the app is built from this rather than from nested cards, which
 * is what keeps the interface reading as an instrument instead of a dashboard.
 */
export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-5 py-4 sm:px-6',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="label mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-[15px] font-medium tracking-tight text-mist-50">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PanelBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('px-5 py-5 sm:px-6', className)}>{children}</div>;
}

/** Label/value row used throughout the results and proof panels. */
export function DataRow({
  label,
  children,
  className,
  align = 'center',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-[var(--hairline)] py-3 last:border-b-0 sm:flex-row sm:gap-6',
        align === 'center' ? 'sm:items-center' : 'sm:items-start',
        className,
      )}
    >
      <dt className="label shrink-0 sm:w-48 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-mist-100">{children}</dd>
    </div>
  );
}
