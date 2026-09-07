/**
 * Version of the evidence pipeline. Any change to how evidence is assembled or
 * canonicalised MUST bump this — the value is part of the hashed document, so
 * records produced by different pipeline versions stay distinguishable.
 */
export const PIPELINE_VERSION = '1.0.0';

export const ACCEPTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

export const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/** Smallest image the face detector can work with reliably. */
export const MIN_IMAGE_DIMENSION = 64;
export const MAX_IMAGE_DIMENSION = 10000;

export const EVIDENCE_STRENGTH_THRESHOLDS = {
  HIGH: 0.85,
  MODERATE: 0.7,
  LOW: 0.55,
} as const;

export function evidenceStrengthFor(
  confidence: number,
): 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT' {
  if (confidence >= EVIDENCE_STRENGTH_THRESHOLDS.HIGH) return 'HIGH';
  if (confidence >= EVIDENCE_STRENGTH_THRESHOLDS.MODERATE) return 'MODERATE';
  if (confidence >= EVIDENCE_STRENGTH_THRESHOLDS.LOW) return 'LOW';
  return 'INSUFFICIENT';
}
