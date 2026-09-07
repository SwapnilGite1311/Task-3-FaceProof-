# FaceProof

**Verify. Match. Prove.**

FaceProof detects a face in a submitted image, discovers where that image genuinely appears on
the public web, compares every candidate it finds, and anchors a tamper-evident fingerprint of the
result on a public blockchain.

```
Image → Face detection → Face encoding → Reverse search → Social verification → Evidence hash → Polygon
```

---

## Table of contents

- [Overview](#overview)
- [What a FaceProof record does and does not claim](#what-a-faceproof-record-does-and-does-not-claim)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment setup](#environment-setup)
- [Database](#database)
- [Smart contract](#smart-contract)
- [Running locally](#running-locally)
- [Reverse image search](#reverse-image-search)
- [Blockchain](#blockchain)
- [Demo: the exact end-to-end procedure](#demo-the-exact-end-to-end-procedure)
- [API reference](#api-reference)
- [Testing](#testing)
- [Security](#security)
- [Privacy](#privacy)
- [Technical decisions](#technical-decisions)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## Overview

Given a photograph, FaceProof runs an eight-stage pipeline:

| # | Stage | What actually happens |
|---|-------|----------------------|
| 01 | Image analysis | Media type determined from magic bytes, image decoded, SHA-256 taken over the exact uploaded bytes, 64-bit DCT perceptual hash computed. |
| 02 | Face detection | SSD MobileNet V1 returns a bounding box and confidence score for every face. |
| 03 | Face encoding | The highest-scoring face is encoded into a 128-dimension, L2-normalised embedding. |
| 04 | Reverse image search | A live third-party reverse-image-search API is queried with the real image. |
| 05 | Social verification | Every candidate is downloaded and compared by perceptual hash and, where possible, by face embedding. |
| 06 | Evidence generation | Findings are serialised into a canonical JSON document and hashed with SHA-256. |
| 07 | Blockchain anchor | The digest is written to the `FaceProof` contract on Polygon Amoy. |
| 08 | Complete | The record is final and independently checkable by anyone. |

Every result the UI shows comes from that pipeline. There are no hardcoded search results, no
fabricated similarity scores and no simulated transactions. When a stage cannot produce a result —
no face in the image, a search that returns nothing, a candidate image behind a login wall — the UI
says so plainly instead of substituting something plausible.

---

## What a FaceProof record does and does not claim

**It does claim:** that a specific evidence document existed at or before a specific block, and
that a live reverse-image search returned specific public URLs which scored specific similarities
against the submitted image.

**It does not claim:**

- that the person in the image owns, controls or appears in the discovered account,
- anything at all about anyone's identity,
- legal proof of anything.

Similarity scores indicate computational similarity, not legal identity. Automated face comparison
produces both false positives and false negatives. This wording is used consistently in the UI and
in the generated certificate, and it is not decoration — it is the accurate description of what the
system measures.

---

## Architecture

```
                          ┌──────────────────────────┐
        USER ── image ───▶ │   Next.js 15 (App Router) │
                          └────────────┬─────────────┘
                                       │ multipart POST
                                       ▼
                          ┌──────────────────────────┐
                          │  Fastify 5 · TypeScript   │
                          └────────────┬─────────────┘
                                       │
      ┌──────────┬──────────┬──────────┼──────────┬────────────┬─────────────┐
      ▼          ▼          ▼          ▼          ▼            ▼             ▼
  ┌───────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐
  │ face  │ │reverse-│ │ social  │ │evidence│ │blockch.│ │ storage  │ │verification│
  │       │ │ search │ │(match)  │ │        │ │        │ │(temp url)│ │(orchestr.) │
  └───┬───┘ └───┬────┘ └────┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘ └─────┬──────┘
      │         │           │          │          │           │             │
   TF.js     SerpApi     pHash +    canonical  ethers v6    local/S3    state machine
   WASM      / TinEye    embedding  JSON+SHA256                          + event log
                                       │          │                        │
                                       ▼          ▼                        ▼
                                 PostgreSQL   Polygon Amoy            SSE stream
                                  (Prisma)     (FaceProof.sol)      → live pipeline UI
```

**Backend modules** (`apps/api/src/modules/`), each independently testable:

- `face/` — model loading, detection, embedding, and an in-memory TTL store for embeddings
- `reverse-search/` — a provider interface plus SerpApi (Google Lens / Google Reverse Image) and TinEye implementations
- `social/` — candidate download, comparison and scoring
- `evidence/` — canonical evidence assembly, hashing and the PDF certificate
- `blockchain/` — `BlockchainService` (`connect`, `createRecord`, `waitForConfirmation`, `getTransaction`, `verifyRecord`)
- `storage/` — temporary public hosting for URL-based search providers
- `verification/` — the orchestrator, the stage state machine, the event log, and the HTTP routes

**Real-time:** the API emits Server-Sent Events. Every event is written to a `VerificationEvent`
table *before* it is broadcast, so a client that connects late — or reconnects after a dropped
connection — replays the full history from its `Last-Event-ID` and lands in exactly the state a
client connected from the start would be in. The frontend never animates ahead of the backend.

---

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20.11** | Tested on Node 20, 22 and 25. No native compilation is required. |
| **PostgreSQL 14+** | Via the included `docker-compose.yml` (`npm run db:up`), or without Docker via `npm run db:local`. A managed instance (Neon, Supabase, RDS) also works. |
| **Reverse-image-search credentials** | A [SerpApi](https://serpapi.com) key (default) or [TinEye API](https://services.tineye.com/TinEyeAPI) credentials. Both are paid services; SerpApi has a free monthly allowance. |
| **A funded Polygon Amoy wallet** | Any EVM private key. Test POL is free from the [Polygon faucet](https://faucet.polygon.technology). |
| **A Polygon Amoy RPC URL** | The public endpoint works but is rate-limited; a free Alchemy or Infura key is much more reliable. |
| **A public tunnel** *(SerpApi only)* | `cloudflared` or `ngrok`, so SerpApi can fetch the image. Not needed with TinEye or S3 storage — see [Reverse image search](#reverse-image-search). |

There is **no Redis, no message queue and no external cache**. Progress events use an in-process
event bus backed by a database table.

---

## Installation

```bash
git clone <your-repo-url>
cd faceproof

# installs all workspaces, builds the shared package,
# copies the face model weights into place, generates the Prisma client
npm run setup
```

`npm run setup` is equivalent to:

```bash
npm install
npm run build:shared
npm run models:fetch      # ~12 MB of model weights, copied from node_modules
npm run prisma:generate
```

---

## Environment setup

There is **one** `.env` file, in the repository root. The API, the web app and the Hardhat config
all read it.

```bash
cp .env.example .env
```

Then generate a signing secret and paste it into `SIGNING_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### Every variable

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | no | `development` \| `test` \| `production`. Default `development`. |
| `API_PORT` / `API_HOST` | no | Where Fastify listens. Default `4000` / `0.0.0.0`. |
| `CORS_ORIGINS` | yes | Comma-separated browser origins allowed to call the API. Must include your web origin (`http://localhost:3000`). |
| `PUBLIC_BASE_URL` | for SerpApi | Internet-reachable base URL of the API, used to build temporary image URLs. A `localhost` value is rejected at startup when a URL-based search provider is selected. |
| `DATABASE_URL` | **yes** | PostgreSQL connection string. |
| `NEXT_PUBLIC_API_URL` | **yes** | API origin the browser calls. Baked in at build time. |
| `REVERSE_SEARCH_PROVIDER` | **yes** | `serpapi_google_lens` (default) \| `serpapi_google_reverse_image` \| `tineye`. |
| `REVERSE_SEARCH_API_KEY` | for SerpApi | Your SerpApi key. |
| `TINEYE_API_USERNAME` / `TINEYE_API_PASSWORD` | for TinEye | TinEye HTTP Basic credentials. |
| `REVERSE_SEARCH_TIMEOUT_MS` | no | Per-search timeout. Default `45000`. |
| `REVERSE_SEARCH_MAX_RESULTS` | no | Cap on normalised results. Default `40`. |
| `STORAGE_PROVIDER` | no | `local` (API serves a signed URL) \| `s3` (any S3-compatible bucket). Default `local`. |
| `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_BASE_URL` | for `s3` | Bucket configuration. `STORAGE_ENDPOINT` switches on path-style addressing for MinIO/R2. |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | no | Lifetime of the temporary image URL. Default `900`. |
| `POLYGON_RPC_URL` | **yes** | Amoy RPC endpoint. |
| `BLOCKCHAIN_NETWORK`, `BLOCKCHAIN_CHAIN_ID`, `BLOCKCHAIN_EXPLORER_URL` | no | Defaults describe Polygon Amoy (`80002`, `https://amoy.polygonscan.com`). The chain id is verified against the RPC at connect time. |
| `BLOCKCHAIN_PRIVATE_KEY` | **yes** | `0x`-prefixed 64-hex private key of a funded account. **Server-side only — never exposed to the browser.** |
| `FACEPROOF_CONTRACT_ADDRESS` | **yes** | Address printed by the deploy script. |
| `BLOCKCHAIN_CONFIRMATIONS` | no | Confirmations to wait for. Default `1`. |
| `BLOCKCHAIN_CONFIRMATION_TIMEOUT_MS` | no | Default `180000`. |
| `POLYGONSCAN_API_KEY` | no | Only for `hardhat verify`. |
| `MATCH_CONFIDENCE_THRESHOLD` | no | Minimum combined confidence before a candidate is reported as a match. Default `0.62`. |
| `MATCH_MAX_CANDIDATES_ANALYSED` | no | How many candidates get downloaded and compared. Default `12`. |
| `FACE_MODELS_DIR` | no | Where model weights live. Default `./models` inside `apps/api`. |
| `FACE_MIN_CONFIDENCE` | no | Detector threshold. Default `0.5`. |
| `MAX_UPLOAD_SIZE_MB` | no | Default `10`. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | no | Default 60 requests per minute per IP. |
| `SIGNING_SECRET` | **yes** | ≥32 characters. Signs temporary image URLs. |
| `DEMO_MODE` | no | **Must be `false`** for real verifications. See [Demo mode](#demo-mode). |

The API **refuses to start** if a fatal value is missing, and tells you exactly which one and how to
fix it. Run `npm run doctor -w @faceproof/api` at any time for a full preflight report.

---

## Database

Start PostgreSQL. Either path gives you a real PostgreSQL server:

```bash
npm run db:up        # Docker:    docker compose up -d postgres
npm run db:local     # No Docker: runs an embedded PostgreSQL in .pgdata/
```

`db:local` exists because Docker Desktop is a heavyweight install on Windows. It starts a genuine
PostgreSQL server from the `embedded-postgres` package — same wire protocol, same SQL, no system
installation — and keeps its data in `.pgdata/` (gitignored). Leave it running in its own terminal;
Ctrl+C shuts it down cleanly, and a lock file left behind by an ungraceful kill is cleaned up
automatically on the next start.

Apply the schema:

```bash
npm run prisma:migrate     # development: creates/applies a migration
# or, against an existing database:
npm run prisma:deploy -w @faceproof/api
```

An initial migration is checked in at `apps/api/prisma/migrations/20260101000000_init/`, so
`prisma migrate deploy` works on a clean database without generating anything first.

Inspect the data with `npm run prisma:studio`.

### Schema

- **`Verification`** — status, image metadata and hashes, face summary, search summary, match
  analysis, canonical evidence, evidence hash, and the serialised stage list that drives the UI.
- **`Match`** — the winning candidate: platform, handle, post URL, similarities, confidence,
  evidence strength, match reasons.
- **`BlockchainRecord`** — network, chain id, contract, transaction hash, block number, gas,
  confirmations, status.
- **`VerificationEvent`** — append-only, gap-free event log (`@@unique([verificationId, seq])`)
  that backs SSE replay.

Face embeddings appear in **none** of these tables. See [Privacy](#privacy).

---

## Smart contract

`contracts/FaceProof.sol` is a minimal, permissionless notary.

```solidity
struct Verification {
    bytes32 evidenceHash;
    string  platform;
    string  postUrl;
    uint256 timestamp;
    address verifier;
}

function createVerification(bytes32 evidenceHash, string calldata platform, string calldata postUrl)
    external returns (uint256 blockTimestamp);

event VerificationCreated(bytes32 indexed evidenceHash, string platform, string postUrl, uint256 timestamp);
```

It also exposes `getVerification`, `tryGetVerification` (non-reverting), `exists`, `total` and
`evidenceHashAt` for enumeration. Duplicate hashes, the zero hash and over-long strings are
rejected with custom errors.

Compile, test and deploy:

```bash
npm run contracts:compile
npm run contracts:test        # 7 tests
npm run contracts:deploy      # → Polygon Amoy
```

The deploy script prints the address and writes `contracts/deployments/amoy.json`. Copy the printed
line into your `.env`:

```
FACEPROOF_CONTRACT_ADDRESS=0x…
```

Optionally verify the source on Polygonscan:

```bash
npm run verify:amoy -w @faceproof/contracts -- <address>
```

---

## Running locally

```bash
npm run dev          # api on :4000 and web on :3000, together
```

or separately:

```bash
npm run dev:api      # Fastify with hot reload
npm run dev:web      # Next.js
```

Production build:

```bash
npm run build
npm start -w @faceproof/api
npm start -w @faceproof/web
```

Before a demo, always run the preflight:

```bash
npm run doctor -w @faceproof/api
```

It checks configuration, database reachability and schema, model weights, search-provider
credentials, RPC reachability, that a contract actually exists at the configured address, and that
the signing wallet has gas. It exits non-zero if anything would make a real verification fail.

---

## Reverse image search

The provider is behind an interface, selected with `REVERSE_SEARCH_PROVIDER`:

```ts
interface ReverseSearchProvider {
  search(image: Buffer, context?: ReverseSearchContext): Promise<ReverseSearchResult[]>;
}
```

Results from every provider are normalised into the same shape, de-duplicated by canonical URL
(tracking parameters stripped), and validated — anything that fails URL validation is **dropped**,
never repaired, because a URL we cannot safely fetch is not evidence.

### `serpapi_google_lens` — the default

**Why:** Google Lens indexes social platforms far more aggressively than classic reverse image
search, which is what makes a genuine Instagram/X/Facebook match realistic rather than theoretical.
SerpApi is used because Google publishes no official Lens API.

**Constraint:** SerpApi fetches the image *by URL* — it does not accept uploads. The image
therefore has to be publicly reachable for the duration of the search. Two supported options:

1. `STORAGE_PROVIDER=local` — the API serves the image itself at
   `${PUBLIC_BASE_URL}/api/v1/temp/<key>?exp=…&sig=…`, behind an expiring HMAC signature, and
   deletes the file the moment the search returns (including on failure). **`PUBLIC_BASE_URL` must
   be internet-reachable**, so in local development run a tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   # or: ngrok http 4000
   # then set PUBLIC_BASE_URL to the https URL it prints
   ```

2. `STORAGE_PROVIDER=s3` — upload to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) and
   hand SerpApi a pre-signed GET URL. No tunnel needed. `docker compose --profile storage up -d`
   starts a local MinIO if you want to try it.

### `serpapi_google_reverse_image`

Classic Google reverse image search through SerpApi. Same URL constraint. Better at finding exact
re-publications on ordinary websites, weaker on social platforms.

### `tineye` — no tunnel, no storage

TinEye accepts a **direct multipart upload**, so it needs neither a public URL nor object storage.
That makes it the pragmatic choice for a laptop behind NAT. The trade-off is coverage: TinEye
indexes exact and derivative copies rather than semantically similar images, and its social-platform
coverage is thinner.

```env
REVERSE_SEARCH_PROVIDER=tineye
TINEYE_API_USERNAME=...
TINEYE_API_PASSWORD=...
```

### How candidates are scored

For each candidate the pipeline downloads the image (through an SSRF-hardened fetcher) and measures:

- **Visual similarity** — agreement of 64-bit DCT perceptual hashes. Survives rescaling and
  re-encoding, which is exactly what happens to an image re-uploaded to a social platform.
- **Colour similarity** — cosine similarity of an 8×8 mean-RGB signature. A secondary signal, since
  a perceptual hash ignores colour.
- **Face similarity** — cosine similarity of the two 128-D embeddings, **calibrated** (see below).
- **Platform weight** — whether the source URL belongs to a recognised public platform.

Confidence is a weighted combination whose weights depend on what could actually be measured. A
candidate whose image could not be downloaded is capped at 0.25 and flagged, so missing evidence can
never masquerade as strong evidence.

**Calibration of face similarity.** The raw cosine between two face embeddings occupies a narrow
band: two *different* people typically score 0.75–0.82, the same person 0.95+. Reporting the raw
cosine as a percentage would be actively misleading ("81 % similar" for two strangers). The model's
documented decision boundary is a Euclidean distance of 0.6 between descriptors; for L2-normalised
vectors `d² = 2(1 − cos)`, so `d = 0.6` is `cos = 0.82`. The reported score maps cosine so that
**0.5 is exactly that boundary**:

| raw cosine | reported |
|---|---|
| ≤ 0.65 | 0 % |
| 0.82 | 50 % — the model's own threshold |
| 1.00 | 100 % |

The raw cosine is shown alongside the calibrated score in the UI so nothing is hidden.

---

## Blockchain

**Network:** Polygon Amoy testnet (chain id `80002`), the successor to Mumbai.

1. Get an RPC URL — `https://rpc-amoy.polygon.technology` works, or use a free Alchemy/Infura key.
2. Create a wallet and put its private key in `BLOCKCHAIN_PRIVATE_KEY`.
3. Fund it at <https://faucet.polygon.technology> (select **Polygon Amoy**). A deployment plus
   dozens of verifications costs a fraction of one test POL.
4. `npm run contracts:deploy`, then paste the address into `FACEPROOF_CONTRACT_ADDRESS`.

### Verifying a transaction yourself

Every completed verification shows a transaction hash and a **View transaction** link built from
`BLOCKCHAIN_EXPLORER_URL` — nothing is hardcoded. To check a record without trusting this
application at all:

```bash
# 1. fetch the canonical evidence document and hash it yourself
curl -s http://localhost:4000/api/v1/verifications/<id>/evidence | sha256sum

# 2. compare with what the contract holds
#    (the UI's "Run independent check" button does exactly this, over RPC)
curl -s http://localhost:4000/api/v1/verifications/<id>/verify | jq
```

`GET /verify` deliberately ignores the stored hash column: it re-canonicalises the stored document,
re-hashes it, then reads the contract directly. It returns one of `VALID`, `TAMPERED`,
`NOT_ANCHORED` or `UNVERIFIABLE`, with notes explaining why.

---

## Demo: the exact end-to-end procedure

**Preconditions**

```bash
npm run setup
npm run db:up            # or: npm run db:local  (no Docker required)
npm run prisma:migrate
# .env: DATABASE_URL, SIGNING_SECRET, REVERSE_SEARCH_API_KEY,
#       BLOCKCHAIN_PRIVATE_KEY (funded), POLYGON_RPC_URL, DEMO_MODE=false
npm run contracts:deploy     # paste FACEPROOF_CONTRACT_ADDRESS into .env
# if using SerpApi: start a tunnel and set PUBLIC_BASE_URL to its https URL
npm run doctor -w @faceproof/api   # must report "Ready."
npm run dev
```

**The demo**

1. Open <http://localhost:3000>.
2. Click **Start verification**.
3. Upload a real photograph. The page shows its filename, size, dimensions and a SHA-256 computed
   **in your browser** before anything is uploaded.
4. Click **Start verification**. You land on `/verify/<id>`.
5. Watch the pipeline: stage 02 marks the face detected and draws the bounding box over your image.
6. Stage 03 reports the 128-D embedding.
7. Stage 04 shows the live search starting, then how many candidates came back.
8. Stage 05 compares each candidate; the strongest genuine match is identified.
9. The matched image appears beside your original.
10. Visual similarity, face similarity and overall confidence are shown against the threshold.
11. Stage 06 builds the evidence JSON — expand **Show the exact bytes that were hashed**.
12. The SHA-256 of that document appears.
13. Stage 07 submits the transaction; the hash appears immediately.
14. The transaction confirms and the block number appears.
15. The blockchain panel shows network, hash, block, timestamp and gas.
16. Click **View transaction**.
17. Polygonscan opens on the real transaction.
18. Click **Download PDF** for the evidence certificate.

Then click **Run independent check** to watch the app re-derive the hash and read it back off chain.

Nothing in this sequence requires editing a file or touching the database.

**A pixel-for-pixel new photograph will legitimately find nothing.** That is the honest outcome, and
the UI renders it as `NO RELIABLE MATCH FOUND` while still generating and anchoring the evidence. To
demonstrate the *match* path, use an image that already exists publicly — for example, save a photo
from a public profile and upload that.

### Demo mode

`DEMO_MODE=true` exists only for UI development. In demo mode:

- the reverse-search provider performs **no search and returns nothing** — it does not fabricate
  results, because fake results are exactly what this project must never produce;
- the blockchain service refuses to submit, and the anchor stage fails with a clear message;
- every record is flagged `demo: true`, badged in the UI and in the PDF, and permanently reported as
  `UNVERIFIABLE` by the independent check.

It is useful for exercising stage transitions, the no-match state and error states without spending
API quota. It is never used in the real flow, and the API refuses to start in demo mode when
`NODE_ENV=production`.

---

## API reference

Base path `/api/v1`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/verifications` | Create a verification. `multipart/form-data`, field `image`. Returns `201` with the record. |
| `GET` | `/verifications/:id` | Current state, including the stage list. |
| `GET` | `/verifications/:id/events` | Server-Sent Events stream, with `Last-Event-ID` replay. |
| `GET` | `/verifications/:id/results` | Completed results; `202` while still running. |
| `GET` | `/verifications/:id/evidence` | The canonical evidence bytes verbatim, plus an `X-FaceProof-Evidence-SHA256` header. |
| `GET` | `/verifications/:id/verify` | Recompute the hash and check it against the chain. |
| `GET` | `/verifications/:id/image` | The original upload. |
| `GET` | `/verifications/:id/certificate` | The PDF evidence certificate. |
| `GET` | `/temp/:key` | Signed, expiring temporary image (used by URL-based search providers). |
| `GET` | `/health` | Readiness of every dependency. |
| `GET` | `/meta` | Pipeline version, stage definitions, limits, chain configuration. |

### Events

`verification.created`, `image.analyzed`, `face.detecting`, `face.detected`, `face.not-detected`,
`face.encoding`, `face.encoded`, `reverse-search.started`, `reverse-search.progress`,
`reverse-search.completed`, `reverse-search.failed`, `match.analyzing`, `match.found`,
`match.not-found`, `evidence.created`, `evidence.hashed`, `blockchain.submitting`,
`blockchain.confirmed`, `blockchain.failed`, `verification.completed`, `verification.failed`,
`stage.updated`.

Errors are returned as `{ error, code, stage, hint, details, requestId }` with a stable `code`.

---

## Testing

```bash
npm test                      # every workspace
npm test -w @faceproof/api    # 132 tests
npm run contracts:test        # 7 contract tests
```

Coverage:

- **`hashing.test.ts`** — SHA-256 against known digests and `node:crypto`, `bytes32` conversion,
  canonical JSON (key ordering, whitespace, `undefined`, `-0`, rejection of `NaN`/`BigInt`/`Date`,
  circular structures), score quantisation, HMAC and constant-time comparison.
- **`similarity.test.ts`** — cosine similarity (identity, orthogonality, symmetry, range clamping,
  error cases), L2 normalisation, the `d² = 2(1 − cos)` relationship, Hamming distance, the face
  calibration curve, and candidate scoring behaviour.
- **`url-validation.test.ts`** — SSRF rejection of loopback, RFC1918, link-local, cloud metadata,
  decimal/hex-encoded and IPv4-mapped-IPv6 addresses; protocol, port and credential rejection; URL
  canonicalisation; platform and handle detection.
- **`evidence.test.ts`** — determinism, sensitivity to every field, explicit nulls, structural proof
  that no embedding can appear in the document, and tamper detection.
- **`state-machine.test.ts`** — legal and illegal stage transitions, immutability, idempotence,
  skip-on-failure.
- **`blockchain.test.ts`** — ABI signatures against `ethers`, call encoding round-trip, digest
  agreement with `ethers.sha256`, and record/DTO formatting including `BigInt` serialisation.
- **`api.test.ts`** — real HTTP through `app.inject`: metadata, structured 404s, non-multipart
  rejection, a polyglot file that claims `image/jpeg`, an undersized real image, path-traversal ids,
  unsigned temp URLs, hardening headers, CORS origin rejection.
- **`pipeline.test.ts`** — **runs the real models**: detection on real photographs, embedding
  stability across a simulated social re-upload, separation of different people, perceptual-hash
  robustness, and a full offline creation → stage transitions → evidence creation run that proves no
  match is invented when the search returns nothing. Also renders the PDF certificate.
- **`verification.integration.test.ts`** — the required integration test against **real PostgreSQL**:
  creation → state changes → events → evidence creation → blockchain record → final state, asserting
  the event log is gap-free and ordered and that cascading deletes leave no orphans. It **skips with
  a printed message** when no database is reachable rather than failing the suite.

---

## Security

- **Upload validation** — media type from magic bytes, never the client's `Content-Type`; a real
  decode pass; dimension bounds; size limits enforced both by `@fastify/multipart` and again on the
  buffer.
- **SSRF defence in two layers** — (1) pure structural validation rejecting non-HTTPS schemes,
  credentials, odd ports, blocked hostnames and literal private addresses including decimal, hex and
  IPv4-mapped-IPv6 encodings; (2) a custom DNS `lookup` on the undici agent that re-checks the
  address the socket is about to connect to, which closes the DNS-rebinding window. Redirects are
  followed manually so **every hop** is revalidated. Response bodies are capped while streaming, so
  a server that lies about `Content-Length` cannot exhaust memory.
- **Rate limiting** — per-IP, configurable, with a structured error body.
- **CORS** — explicit allow-list; unknown origins are not reflected. SSE writes its CORS headers onto
  the raw response, since it bypasses the normal reply lifecycle.
- **Secrets** — read only from the environment, redacted in logs, and never sent to the browser. The
  frontend receives a transaction hash and an explorer URL, both public the moment the transaction
  is broadcast.
- **Input validation** — Zod at every boundary, including route parameters.
- **Temporary files** — written `0600` under `apps/api/.tmp`, served only behind an expiring HMAC
  signature, deleted immediately after use and swept periodically.
- **Response hardening** — `nosniff`, `DENY` framing, `no-referrer`, a restrictive
  `Permissions-Policy`, and `Content-Security-Policy: default-src 'none'; sandbox` on served images.
- **Path safety** — uploads are named from the database-generated id, which is asserted against a
  strict pattern before any filesystem write.

---

## Privacy

- **Face embeddings are never persisted.** They live in an in-memory store with a 15-minute TTL,
  are zeroed on release, and are dropped in a `finally` block when the job ends — success or
  failure. A test asserts structurally that no numeric vector can appear in the evidence document.
- **No biometric data goes on chain.** Only `evidenceHash`, `platform`, `postUrl` and the block
  timestamp are written.
- **No image goes on chain.** The uploaded file is retained on the API host only so the results page
  can display it next to any match.
- **Candidate data** is limited to the public URLs the search provider itself returned, plus the
  scores measured against them.

The UI states all of this on the how-it-works page, the results page and the certificate.

---

## Technical decisions

**Face model runtime.** `@vladmandic/face-api`'s default build requires `@tensorflow/tfjs-node`, a
native addon whose prebuilt binaries lag well behind current Node releases and frequently fail to
build on Windows. FaceProof loads `face-api.node-wasm.js` instead, running on `@tensorflow/tfjs`
plus the WebAssembly backend: pure JS + WASM, no native toolchain, working on every platform Node
supports. If WASM cannot initialise it falls back to the pure-JS CPU backend. Detection takes
roughly 0.7–2 s per image on WASM.

**No `canvas` dependency.** Images are decoded to raw RGB with `sharp` (prebuilt N-API binaries) and
handed to the model as a tensor, which avoids `node-canvas` and its Cairo build requirements
entirely. EXIF orientation is applied during decode, so phone photos are analysed the right way up,
and boxes are scaled back into the original image's coordinate space for the overlay.

**Python was not used**, as required — the entire backend is Node + TypeScript.

**Deterministic evidence.** Canonical JSON (RFC 8785 style): sorted keys, no whitespace, `undefined`
members dropped, `-0` normalised, non-finite numbers rejected rather than coerced, and all scores
quantised to six decimals so float noise on a different machine cannot change the digest.

**Permissionless contract.** Anyone may anchor a hash. The meaningful assertion is "this exact
document existed by this block", which does not depend on who paid the gas — but `msg.sender` is
recorded so a verifier can still check the submitting wallet.

---

## Known limitations

**Reverse-image-search availability**
- Both SerpApi and TinEye are paid, quota-limited services. Exhausting a quota produces a clear
  `REVERSE_SEARCH_UNAVAILABLE` failure — the verification fails rather than reporting "no match",
  because claiming nothing was found when nothing was searched would be a lie.
- Google Lens results are not stable over time; the same image can return different candidates on
  different days.
- SerpApi must be able to fetch your image URL. A `localhost` `PUBLIC_BASE_URL` will always fail;
  this is checked at startup.

**Social platform restrictions**
- Instagram, Facebook and X aggressively block server-side image fetching. Candidate images
  frequently return 403 or a login wall. The pipeline records this per candidate as
  "Access denied by the host" and caps that candidate's confidence — it never guesses.
- Private accounts are invisible to the search engine in the first place.
- Deleted posts may still appear in the index while the image itself 404s.
- Some platforms serve a thumbnail rather than the original; the comparison then runs on a
  lower-resolution image, which slightly depresses similarity scores.

**Image transformations**
- Heavy crops, large text overlays, filters, mirroring or aspect-ratio changes will lower perceptual
  hash similarity substantially. Mirroring in particular defeats a DCT hash while a human would call
  the images identical.

**Face recognition**
- The 128-D embedding is a general-purpose model, not a forensic one. It degrades with extreme pose,
  occlusion, heavy makeup, low resolution and age gaps, and it is known to perform unevenly across
  demographic groups.
- **False positives and false negatives both occur.** A high score is evidence of visual similarity,
  nothing more. Group photos are matched on the single highest-confidence face.
- Some candidate images contain no detectable face at all; those are scored on visual signals only,
  and the UI says so.

**Rate limits**
- The API rate-limits per IP by default (60/min).
- The public Amoy RPC endpoint is aggressively rate-limited; use a dedicated RPC URL for anything
  beyond casual testing.

**Blockchain testnet**
- Amoy can be slow or briefly unavailable; a confirmation timeout is reported as
  `BLOCKCHAIN_CONFIRMATION_TIMEOUT` with the transaction hash, so you can check the explorer
  yourself — the transaction may still confirm afterwards.
- Testnet state is not guaranteed to persist indefinitely. This is a demonstration of the mechanism,
  not a production notary.
- Anchoring the same evidence document twice reverts with `VerificationAlreadyAnchored`.

**Scope**
- Verifications run in-process. Restarting the API abandons any job that was mid-flight; its record
  keeps the last state it reached, and the failed stage is visible. A production deployment would
  put the orchestrator behind a durable job runner.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| API exits with a list of variables | Fatal configuration. Fix the listed keys in `.env`. |
| `Can't reach database server at localhost:5432` | `npm run db:up` (or `npm run db:local` without Docker), then `npm run prisma:migrate`. |
| `Face model weights are missing` | `npm run models:fetch`. |
| `The FaceProof API is unreachable` in the browser | API not running, or `NEXT_PUBLIC_API_URL` is wrong. Note it is baked in at build time — rebuild the web app after changing it. |
| SerpApi error mentioning the image URL | `PUBLIC_BASE_URL` is not reachable from the internet. Start a tunnel or switch to `STORAGE_PROVIDER=s3` or `tineye`. |
| `The signing wallet … has no POL` | Fund the address at the Polygon faucet. |
| `No contract at FACEPROOF_CONTRACT_ADDRESS` | Deploy first, and check you are on Amoy. |
| Every candidate says "Access denied by the host" | Expected on Instagram/Facebook/X. The record is still produced, with those candidates honestly marked unreachable. |
| Face detection is slow | The WASM backend runs on CPU. 0.7–2 s per image is normal; the first request also pays for model loading. |

---

## Project layout

```
faceproof/
├── apps/
│   ├── web/                    Next.js 15 · React 19 · Tailwind v4 · Framer Motion
│   │   ├── app/                landing, how-it-works, /verify, /verify/[id]
│   │   ├── components/         ui/ site/ landing/ verify/
│   │   ├── hooks/              use-verification-stream, use-image-inspection
│   │   └── lib/                api client, config, utils
│   └── api/                    Fastify 5 · TypeScript · Prisma
│       ├── src/
│       │   ├── config/         env validation, prisma client
│       │   ├── middleware/     error handler, security
│       │   ├── utils/          hashing, image, SSRF-safe fetch, temp files, logging
│       │   ├── modules/
│       │   │   ├── verification/   orchestrator, state machine, events, routes, proof
│       │   │   ├── face/           models, detector, embedding store
│       │   │   ├── reverse-search/ provider interface, SerpApi, TinEye, normalisation
│       │   │   ├── social/         candidate analysis and scoring
│       │   │   ├── evidence/       canonical builder, PDF certificate
│       │   │   ├── blockchain/     BlockchainService, ABI
│       │   │   └── storage/        temporary public hosting
│       │   └── server.ts
│       ├── prisma/             schema + initial migration
│       ├── scripts/            fetch-models, doctor
│       └── tests/              132 tests
├── contracts/                  FaceProof.sol, hardhat.config.ts, deploy.ts, test/
├── packages/shared/            isomorphic types, canonical JSON, similarity, URL validation
├── .env.example
├── docker-compose.yml
└── package.json                npm workspaces
```

---

## Licence

Provided as-is for demonstration and evaluation.
