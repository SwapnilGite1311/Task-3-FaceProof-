'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Wordmark } from './brand';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/verify', label: 'Verify' },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--hairline)] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-8">
        <Wordmark />

        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-md px-2 py-2 text-[12.5px] transition-colors sm:px-3 sm:text-[13px]',
                  active ? 'text-mist-50' : 'text-mist-400 hover:text-mist-100',
                )}
              >
                {item.label}
              </Link>
            );
          })}

          <Button asChild size="sm" variant="outline" className="ml-2 hidden sm:inline-flex">
            <Link href="/verify">
              Start verification
              <ArrowUpRight />
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
