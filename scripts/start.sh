#!/usr/bin/env bash
# Bygger webbappen och startar servern (och tunneln) i bakgrunden med pm2.
set -e
cd "$(dirname "$0")/.."
npm run build
npx pm2 startOrRestart ecosystem.config.js
npx pm2 save >/dev/null
sleep 12
echo "Lokalt: http://localhost:${PORT:-8787}"
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ~/.pm2/logs/slapandtalk-tunnel-*.log 2>/dev/null | tail -1 | sed 's/^.*https/Publik länk: https/' || true
