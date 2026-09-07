import { Contract, JsonRpcProvider, Wallet, isError, type TransactionReceipt } from 'ethers';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { toBytes32 } from '../../utils/hash';
import { logger } from '../../utils/logger';
import { FACEPROOF_ABI, MAX_PLATFORM_LENGTH, MAX_POST_URL_LENGTH } from './abi';

export interface OnChainRecord {
  evidenceHash: string;
  platform: string;
  postUrl: string;
  timestamp: Date;
  verifier: string;
}

export interface SubmittedTransaction {
  transactionHash: string;
  network: string;
  chainId: number;
  contractAddress: string;
  /** Null when the configured network has no block explorer. */
  explorerTxUrl: string | null;
}

export interface ConfirmedTransaction extends SubmittedTransaction {
  blockNumber: number;
  blockTimestamp: Date;
  gasUsed: string;
  confirmations: number;
}

export interface WalletStatus {
  address: string;
  balanceWei: string;
  balanceFormatted: string;
  chainId: number;
  networkName: string;
  contractAddress: string;
  contractDeployed: boolean;
}

/**
 * Everything that touches the chain.
 *
 * The private key never leaves this process: the frontend only ever sees a
 * transaction hash and an explorer URL, both of which are public information
 * the moment the transaction is broadcast.
 */
export class BlockchainService {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private contract: Contract | null = null;

  /** Throws with an actionable message when the chain cannot be used. */
  assertConfigured(): void {
    if (config.demoMode) {
      throw new AppError('DEMO_MODE is enabled, so no blockchain transaction was submitted.', {
        code: ERROR_CODES.DEMO_MODE_BLOCKED,
        statusCode: 503,
        stage: 'blockchain_anchor',
        hint: 'Set DEMO_MODE=false and provide BLOCKCHAIN_PRIVATE_KEY plus FACEPROOF_CONTRACT_ADDRESS to anchor real evidence.',
      });
    }
    if (!config.blockchain.privateKey) {
      throw new AppError('No blockchain private key is configured.', {
        code: ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED,
        statusCode: 503,
        stage: 'blockchain_anchor',
        hint: 'Set BLOCKCHAIN_PRIVATE_KEY in .env to a funded Polygon Amoy account. Fund it at https://faucet.polygon.technology',
      });
    }
    if (!config.blockchain.contractAddress) {
      throw new AppError('No FaceProof contract address is configured.', {
        code: ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED,
        statusCode: 503,
        stage: 'blockchain_anchor',
        hint: 'Deploy the contract with `npm run contracts:deploy` and set FACEPROOF_CONTRACT_ADDRESS in .env.',
      });
    }
  }

  /** Establishes provider, signer and contract handles. Idempotent. */
  async connect(): Promise<void> {
    this.assertConfigured();
    if (this.contract) return;

    this.provider = new JsonRpcProvider(config.blockchain.rpcUrl, {
      chainId: config.blockchain.chainId,
      name: config.blockchain.network,
    });

    try {
      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== config.blockchain.chainId) {
        throw new AppError(
          `The RPC endpoint is on chain ${network.chainId} but BLOCKCHAIN_CHAIN_ID is ${config.blockchain.chainId}.`,
          {
            code: ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED,
            statusCode: 503,
            hint: 'Point POLYGON_RPC_URL at a Polygon Amoy endpoint, or correct BLOCKCHAIN_CHAIN_ID.',
          },
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Could not reach the RPC endpoint at ${config.blockchain.rpcUrl}.`, {
        code: ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED,
        statusCode: 503,
        cause: error,
        hint: 'Check POLYGON_RPC_URL. The public Amoy endpoint is rate limited; a free Alchemy or Infura key is more reliable.',
      });
    }

    this.wallet = new Wallet(config.blockchain.privateKey as string, this.provider);
    this.contract = new Contract(
      config.blockchain.contractAddress as string,
      FACEPROOF_ABI as unknown as string[],
      this.wallet,
    );

    logger.info(
      {
        network: config.blockchain.network,
        chainId: config.blockchain.chainId,
        contract: config.blockchain.contractAddress,
        signer: this.wallet.address,
      },
      'Blockchain service connected',
    );
  }

  /** Read-only handle; used by verification checks that must not need a key. */
  private async readOnlyContract(): Promise<Contract> {
    if (this.contract) return this.contract;
    if (!config.blockchain.contractAddress) {
      throw new AppError('No FaceProof contract address is configured.', {
        code: ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED,
        statusCode: 503,
      });
    }
    const provider = new JsonRpcProvider(config.blockchain.rpcUrl, {
      chainId: config.blockchain.chainId,
      name: config.blockchain.network,
    });
    return new Contract(
      config.blockchain.contractAddress,
      FACEPROOF_ABI as unknown as string[],
      provider,
    );
  }

  /** Null when the configured network has no block explorer (local chains). */
  explorerTxUrl(transactionHash: string): string | null {
    return config.blockchain.explorerUrl
      ? `${config.blockchain.explorerUrl}/tx/${transactionHash}`
      : null;
  }

  explorerContractUrl(): string | null {
    return config.blockchain.explorerUrl
      ? `${config.blockchain.explorerUrl}/address/${config.blockchain.contractAddress ?? ''}`
      : null;
  }

  /**
   * Submits the evidence hash. Returns as soon as the transaction is accepted
   * by the network so the UI can show the hash while confirmation is pending.
   */
  async createRecord(input: {
    evidenceHash: string;
    platform: string | null;
    postUrl: string | null;
  }): Promise<SubmittedTransaction> {
    await this.connect();
    const contract = this.contract as Contract;

    const evidenceHash = toBytes32(input.evidenceHash);
    const platform = truncate(input.platform ?? '', MAX_PLATFORM_LENGTH);
    const postUrl = truncate(input.postUrl ?? '', MAX_POST_URL_LENGTH);

    await this.assertFunded();

    try {
      const method = contract.getFunction('createVerification');
      const tx = await method(evidenceHash, platform, postUrl);

      logger.info(
        { transactionHash: tx.hash, evidenceHash, platform: platform || null },
        'Evidence hash submitted to chain',
      );

      return {
        transactionHash: tx.hash,
        network: config.blockchain.network,
        chainId: config.blockchain.chainId,
        contractAddress: config.blockchain.contractAddress as string,
          explorerTxUrl: this.explorerTxUrl(tx.hash),
      };
    } catch (error) {
      throw this.translateSubmitError(error, evidenceHash);
    }
  }

  /** Waits for the configured number of confirmations. */
  async waitForConfirmation(transactionHash: string): Promise<ConfirmedTransaction> {
    await this.connect();
    const provider = this.provider as JsonRpcProvider;

    let receipt: TransactionReceipt | null;
    try {
      receipt = await provider.waitForTransaction(
        transactionHash,
        config.blockchain.confirmations,
        config.blockchain.confirmationTimeoutMs,
      );
    } catch (error) {
      throw new AppError(`Failed while waiting for transaction ${transactionHash}.`, {
        code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
        statusCode: 502,
        stage: 'blockchain_anchor',
        cause: error,
      });
    }

    if (!receipt) {
      throw new AppError(
        `Transaction ${transactionHash} was not confirmed within ${Math.round(config.blockchain.confirmationTimeoutMs / 1000)}s.`,
        {
          code: ERROR_CODES.BLOCKCHAIN_CONFIRMATION_TIMEOUT,
          statusCode: 504,
          stage: 'blockchain_anchor',
          hint: 'The transaction may still confirm later. Open it on the explorer to check before retrying.',
          details: { transactionHash, explorerTxUrl: this.explorerTxUrl(transactionHash) },
        },
      );
    }

    if (receipt.status === 0) {
      throw new AppError(`Transaction ${transactionHash} was mined but reverted.`, {
        code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
        statusCode: 502,
        stage: 'blockchain_anchor',
        details: { transactionHash, explorerTxUrl: this.explorerTxUrl(transactionHash) },
      });
    }

    const block = await provider.getBlock(receipt.blockNumber);
    const confirmations = await receipt.confirmations();

    return {
      transactionHash,
      network: config.blockchain.network,
      chainId: config.blockchain.chainId,
      contractAddress: config.blockchain.contractAddress as string,
      explorerTxUrl: this.explorerTxUrl(transactionHash),
      blockNumber: receipt.blockNumber,
      blockTimestamp: new Date((block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000),
      gasUsed: receipt.gasUsed.toString(),
      confirmations: Number(confirmations),
    };
  }

  async getTransaction(transactionHash: string) {
    await this.connect();
    const provider = this.provider as JsonRpcProvider;
    const [transaction, receipt] = await Promise.all([
      provider.getTransaction(transactionHash),
      provider.getTransactionReceipt(transactionHash),
    ]);
    return { transaction, receipt, explorerTxUrl: this.explorerTxUrl(transactionHash) };
  }

  /**
   * Reads a record straight from the contract. This is the call that makes the
   * proof independently checkable: it does not consult our database at all.
   */
  async verifyRecord(evidenceHash: string): Promise<OnChainRecord | null> {
    const contract = await this.readOnlyContract();
    const key = toBytes32(evidenceHash);

    try {
      const method = contract.getFunction('tryGetVerification');
      const [found, record] = (await method(key)) as [
        boolean,
        {
          evidenceHash: string;
          platform: string;
          postUrl: string;
          timestamp: bigint;
          verifier: string;
        },
      ];

      if (!found) return null;

      return {
        evidenceHash: record.evidenceHash,
        platform: record.platform,
        postUrl: record.postUrl,
        timestamp: new Date(Number(record.timestamp) * 1000),
        verifier: record.verifier,
      };
    } catch (error) {
      throw new AppError('Could not read the record back from the contract.', {
        code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
        statusCode: 502,
        cause: error,
        hint: 'Check FACEPROOF_CONTRACT_ADDRESS and that POLYGON_RPC_URL is reachable.',
      });
    }
  }

  /** Wallet/contract health, surfaced by GET /api/v1/health. */
  async status(): Promise<WalletStatus> {
    await this.connect();
    const provider = this.provider as JsonRpcProvider;
    const wallet = this.wallet as Wallet;

    const [balance, code] = await Promise.all([
      provider.getBalance(wallet.address),
      provider.getCode(config.blockchain.contractAddress as string),
    ]);

    return {
      address: wallet.address,
      balanceWei: balance.toString(),
      balanceFormatted: `${Number(balance) / 1e18} POL`,
      chainId: config.blockchain.chainId,
      networkName: config.blockchain.network,
      contractAddress: config.blockchain.contractAddress as string,
      contractDeployed: code !== '0x',
    };
  }

  private async assertFunded(): Promise<void> {
    const provider = this.provider as JsonRpcProvider;
    const wallet = this.wallet as Wallet;

    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) {
      throw new AppError(`The signing wallet ${wallet.address} has no POL to pay for gas.`, {
        code: ERROR_CODES.BLOCKCHAIN_INSUFFICIENT_FUNDS,
        statusCode: 503,
        stage: 'blockchain_anchor',
        hint: `Fund ${wallet.address} with test POL from https://faucet.polygon.technology (select Polygon Amoy).`,
      });
    }
  }

  private translateSubmitError(error: unknown, evidenceHash: string): AppError {
    if (isError(error, 'INSUFFICIENT_FUNDS')) {
      return new AppError('The signing wallet does not have enough POL to pay for gas.', {
        code: ERROR_CODES.BLOCKCHAIN_INSUFFICIENT_FUNDS,
        statusCode: 503,
        stage: 'blockchain_anchor',
        cause: error,
        hint: 'Top the wallet up at https://faucet.polygon.technology (Polygon Amoy).',
      });
    }

    const message = error instanceof Error ? error.message : String(error);

    if (/VerificationAlreadyAnchored/.test(message)) {
      return new AppError(
        'This exact evidence document has already been anchored on chain.',
        {
          code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
          statusCode: 409,
          stage: 'blockchain_anchor',
          cause: error,
          hint: 'An identical verification already exists. Look it up by its evidence hash instead of re-anchoring.',
          details: { evidenceHash },
        },
      );
    }

    if (isError(error, 'CALL_EXCEPTION')) {
      return new AppError(`The contract rejected the transaction: ${message}`, {
        code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
        statusCode: 502,
        stage: 'blockchain_anchor',
        cause: error,
      });
    }

    return new AppError(`Failed to submit the transaction: ${message}`, {
      code: ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED,
      statusCode: 502,
      stage: 'blockchain_anchor',
      cause: error,
      hint: 'The public Amoy RPC endpoint is frequently rate limited. A dedicated RPC URL is far more reliable.',
    });
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

let instance: BlockchainService | null = null;

export function getBlockchainService(): BlockchainService {
  instance ??= new BlockchainService();
  return instance;
}
