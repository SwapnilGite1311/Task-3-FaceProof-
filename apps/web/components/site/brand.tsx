import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The mark: a reticle with a face-scan bracket. Drawn inline as SVG so it stays
 * crisp, themeable and free of an extra network request.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-7', className)}
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      {/* corner brackets - the framing of a detected face */}
      <path
        d="M8 12V9.5A1.5 1.5 0 0 1 9.5 8H12M20 8h2.5A1.5 1.5 0 0 1 24 9.5V12M24 20v2.5a1.5 1.5 0 0 1-1.5 1.5H20M12 24H9.5A1.5 1.5 0 0 1 8 22.5V20"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* the scan line */}
      <path
        d="M10.5 16h11"
        stroke="var(--color-mint-400)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.6" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.55" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        'group inline-flex items-center gap-2.5 text-mist-50 transition-opacity hover:opacity-85',
        className,
      )}
    >
      <Mark className="size-6 text-mist-200 sm:size-7" />
      <span className="whitespace-nowrap text-[13px] font-semibold tracking-[0.14em] sm:text-[15px] sm:tracking-[0.16em]">
        FACEPROOF
      </span>
    </Link>
  );
}
