import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-[var(--hairline-strong)] bg-white/[0.04] text-mist-400',
        success: 'border-mint-500/30 bg-mint-500/10 text-mint-300',
        warn: 'border-amber-warn/30 bg-amber-warn/10 text-amber-warn',
        fail: 'border-rose-fail/30 bg-rose-fail/10 text-rose-fail',
        info: 'border-iris-400/30 bg-iris-400/10 text-iris-400',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
