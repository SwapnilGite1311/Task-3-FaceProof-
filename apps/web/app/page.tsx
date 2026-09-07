import Link from 'next/link';
import { ArrowRight, Cpu, FileLock2, Radar, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { PipelineChain } from '@/components/landing/pipeline-chain';

const FEATURES = [
  {
    icon: Cpu,
    title: 'AI FACE ANALYSIS',
    body: 'Detect and encode faces from submitted images.',
    detail:
      'An SSD MobileNet V1 detector locates every face and returns its bounding box and score. The strongest face is encoded into a 128-dimension embedding that never leaves memory.',
  },
  {
    icon: Radar,
    title: 'GENUINE SOURCE DISCOVERY',
    body: 'Search the web for real image matches.',
    detail:
      'A live reverse-image-search provider is queried with the actual image. Every candidate it returns is downloaded and compared — nothing is assumed, and nothing is invented.',
  },
  {
    icon: FileLock2,
    title: 'TAMPER-EVIDENT PROOF',
    body: 'Anchor evidence hashes on blockchain.',
    detail:
      'The findings are serialised into a canonical JSON document, hashed with SHA-256, and that digest is written to a public contract on Polygon Amoy.',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="grid-field absolute inset-0 -z-10" />
        <div
          aria-hidden
          className="absolute left-1/2 top-0 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-mint-500/[0.07] blur-[130px]"
        />

        <div className="mx-auto max-w-6xl px-5 pt-20 pb-16 sm:px-8 sm:pt-28">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <Badge tone="neutral" className="mb-7">
                <span className="size-1.5 rounded-full bg-mint-400" />
                Face analysis · source discovery · on-chain evidence
              </Badge>

              <h1 className="text-[clamp(2.75rem,7vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-mist-50">
                Verify.
                <br />
                Match.
                <br />
                <span className="bg-gradient-to-r from-mint-300 to-iris-400 bg-clip-text text-transparent">
                  Prove.
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-[16.5px] leading-relaxed text-mist-400">
                Detect a face, discover its real image source, and create a tamper-evident
                blockchain proof.
              </p>

              <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-mist-500">
                FaceProof connects visual identity analysis, genuine reverse-image discovery, and
                blockchain-backed evidence into one verifiable pipeline.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/verify">
                    Start verification
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/how-it-works">How it works</Link>
                </Button>
              </div>
            </div>

            <Panel className="p-6 sm:p-8">
              <div className="mb-6 flex items-center justify-between">
                <div className="label">Verification pipeline</div>
                <div className="hash text-mist-600">v1.0.0</div>
              </div>
              <PipelineChain />
            </Panel>
          </div>
        </div>
      </section>

      {/* ── Feature cards ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Panel key={feature.title} className="p-6">
                <Icon className="size-5 text-mint-400" strokeWidth={1.5} />
                <h3 className="mt-5 text-[12px] font-medium tracking-[0.16em] text-mist-100">
                  {feature.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-mist-200">{feature.body}</p>
                <p className="mt-3 text-[13px] leading-relaxed text-mist-500">{feature.detail}</p>
              </Panel>
            );
          })}
        </div>
      </section>

      {/* ── What it is / is not ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
        <Panel className="overflow-hidden">
          <div className="grid divide-y divide-[var(--hairline)] md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-7 sm:p-9">
              <div className="label mb-4 text-mint-400">What a FaceProof record is</div>
              <ul className="space-y-3 text-[14px] leading-relaxed text-mist-300">
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mint-400" />
                  Proof that a specific evidence document existed at or before a specific block.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mint-400" />
                  A record of what a live reverse-image search genuinely returned, and how closely
                  each candidate matched.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mint-400" />
                  Independently checkable: anyone can recompute the hash and read the contract.
                </li>
              </ul>
            </div>

            <div className="p-7 sm:p-9">
              <div className="label mb-4 flex items-center gap-2 text-amber-warn">
                <ShieldQuestion className="size-3.5" />
                What it is not
              </div>
              <ul className="space-y-3 text-[14px] leading-relaxed text-mist-400">
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mist-600" />
                  It does not prove that a person owns the discovered social-media account.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mist-600" />
                  It does not prove anyone&apos;s identity.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-mist-600" />
                  Similarity scores indicate computational similarity, not legal identity.
                  Automated face comparison produces both false positives and false negatives.
                </li>
              </ul>
            </div>
          </div>
        </Panel>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[var(--radius-panel)] border border-[var(--hairline)] bg-gradient-to-br from-mint-500/[0.06] to-transparent p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="text-2xl font-medium tracking-tight text-mist-50">
              Run the full pipeline on a real photograph.
            </h2>
            <p className="mt-2 max-w-xl text-[14px] text-mist-400">
              Every stage below runs for real: live search, real downloads, a real SHA-256 and a
              real testnet transaction you can open on the block explorer.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/verify">
              Start verification
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
