import type { EvidenceDocument, VerificationProofCheck } from '@faceproof/shared';
import { AppError, ERROR_CODES, errorMessage } from '../../utils/errors';
import { getBlockchainService } from '../blockchain';
import { recomputeEvidenceHash } from '../evidence';
import { requireVerification } from './repository';

/**
 * Independent re-verification.
 *
 * This deliberately does not trust the stored `evidenceHash` column. It
 * re-canonicalises the stored evidence document, hashes it again, then reads
 * the contract directly over RPC. Three things can therefore be detected:
 *
 *  1. the evidence JSON was edited after the fact  -> hashes disagree
 *  2. the stored hash was edited                   -> hashes disagree
 *  3. the record was never actually anchored       -> nothing on chain
 *
 * A demo-mode record is never reported as valid, whatever it contains.
 */
export async function checkProof(verificationId: string): Promise<VerificationProofCheck> {
  const record = await requireVerification(verificationId);
  const notes: string[] = [];
  const checkedAt = new Date().toISOString();

  if (!record.evidence || !record.evidenceHash) {
    throw new AppError('This verification has no evidence document to check.', {
      code: ERROR_CODES.NOT_FOUND,
      statusCode: 409,
      hint:
        record.status === 'failed'
          ? 'The pipeline failed before evidence was generated.'
          : 'Wait for the verification to finish, then try again.',
    });
  }

  const evidence = record.evidence as unknown as EvidenceDocument;
  const recomputed = recomputeEvidenceHash(evidence);
  const evidenceHashMatches = recomputed === record.evidenceHash;

  if (!evidenceHashMatches) {
    notes.push(
      'The stored evidence document does not hash to the stored evidence hash. The record has been altered since it was created.',
    );
  }

  const base: VerificationProofCheck = {
    verificationId,
    evidenceHashStored: record.evidenceHash,
    evidenceHashRecomputed: recomputed,
    evidenceHashMatches,
    onChainFound: false,
    onChainEvidenceHash: null,
    onChainPlatform: null,
    onChainPostUrl: null,
    onChainTimestamp: null,
    onChainVerifier: null,
    onChainMatches: false,
    transactionHash: record.blockchainRecord?.transactionHash ?? null,
    explorerTxUrl: record.blockchainRecord
      ? `${getBlockchainService().explorerTxUrl(record.blockchainRecord.transactionHash)}`
      : null,
    verdict: 'UNVERIFIABLE',
    checkedAt,
    notes,
  };

  if (record.demo) {
    notes.push(
      'This record was produced with DEMO_MODE=true. Demo records are never treated as valid evidence.',
    );
    return { ...base, verdict: 'UNVERIFIABLE' };
  }

  let onChain;
  try {
    onChain = await getBlockchainService().verifyRecord(recomputed);
  } catch (error) {
    notes.push(`The blockchain could not be reached: ${errorMessage(error)}`);
    return { ...base, verdict: 'UNVERIFIABLE' };
  }

  if (!onChain) {
    // Fall back to the stored hash so we can distinguish "never anchored" from
    // "anchored, then the local copy was tampered with".
    if (!evidenceHashMatches) {
      const storedOnChain = await getBlockchainService()
        .verifyRecord(record.evidenceHash)
        .catch(() => null);
      if (storedOnChain) {
        notes.push(
          'The originally anchored hash does exist on chain, but the evidence stored locally no longer reproduces it.',
        );
        return {
          ...base,
          onChainFound: true,
          onChainEvidenceHash: storedOnChain.evidenceHash,
          onChainPlatform: storedOnChain.platform || null,
          onChainPostUrl: storedOnChain.postUrl || null,
          onChainTimestamp: storedOnChain.timestamp.toISOString(),
          onChainVerifier: storedOnChain.verifier,
          onChainMatches: false,
          verdict: 'TAMPERED',
        };
      }
    }

    notes.push('No record for this evidence hash exists in the FaceProof contract.');
    return { ...base, verdict: 'NOT_ANCHORED' };
  }

  const platformMatches = (onChain.platform || null) === (evidence.matchedPlatform || null);
  const postUrlMatches = (onChain.postUrl || null) === (evidence.matchedPostUrl || null);

  if (!platformMatches) {
    notes.push(
      `The platform recorded on chain ("${onChain.platform || 'none'}") differs from the evidence document ("${evidence.matchedPlatform ?? 'none'}").`,
    );
  }
  if (!postUrlMatches) {
    notes.push(
      'The post URL recorded on chain differs from the one in the evidence document.',
    );
  }

  const onChainMatches =
    onChain.evidenceHash.toLowerCase() === `0x${recomputed}` && platformMatches && postUrlMatches;

  if (evidenceHashMatches && onChainMatches) {
    notes.push(
      `The evidence document hashes to ${recomputed}, and that exact hash is recorded in the FaceProof contract with a block timestamp of ${onChain.timestamp.toISOString()}.`,
    );
  }

  return {
    ...base,
    onChainFound: true,
    onChainEvidenceHash: onChain.evidenceHash,
    onChainPlatform: onChain.platform || null,
    onChainPostUrl: onChain.postUrl || null,
    onChainTimestamp: onChain.timestamp.toISOString(),
    onChainVerifier: onChain.verifier,
    onChainMatches,
    verdict: evidenceHashMatches && onChainMatches ? 'VALID' : 'TAMPERED',
  };
}
