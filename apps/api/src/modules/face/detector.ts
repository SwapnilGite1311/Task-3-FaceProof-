import type { BoundingBox, DetectedFace, FaceDetectionSummary } from '@faceproof/shared';
import { l2Normalize } from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { toRawPixels } from '../../utils/image';
import { logger } from '../../utils/logger';
import {
  DETECTOR_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  loadFaceModels,
  tf,
} from './models';

/** Longest edge the detector runs on. Bounds inference time on large uploads. */
const ANALYSIS_MAX_DIMENSION = 1024;

export interface FaceAnalysis {
  summary: FaceDetectionSummary;
  /**
   * L2-normalised 128-D embeddings, aligned with `summary.faces` by index.
   * These are biometric data: they are never persisted and never leave the
   * process (see modules/face/embedding-store).
   */
  embeddings: number[][];
}

/**
 * Detects faces and computes an embedding for each one.
 *
 * The image is decoded to raw RGB with sharp and handed to the model as a
 * tensor, which avoids a native `canvas` dependency entirely. Bounding boxes
 * are scaled back into the coordinate space of the *original* image so the UI
 * can draw them over the picture the user actually uploaded.
 */
export async function analyzeFaces(
  buffer: Buffer,
  originalWidth: number,
  originalHeight: number,
): Promise<FaceAnalysis> {
  const api = await loadFaceModels();
  const started = Date.now();

  const pixels = await toRawPixels(buffer, ANALYSIS_MAX_DIMENSION);

  // The detector sees a possibly downscaled image; map its coordinates back.
  const scaleX = originalWidth / pixels.width;
  const scaleY = originalHeight / pixels.height;

  const tensor = tf.tensor3d(pixels.data, [pixels.height, pixels.width, 3], 'int32');

  try {
    const detections = await api
      .detectAllFaces(
        tensor as never,
        new api.SsdMobilenetv1Options({ minConfidence: config.face.minConfidence }),
      )
      .withFaceLandmarks()
      .withFaceDescriptors();

    // Highest scoring face first, so index 0 is always the primary subject.
    const ordered = [...detections].sort((a, b) => b.detection.score - a.detection.score);

    const faces: DetectedFace[] = [];
    const embeddings: number[][] = [];

    ordered.forEach((result, index) => {
      const { box, score } = result.detection;

      const pixelBox: BoundingBox = {
        x: Math.max(0, Math.round(box.x * scaleX)),
        y: Math.max(0, Math.round(box.y * scaleY)),
        width: Math.round(box.width * scaleX),
        height: Math.round(box.height * scaleY),
      };

      const relativeBox: BoundingBox = {
        x: clamp01(box.x / pixels.width),
        y: clamp01(box.y / pixels.height),
        width: clamp01(box.width / pixels.width),
        height: clamp01(box.height / pixels.height),
      };

      faces.push({
        index,
        score: round(score, 4),
        box: pixelBox,
        relativeBox: {
          x: round(relativeBox.x, 6),
          y: round(relativeBox.y, 6),
          width: round(relativeBox.width, 6),
          height: round(relativeBox.height, 6),
        },
        landmarkCount: result.landmarks?.positions?.length ?? 0,
      });

      const descriptor = Array.from(result.descriptor as Float32Array);
      if (descriptor.length !== EMBEDDING_DIMENSIONS) {
        throw new AppError(
          `Face embedding has ${descriptor.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`,
          { code: ERROR_CODES.FACE_ENCODING_FAILED, statusCode: 500 },
        );
      }
      // Normalising up front means cosine similarity is a plain dot product and
      // every stored/compared vector lives on the unit sphere.
      embeddings.push(l2Normalize(descriptor));
    });

    const durationMs = Date.now() - started;
    logger.debug({ faceCount: faces.length, durationMs }, 'Face analysis complete');

    return {
      summary: {
        faceDetected: faces.length > 0,
        faceCount: faces.length,
        faces,
        detector: DETECTOR_ID,
        durationMs,
      },
      embeddings,
    };
  } finally {
    tensor.dispose();
  }
}

/**
 * Detects a single face in a candidate image found by the reverse search and
 * returns only its embedding. Returns null when the candidate contains no face
 * — a very common and completely legitimate outcome.
 */
export async function embedPrimaryFace(buffer: Buffer): Promise<number[] | null> {
  const api = await loadFaceModels();

  const pixels = await toRawPixels(buffer, ANALYSIS_MAX_DIMENSION);
  const tensor = tf.tensor3d(pixels.data, [pixels.height, pixels.width, 3], 'int32');

  try {
    const result = await api
      .detectSingleFace(
        tensor as never,
        new api.SsdMobilenetv1Options({ minConfidence: config.face.minConfidence }),
      )
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!result?.descriptor) return null;
    return l2Normalize(Array.from(result.descriptor as Float32Array));
  } finally {
    tensor.dispose();
  }
}

export function encodingSummary(durationMs: number) {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    model: EMBEDDING_MODEL_ID,
    normalized: true,
    durationMs,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
