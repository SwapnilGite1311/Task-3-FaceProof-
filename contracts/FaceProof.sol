// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FaceProof
 * @notice A minimal, permissionless notary for FaceProof evidence documents.
 *
 * @dev What this contract does and does not claim:
 *
 *  - It stores the SHA-256 digest of a canonical evidence document together
 *    with the public source URL that the off-chain pipeline discovered.
 *  - It therefore proves that a *particular evidence document existed at or
 *    before a particular block*. That is the whole of the guarantee.
 *  - It does NOT prove that a person owns an account, that the discovered post
 *    belongs to the person in the image, or anything about identity. Similarity
 *    scores computed off chain are statistical, not legal, statements.
 *
 * No biometric data ever reaches this contract: only a hash, a platform label,
 * a public post URL and a timestamp are recorded.
 *
 * Writing is intentionally permissionless - anyone may anchor a hash. The
 * meaningful assertion is "this exact document existed by this block", which is
 * independent of who paid the gas. The submitting address is recorded so a
 * verifier can still check that a record came from an expected wallet.
 */
contract FaceProof {
    struct Verification {
        bytes32 evidenceHash;
        string platform;
        string postUrl;
        uint256 timestamp;
        address verifier;
    }

    /// @dev Bounds on the free-form strings, so a single call cannot be used to
    ///      write unbounded calldata into storage.
    uint256 public constant MAX_PLATFORM_LENGTH = 64;
    uint256 public constant MAX_POST_URL_LENGTH = 2048;

    mapping(bytes32 => Verification) private _verifications;
    bytes32[] private _evidenceHashes;

    event VerificationCreated(
        bytes32 indexed evidenceHash,
        string platform,
        string postUrl,
        uint256 timestamp
    );

    error EvidenceHashRequired();
    error VerificationAlreadyAnchored(bytes32 evidenceHash);
    error PlatformTooLong(uint256 length);
    error PostUrlTooLong(uint256 length);
    error VerificationNotFound(bytes32 evidenceHash);
    error IndexOutOfRange(uint256 index, uint256 length);

    /**
     * @notice Anchors an evidence hash on chain.
     * @param evidenceHash SHA-256 of the canonical evidence JSON.
     * @param platform     Human readable platform label, e.g. "Instagram".
     *                     Empty when the pipeline found no reliable match.
     * @param postUrl      Public URL of the discovered source. Empty when there
     *                     is no match - the record then attests only to the
     *                     analysis itself.
     * @return blockTimestamp The block timestamp stored with the record.
     */
    function createVerification(
        bytes32 evidenceHash,
        string calldata platform,
        string calldata postUrl
    ) external returns (uint256 blockTimestamp) {
        if (evidenceHash == bytes32(0)) revert EvidenceHashRequired();
        if (_verifications[evidenceHash].timestamp != 0) {
            revert VerificationAlreadyAnchored(evidenceHash);
        }
        if (bytes(platform).length > MAX_PLATFORM_LENGTH) {
            revert PlatformTooLong(bytes(platform).length);
        }
        if (bytes(postUrl).length > MAX_POST_URL_LENGTH) {
            revert PostUrlTooLong(bytes(postUrl).length);
        }

        blockTimestamp = block.timestamp;

        _verifications[evidenceHash] = Verification({
            evidenceHash: evidenceHash,
            platform: platform,
            postUrl: postUrl,
            timestamp: blockTimestamp,
            verifier: msg.sender
        });
        _evidenceHashes.push(evidenceHash);

        emit VerificationCreated(evidenceHash, platform, postUrl, blockTimestamp);
    }

    /// @notice Returns the record for an evidence hash. Reverts if absent.
    function getVerification(bytes32 evidenceHash)
        external
        view
        returns (Verification memory record)
    {
        record = _verifications[evidenceHash];
        if (record.timestamp == 0) revert VerificationNotFound(evidenceHash);
    }

    /**
     * @notice Non-reverting lookup, convenient for clients that want to render
     *         "not anchored" rather than handle a revert.
     */
    function tryGetVerification(bytes32 evidenceHash)
        external
        view
        returns (bool found, Verification memory record)
    {
        record = _verifications[evidenceHash];
        found = record.timestamp != 0;
    }

    /// @notice True when the hash has been anchored.
    function exists(bytes32 evidenceHash) external view returns (bool) {
        return _verifications[evidenceHash].timestamp != 0;
    }

    /// @notice Total number of anchored records.
    function total() external view returns (uint256) {
        return _evidenceHashes.length;
    }

    /// @notice Evidence hash at an insertion index, for enumeration.
    function evidenceHashAt(uint256 index) external view returns (bytes32) {
        if (index >= _evidenceHashes.length) {
            revert IndexOutOfRange(index, _evidenceHashes.length);
        }
        return _evidenceHashes[index];
    }
}
