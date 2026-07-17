#!/usr/bin/env bash
# Starts every Vigil service for the demo. Ctrl-C stops them all.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi

for svc in payments-api gate vigil-agent; do
  if [ -d "services/$svc" ] && [ ! -d "services/$svc/node_modules" ]; then
    (cd "services/$svc" && npm install --silent)
  fi
done
[ -d node_modules ] || npm install --silent

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

if [ -d services/payments-api ]; then
  (cd services/payments-api && npx tsx src/index.ts) & pids+=($!)
fi
if [ -d services/gate ]; then
  (cd services/gate && npx tsx src/server.ts) & pids+=($!)
fi
if [ -d services/vigil-agent ]; then
  (cd services/vigil-agent && npx tsx src/server.ts) & pids+=($!)
fi

echo "──────────────────────────────────────────────"
echo " web      → http://localhost:3000/incidents/inc-4821"
echo " agent    → ${NEXT_PUBLIC_AGENT_URL:-unset (frontend stays in SIM mode)}"
echo " pomerium → run separately: see pomerium/README.md"
echo "──────────────────────────────────────────────"
npm run dev
