# PumpFun Revenue Share

Template for automatic pump.fun creator fee claiming and distribution to token holders. Works with both **SOL** and **USDC** bonding curve tokens.

## What it does

Every cycle (default 60s), the backend:
1. **Claims** creator fees from pump.fun (`CollectCreatorFeeV2`)
2. **Calculates** proportional shares based on token holdings
3. **Distributes** rewards (SOL or USDC) directly to holder wallets
4. **Logs** every step to a transparency terminal

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│   Frontend   │────▶│   Backend    │────▶│ Solana   │
│   (Vercel)   │     │  (Railway)   │     │ RPC      │
└─────────────┘     └──────┬───────┘     └──────────┘
                           │
                    ┌──────▼───────┐
                    │  PostgreSQL  │
                    │  (Railway)   │
                    └──────────────┘
```

- **Frontend**: Next.js landing page with live stats, distribution feed, transparency terminal
- **Backend**: Express API — claims fees, distributes to holders, serves event log
- **Database**: PostgreSQL — stores rounds, distributions, events, pending balances

## Quick Start

### 1. Clone & Setup

```bash
git clone https://github.com/ciberneticatradingdev/pumpfun-revenue-share.git
cd pumpfun-revenue-share
./setup.sh
```

The setup script asks for your token details and generates `.env` files.

### 2. Add Branding

Replace `public/hero.png` and `public/logo.png` with your token's images.

### 3. Run Locally

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (another terminal)
npm install && npm run dev
```

### 4. Deploy

**Backend → Railway**
- New service, connect repo, set Root Directory: `backend`
- Add env vars from `backend/.env`
- Add a PostgreSQL database

**Frontend → Vercel**
- Import repo
- Set `NEXT_PUBLIC_*` env vars from `.env.example`
- Set `NEXT_PUBLIC_API_URL` to your Railway backend URL

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `WALLET_PRIVATE_KEY` | ✅ | — | Deployer wallet (base58) |
| `TOKEN_MINT` | ✅ | — | Token mint address |
| `SOLANA_RPC_URL` | ✅ | mainnet | Solana RPC endpoint |
| `REWARD_TOKEN` | — | `USDC` | `SOL` or `USDC` |
| `TOKEN_NAME` | — | `TOKEN` | Display name |
| `TOKEN_SYMBOL` | — | `TKN` | Display symbol |
| `MIN_HOLDING` | — | `10000` | Minimum tokens to qualify |
| `CYCLE_MS` | — | `60000` | Distribution cycle (ms) |
| `PORT` | — | `4000` | Server port |

### Frontend (`.env.local` or Vercel)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend URL |
| `NEXT_PUBLIC_TOKEN_NAME` | `TOKEN` | Display name |
| `NEXT_PUBLIC_TOKEN_SYMBOL` | `$TKN` | Display symbol |
| `NEXT_PUBLIC_REWARD_TOKEN` | `USDC` | `SOL` or `USDC` |
| `NEXT_PUBLIC_TOKEN_TAGLINE` | — | Hero tagline |
| `NEXT_PUBLIC_TOKEN_DESCRIPTION` | — | Hero description |
| `NEXT_PUBLIC_CYCLE_SECONDS` | `60` | Cycle display |
| `NEXT_PUBLIC_MIN_HOLDING` | `10000` | Min holding display |
| `NEXT_PUBLIC_BUY_URL` | `#` | Buy button link |
| `NEXT_PUBLIC_CHART_URL` | `#` | Chart button link |
| `NEXT_PUBLIC_TWITTER_URL` | `#` | Footer link |
| `NEXT_PUBLIC_TELEGRAM_URL` | `#` | Footer link |
| `NEXT_PUBLIC_DISCORD_URL` | `#` | Footer link |

## SOL vs USDC Mode

Set `REWARD_TOKEN=SOL` or `REWARD_TOKEN=USDC` in the backend.

| | SOL Mode | USDC Mode |
|---|---|---|
| Fee source | SOL creator fees | USDC creator fees |
| Distribution | Native SOL transfers | SPL token transfers |
| Holder requirement | Any wallet | Needs USDC ATA |
| Token program | Token-2022 or Classic | Token-2022 or Classic |

Both modes use the same `CollectCreatorFeeV2` instruction from pump.fun.

## How the Cycle Works

```
1. ⏰ Cycle starts (every CYCLE_MS)
2. 💰 Check current reward balance
3. 📊 Claim creator fees from pump.fun
   └─ Simulates first — no SOL wasted on empty claims
4. ➕ Add any pending balance from previous cycles
5. 👥 Get qualified holders (above MIN_HOLDING)
   └─ Auto-excludes: bonding curve, AMM pool, deployer, protocol accounts
6. 📤 Distribute proportionally in batches
7. ✅ Log everything to transparency terminal
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/stats` | Treasury, holders, rounds |
| `GET /api/cycle` | Cycle timing info |
| `GET /api/distributions?limit=12` | Recent distributions |
| `GET /api/holders?limit=12` | Top holders |
| `GET /api/events?limit=50&offset=0` | Event log (paginated) |
| `GET /api/events/stream` | SSE real-time events |
| `GET /api/events/cycle/:round` | Events for specific round |
| `POST /api/distribute` | Manual trigger |

## Features

- ✅ Auto-claim pump.fun creator fees (SOL + USDC)
- ✅ Proportional distribution to holders
- ✅ Pending balance tracking (claimed but undistributed)
- ✅ Token-2022 + classic Token Program support
- ✅ Bonding curve + graduated token support
- ✅ Transparency terminal with Solscan links
- ✅ SSE real-time event streaming
- ✅ RPC cache to avoid rate limits
- ✅ Auto-migration (DB tables created on boot)
- ✅ Configurable branding via env vars

## License

MIT
