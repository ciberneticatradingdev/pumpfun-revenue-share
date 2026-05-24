#!/bin/bash
echo "🚀 PumpFun Revenue Share — Setup"
echo ""

read -p "Token name: " TOKEN_NAME
read -p "Token symbol (no $): " TOKEN_SYMBOL
read -p "Token mint address: " TOKEN_MINT
read -p "Reward token (SOL/USDC) [USDC]: " REWARD_TOKEN
REWARD_TOKEN=${REWARD_TOKEN:-USDC}
read -p "Wallet private key (base58): " WALLET_KEY
read -p "RPC URL [https://api.mainnet-beta.solana.com]: " RPC_URL
RPC_URL=${RPC_URL:-https://api.mainnet-beta.solana.com}
read -p "Database URL (postgresql://...): " DATABASE_URL
read -p "Min holding [10000]: " MIN_HOLDING
MIN_HOLDING=${MIN_HOLDING:-10000}
read -p "Cycle seconds [60]: " CYCLE_SEC
CYCLE_SEC=${CYCLE_SEC:-60}

# Generate backend/.env
cat > backend/.env << EOF
DATABASE_URL=$DATABASE_URL
WALLET_PRIVATE_KEY=$WALLET_KEY
TOKEN_MINT=$TOKEN_MINT
SOLANA_RPC_URL=$RPC_URL
REWARD_TOKEN=$REWARD_TOKEN
TOKEN_NAME=$TOKEN_NAME
TOKEN_SYMBOL=$TOKEN_SYMBOL
MIN_HOLDING=$MIN_HOLDING
CYCLE_MS=$((CYCLE_SEC * 1000))
PORT=4000
EOF

# Generate .env.local for frontend
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_TOKEN_NAME=$TOKEN_NAME
NEXT_PUBLIC_TOKEN_SYMBOL=\$$TOKEN_SYMBOL
NEXT_PUBLIC_TOKEN_DESCRIPTION=Auto-distributes $REWARD_TOKEN to all \$$TOKEN_SYMBOL holders
NEXT_PUBLIC_TOKEN_TAGLINE=Hold \$$TOKEN_SYMBOL. Earn $REWARD_TOKEN.
NEXT_PUBLIC_REWARD_TOKEN=$REWARD_TOKEN
NEXT_PUBLIC_CYCLE_SECONDS=$CYCLE_SEC
NEXT_PUBLIC_MIN_HOLDING=$MIN_HOLDING
NEXT_PUBLIC_BUY_URL=#
NEXT_PUBLIC_CHART_URL=#
NEXT_PUBLIC_TWITTER_URL=#
NEXT_PUBLIC_TELEGRAM_URL=#
NEXT_PUBLIC_DISCORD_URL=#
EOF

echo ""
echo "✅ Setup complete!"
echo "   backend/.env created"
echo "   .env.local created"
echo ""
echo "Next steps:"
echo "  1. Add hero.png and logo.png to /public"
echo "  2. cd backend && npm install && npm run dev"
echo "  3. In another terminal: npm install && npm run dev"
echo ""
echo "Deploy:"
echo "  Backend → Railway (root dir: backend)"
echo "  Frontend → Vercel (set NEXT_PUBLIC_* env vars)"
