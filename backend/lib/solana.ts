import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import { getAssociatedTokenAddressSync } from "@solana/spl-token"
import bs58 from "bs58"
import { config, isSOLMode } from "./config.js"

export const connection = new Connection(config.rpcUrl, "confirmed")

export function getWallet(): Keypair | null {
  if (!config.walletKey) return null
  try {
    return Keypair.fromSecretKey(bs58.decode(config.walletKey))
  } catch {
    console.error("Invalid WALLET_PRIVATE_KEY")
    return null
  }
}

export const USDC_MINT = new PublicKey(config.usdcMint)
export const NATIVE_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112")
export const REWARD_MINT = isSOLMode ? NATIVE_SOL_MINT : USDC_MINT

export function getTokenMint(): PublicKey | null {
  if (!config.tokenMint) return null
  try {
    return new PublicKey(config.tokenMint)
  } catch {
    return null
  }
}

const PUMP_FUN = new PublicKey(config.pumpMain)
const PUMP_AMM = new PublicKey(config.pumpAmm)

/**
 * Derive addresses that should be excluded from distributions:
 * - Bonding curve PDA (holds unsold supply)
 * - AMM pool address (holds liquidity after graduation)
 * - The deployer/treasury wallet itself
 */
function getExcludedHolders(mint: PublicKey): Set<string> {
  const excluded = new Set<string>()

  // Deployer wallet — don't pay ourselves
  const wallet = getWallet()
  if (wallet) excluded.add(wallet.publicKey.toBase58())

  // Bonding curve PDA
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_FUN
  )
  excluded.add(bondingCurve.toBase58())

  // PumpSwap AMM pool PDA (for when/if token graduates)
  const [ammPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    PUMP_AMM
  )
  excluded.add(ammPool.toBase58())

  // Fee accumulator (protocol account)
  excluded.add("79zVwEh3BHYs5N352uNuCQZv16swdtriAP1Sgm6ksbLA")

  return excluded
}

/**
 * Get all token holders for a given mint.
 * Supports Token-2022 (new pump.fun) and classic Token Program.
 * Automatically excludes bonding curve, AMM pool, deployer, protocol accounts.
 */
export async function getTokenHolders(mint: PublicKey) {
  const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
  const TOKEN_CLASSIC = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")

  // Token-2022 accounts have variable size (extensions), so no dataSize filter
  let accounts = await connection.getProgramAccounts(TOKEN_2022, {
    filters: [
      { memcmp: { offset: 0, bytes: mint.toBase58() } },
    ],
  })

  // Fallback to classic if no Token-2022 accounts found
  if (accounts.length === 0) {
    accounts = await connection.getProgramAccounts(TOKEN_CLASSIC, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mint.toBase58() } },
      ],
    })
  }

  const excluded = getExcludedHolders(mint)
  const holders: { wallet: string; balance: number }[] = []

  for (const { account } of accounts) {
    const data = account.data
    const owner = new PublicKey(data.subarray(32, 64))
    const ownerStr = owner.toBase58()
    const amount = data.readBigUInt64LE(64)
    const balance = Number(amount)

    if (balance > 0 && !excluded.has(ownerStr)) {
      holders.push({ wallet: ownerStr, balance })
    }
  }

  holders.sort((a, b) => b.balance - a.balance)
  return holders
}

/**
 * Get reward balance for a wallet (USDC or SOL depending on mode)
 */
export async function getRewardBalance(wallet: PublicKey): Promise<number> {
  if (isSOLMode) {
    const lamports = await connection.getBalance(wallet)
    return lamports / 1e9
  }
  try {
    const ata = getAssociatedTokenAddressSync(USDC_MINT, wallet)
    const balance = await connection.getTokenAccountBalance(ata)
    return parseFloat(balance.value.uiAmountString || "0")
  } catch {
    return 0
  }
}
