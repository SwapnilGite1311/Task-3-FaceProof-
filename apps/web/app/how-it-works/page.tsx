import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'The seven steps of the FaceProof verification pipeline, explained.',
};

const STEPS = [
  {
    n: '01',
    title: 'UPLOAD',
    lead: 'Submit an image.',
    body: 'The file is validated by its magic bytes rather than its extension, decoded to confirm it is a real image, and fingerprinted with SHA-256 over the exact bytes received. Nothing is written to disk before that check passes.',
  },
  {
    n: '02',
    title: 'ANALYZE',
    lead: 'Detect and encode the face.',
    body: 'An SSD MobileNet V1 detector returns a bounding box and confidence score for every face. The highest-scoring face is passed through a recognition network to produce a 128-dimension embedding, which is L2-normalised so comparisons are pure cosine similarity.',
  },
  {
    n: '03',
    title: 'SEARCH',
    lead: 'Perform genuine reverse-image search.',
    body: 'The image is sent to a live reverse-image-search provider. Providers that need a URL receive a temporary, expiring, signed link that is deleted the moment the search returns. Providers that accept uploads receive the bytes directly.',
  },
  {
    n: '04',
    title: 'MATCH',
    lead: 'Analyze candidate social-media sources.',
    body: 'Each returned candidate is downloaded through an SSRF-hardened fetcher and compared two ways: a DCT perceptual hash for visual similarity, and a face embedding comparison where both images contain a face. Candidates that cannot be reached are reported as unreachable, never guessed at.',
  },
  {
    n: '05',
    title: 'HASH',
    lead: 'Create a canonical evidence fingerprint.',
    body: 'The findings are serialised into a canonical JSON document — sorted keys, no whitespace, quantised scores — so the same inputs always produce the same bytes. That document is hashed with SHA-256.',
  },
  {
    n: '06',
    title: 'ANCHOR',
    lead: 'Record the fingerprint on Polygon.',
    body: 'The digest, the platform label and the public post URL are written to the FaceProof contract on the Polygon Amoy testnet. No image, no embedding and no personal data is ever sent on chain.',
  },
  {
    n: '07',
    title: 'VERIFY',
    lead: 'Anyone can independently verify the record.',
    body: 'The evidence JSON is served verbatim, so a third party can pipe it through sha256sum and compare the result with what the contract holds. If either the document or the stored hash has been altered, the check fails.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
      <header className="max-w-2xl">
        <div className="label mb-4">The pipeline</div>
        <h1 className="text-[clamp(2.25rem,5vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-mist-50">
          How FaceProof works
        </h1>
        <p className="mt-6 text-[15.5px] leading-relaxed text-mist-400">
          Seven steps, each of which either produces a real result or reports honestly that it
          could not. No stage is simulated, and no stage reports success on behalf of another.
        </p>
      </header>

      <ol className="mt-14 space-y-px">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="group grid gap-4 border-t border-[var(--hairline)] py-8 sm:grid-cols-[88px_1fr] sm:gap-8"
          >
            <div className="hash pt-1 text-[22px] font-medium text-mist-600 transition-colors group-hover:text-mint-400">
              {step.n}
            </div>
            <div>
              <h2 className="text-[13px] font-medium tracking-[0.18em] text-mist-100">
                {step.title}
              </h2>
              <p className="mt-2.5 text-[16px] text-mist-200">{step.lead}</p>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-mist-500">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <Panel className="mt-16 p-7 sm:p-9">
        <div className="label mb-4">Privacy by construction</div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[14px] font-medium text-mist-100">What is never stored</h3>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-mist-500">
              <li>Face embeddings — held in memory for the job, then zeroed.</li>
              <li>Biometric templates of any kind in the database.</li>
              <li>Anything at all about candidate images beyond public URLs and scores.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-mist-100">What goes on chain</h3>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-mist-500">
              <li>The evidence hash.</li>
              <li>The platform label, when a match was found.</li>
              <li>The public post URL, when a match was found.</li>
              <li>The block timestamp.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/verify">
            Start verification
            <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
