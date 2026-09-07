import PDFDocument from 'pdfkit';
import {
  formatBytes,
  formatDateTimeUTC,
  formatPercent,
  type VerificationDto,
} from '@faceproof/shared';

const INK = '#0b0d12';
const MUTED = '#6b7280';
const RULE = '#d4d7de';
const ACCENT = '#0f766e';
const WARN = '#b45309';

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LABEL_WIDTH = 190;

/**
 * Renders the downloadable evidence certificate.
 *
 * Wording is deliberately constrained: the document describes a tamper-evident
 * record of an automated analysis. It never asserts identity, ownership of an
 * account, or legal proof — see the closing statement.
 */
export function renderCertificate(verification: VerificationDto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `FaceProof evidence certificate ${verification.id}`,
        Author: 'FaceProof',
        Subject: 'Tamper-evident digital evidence record',
        Keywords: 'faceproof, evidence, sha-256, polygon, verification',
        CreationDate: new Date(verification.createdAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    header(doc, verification);
    statusBanner(doc, verification);

    section(doc, 'VERIFICATION');
    row(doc, 'Verification ID', verification.id, { mono: true });
    row(doc, 'Created', formatDateTimeUTC(verification.createdAt));
    row(doc, 'Completed', formatDateTimeUTC(verification.completedAt));
    row(doc, 'Pipeline version', verification.evidence?.pipelineVersion ?? '—', { mono: true });

    section(doc, 'INPUT IMAGE');
    row(doc, 'Filename', verification.image.filename);
    row(doc, 'Media type', verification.image.mimeType);
    row(doc, 'Size', `${formatBytes(verification.image.byteSize)} · ${verification.image.width} × ${verification.image.height} px`);
    row(doc, 'SHA-256', verification.image.sha256, { mono: true, wrap: true });
    row(doc, 'Perceptual hash', verification.image.perceptualHash, { mono: true });

    section(doc, 'FACE ANALYSIS');
    row(doc, 'Face detected', verification.face?.faceDetected ? 'Yes' : 'No');
    row(doc, 'Face count', String(verification.face?.faceCount ?? 0));
    row(doc, 'Detector', verification.face?.detector ?? '—', { mono: true });
    row(
      doc,
      'Embedding',
      verification.encoding
        ? `${verification.encoding.dimensions}-D · ${verification.encoding.model}`
        : 'Not generated',
      { mono: Boolean(verification.encoding) },
    );

    section(doc, 'SOURCE DISCOVERY');
    row(doc, 'Search provider', verification.reverseSearch?.provider ?? '—');
    row(doc, 'Candidates returned', String(verification.reverseSearch?.totalResults ?? 0));
    row(doc, 'Candidates compared', String(verification.match?.candidatesAnalysed ?? 0));

    const best = verification.match?.bestMatch ?? null;
    if (best) {
      row(doc, 'Matched platform', best.platform ?? 'Not a recognised platform');
      if (best.handle) row(doc, 'Account handle', best.handle);
      row(doc, 'Matched post URL', best.sourceUrl, { mono: true, wrap: true, link: best.sourceUrl });
      row(doc, 'Visual similarity', formatPercent(best.visualSimilarity));
      row(doc, 'Face similarity', formatPercent(best.faceSimilarity));
      row(doc, 'Confidence', formatPercent(verification.match?.confidence));
      row(doc, 'Evidence strength', verification.match?.evidenceStrength ?? '—');
      if (best.matchReasons.length > 0) {
        list(doc, 'Match reasons', best.matchReasons);
      }
    } else {
      row(doc, 'Match', 'No candidate met the verification threshold');
      if (verification.match?.rejectionReason) {
        paragraph(doc, verification.match.rejectionReason);
      }
    }

    section(doc, 'EVIDENCE');
    row(doc, 'Evidence SHA-256', verification.evidenceHash ?? '—', { mono: true, wrap: true });

    section(doc, 'BLOCKCHAIN ANCHOR');
    if (verification.blockchain) {
      const chain = verification.blockchain;
      row(doc, 'Status', chain.status === 'confirmed' ? 'Confirmed' : chain.status);
      row(doc, 'Network', `${chain.network} (chain id ${chain.chainId})`);
      row(doc, 'Contract', chain.contractAddress, { mono: true, wrap: true });
      row(doc, 'Transaction hash', chain.transactionHash, { mono: true, wrap: true });
      row(doc, 'Block number', chain.blockNumber ?? '—', { mono: true });
      row(doc, 'Block timestamp', formatDateTimeUTC(chain.timestamp));
      // A local development chain has no block explorer; say so rather than
      // printing a link that goes nowhere.
      if (chain.explorerTxUrl) {
        row(doc, 'Explorer', chain.explorerTxUrl, {
          mono: true,
          wrap: true,
          link: chain.explorerTxUrl,
        });
      } else {
        row(doc, 'Explorer', 'No public block explorer for this network');
      }
    } else {
      row(doc, 'Status', 'Not anchored');
      paragraph(
        doc,
        'This record was not written to a blockchain, so it carries no independent timestamp.',
      );
    }

    footer(doc, verification);

    doc.end();
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function header(doc: Doc, verification: VerificationDto): void {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('FACEPROOF', MARGIN, MARGIN, {
    characterSpacing: 3,
  });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text('DIGITAL EVIDENCE CERTIFICATE', { characterSpacing: 2 });

  doc.moveDown(0.8);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .lineWidth(1)
    .strokeColor(INK)
    .stroke();

  doc.moveDown(0.9);

  if (verification.demo) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(WARN)
      .text(
        'DEMO MODE RECORD — produced with DEMO_MODE=true. Not a real verification and not valid evidence.',
        { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.6);
  }
}

function statusBanner(doc: Doc, verification: VerificationDto): void {
  const label =
    verification.status === 'completed'
      ? 'VERIFICATION COMPLETE — SOURCE MATCH RECORDED'
      : verification.status === 'completed_no_match'
        ? 'VERIFICATION COMPLETE — NO RELIABLE MATCH FOUND'
        : verification.status === 'failed'
          ? 'VERIFICATION FAILED'
          : `VERIFICATION ${verification.status.toUpperCase()}`;

  const color = verification.status === 'failed' ? WARN : ACCENT;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(color).text(label, { characterSpacing: 1 });

  if (verification.error) {
    doc.font('Helvetica').fontSize(9).fillColor(WARN).text(verification.error, {
      width: CONTENT_WIDTH,
    });
  }
  doc.moveDown(0.4);
}

function section(doc: Doc, title: string): void {
  ensureSpace(doc, 60);
  doc.moveDown(0.7);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(MUTED)
    .text(title, MARGIN, doc.y, { characterSpacing: 1.6 });
  doc.moveDown(0.25);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
  doc.moveDown(0.45);
}

interface RowOptions {
  mono?: boolean;
  wrap?: boolean;
  link?: string;
}

function row(doc: Doc, label: string, value: string, options: RowOptions = {}): void {
  ensureSpace(doc, 32);
  const top = doc.y;

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(label, MARGIN, top, { width: LABEL_WIDTH - 12 });

  const valueX = MARGIN + LABEL_WIDTH;
  const valueWidth = CONTENT_WIDTH - LABEL_WIDTH;

  doc
    .font(options.mono ? 'Courier' : 'Helvetica')
    .fontSize(options.mono ? 8.5 : 9.5)
    .fillColor(options.link ? ACCENT : INK)
    .text(value, valueX, top, {
      width: valueWidth,
      lineBreak: options.wrap !== false,
      ...(options.link ? { link: options.link, underline: false } : {}),
    });

  doc.y = Math.max(doc.y, top) + 4;
  doc.x = MARGIN;
}

function list(doc: Doc, label: string, items: string[]): void {
  ensureSpace(doc, 24 + items.length * 12);
  const top = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, MARGIN, top, {
    width: LABEL_WIDTH - 12,
  });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(INK)
    .text(items.map((item) => `· ${item}`).join('\n'), MARGIN + LABEL_WIDTH, top, {
      width: CONTENT_WIDTH - LABEL_WIDTH,
    });

  doc.y += 4;
  doc.x = MARGIN;
}

function paragraph(doc: Doc, text: string): void {
  ensureSpace(doc, 40);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(text, MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
}

function footer(doc: Doc, verification: VerificationDto): void {
  ensureSpace(doc, 150);
  doc.moveDown(1.2);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .lineWidth(1)
    .strokeColor(INK)
    .stroke();
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('WHAT THIS DOCUMENT IS');
  doc.moveDown(0.25);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      'This is a tamper-evident digital evidence record. It states that a specific image was analysed by an automated pipeline at a specific time, that a reverse-image search returned specific public URLs, and that the SHA-256 digest of the resulting evidence document was written to a public blockchain. Anyone can recompute the digest from the canonical evidence JSON and compare it with the on-chain record.',
      { width: CONTENT_WIDTH, align: 'left' },
    );

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('WHAT THIS DOCUMENT IS NOT');
  doc.moveDown(0.25);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      'It is not proof of identity, and it does not establish that the person in the submitted image owns, controls or appears in the discovered account or post. Similarity scores describe computational similarity between images and embeddings; they are statistical measurements, not legal findings. Automated face comparison produces both false positives and false negatives.',
      { width: CONTENT_WIDTH, align: 'left' },
    );

  doc.moveDown(0.8);
  doc
    .font('Courier')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      `Generated ${formatDateTimeUTC(new Date().toISOString())} · verification ${verification.id} · evidence ${verification.evidenceHash ?? 'not generated'}`,
      { width: CONTENT_WIDTH },
    );
}

/** Starts a new page when the remaining space is too small for a block. */
function ensureSpace(doc: Doc, needed: number): void {
  const bottom = doc.page.height - MARGIN;
  if (doc.y + needed > bottom) {
    doc.addPage();
    doc.x = MARGIN;
  }
}
