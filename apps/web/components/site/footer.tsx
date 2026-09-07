import Link from 'next/link';
import { Mark } from './brand';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2.5">
              <Mark className="size-6 text-mist-400" />
              <span className="text-[13px] font-semibold tracking-[0.16em] text-mist-200">
                FACEPROOF
              </span>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-mist-500">
              FaceProof creates a tamper-evident record linking the submitted image analysis to a
              discovered public source. Similarity scores indicate computational similarity, not
              legal identity.
            </p>
          </div>

          <div className="flex gap-14">
            <div>
              <div className="label mb-3">Product</div>
              <ul className="space-y-2 text-[13px]">
                <li>
                  <Link href="/verify" className="text-mist-400 transition-colors hover:text-mist-100">
                    Verify an image
                  </Link>
                </li>
                <li>
                  <Link
                    href="/how-it-works"
                    className="text-mist-400 transition-colors hover:text-mist-100"
                  >
                    How it works
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <div className="label mb-3">Privacy</div>
              <ul className="space-y-2 text-[13px] text-mist-500">
                <li>Embeddings held in memory only</li>
                <li>No biometric data on chain</li>
                <li>Only a hash is anchored</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-[var(--hairline)] pt-6">
          <p className="text-[11px] leading-relaxed text-mist-600">
            FaceProof does not prove that a person owns a social-media account and does not
            establish identity. A blockchain record proves only that a specific evidence document
            existed at or before a specific block.
          </p>
        </div>
      </div>
    </footer>
  );
}
