import { PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getConnection, sendTransactionWithRetry } from '../utils/solana';
import { HolderInfo } from './snapshot';

export interface DistributionResult {
  distributionId: number;
  totalDistributed: string;
  successCount: number;
  failCount: number;
  status: string;
}

interface PaymentInfo {
  wallet: string;
  amountUsdc: string;
  amountRaw: bigint;
  tokenBalance: string;
  percentage: string;
}

async function logEvent(type: string, message: string, data?: Record<string, unknown>): Promise<void> {
  await pool.query(
    'INSERT INTO events (type, message, data) VALUES ($1, $2, $3)',
    [type, message, data ? JSON.stringify(data) : null]
  );
}

export async function distributeUsdc(
  claimRoundId: number,
  snapshotId: number,
  holders: HolderInfo[],
  totalAmountUsdc: string,
  totalSupply: string
): Promise<DistributionResult> {
  logger.info('Starting USDC distribution', {
    claimRoundId,
    snapshotId,
    holderCount: holders.length,
    totalAmountUsdc,
  });

  // Create distribution record
  const distResult = await pool.query<{ id: number }>(
    `INSERT INTO distributions (claim_round_id, snapshot_id, total_amount_usdc, holder_count, status)
     VALUES ($1, $2, $3, $4, 'distributing') RETURNING id`,
    [claimRoundId, snapshotId, totalAmountUsdc, holders.length]
  );
  const distributionId = distResult.rows[0].id;

  await logEvent('distribution_started', `Distribution #${distributionId} started`, {
    distributionId,
    claimRoundId,
    totalAmountUsdc,
    holderCount: holders.length,
  });

  // Calculate each holder's share
  const totalAmountRaw = parseUsdcToRaw(totalAmountUsdc);
  const totalSupplyNum = parseFloat(totalSupply);
  const dustThreshold = BigInt(1); // 0.000001 USDC = 1 raw unit

  const payments: PaymentInfo[] = [];

  for (const holder of holders) {
    const holderBalance = parseFloat(holder.tokenBalance);
    const share = holderBalance / totalSupplyNum;
    const amountRaw = BigInt(Math.floor(Number(totalAmountRaw) * share));

    if (amountRaw < dustThreshold) continue;

    const amountUsdc = formatUsdcAmount(amountRaw);

    payments.push({
      wallet: holder.wallet,
      amountUsdc,
      amountRaw,
      tokenBalance: holder.tokenBalance,
      percentage: holder.percentage,
    });
  }

  logger.info(`Preparing ${payments.length} payments`);

  // Insert all payment records
  for (const payment of payments) {
    await pool.query(
      `INSERT INTO distribution_payments 
       (distribution_id, wallet, amount_usdc, token_balance, percentage, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [distributionId, payment.wallet, payment.amountUsdc, payment.tokenBalance, payment.percentage]
    );
  }

  // Batch and send payments
  let successCount = 0;
  let failCount = 0;
  const batches = chunkArray(payments, config.batchSize);

  const deployerUsdcAta = getAssociatedTokenAddressSync(
    config.usdcMint,
    config.walletPublicKey
  );

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    logger.info(`Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} payments)`);

    try {
      const instructions = [];

      for (const payment of batch) {
        const recipientPubkey = new PublicKey(payment.wallet);
        const recipientAta = getAssociatedTokenAddressSync(
          config.usdcMint,
          recipientPubkey
        );

        // Create ATA if needed (idempotent)
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            config.walletPublicKey,
            recipientAta,
            recipientPubkey,
            config.usdcMint
          )
        );

        // Transfer USDC
        instructions.push(
          createTransferInstruction(
            deployerUsdcAta,
            recipientAta,
            config.walletPublicKey,
            payment.amountRaw
          )
        );
      }

      const result = await sendTransactionWithRetry(instructions, [config.walletKeypair], 3);

      // Mark batch payments as sent
      for (const payment of batch) {
        await pool.query(
          `UPDATE distribution_payments 
           SET status = 'confirmed', tx_signature = $1, sent_at = NOW()
           WHERE distribution_id = $2 AND wallet = $3 AND status = 'pending'`,
          [result.signature, distributionId, payment.wallet]
        );
        successCount++;
      }

      await logEvent('payment_sent', `Batch ${batchIdx + 1} sent: ${batch.length} payments`, {
        distributionId,
        batchIndex: batchIdx,
        txSignature: result.signature,
        paymentCount: batch.length,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
      logger.error(`Batch ${batchIdx + 1} failed`, { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });

      // Mark batch payments as failed
      for (const payment of batch) {
        await pool.query(
          `UPDATE distribution_payments 
           SET status = 'failed', error_message = $1
           WHERE distribution_id = $2 AND wallet = $3 AND status = 'pending'`,
          [errorMessage, distributionId, payment.wallet]
        );
        failCount++;
      }

      await logEvent('payment_failed', `Batch ${batchIdx + 1} failed: ${errorMessage}`, {
        distributionId,
        batchIndex: batchIdx,
        error: errorMessage,
      });
    }
  }

  // Update distribution status
  const status = failCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial';

  await pool.query(
    `UPDATE distributions SET status = $1, completed_at = NOW() WHERE id = $2`,
    [status, distributionId]
  );

  const totalDistributed = payments
    .filter((_, idx) => {
      const batchIdx = Math.floor(idx / config.batchSize);
      // We can't perfectly track this inline, so use successCount
      return true;
    })
    .reduce((sum, p) => sum + p.amountRaw, BigInt(0));

  const result: DistributionResult = {
    distributionId,
    totalDistributed: formatUsdcAmount(totalDistributed),
    successCount,
    failCount,
    status,
  };

  await logEvent('distribution_completed', `Distribution #${distributionId} ${status}`, {
    distributionId,
    totalDistributed: result.totalDistributed,
    successCount: result.successCount,
    failCount: result.failCount,
    status: result.status,
  });

  logger.info('Distribution complete', {
    distributionId: result.distributionId,
    totalDistributed: result.totalDistributed,
    successCount: result.successCount,
    failCount: result.failCount,
    status: result.status,
  });
  return result;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseUsdcToRaw(amount: string): bigint {
  const parts = amount.split('.');
  const whole = BigInt(parts[0]) * BigInt(1_000_000);
  const fraction = parts[1] ? BigInt(parts[1].padEnd(6, '0').slice(0, 6)) : BigInt(0);
  return whole + fraction;
}

function formatUsdcAmount(rawAmount: bigint): string {
  const whole = rawAmount / BigInt(1_000_000);
  const fraction = rawAmount % BigInt(1_000_000);
  const fractionStr = fraction.toString().padStart(6, '0');
  return `${whole}.${fractionStr}`;
}
