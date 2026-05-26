import {
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getConnection, sendTransactionWithRetry } from '../utils/solana';

export interface ClaimResult {
  claimed: boolean;
  amountUsdc: string;
  txSignature: string;
  claimRoundId: number;
}

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

export async function claimCreatorFees(): Promise<ClaimResult | null> {
  const connection = getConnection();

  await logEvent('claim_started', 'Starting fee claim cycle');
  logger.info('Starting fee claim...');

  try {
    // Get deployer's USDC ATA
    const deployerUsdcAta = await getAssociatedTokenAddress(
      config.usdcMint,
      config.walletPublicKey
    );

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

    // Build CollectCreatorFeeV2 instruction
    const discriminator = Buffer.from('cf118af204221338', 'hex');

    // Derive fee vault PDA
    // Account keys for CollectCreatorFeeV2:
    // 0: pool (fee_account from config)
    // 1: creator (signer) 
    // 2: creator_token_account (deployer USDC ATA)
    // 3: fee_vault (fee account)
    // 4: token_program
    // 5: system_program
    const collectFeeIx = new TransactionInstruction({
      programId: config.pumpswapProgram,
      keys: [
        { pubkey: config.feeAccount, isSigner: false, isWritable: true },
        { pubkey: config.walletPublicKey, isSigner: true, isWritable: true },
        { pubkey: deployerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: config.feeAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      data: discriminator,
    });

    // Send transaction
    const result = await sendTransactionWithRetry(
      [createAtaIx, collectFeeIx],
      [config.walletKeypair]
    );

    // Get balance AFTER claim
    const balanceAfter = await getTokenAccountBalance(connection, deployerUsdcAta);
    logger.info('USDC balance after claim', { balance: balanceAfter.toString() });

    // Calculate delta (USDC has 6 decimals)
    const deltaRaw = balanceAfter - balanceBefore;
    if (deltaRaw <= BigInt(0)) {
      logger.info('No fees to claim (delta = 0)');
      await logEvent('claim_completed', 'No fees available to claim', {
        txSignature: result.signature,
        delta: '0',
      });
      return null;
    }

    // Convert raw amount to human-readable (6 decimals)
    const amountUsdc = formatUsdcAmount(deltaRaw);
    logger.info('Fees claimed successfully', { amountUsdc, txSignature: result.signature });

    // Record in database
    const insertResult = await pool.query<{ id: number }>(
      `INSERT INTO claim_rounds (tx_signature, amount_usdc, fee_account, status)
       VALUES ($1, $2, $3, 'completed') RETURNING id`,
      [result.signature, amountUsdc, config.feeAccount.toBase58()]
    );

    const claimRoundId = insertResult.rows[0].id;

    await logEvent('claim_completed', `Claimed ${amountUsdc} USDC`, {
      txSignature: result.signature,
      amountUsdc,
      claimRoundId,
    });

    return {
      claimed: true,
      amountUsdc,
      txSignature: result.signature,
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
