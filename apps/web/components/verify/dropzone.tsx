'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ImageUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@faceproof/shared';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export function Dropzone({
  file,
  onSelect,
  onClear,
  maxBytes,
  disabled,
  previewUrl,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  maxBytes: number;
  disabled?: boolean;
  previewUrl?: string | undefined;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const accept = React.useCallback(
    (candidate: File | undefined) => {
      setLocalError(null);
      if (!candidate) return;

      if (!ACCEPTED.includes(candidate.type)) {
        setLocalError(
          `${candidate.name || 'That file'} is not a JPG, PNG or WEBP image.`,
        );
        return;
      }
      if (candidate.size > maxBytes) {
        setLocalError(
          `${formatBytes(candidate.size)} exceeds the ${formatBytes(maxBytes)} upload limit.`,
        );
        return;
      }
      onSelect(candidate);
    },
    [maxBytes, onSelect],
  );

  // A drop anywhere else on the page should not navigate away from the app.
  React.useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  if (file && previewUrl) {
    return (
      <div className="panel overflow-hidden">
        <div className="relative aspect-[16/10] bg-ink-950">
          <img
            src={previewUrl}
            alt="Selected upload preview"
            className="size-full object-contain"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(4,5,10,0.7))]"
          />
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg border border-[var(--hairline-strong)] bg-ink-950/80 text-mist-400 backdrop-blur transition-colors hover:text-rose-fail"
              aria-label="Remove selected image"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <motion.div
        whileHover={disabled ? {} : { scale: 1.004 }}
        transition={{ duration: 0.2 }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'relative overflow-hidden rounded-[var(--radius-panel)] border border-dashed transition-colors duration-200',
          dragging
            ? 'border-mint-400/70 bg-mint-500/[0.06]'
            : 'border-[var(--hairline-strong)] bg-ink-900/60 hover:border-mist-600/60',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <div aria-hidden className="grid-field absolute inset-0 opacity-60" />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="relative flex w-full flex-col items-center justify-center gap-5 px-6 py-20 text-center sm:py-28"
        >
          <div
            className={cn(
              'grid size-16 place-items-center rounded-2xl border transition-colors',
              dragging
                ? 'border-mint-400/50 bg-mint-500/10'
                : 'border-[var(--hairline)] bg-ink-850',
            )}
          >
            <ImageUp
              className={cn('size-7 transition-colors', dragging ? 'text-mint-300' : 'text-mist-400')}
              strokeWidth={1.4}
            />
          </div>

          <div>
            <div className="text-[16px] font-medium text-mist-50">
              {dragging ? 'Drop to load the image' : 'Drop a photograph here'}
            </div>
            <div className="mt-1.5 text-[13.5px] text-mist-500">
              or click to browse — JPG, PNG or WEBP up to {formatBytes(maxBytes)}
            </div>
          </div>

          <div className="hash text-[11px] text-mist-600">
            SHA-256 is computed in your browser before anything is uploaded
          </div>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Allow re-selecting the same file after a clear.
            event.target.value = '';
          }}
        />
      </motion.div>

      {localError ? (
        <p role="alert" className="mt-3 text-[13px] text-rose-fail">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
