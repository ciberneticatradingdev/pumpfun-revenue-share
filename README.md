# PumpFun Revenue Share

Automated pump.fun creator fee claiming and USDC distribution to token holders. Clone, configure, deploy to Railway.

## How It Works

1. **Claim** — Every cycle (default 90s), the backend claims accumulated creator fees from the PumpSwap AMM
2. **Snapshot** — Takes a holder snapshot via `getProgramAccounts`, filtering by minimum holding
3. **Distribute** — Sends USDC proportionally to all qualified holders in batched transactions
4. **Track** — Every action is logged to PostgreSQL with full transparency via REST API

## Quick Start

### 1. Clone

```bash
git clone https://github.com/your-org/pumpfun-revenue-share.git
cd pumpfun-revenue-share/backend
cp .env.example .env
```

### 2. Configure

Edit `.env` with your values:

```env
WALLET_PRIVATE_KEY=your_deployer_wallet_base58_private_key
TOKEN_MINT=your_token_mint_address
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SOLANA_RPC_URL=https://your-rpc-endpoint.com
```

### 3. Local Development

```bash
npm install
npm run dev
```

### 4. Deploy to Railway

1. Create a new Railway project
2. Add a PostgreSQL service (Railway provides `DATABASE_URL` automatically)
3. Add a new service from this repo
4. Set environment variables in Railway dashboard
5. Deploy — migrations run automatically on boot

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WALLET_PRIVATE_KEY` | ✅ | — | Deployer wallet private key (base58) |
| `TOKEN_MINT` | ✅ | — | Token mint address |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `SOLANA_RPC_URL` | ✅ | — | Solana RPC endpoint |
| `USDC_MINT` | ❌ | `EPjFWdd5...` | USDC mint address |
| `PUMPSWAP_PROGRAM` | ❌ | `6EF8rrec...` | PumpSwap program ID |
| `PUMP_AMM` | ❌ | `pAMMBay6...` | PumpSwap AMM address |
| `FEE_ACCOUNT` | ❌ | `wrYFA52o...` | Fee account address |
| `CYCLE_MS` | ❌ | `90000` | Distribution cycle (ms) |
| `MIN_HOLDING` | ❌ | `10000` | Min tokens to qualify |
| `BATCH_SIZE` | ❌ | `10` | Transfers per transaction |
| `PORT` | ❌ | `4000` | HTTP server port |
| `MIN_CLAIM_USDC` | ❌ | `0.001` | Min USDC to trigger distribution |

## API Endpoints

All endpoints are GET, read-only, no auth required.

- `GET /api/health` — Scheduler status, uptime
- `GET /api/stats` — Total distributed, claims, holders
- `GET /api/distributions?page=1&limit=20` — Distribution history
- `GET /api/distributions/:id` — Single distribution with payments
- `GET /api/holders` — Current holder snapshot + earnings
- `GET /api/events?page=1&limit=50&type=claim_completed` — Event log
- `GET /api/events/stream` — SSE real-time event stream

## Architecture

```
Express API ─── PostgreSQL (6 tables)
     │
     └── Scheduler Loop (every CYCLE_MS)
           ├── 1. Claim fees (CollectCreatorFeeV2)
           ├── 2. Snapshot holders (getProgramAccounts)
           └── 3. Distribute USDC (batched SPL transfers)
```

## License

MIT
