import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * Face model loading.
 *
 * Node compatibility decision (documented in the README):
 * `face-api.js` / `@vladmandic/face-api` ships several builds. The default
 * (`face-api.node.js`) requires `@tensorflow/tfjs-node`, a native addon whose
 * prebuilt binaries lag well behind current Node releases and frequently fail
 * to compile on Windows. We therefore load `face-api.node-wasm.js`, which runs
 * on `@tensorflow/tfjs` plus the WebAssembly backend: pure JS + WASM, no native
 * toolchain, and it works on every platform Node itself supports. If the WASM
 * backend cannot initialise we fall back to the pure-JS CPU backend, which is
 * slower but always available.
 *
 * Models used:
 *   ssdMobilenetv1     - face detection with bounding boxes and scores
 *   faceLandmark68Net  - 68 point landmarks, used to align the crop
 *   faceRecognitionNet - 128-D embedding (ResNet-34 style, FaceNet lineage)
 */

// The wasm build is required by path because the package `main` points at the
// tfjs-node build. Both this module and face-api resolve to the *same*
// @tensorflow/tfjs instance from node_modules, so tensors created here are
// valid inputs to the nets - we import tf directly because face-api re-exports
// it under a narrower bundled type that omits the backend controls.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as typeof import('@vladmandic/face-api');

export type FaceApi = typeof faceapi;

export const DETECTOR_ID = 'ssd_mobilenetv1@face-api-1.7';
export const EMBEDDING_MODEL_ID = 'face_recognition_resnet34@face-api-1.7';
export const EMBEDDING_DIMENSIONS = 128;

/** Manifest files that must exist before the nets can be loaded from disk. */
export const REQUIRED_MODEL_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

export function missingModelFiles(dir = config.face.modelsDir): string[] {
  return REQUIRED_MODEL_FILES.filter((file) => !fs.existsSync(path.join(dir, file)));
}

let backendPromise: Promise<string> | null = null;
let loadPromise: Promise<FaceApi> | null = null;
let activeBackend = 'uninitialised';

async function initBackend(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasm = require('@tensorflow/tfjs-backend-wasm') as typeof import('@tensorflow/tfjs-backend-wasm');
    const wasmDir = `${path.join(
      path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')),
      'dist',
    )}${path.sep}`;
    wasm.setWasmPaths(wasmDir);
    await tf.setBackend('wasm');
    await tf.ready();
    if (tf.getBackend() === 'wasm') {
      activeBackend = 'wasm';
      return activeBackend;
    }
  } catch (error) {
    logger.warn({ err: error }, 'WASM backend unavailable, falling back to the CPU backend');
  }

  await tf.setBackend('cpu');
  await tf.ready();
  activeBackend = tf.getBackend();
  return activeBackend;
}

/**
 * Loads the models once and caches the promise, so concurrent verifications
 * share a single warm-up instead of racing to read the same weight files.
 */
export function loadFaceModels(): Promise<FaceApi> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const missing = missingModelFiles();
      if (missing.length > 0) {
        loadPromise = null;
        throw new AppError(
          `Face model weights are missing from ${config.face.modelsDir}: ${missing.join(', ')}`,
          {
            code: ERROR_CODES.FACE_MODELS_MISSING,
            statusCode: 503,
            hint: 'Run: npm run models:fetch',
          },
        );
      }

      backendPromise ??= initBackend();
      const backend = await backendPromise;

      const started = Date.now();
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(config.face.modelsDir);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(config.face.modelsDir);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(config.face.modelsDir);

      logger.info(
        { backend, durationMs: Date.now() - started, modelsDir: config.face.modelsDir },
        'Face models loaded',
      );

      return faceapi;
    })();
  }
  return loadPromise;
}

/**
 * Runs one tiny inference so the first real verification is not slowed down by
 * lazy kernel compilation. Failures are logged, never fatal.
 */
export async function warmUpFaceModels(): Promise<void> {
  try {
    const api = await loadFaceModels();
    const blank = tf.zeros([160, 160, 3], 'int32');
    await api.detectAllFaces(blank as never, new api.SsdMobilenetv1Options({ minConfidence: 0.9 }));
    blank.dispose();
    logger.info({ backend: activeBackend }, 'Face pipeline warm-up complete');
  } catch (error) {
    logger.warn({ err: error }, 'Face pipeline warm-up failed; models will load on first request');
  }
}

export function getActiveBackend(): string {
  return activeBackend;
}

export { faceapi, tf };
