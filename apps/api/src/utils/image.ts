import sharp from 'sharp';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  type AcceptedImageMimeType,
} from '@faceproof/shared';
import { AppError, ERROR_CODES } from './errors';

export interface DecodedImage {
  /** Original bytes, unmodified - this is what gets SHA-256'd. */
  buffer: Buffer;
  mimeType: AcceptedImageMimeType;
  extension: string;
  width: number;
  height: number;
  byteSize: number;
}

/** Raw pixel data ready to be handed to a tensor. */
export interface RawPixels {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 3;
}

const MAGIC_SIGNATURES: Array<{
  mimeType: AcceptedImageMimeType;
  extension: string;
  test: (buffer: Buffer) => boolean;
}> = [
  {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extension: '.png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mimeType: 'image/webp',
    extension: '.webp',
    // "RIFF" .... "WEBP"
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/**
 * Determines the real media type from magic bytes.
 * The client-supplied Content-Type is never trusted: a `.png` upload that is
 * actually an HTML file or a polyglot payload is rejected here.
 */
export function sniffImageType(
  buffer: Buffer,
): { mimeType: AcceptedImageMimeType; extension: string } | null {
  const match = MAGIC_SIGNATURES.find((signature) => signature.test(buffer));
  return match ? { mimeType: match.mimeType, extension: match.extension } : null;
}

/**
 * Validates and decodes an uploaded image.
 *
 * Everything about the file is derived from its actual content: the media type
 * comes from magic bytes, the dimensions come from a real decode pass. A file
 * that sharp cannot decode is rejected rather than passed further down the
 * pipeline.
 */
export async function decodeImage(buffer: Buffer, declaredMimeType?: string): Promise<DecodedImage> {
  if (buffer.length === 0) {
    throw new AppError('The uploaded file is empty.', {
      code: ERROR_CODES.INVALID_IMAGE,
      hint: 'Choose a JPG, PNG or WEBP image and try again.',
    });
  }

  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    throw new AppError('The uploaded file is not a JPG, PNG or WEBP image.', {
      code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      statusCode: 415,
      hint: `Accepted types: ${ACCEPTED_IMAGE_MIME_TYPES.join(', ')}.`,
      details: { declaredMimeType: declaredMimeType ?? null },
    });
  }

  let metadata: sharp.Metadata;
  try {
    // `failOn: 'error'` makes sharp reject truncated or malformed files instead
    // of silently producing a partial image.
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 268_402_689 }).metadata();
  } catch (error) {
    throw new AppError('The image could not be decoded. It may be corrupt or truncated.', {
      code: ERROR_CODES.IMAGE_DECODE_FAILED,
      cause: error,
      hint: 'Re-export the image from your photo app and upload it again.',
    });
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new AppError(
      `The image is ${width}x${height}px. A minimum of ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px is required for face analysis.`,
      { code: ERROR_CODES.INVALID_IMAGE, hint: 'Upload a larger version of the photo.' },
    );
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new AppError(
      `The image is ${width}x${height}px, which exceeds the ${MAX_IMAGE_DIMENSION}px limit.`,
      { code: ERROR_CODES.INVALID_IMAGE, hint: 'Downscale the image before uploading.' },
    );
  }

  return {
    buffer,
    mimeType: sniffed.mimeType,
    extension: sniffed.extension,
    width,
    height,
    byteSize: buffer.length,
  };
}

/**
 * Decodes to raw RGB pixels, optionally downscaling so the face detector runs
 * in bounded time. EXIF orientation is applied so a portrait photo taken on a
 * phone is analysed the right way up.
 */
export async function toRawPixels(buffer: Buffer, maxDimension = 1024): Promise<RawPixels> {
  const pipeline = sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .removeAlpha()
    .toColourspace('srgb');

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new AppError('Unexpected channel count while decoding the image.', {
      code: ERROR_CODES.IMAGE_DECODE_FAILED,
      details: { channels: info.channels },
    });
  }

  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    channels: 3,
  };
}

// ---------------------------------------------------------------------------
// Perceptual hashing
// ---------------------------------------------------------------------------

const PHASH_SIZE = 32;
const PHASH_LOW_FREQ = 8;

/** Pre-computed DCT-II basis so repeated hashing does not recompute cosines. */
const DCT_BASIS: number[][] = (() => {
  const basis: number[][] = [];
  for (let u = 0; u < PHASH_SIZE; u += 1) {
    const row = new Array<number>(PHASH_SIZE);
    for (let x = 0; x < PHASH_SIZE; x += 1) {
      row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
    }
    basis.push(row);
  }
  return basis;
})();

function dct2d(pixels: Float64Array): Float64Array {
  // Separable DCT: rows first, then columns. O(2 * N^3) with N = 32 is trivial.
  const rows = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let y = 0; y < PHASH_SIZE; y += 1) {
    for (let u = 0; u < PHASH_SIZE; u += 1) {
      let sum = 0;
      const basisRow = DCT_BASIS[u] as number[];
      for (let x = 0; x < PHASH_SIZE; x += 1) {
        sum += (pixels[y * PHASH_SIZE + x] as number) * (basisRow[x] as number);
      }
      rows[y * PHASH_SIZE + u] = sum;
    }
  }

  const out = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let u = 0; u < PHASH_SIZE; u += 1) {
    for (let v = 0; v < PHASH_SIZE; v += 1) {
      let sum = 0;
      const basisRow = DCT_BASIS[v] as number[];
      for (let y = 0; y < PHASH_SIZE; y += 1) {
        sum += (rows[y * PHASH_SIZE + u] as number) * (basisRow[y] as number);
      }
      out[v * PHASH_SIZE + u] = sum;
    }
  }
  return out;
}

/**
 * 64-bit DCT perceptual hash, returned as 16 lowercase hex characters.
 *
 * The image is reduced to 32x32 greyscale, transformed with a 2D DCT, and the
 * 8x8 low-frequency block (minus the DC term) is thresholded at its median.
 * The result survives rescaling, re-encoding and mild colour shifts, which is
 * exactly what happens to an image that has been re-uploaded to a social
 * platform.
 */
export async function perceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .removeAlpha()
    .greyscale()
    .resize(PHASH_SIZE, PHASH_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = data[i] as number;

  const coefficients = dct2d(pixels);

  const lowFrequency: number[] = [];
  for (let v = 0; v < PHASH_LOW_FREQ; v += 1) {
    for (let u = 0; u < PHASH_LOW_FREQ; u += 1) {
      if (u === 0 && v === 0) continue; // drop the DC term (overall brightness)
      lowFrequency.push(coefficients[v * PHASH_SIZE + u] as number);
    }
  }

  const sorted = [...lowFrequency].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
      : (sorted[Math.floor(mid)] as number);

  // 63 coefficients + a constant padding bit keeps the digest a round 64 bits.
  const bits = [...lowFrequency.map((value) => (value > median ? 1 : 0)), 0];

  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble =
      ((bits[i] as number) << 3) |
      ((bits[i + 1] as number) << 2) |
      ((bits[i + 2] as number) << 1) |
      (bits[i + 3] as number);
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Coarse colour signature: mean R/G/B of an 8x8 grid, normalised to [0,1].
 * Used as a secondary ranking signal - a perceptual hash ignores colour, so two
 * images that differ only in palette would otherwise score identically.
 */
export async function colorSignature(buffer: Buffer): Promise<number[]> {
  const grid = 8;
  const { data } = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .removeAlpha()
    .resize(grid, grid, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const signature: number[] = [];
  for (let i = 0; i < grid * grid * 3; i += 1) signature.push((data[i] as number) / 255);
  return signature;
}

/** Crops a face box (with padding) so the embedding sees a tight face region. */
export async function cropRegion(
  buffer: Buffer,
  box: { x: number; y: number; width: number; height: number },
  paddingRatio = 0.25,
): Promise<Buffer> {
  const image = sharp(buffer, { failOn: 'error' }).rotate();
  const metadata = await image.metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;

  const padX = box.width * paddingRatio;
  const padY = box.height * paddingRatio;

  const left = Math.max(0, Math.round(box.x - padX));
  const top = Math.max(0, Math.round(box.y - padY));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(box.width + padX * 2)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(box.height + padY * 2)));

  return image.extract({ left, top, width, height }).png().toBuffer();
}
