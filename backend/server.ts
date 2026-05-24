import express from "express"
import cors from "cors"
import { config, rewardSymbol } from "./lib/config.js"
import { connection, getWallet, getTokenMint, getTokenHolders, getRewardBalance } from "./lib/solana.js"
import { runDistributionCycle } from "./lib/claimer.js"
import { store } from "./lib/store.js"
import { testConnection } from "./lib/db.js"
import { subscribeToEvents } from "./lib/events.js"

const app = express()
app.use(cors())
app.use(express.json())

/* ── Simple RPC cache to avoid rate limits ── */
const rpcCache: Record<string, { data: any; ts: number }> = {}
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = rpcCache[key]
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data)
  return fn().then((data) => { rpcCache[key] = { data, ts: Date.now() }; return data })
}

/* ── Health ── */
app.get("/health", (_req, res) => {
  const wallet = getWallet()
  const mint = getTokenMint()
  res.json({
    status: "ok",
    configured: !!(wallet && mint),
    mint: config.tokenMint || "NOT SET",
    walletConfigured: !!wallet,
    rewardToken: config.rewardToken,
    cycleMs: config.cycleMs,
  })
})

/* ── Cycle info ── */
let lastDistributionAt = Date.now()

app.get("/api/cycle", (_req, res) => {
  const nextAt = lastDistributionAt + config.cycleMs
  res.json({
    cycleMs: config.cycleMs,
    lastDistributionAt,
    nextDistributionAt: nextAt,
    serverNow: Date.now(),
  })
})

/* ── Stats ── */
app.get("/api/stats", async (_req, res) => {
  try {
    const wallet = getWallet()
    const mint = getTokenMint()

    let treasury = "—"
    let holders = 0

    if (wallet) {
      const balance = await cached("reward", 60_000, () => getRewardBalance(wallet.publicKey))
      treasury = config.rewardToken === "SOL" ? `${balance.toFixed(4)} SOL` : `$${balance.toFixed(2)}`
    }

    if (mint) {
      const allHolders = await cached("holders", 120_000, () => getTokenHolders(mint))
      holders = allHolders.filter((h) => h.balance >= config.minHolding).length
    }

    const storeStats = await store.getStats()

    res.json({
      treasury,
      totalDistributed: storeStats.totalDistributed,
      holders,
      totalRounds: storeStats.totalRounds,
      rewardToken: config.rewardToken,
    })
  } catch (err: any) {
    console.error("[API] Stats error:", err.message)
    res.status(500).json({ error: "Failed to fetch stats" })
  }
})

/* ── Distribution feed ── */
app.get("/api/distributions", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit) || "12", 10), 50)
  const distributions = await store.getDistributions(limit)
  res.json({ distributions })
})

/* ── Holders ── */
app.get("/api/holders", async (req, res) => {
  try {
    const mint = getTokenMint()
    if (!mint) return res.json({ holders: [] })

    const limit = Math.min(parseInt(String(req.query.limit) || "12", 10), 50)
    const allHolders = await cached("holders", 120_000, () => getTokenHolders(mint))
    const qualified = allHolders.filter((h) => h.balance >= config.minHolding)
    const totalSupply = qualified.reduce((s, h) => s + h.balance, 0)

    const holders = qualified.slice(0, limit).map((h) => ({
      wallet: h.wallet,
      percentage: `${((h.balance / totalSupply) * 100).toFixed(1)}%`,
      totalEarned: "—",
    }))

    res.json({ holders })
  } catch (err: any) {
    console.error("[API] Holders error:", err.message)
    res.status(500).json({ error: "Failed to fetch holders" })
  }
})

/* ── Manual trigger ── */
app.post("/api/distribute", async (_req, res) => {
  console.log("[DIST] Manual distribution triggered")
  const result = await runDistributionCycle()
  res.json(result)
})

/* ── Transparency Terminal: Events ── */
app.get("/api/events", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit) || "50", 10) || 50, 200)
    const offset = Math.max(parseInt(String(req.query.offset) || "0", 10) || 0, 0)
    const events = await store.getEvents(limit, offset)
    res.json({ events })
  } catch (err: any) {
    console.error("[API] Events error:", err.message)
    res.status(500).json({ error: "Failed to fetch events" })
  }
})

app.get("/api/events/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  res.write("data: {\"type\":\"connected\"}\n\n")

  const unsubscribe = subscribeToEvents((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  req.on("close", () => { unsubscribe() })
})

app.get("/api/events/cycle/:round", async (req, res) => {
  const round = parseInt(req.params.round, 10)
  if (isNaN(round)) return res.status(400).json({ error: "Invalid round" })
  const events = await store.getEventsByCycle(round)
  res.json({ events })
})

/* ── Start ── */
app.listen(config.port, async () => {
  await testConnection()
  await store.init()
  console.log(`\n🚀 Revenue Share Backend running on port ${config.port}`)
  console.log(`   Token: ${config.tokenName} (${config.tokenSymbol})`)
  console.log(`   Reward: ${rewardSymbol}`)
  console.log(`   RPC: ${config.rpcUrl}`)
  console.log(`   Mint: ${config.tokenMint || "NOT CONFIGURED"}`)
  console.log(`   Wallet: ${getWallet() ? "✓ configured" : "✗ not set"}`)
  console.log(`   Cycle: ${config.cycleMs / 1000}s`)
  console.log(`   Min holding: ${config.minHolding.toLocaleString()}\n`)

  if (getWallet() && getTokenMint()) {
    console.log("[DIST] Starting automatic distribution cycle...")
    setInterval(async () => {
      console.log(`\n[DIST] ⏰ Running distribution cycle...`)
      lastDistributionAt = Date.now()
      const result = await runDistributionCycle()
      if (result.success) {
        console.log(`[DIST] ✓ Distributed ${result.distributed.toFixed(4)} to ${result.holders} holders`)
      } else {
        console.log(`[DIST] ✗ Failed: ${result.error}`)
      }
    }, config.cycleMs)
  } else {
    console.log("[DIST] ⚠️  Not starting — configure TOKEN_MINT and WALLET_PRIVATE_KEY in .env")
  }
})
