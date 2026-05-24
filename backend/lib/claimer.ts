import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Keypair,
  SystemProgram,
} from "@solana/web3.js"
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token"
import { config, isSOLMode, rewardSymbol } from "./config.js"
import { connection, getWallet, getTokenMint, getTokenHolders, getRewardBalance, USDC_MINT, NATIVE_SOL_MINT, REWARD_MINT } from "./solana.js"
import { store } from "./store.js"
import { emitEvent } from "./events.js"

const SOLSCAN_TX = "https://solscan.io/tx"

const PUMP_FUN = new PublicKey(config.pumpMain)

// Fee accumulator — collects creator fees from bonding curve trades
const FEE_ACCUMULATOR = new PublicKey("79zVwEh3BHYs5N352uNuCQZv16swdtriAP1Sgm6ksbLA")

// CollectCreatorFeeV2 discriminator (works for both SOL and USDC)
const COLLECT_CREATOR_FEE_V2_DISC = Buffer.from("cf118af204221338", "hex")

// Event authority PDA
const [EVENT_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_FUN
)

/**
 * Build CollectCreatorFeeV2 instruction.
 * Same discriminator for SOL and USDC — only the accounts differ.
 */
function buildCollectCreatorFee(creator: Keypair): TransactionInstruction {
  const mint = REWARD_MINT
  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey)
  const feeAccumulatorAta = getAssociatedTokenAddressSync(mint, FEE_ACCUMULATOR, true)

  return new TransactionInstruction({
    programId: PUMP_FUN,
    keys: [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorAta, isSigner: false, isWritable: true },
      { pubkey: FEE_ACCUMULATOR, isSigner: false, isWritable: true },
      { pubkey: feeAccumulatorAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN, isSigner: false, isWritable: false },
    ],
    data: COLLECT_CREATOR_FEE_V2_DISC,
  })
}

/**
 * Claim creator fees from pump.fun.
 * Returns the amount claimed (delta).
 */
async function claimCreatorFees(wallet: Keypair): Promise<{ claimed: number; txSignature: string | null }> {
  const balanceBefore = await getRewardBalance(wallet.publicKey)

  // Ensure ATA exists
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    wallet.publicKey,
    getAssociatedTokenAddressSync(REWARD_MINT, wallet.publicKey),
    wallet.publicKey,
    REWARD_MINT
  )

  const collectIx = buildCollectCreatorFee(wallet)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed")
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [createAtaIx, collectIx],
  }).compileToV0Message()

  const tx = new VersionedTransaction(messageV0)
  tx.sign([wallet])

  // Simulate first
  const sim = await connection.simulateTransaction(tx)
  if (sim.value.err) {
    const noFee = sim.value.logs?.some(l => l.includes("No creator fee to collect"))
    if (noFee) return { claimed: 0, txSignature: null }
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`)
  }

  const noFee = sim.value.logs?.some(l => l.includes("No creator fee to collect"))
  if (noFee) return { claimed: 0, txSignature: null }

  // Send for real
  const txSig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 })
  await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed")

  const balanceAfter = await getRewardBalance(wallet.publicKey)
  const claimed = balanceAfter - balanceBefore

  return { claimed: Math.max(0, claimed), txSignature: txSig }
}

/**
 * Send reward to a single recipient.
 * SOL mode: native transfer. USDC mode: SPL token transfer.
 */
function addTransferIx(
  tx: Transaction,
  sender: Keypair,
  recipientWallet: PublicKey,
  amount: number
) {
  if (isSOLMode) {
    // Native SOL transfer
    const lamports = Math.floor(amount * 1e9)
    if (lamports > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipientWallet,
          lamports,
        })
      )
    }
  } else {
    // USDC SPL token transfer
    const senderAta = getAssociatedTokenAddressSync(USDC_MINT, sender.publicKey)
    const recipientAta = getAssociatedTokenAddressSync(USDC_MINT, recipientWallet, true)

    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        sender.publicKey,
        recipientAta,
        recipientWallet,
        USDC_MINT
      )
    )

    const lamports = Math.floor(amount * 1_000_000) // USDC has 6 decimals
    if (lamports > 0) {
      tx.add(
        createTransferInstruction(senderAta, recipientAta, sender.publicKey, lamports)
      )
    }
  }
}

/**
 * Full distribution cycle:
 * 1. Claim creator fees from pump.fun
 * 2. Add any pending (previously claimed but undistributed)
 * 3. Distribute proportionally to holders
 * 4. Log every step
 */
export async function runDistributionCycle(): Promise<{
  success: boolean
  distributed: number
  holders: number
  error?: string
}> {
  const wallet = getWallet()
  const mint = getTokenMint()

  if (!wallet || !mint) {
    return { success: false, distributed: 0, holders: 0, error: "Missing wallet or mint config" }
  }

  const stats = await store.getStats()
  const round = stats.totalRounds + 1
  const sym = rewardSymbol

  try {
    await emitEvent("CYCLE_START", `🔄 Distribution cycle #${round} started`, { round })

    const balanceBefore = await getRewardBalance(wallet.publicKey)
    await emitEvent("BALANCE_CHECK", `💰 ${sym} balance before claim: ${formatAmount(balanceBefore)}`, {
      round, balance: balanceBefore, wallet: wallet.publicKey.toBase58(),
    })

    // Pending from previous cycles
    const pendingBalance = await store.getPendingBalance()
    if (pendingBalance > 0) {
      console.log(`[DIST] Pending from previous cycles: ${formatAmount(pendingBalance)}`)
    }

    // Claim
    console.log(`[DIST] Claiming creator fees...`)
    let claimed = 0
    let claimTxSig: string | null = null

    try {
      const result = await claimCreatorFees(wallet)
      claimed = result.claimed
      claimTxSig = result.txSignature

      if (claimed > 0 && claimTxSig) {
        await emitEvent("CLAIM_DETECTED", `📊 Claimed ${formatAmount(claimed)} ${sym} creator fees`, {
          round, claimed, txSignature: claimTxSig,
          solscanUrl: `${SOLSCAN_TX}/${claimTxSig}`,
          balanceBefore, balanceAfter: balanceBefore + claimed,
        })
        console.log(`[DIST] Claimed ${formatAmount(claimed)} ${sym} (tx: ${claimTxSig})`)
      } else {
        console.log(`[DIST] No new creator fees to claim`)
      }
    } catch (err: any) {
      await emitEvent("TRANSFER_FAILED", `❌ Claim failed: ${err.message}`, { round, error: err.message })
      console.error(`[DIST] Claim error:`, err.message)
    }

    const distributable = claimed + pendingBalance
    if (distributable < 0.0001) {
      await emitEvent("CYCLE_SKIP", `⏭️ Cycle #${round} — nothing to distribute (claimed: ${formatAmount(claimed)}, pending: ${formatAmount(pendingBalance)})`, {
        round, claimed, pendingBalance, balanceBefore,
      })
      console.log(`[DIST] Nothing to distribute`)
      return { success: true, distributed: 0, holders: 0 }
    }

    // Get holders
    const allHolders = await getTokenHolders(mint)
    const qualifiedHolders = allHolders.filter((h) => h.balance >= config.minHolding)
    console.log(`[DIST] ${qualifiedHolders.length} qualified holders (of ${allHolders.length} total)`)

    if (qualifiedHolders.length === 0) {
      if (claimed > 0) await store.addPendingBalance(claimed)
      await emitEvent("CYCLE_SKIP", `⏭️ Cycle #${round} — ${formatAmount(distributable)} pending, no qualified holders (min: ${config.minHolding.toLocaleString()})`, {
        round, claimed, distributable, pendingBalance: distributable,
        totalHolders: allHolders.length, minHolding: config.minHolding,
      })
      console.log(`[DIST] No qualified holders — ${formatAmount(distributable)} saved as pending`)
      return { success: true, distributed: 0, holders: 0 }
    }

    // Calculate shares
    const totalSupplyHeld = qualifiedHolders.reduce((sum, h) => sum + h.balance, 0)
    const distributions = qualifiedHolders.map((h) => ({
      wallet: h.wallet,
      share: h.balance / totalSupplyHeld,
      amount: (h.balance / totalSupplyHeld) * distributable,
    }))
    const meaningful = distributions.filter((d) => d.amount >= 0.0001)

    await emitEvent("DISTRIBUTION_START", `📤 Distributing ${formatAmount(distributable)} ${sym} to ${meaningful.length} holders${pendingBalance > 0 ? ` (includes ${formatAmount(pendingBalance)} pending)` : ""}`, {
      round, totalAmount: distributable, claimed, pendingBalance,
      holders: meaningful.length, totalHolders: allHolders.length,
    })

    // Batch send
    const BATCH_SIZE = isSOLMode ? 20 : 10 // SOL transfers are lighter
    let totalSent = 0
    const distRecords: Array<{ wallet: string; amount: string; timestamp: number; txSignature: string }> = []

    for (let i = 0; i < meaningful.length; i += BATCH_SIZE) {
      const batch = meaningful.slice(i, i + BATCH_SIZE)
      const tx = new Transaction()

      for (const d of batch) {
        addTransferIx(tx, wallet, new PublicKey(d.wallet), d.amount)
      }

      if (tx.instructions.length > 0) {
        try {
          const { blockhash } = await connection.getLatestBlockhash()
          tx.recentBlockhash = blockhash
          tx.feePayer = wallet.publicKey
          tx.sign(wallet)
          const sig = await connection.sendRawTransaction(tx.serialize())
          await connection.confirmTransaction(sig, "confirmed")

          for (const d of batch) {
            const amount = d.amount.toFixed(4)
            totalSent += d.amount
            distRecords.push({ wallet: d.wallet, amount, timestamp: Date.now(), txSignature: sig })

            const shortWallet = `${d.wallet.slice(0, 4)}...${d.wallet.slice(-4)}`
            await emitEvent("TRANSFER_SENT", `💸 Sent ${formatAmount(d.amount)} ${sym} to ${shortWallet}`, {
              round, wallet: d.wallet, amount: parseFloat(amount),
              share: `${(d.share * 100).toFixed(2)}%`,
              txSignature: sig, solscanUrl: `${SOLSCAN_TX}/${sig}`,
            })
          }
          console.log(`[DIST] Batch sent: ${batch.length} transfers, tx: ${sig}`)
        } catch (err: any) {
          const errMsg = err?.message || err?.toString() || JSON.stringify(err)
          console.error(`[DIST] Batch failed:`, errMsg)
          if (err?.logs) console.error(`[DIST] TX Logs:`, err.logs)
          for (const d of batch) {
            const shortWallet = `${d.wallet.slice(0, 4)}...${d.wallet.slice(-4)}`
            await emitEvent("TRANSFER_FAILED", `❌ Failed to send ${formatAmount(d.amount)} to ${shortWallet}: ${errMsg}`, {
              round, wallet: d.wallet, amount: d.amount, error: errMsg,
            })
          }
        }
      }
    }

    // Store records + clear pending
    await store.addRound(totalSent, meaningful.length)
    await store.addDistributions(distRecords)
    await store.clearPendingBalance()

    await emitEvent("CYCLE_COMPLETE", `✅ Cycle #${round} complete: claimed ${formatAmount(claimed)}, distributed ${formatAmount(totalSent)} ${sym} to ${meaningful.length} holders`, {
      round, claimed, pendingCleared: pendingBalance,
      totalDistributed: totalSent, holders: meaningful.length, claimTx: claimTxSig,
    })

    console.log(`[DIST] Round complete: ${formatAmount(totalSent)} ${sym} to ${meaningful.length} holders`)
    return { success: true, distributed: totalSent, holders: meaningful.length }
  } catch (err: any) {
    const errMsg = err?.message || err?.toString() || JSON.stringify(err)
    console.error(`[DIST] Cycle error:`, errMsg)
    if (err?.logs) console.error(`[DIST] Logs:`, err.logs)
    if (err?.stack) console.error(err.stack)
    await emitEvent("TRANSFER_FAILED", `❌ Cycle #${round} error: ${errMsg}`, { round, error: errMsg })
    return { success: false, distributed: 0, holders: 0, error: errMsg }
  }
}

function formatAmount(n: number): string {
  return isSOLMode ? `${n.toFixed(6)} SOL` : `$${n.toFixed(4)}`
}
