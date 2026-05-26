import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getConnection } from '../utils/solana';

export interface ClaimResult {
  claimed: boolean;
  amountUsdc: string;
  txSignature: string;
  claimRoundId: number;
}

// Fee accumulator — collects USDC creator fees from bonding curve trades
const FEE_ACCUMULATOR = new PublicKey('79zVwEh3BHYs5N352uNuCQZv16swdtriAP1Sgm6ksbLA');

// CollectCreatorFeeV2 discriminator
const COLLECT_CREATOR_FEE_V2_DISC = Buffer.from('cf118af204221338', 'hex');

// Event authority PDA
const [EVENT_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  config.pumpswapProgram
);

async function logEvent(type: string, message: string, data?: Record<string, unknown>): Promise<void> {
  await pool.query(
    'INSERT INTO events (type, message, data) VALUES ($1, $2, $3)',
    [type, message, data ? JSON.stringify(data) : null]
  );
}

async function getTokenAccountBalance(connection: ReturnType<typeof getConnection>, ata: PublicKey): Promise<bigint> {
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return BigInt(info.value.amount);
  } catch {
    return BigInt(0);
  }
}

function buildCollectCreatorFeeUSDC(): TransactionInstruction {
  const creatorUsdcAta = getAssociatedTokenAddressSync(config.usdcMint, config.walletPublicKey);
  const feeAccumulatorUsdcAta = getAssociatedTokenAddressSync(config.usdcMint, FEE_ACCUMULATOR, true);

  return new TransactionInstruction({
    programId: config.pumpswapProgram,
    keys: [
      { pubkey: config.walletPublicKey, isSigner: true, isWritable: true },
      { pubkey: creatorUsdcAta, isSigner: false, isWritable: true },
      { pubkey: FEE_ACCUMULATOR, isSigner: false, isWritable: true },
      { pubkey: feeAccumulatorUsdcAta, isSigner: false, isWritable: true },
      { pubkey: config.usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: config.pumpswapProgram, isSigner: false, isWritable: false },
    ],
    data: COLLECT_CREATOR_FEE_V2_DISC,
  });
}

export async function claimCreatorFees(): Promise<ClaimResult | null> {
  const connection = getConnection();

  await logEvent('claim_started', 'Starting fee claim cycle');
  logger.info('Starting fee claim...');

  try {
    const deployerUsdcAta = getAssociatedTokenAddressSync(config.usdcMint, config.walletPublicKey);

    // Get balance BEFORE claim
    const balanceBefore = await getTokenAccountBalance(connection, deployerUsdcAta);
    logger.info('USDC balance before claim', { balance: balanceBefore.toString() });

    // Create USDC ATA if needed (idempotent)
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      config.walletPublicKey,
      deployerUsdcAta,
      config.walletPublicKey,
      config.usdcMint
    );

    // Build collect instruction
    const collectIx = buildCollectCreatorFeeUSDC();

    // Build versioned transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: config.walletPublicKey,
      recentBlockhash: blockhash,
      instructions: [createAtaIx, collectIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([config.walletKeypair]);

    // Simulate first to check for "No creator fee to collect"
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const logs = sim.value.logs || [];
      const noFeeLog = logs.some((l: string) => l.includes('No creator fee to collect'));
      if (noFeeLog) {
        logger.info('No creator fees to collect');
        await logEvent('claim_completed', 'No fees available to claim', { reason: 'no_fees' });
        return null;
      }
      throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
    }

    // Check simulation logs for "No creator fee to collect" even without error
    const noFee = sim.value.logs?.some((l: string) => l.includes('No creator fee to collect'));
    if (noFee) {
      logger.info('No creator fees to collect (from sim logs)');
      await logEvent('claim_completed', 'No fees available to claim', { reason: 'no_fees_in_logs' });
      return null;
    }

    // Send for real
    const txSignature = await connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3,
    });
    logger.info('Claim transaction sent', { signature: txSignature });

    // Confirm
    await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    logger.info('Claim transaction confirmed', { signature: txSignature });

    // Get balance AFTER claim
    // Small delay to ensure balance is updated
    await new Promise(resolve => setTimeout(resolve, 2000));
    const balanceAfter = await getTokenAccountBalance(connection, deployerUsdcAta);
    logger.info('USDC balance after claim', { balance: balanceAfter.toString() });

    // Calculate delta (USDC has 6 decimals)
    const deltaRaw = balanceAfter - balanceBefore;
    if (deltaRaw <= BigInt(0)) {
      logger.info('No fees to claim (delta = 0)');
      await logEvent('claim_completed', 'No fees available to claim', {
        txSignature,
        delta: '0',
      });
      return null;
    }

    // Convert raw amount to human-readable (6 decimals)
    const amountUsdc = formatUsdcAmount(deltaRaw);
    logger.info('Fees claimed successfully', { amountUsdc, txSignature });

    // Record in database
    const insertResult = await pool.query<{ id: number }>(
      `INSERT INTO claim_rounds (tx_signature, amount_usdc, fee_account, status)
       VALUES ($1, $2, $3, 'completed') RETURNING id`,
      [txSignature, amountUsdc, FEE_ACCUMULATOR.toBase58()]
    );

    const claimRoundId = insertResult.rows[0].id;

    await logEvent('claim_completed', `Claimed ${amountUsdc} USDC`, {
      txSignature,
      amountUsdc,
      claimRoundId,
    });

    return {
      claimed: true,
      amountUsdc,
      txSignature,
      claimRoundId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Fee claim failed', { error: errorMessage });
    await logEvent('claim_failed', `Fee claim failed: ${errorMessage}`, {
      error: errorMessage,
    });
    return null;
  }
}

function formatUsdcAmount(rawAmount: bigint): string {
  const whole = rawAmount / BigInt(1_000_000);
  const fraction = rawAmount % BigInt(1_000_000);
  const fractionStr = fraction.toString().padStart(6, '0');
  return `${whole}.${fractionStr}`;
}
