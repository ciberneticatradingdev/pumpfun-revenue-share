import {
  Connection,
  Transaction,
  TransactionInstruction,
  Keypair,
  ComputeBudgetProgram,
  SendOptions,
  TransactionSignature,
} from '@solana/web3.js';
import { config } from '../config';
import { logger } from './logger';

let connectionInstance: Connection | null = null;

export function getConnection(): Connection {
  if (!connectionInstance) {
    connectionInstance = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
    });
    logger.info('Solana connection initialized', { rpc: config.solanaRpcUrl.substring(0, 30) + '...' });
  }
  return connectionInstance;
}

export function addPriorityFees(transaction: Transaction): void {
  transaction.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
  );
}

export interface SendTransactionResult {
  signature: TransactionSignature;
  confirmed: boolean;
}

export async function sendTransactionWithRetry(
  instructions: TransactionInstruction[],
  signers: Keypair[],
  maxRetries: number = 3
): Promise<SendTransactionResult> {
  const connection = getConnection();
  const backoffMs = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const transaction = new Transaction();
      addPriorityFees(transaction);
      instructions.forEach((ix) => transaction.add(ix));

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = signers[0].publicKey;
      transaction.sign(...signers);

      const sendOptions: SendOptions = {
        skipPreflight: true,
        maxRetries: 0,
      };

      logger.info(`Sending transaction attempt ${attempt + 1}/${maxRetries}`);
      const signature = await connection.sendRawTransaction(transaction.serialize(), sendOptions);
      logger.info('Transaction sent', { signature });

      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      logger.info('Transaction confirmed', { signature });
      return { signature, confirmed: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Transaction attempt ${attempt + 1} failed`, { error: errorMessage });

      if (attempt < maxRetries - 1) {
        const delay = backoffMs[attempt] || 4000;
        logger.info(`Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }

  throw new Error('All transaction attempts exhausted');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
