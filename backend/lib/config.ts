import "dotenv/config"

export const config = {
  databaseUrl: process.env.DATABASE_URL || "",
  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  tokenMint: process.env.TOKEN_MINT || "",
  walletKey: process.env.WALLET_PRIVATE_KEY || "",
  usdcMint: process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  cycleMs: parseInt(process.env.CYCLE_MS || "60000", 10),
  minHolding: parseInt(process.env.MIN_HOLDING || "10000", 10),
  port: parseInt(process.env.PORT || "4000", 10),

  // Token branding
  tokenName: process.env.TOKEN_NAME || "TOKEN",
  tokenSymbol: process.env.TOKEN_SYMBOL || "TKN",

  // Reward mode: "USDC" or "SOL"
  rewardToken: (process.env.REWARD_TOKEN || "USDC").toUpperCase() as "USDC" | "SOL",

  // pump.fun programs
  pumpMain: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpFees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
}

export const isSOLMode = config.rewardToken === "SOL"
export const rewardSymbol = isSOLMode ? "SOL" : "USDC"
