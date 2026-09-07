/**
 * Minimal ABI for FaceProof.sol.
 *
 * Written by hand rather than imported from Hardhat artifacts so the running
 * API has no build-time dependency on the contracts workspace. It must stay in
 * sync with contracts/FaceProof.sol - the contract test suite and the
 * `verifyRecord` round-trip both exercise these signatures.
 */
export const FACEPROOF_ABI = [
  'function createVerification(bytes32 evidenceHash, string calldata platform, string calldata postUrl) external returns (uint256)',
  'function getVerification(bytes32 evidenceHash) external view returns (tuple(bytes32 evidenceHash, string platform, string postUrl, uint256 timestamp, address verifier))',
  'function tryGetVerification(bytes32 evidenceHash) external view returns (bool found, tuple(bytes32 evidenceHash, string platform, string postUrl, uint256 timestamp, address verifier) record)',
  'function exists(bytes32 evidenceHash) external view returns (bool)',
  'function total() external view returns (uint256)',
  'function evidenceHashAt(uint256 index) external view returns (bytes32)',
  'event VerificationCreated(bytes32 indexed evidenceHash, string platform, string postUrl, uint256 timestamp)',
  'error EvidenceHashRequired()',
  'error VerificationAlreadyAnchored(bytes32 evidenceHash)',
  'error PlatformTooLong(uint256 length)',
  'error PostUrlTooLong(uint256 length)',
  'error VerificationNotFound(bytes32 evidenceHash)',
  'error IndexOutOfRange(uint256 index, uint256 length)',
] as const;

/** Mirrors the on-chain string bounds so we fail fast instead of paying gas. */
export const MAX_PLATFORM_LENGTH = 64;
export const MAX_POST_URL_LENGTH = 2048;
