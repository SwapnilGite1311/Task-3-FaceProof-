import { describe, expect, it } from 'vitest';
import { Interface, sha256 as ethersSha256, toUtf8Bytes } from 'ethers';
import type { BlockchainRecord } from '@prisma/client';
import { FACEPROOF_ABI, MAX_PLATFORM_LENGTH, MAX_POST_URL_LENGTH } from '../src/modules/blockchain';
import { toBlockchainDto } from '../src/modules/verification/repository';
import { sha256Utf8, toBytes32 } from '../src/utils/hash';
import { config } from '../src/config/env';

describe('FaceProof ABI', () => {
  const iface = new Interface(FACEPROOF_ABI as unknown as string[]);

  it('exposes the functions the service calls', () => {
    for (const name of [
      'createVerification',
      'getVerification',
      'tryGetVerification',
      'exists',
      'total',
      'evidenceHashAt',
    ]) {
      expect(iface.getFunction(name), name).toBeTruthy();
    }
  });

  it('declares createVerification with the agreed signature', () => {
    const fragment = iface.getFunction('createVerification');
    expect(fragment?.format('sighash')).toBe('createVerification(bytes32,string,string)');
  });

  it('declares the VerificationCreated event with an indexed hash', () => {
    const event = iface.getEvent('VerificationCreated');
    expect(event?.format('sighash')).toBe('VerificationCreated(bytes32,string,string,uint256)');
    expect(event?.inputs[0]?.indexed).toBe(true);
  });

  it('encodes a call whose bytes32 argument is the evidence digest', () => {
    const digest = sha256Utf8('{"verificationId":"abc"}');
    const data = iface.encodeFunctionData('createVerification', [
      toBytes32(digest),
      'Instagram',
      'https://www.instagram.com/p/Cabc/',
    ]);

    const decoded = iface.decodeFunctionData('createVerification', data);
    expect(decoded[0]).toBe(`0x${digest}`);
    expect(decoded[1]).toBe('Instagram');
    expect(decoded[2]).toBe('https://www.instagram.com/p/Cabc/');
  });

  it('produces the same digest as ethers for the same pre-image', () => {
    const preImage = '{"a":1}';
    expect(`0x${sha256Utf8(preImage)}`).toBe(ethersSha256(toUtf8Bytes(preImage)));
  });

  it('mirrors the contract string bounds', () => {
    expect(MAX_PLATFORM_LENGTH).toBe(64);
    expect(MAX_POST_URL_LENGTH).toBe(2048);
  });
});

describe('blockchain record formatting', () => {
  const row = {
    id: 'rec_1',
    verificationId: 'ver_1',
    network: 'polygon-amoy',
    chainId: 80002,
    contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
    transactionHash: '0xabc123',
    blockNumber: 26_542_913n,
    evidenceHash: 'f'.repeat(64),
    timestamp: new Date('2026-09-05T10:00:00.000Z'),
    confirmations: 3,
    gasUsed: '128432',
    status: 'confirmed',
    error: null,
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    updatedAt: new Date('2026-09-05T10:00:05.000Z'),
  } satisfies BlockchainRecord;

  it('serialises BigInt block numbers as strings so JSON encoding cannot throw', () => {
    const dto = toBlockchainDto(row);
    expect(dto?.blockNumber).toBe('26542913');
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('builds explorer links dynamically from configuration', () => {
    const dto = toBlockchainDto(row);
    expect(dto?.explorerTxUrl).toBe(`${config.blockchain.explorerUrl}/tx/0xabc123`);
    expect(dto?.explorerContractUrl).toBe(
      `${config.blockchain.explorerUrl}/address/${row.contractAddress}`,
    );
  });

  it('emits ISO-8601 timestamps', () => {
    expect(toBlockchainDto(row)?.timestamp).toBe('2026-09-05T10:00:00.000Z');
  });

  it('keeps a null block number null rather than coercing it to zero', () => {
    expect(toBlockchainDto({ ...row, blockNumber: null })?.blockNumber).toBeNull();
  });

  it('propagates a failed status and its error message', () => {
    const dto = toBlockchainDto({ ...row, status: 'failed', error: 'insufficient funds' });
    expect(dto?.status).toBe('failed');
    expect(dto?.error).toBe('insufficient funds');
  });

  it('returns null when there is no record at all', () => {
    expect(toBlockchainDto(null)).toBeNull();
  });
});
