# PumpFun Revenue Share — Backend Template

## Overview

Build a **production-grade backend template** for automated pump.fun creator fee claiming and distribution to token holders. This is a template — users clone it, set env vars, and deploy to Railway.

## Architecture

**Stack:** Node.js + TypeScript + Express + PostgreSQL
**Deploy target:** Railway (backend + PostgreSQL)
**Runtime:** Node 20+

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Express app entry point + scheduler boot
│   ├── config.ts             # ENV validation — crash on missing required vars
│   ├── db/
│   │   ├── pool.ts           # pg Pool with SSL support (Railway requires it)
│   │   └── migrate.ts        # Versioned schema migrations (run on boot)
│   ├── services/
│   │   ├── claimer.ts        # Claim creator fees from pump.fun via CollectCreatorFeeV2
│   │   ├── distributor.ts    # Distribute USDC to holders proportionally (batched)
│   │   ├── snapshot.ts       # Get token holder snapshot via getProgramAccounts
│   │   └── scheduler.ts     # Main loop: claim → snapshot → distribute (every CYCLE_MS)
│   ├── routes/
│   │   ├── stats.ts          # GET /api/stats — real totals from DB
│   │   ├── distributions.ts  # GET /api/distributions — history with pagination
│   │   ├── holders.ts        # GET /api/holders — current snapshot + earnings
│   │   ├── events.ts         # GET /api/events — full event log + SSE stream
│   │   └── health.ts         # GET /api/health — scheduler status, last claim, uptime
│   └── utils/
│       ├── solana.ts         # Connection management, retry with backoff, priority fees
│       └── logger.ts         # Structured console logging with timestamps
├── .env.example              # All env vars documented
├── Dockerfile                # Multi-stage build for Railway
├── railway.toml              # Railway deploy config
├── package.json
├── tsconfig.json
└── README.md                 # Setup guide: clone → env → deploy
```

## Database Schema (PostgreSQL)

6 tables. All must be created in `migrate.ts` on boot with IF NOT EXISTS.

```sql
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Each fee claim round
CREATE TABLE IF NOT EXISTS claim_rounds (
  id SERIAL PRIMARY KEY,
  tx_signature TEXT NOT NULL,
  amount_usdc NUMERIC(20, 6) NOT NULL,
  fee_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed', -- completed, failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Each holder snapshot
CREATE TABLE IF NOT EXISTS snapshots (
  id SERIAL PRIMARY KEY,
  holder_count INTEGER NOT NULL,
  total_supply NUMERIC(30, 6) NOT NULL,
  token_mint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual holders in each snapshot
CREATE TABLE IF NOT EXISTS snapshot_holders (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER REFERENCES snapshots(id),
  wallet TEXT NOT NULL,
  token_balance NUMERIC(30, 6) NOT NULL,
  percentage NUMERIC(10, 6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Each distribution round
CREATE TABLE IF NOT EXISTS distributions (
  id SERIAL PRIMARY KEY,
  claim_round_id INTEGER REFERENCES claim_rounds(id),
  snapshot_id INTEGER REFERENCES snapshots(id),
  total_amount_usdc NUMERIC(20, 6) NOT NULL,
  holder_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, distributing, completed, partial, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Individual payments within a distribution
CREATE TABLE IF NOT EXISTS distribution_payments (
  id SERIAL PRIMARY KEY,
  distribution_id INTEGER REFERENCES distributions(id),
  wallet TEXT NOT NULL,
  amount_usdc NUMERIC(20, 6) NOT NULL,
  token_balance NUMERIC(30, 6) NOT NULL,
  percentage NUMERIC(10, 6) NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, confirmed, failed
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Full event log for transparency
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL, -- claim_started, claim_completed, claim_failed, snapshot_taken, distribution_started, payment_sent, payment_failed, etc
  message TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claim_rounds_created ON claim_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_distributions_created ON distributions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_distribution_payments_wallet ON distribution_payments(wallet);
CREATE INDEX IF NOT EXISTS idx_distribution_payments_dist_id ON distribution_payments(distribution_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
```

## Solana Integration Details

### Fee Claiming (claimer.ts)

Program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (PumpSwap AMM)

The CollectCreatorFeeV2 instruction:
- Discriminator: `cf118af204221338` (first 8 bytes)
- Claims USDC fees accumulated in the creator fee vault
- Signer must be the original token creator (deployer wallet)

Flow:
1. Get deployer's USDC ATA balance BEFORE claim
2. Create USDC ATA if it doesn't exist (idempotent)
3. Build CollectCreatorFeeV2 instruction
4. Add priority fees (ComputeBudgetProgram)
5. Send transaction with retry (3 attempts, exponential backoff)
6. Confirm transaction
7. Get deployer's USDC ATA balance AFTER claim
8. Calculate delta = amount claimed
9. If delta > 0, record in claim_rounds + events

Account layout for CollectCreatorFeeV2 (derive from on-chain analysis):
- Need: pool, creator (signer), creator_token_account (USDC ATA), fee_vault, token_program, system_program

Use the global fee account: `wrYFA52opsGRt4m4GMgNFjxKNvFh1VGJ66inTdiH2Wq`

### Holder Snapshot (snapshot.ts)

Use `getProgramAccounts` with memcmp filters on the Token Program:
- Filter by data size (165 bytes for token accounts)
- Filter by mint at offset 0

Parse each account:
- Owner: bytes 32-64
- Amount: bytes 64-72 (u64 LE)

**IMPORTANT**: pump.fun tokens have 6 decimals. Raw amount / 1_000_000 = real balance.

Exclusion list (do NOT distribute to):
- Deployer wallet itself
- Bonding curve PDA
- AMM pool PDA (PumpSwap: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)
- Fee accumulator
- Any wallet with balance below MIN_HOLDING

### Distribution (distributor.ts)

1. Take snapshot result + claimed USDC amount
2. Calculate each holder's share: (holder_balance / total_eligible_supply) * claimed_amount
3. Skip payments below 0.000001 USDC (dust threshold)
4. Batch USDC transfers: max 10 per transaction (SPL token transfers are larger than SOL)
5. For each holder: create ATA if needed (deployer pays rent), then transfer USDC
6. Track each payment individually (pending → sent → confirmed / failed)
7. If a batch fails after 3 retries, mark those payments as "failed" and continue with remaining batches
8. Update distribution status: "completed" if all sent, "partial" if some failed

### Transaction Best Practices (utils/solana.ts)

- Always add priority fees: `ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })`
- Set compute unit limit: `ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })`
- Get fresh blockhash per attempt
- Retry with exponential backoff: 1s, 2s, 4s
- Skip preflight for speed: `skipPreflight: true`
- Confirm with `confirmTransaction` using blockhash strategy
- Log all transaction attempts and results

## Environment Variables

```env
# Required
WALLET_PRIVATE_KEY=           # Deployer wallet private key (base58)
TOKEN_MINT=                   # Token mint address
DATABASE_URL=                 # PostgreSQL connection string (Railway provides this)
SOLANA_RPC_URL=              # RPC endpoint (Chainstack, Helius, etc.)

# Optional with defaults
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
PUMPSWAP_PROGRAM=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
PUMP_AMM=pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
FEE_ACCOUNT=wrYFA52opsGRt4m4GMgNFjxKNvFh1VGJ66inTdiH2Wq
CYCLE_MS=90000               # Distribution cycle in ms (default: 90s)
MIN_HOLDING=10000            # Minimum token holding to qualify (in real tokens, not raw)
BATCH_SIZE=10                # Transfers per transaction
PORT=4000                    # HTTP server port
MIN_CLAIM_USDC=0.001         # Minimum USDC to trigger distribution
```

## API Endpoints

All endpoints are GET, no auth needed (read-only public data for transparency).

### GET /api/health
```json
{
  "status": "ok",
  "uptime": 3600,
  "scheduler": { "running": true, "lastCycle": "2025-05-25T...", "cycleMs": 90000 },
  "token": "4K3GF33o1PUFa4UKB3o8xnZPSEdMNNtRBj6McXJUpump"
}
```

### GET /api/stats
```json
{
  "totalDistributed": "1234.567890",
  "totalRounds": 42,
  "totalClaims": 45,
  "totalClaimedUsdc": "1250.000000",
  "currentHolders": 156,
  "qualifiedHolders": 89,
  "lastClaimAt": "2025-05-25T...",
  "lastDistributionAt": "2025-05-25T...",
  "avgPerRound": "29.394473",
  "tokenMint": "4K3GF33o1PUFa4UKB3o8xnZPSEdMNNtRBj6McXJUpump"
}
```

### GET /api/distributions?page=1&limit=20
Paginated list of all distribution rounds with summary.

### GET /api/distributions/:id
Single distribution with all individual payments.

### GET /api/holders
Current holder snapshot with cumulative earnings per wallet.

### GET /api/events?page=1&limit=50&type=claim_completed
Paginated event log, filterable by type.

### GET /api/events/stream
SSE endpoint for real-time events.

## Scheduler Flow (scheduler.ts)

Every CYCLE_MS:
1. Log cycle start
2. **Claim**: Call claimer.claim() → returns claimed USDC amount
3. If claimed > MIN_CLAIM_USDC:
   a. **Snapshot**: Take holder snapshot
   b. **Distribute**: Send USDC to all qualified holders proportionally
4. If claimed == 0 or below threshold, log "nothing to claim" and skip
5. Log cycle end with summary
6. Wait for next cycle

The scheduler must be resilient:
- If any step fails, log the error and continue to the next cycle
- Never crash the process
- Use try/catch around every step

## Code Quality

- Use proper TypeScript types everywhere (no `any`)
- Structured error handling with descriptive messages
- Console logging with ISO timestamps and log levels
- All monetary amounts stored as NUMERIC(20,6) in DB, passed as strings in API
- Validate all env vars at startup, crash with clear message if missing

## Railway Deploy

- `railway.toml` with build command `npm run build` and start command `npm start`
- `Dockerfile` for containerized deployment
- Railway provides `DATABASE_URL` automatically when you add PostgreSQL

## IMPORTANT RULES

1. Do NOT hardcode any wallet addresses, token mints, or RPC URLs — everything from env vars
2. Do NOT use `any` type — define proper interfaces
3. Do NOT ignore errors — every catch block must log and record in events table
4. Do NOT skip SSL for PostgreSQL — Railway requires it
5. Do NOT use the public Solana RPC — require SOLANA_RPC_URL in env
6. ALL monetary amounts must use NUMERIC/string, never JavaScript floating point
7. Make the README a complete setup guide: clone → env → railway deploy
