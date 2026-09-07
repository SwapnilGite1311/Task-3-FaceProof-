'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Loader2, ServerCrash } from 'lucide-react';
import { formatBytes } from '@faceproof/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelBody, PanelHeader, DataRow } from '@/components/ui/panel';
import { HashValue } from '@/components/ui/hash-value';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropzone } from '@/components/verify/dropzone';
import { useImageInspection } from '@/hooks/use-image-inspection';
import { ApiError, createVerification, fetchMeta, type ApiMeta } from '@/lib/api';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export default function VerifyUploadPage() {
  const router = useRouter();

  const [file, setFile] = React.useState<File | null>(null);
  const [meta, setMeta] = React.useState<ApiMeta | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; hint: string | null } | null>(null);

  const inspection = useImageInspection(file);
  const maxBytes = meta?.maxUploadBytes ?? DEFAULT_MAX_BYTES;

  React.useEffect(() => {
    let cancelled = false;
    void fetchMeta()
      .then((value) => {
        if (!cancelled) setMeta(value);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setMetaError(
          cause instanceof ApiError
            ? cause.message
            : 'The FaceProof API could not be reached.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async () => {
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const verification = await createVerification(file);
      router.push(`/verify/${verification.id}`);
    } catch (cause) {
      setSubmitting(false);
      if (cause instanceof ApiError) {
        setError({ message: cause.message, hint: cause.hint });
      } else {
        setError({
          message: 'The verification could not be started.',
          hint: cause instanceof Error ? cause.message : null,
        });
      }
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="mb-10">
        <div className="label mb-3">Step 01 · Upload</div>
        <h1 className="text-[clamp(2rem,4.5vw,2.75rem)] font-semibold leading-tight tracking-[-0.03em] text-mist-50">
          Submit an image
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mist-400">
          Use a photograph where a face is clearly visible. The pipeline runs for real from here:
          a live reverse-image search, real candidate downloads, and a real transaction on Polygon
          Amoy.
        </p>
      </header>

      {metaError ? (
        <Panel className="mb-8 border-rose-fail/25 bg-rose-fail/[0.04] p-5">
          <div className="flex gap-3">
            <ServerCrash className="mt-0.5 size-4 shrink-0 text-rose-fail" />
            <div>
              <p className="text-[14px] text-mist-100">{metaError}</p>
              <p className="mt-1.5 text-[13px] text-mist-500">
                Start the API with <span className="hash">npm run dev:api</span> and confirm{' '}
                <span className="hash">NEXT_PUBLIC_API_URL</span> points at it.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {meta?.demoMode ? (
        <Panel className="mb-8 border-amber-warn/25 bg-amber-warn/[0.05] p-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-warn" />
            <div>
              <p className="text-[14px] text-mist-100">Demo mode is enabled on the API.</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-mist-500">
                No reverse-image search will be performed and no blockchain transaction will be
                sent. Records produced now are flagged as demo and are rejected by the independent
                verification endpoint. Set <span className="hash">DEMO_MODE=false</span> for a real
                verification.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      <Dropzone
        file={file}
        onSelect={setFile}
        onClear={() => {
          setFile(null);
          setError(null);
        }}
        maxBytes={maxBytes}
        disabled={submitting}
        previewUrl={inspection?.previewUrl}
      />

      {file && inspection ? (
        <Panel className="mt-4">
          <PanelHeader
            eyebrow="Selected file"
            title={file.name}
            action={
              <Badge tone="neutral">{file.type.replace('image/', '').toUpperCase()}</Badge>
            }
          />
          <PanelBody className="py-2">
            <dl>
              <DataRow label="File size">{formatBytes(file.size)}</DataRow>
              <DataRow label="Dimensions">
                {inspection.width > 0 ? (
                  `${inspection.width} × ${inspection.height} px`
                ) : (
                  <Skeleton className="h-4 w-28" />
                )}
              </DataRow>
              <DataRow label="SHA-256" align="start">
                {inspection.hashing ? (
                  <Skeleton className="h-4 w-full max-w-sm" />
                ) : inspection.sha256 ? (
                  <HashValue value={inspection.sha256} label="file hash" />
                ) : (
                  <span className="text-[13px] text-mist-500">
                    Unavailable in this browser context — the server will compute it.
                  </span>
                )}
              </DataRow>
            </dl>
          </PanelBody>
        </Panel>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-panel)] border border-rose-fail/25 bg-rose-fail/[0.05] p-5"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-fail" />
            <div>
              <p className="text-[14px] text-mist-100">{error.message}</p>
              {error.hint ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-mist-500">{error.hint}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={start} disabled={!file || submitting}>
          {submitting ? (
            <>
              <Loader2 className="animate-spin" />
              Creating verification…
            </>
          ) : (
            <>
              Start verification
              <ArrowRight />
            </>
          )}
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/how-it-works">What happens next?</Link>
        </Button>
      </div>

      <p className="mt-8 text-[12.5px] leading-relaxed text-mist-600">
        Your image is stored only so the results page can display it beside any match found. The
        face embedding generated from it is held in memory for the duration of the job and then
        discarded — it is never written to the database and never sent to the blockchain.
      </p>
    </div>
  );
}
