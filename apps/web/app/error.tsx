'use client';

import * as React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the browser console so the cause is not silently swallowed.
    console.error('FaceProof UI error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-32 text-center sm:px-8">
      <TriangleAlert className="size-8 text-amber-warn" strokeWidth={1.5} />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-mist-50">
        Something broke while rendering this page
      </h1>
      <p className="mt-4 text-[14.5px] leading-relaxed text-mist-400">
        {error.message || 'An unexpected client-side error occurred.'}
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[12px] text-mist-600">digest {error.digest}</p>
      ) : null}
      <Button onClick={reset} variant="outline" className="mt-8">
        <RotateCcw />
        Try again
      </Button>
    </div>
  );
}
