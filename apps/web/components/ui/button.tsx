'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-mint-400 text-ink-950 hover:bg-mint-300 active:bg-mint-500 shadow-[0_0_0_1px_rgba(78,233,198,0.35),0_8px_28px_-12px_rgba(78,233,198,0.55)]',
        outline:
          'border border-[var(--hairline-strong)] bg-transparent text-mist-100 hover:bg-white/[0.04] hover:border-[color-mix(in_oklab,var(--color-mint-400)_35%,transparent)]',
        ghost: 'bg-transparent text-mist-400 hover:text-mist-100 hover:bg-white/[0.04]',
        subtle: 'bg-white/[0.05] text-mist-100 hover:bg-white/[0.09]',
        danger: 'bg-rose-fail/15 text-rose-fail border border-rose-fail/30 hover:bg-rose-fail/25',
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-10 rounded-lg px-4 text-sm [&_svg]:size-4',
        lg: 'h-12 rounded-xl px-6 text-[15px] [&_svg]:size-4',
        icon: 'size-9 rounded-lg [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
