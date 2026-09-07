import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { FaceProof } from '../typechain-types';

const hash = (value: string) => ethers.sha256(ethers.toUtf8Bytes(value));

describe('FaceProof', () => {
  let contract: FaceProof;

  beforeEach(async () => {
    const factory = await ethers.getContractFactory('FaceProof');
    contract = (await factory.deploy()) as unknown as FaceProof;
    await contract.waitForDeployment();
  });

  it('anchors an evidence hash and emits VerificationCreated', async () => {
    const evidenceHash = hash('{"verificationId":"abc"}');
    const platform = 'Instagram';
    const postUrl = 'https://www.instagram.com/p/Cabcdefghij/';

    await expect(contract.createVerification(evidenceHash, platform, postUrl))
      .to.emit(contract, 'VerificationCreated')
      .withArgs(evidenceHash, platform, postUrl, (value: bigint) => value > 0n);

    const record = await contract.getVerification(evidenceHash);
    const [signer] = await ethers.getSigners();

    expect(record.evidenceHash).to.equal(evidenceHash);
    expect(record.platform).to.equal(platform);
    expect(record.postUrl).to.equal(postUrl);
    expect(record.verifier).to.equal(signer!.address);
    expect(record.timestamp).to.be.greaterThan(0n);
  });

  it('accepts a record with no match (empty platform and url)', async () => {
    const evidenceHash = hash('no-match');
    await contract.createVerification(evidenceHash, '', '');

    const [found, record] = await contract.tryGetVerification(evidenceHash);
    expect(found).to.equal(true);
    expect(record.platform).to.equal('');
    expect(record.postUrl).to.equal('');
  });

  it('rejects the zero hash', async () => {
    await expect(contract.createVerification(ethers.ZeroHash, 'X', '')).to.be.revertedWithCustomError(
      contract,
      'EvidenceHashRequired',
    );
  });

  it('refuses to anchor the same evidence hash twice', async () => {
    const evidenceHash = hash('duplicate');
    await contract.createVerification(evidenceHash, 'X', 'https://x.com/a/status/1');

    await expect(contract.createVerification(evidenceHash, 'X', 'https://x.com/a/status/1'))
      .to.be.revertedWithCustomError(contract, 'VerificationAlreadyAnchored')
      .withArgs(evidenceHash);
  });

  it('bounds the platform and url lengths', async () => {
    await expect(
      contract.createVerification(hash('long-platform'), 'p'.repeat(65), ''),
    ).to.be.revertedWithCustomError(contract, 'PlatformTooLong');

    await expect(
      contract.createVerification(hash('long-url'), 'X', `https://x.com/${'a'.repeat(2050)}`),
    ).to.be.revertedWithCustomError(contract, 'PostUrlTooLong');
  });

  it('reports unknown hashes without reverting via tryGetVerification', async () => {
    const [found] = await contract.tryGetVerification(hash('never-anchored'));
    expect(found).to.equal(false);
    expect(await contract.exists(hash('never-anchored'))).to.equal(false);

    await expect(contract.getVerification(hash('never-anchored'))).to.be.revertedWithCustomError(
      contract,
      'VerificationNotFound',
    );
  });

  it('enumerates anchored records', async () => {
    const first = hash('one');
    const second = hash('two');

    await contract.createVerification(first, 'Instagram', 'https://instagram.com/p/1/');
    await contract.createVerification(second, 'Reddit', 'https://reddit.com/r/pics/comments/2/');

    expect(await contract.total()).to.equal(2n);
    expect(await contract.evidenceHashAt(0)).to.equal(first);
    expect(await contract.evidenceHashAt(1)).to.equal(second);

    await expect(contract.evidenceHashAt(2)).to.be.revertedWithCustomError(
      contract,
      'IndexOutOfRange',
    );
  });
});
