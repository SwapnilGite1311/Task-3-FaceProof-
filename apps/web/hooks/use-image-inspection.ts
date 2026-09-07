'use client';

import * as React from 'react';

export interface ImageInspection {
  previewUrl: string;
  width: number;
  height: number;
  /** SHA-256 of the file, computed in the browser with Web Crypto. */
  sha256: string | null;
  hashing: boolean;
  error: string | null;
}

/**
 * Inspects a chosen file entirely client-side: object URL for preview, real
 * pixel dimensions from a decode, and a SHA-256 over the exact bytes.
 *
 * Computing the digest here lets the user compare it against the one the server
 * reports back. If the two ever differed, the file was altered in transit.
 * `crypto.subtle` requires a secure context, which localhost satisfies; if it
 * is unavailable the rest of the inspection still works and the digest is
 * simply reported as unavailable.
 */
export function useImageInspection(file: File | null): ImageInspection | null {
  const [state, setState] = React.useState<ImageInspection | null>(null);

  React.useEffect(() => {
    if (!file) {
      setState(null);
      return;
    }

    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);

    setState({
      previewUrl: objectUrl,
      width: 0,
      height: 0,
      sha256: null,
      hashing: true,
      error: null,
    });

    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setState((previous) =>
        previous ? { ...previous, width: image.naturalWidth, height: image.naturalHeight } : previous,
      );
    };
    image.onerror = () => {
      if (cancelled) return;
      setState((previous) =>
        previous
          ? { ...previous, error: 'This file could not be decoded as an image.', hashing: false }
          : previous,
      );
    };
    image.src = objectUrl;

    void (async () => {
      try {
        if (!globalThis.crypto?.subtle) {
          throw new Error('Web Crypto is unavailable in this context.');
        }
        const buffer = await file.arrayBuffer();
        const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
        if (cancelled) return;
        const hex = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        setState((previous) => (previous ? { ...previous, sha256: hex, hashing: false } : previous));
      } catch {
        if (cancelled) return;
        setState((previous) => (previous ? { ...previous, hashing: false } : previous));
      }
    })();

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return state;
}
