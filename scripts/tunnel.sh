#!/usr/bin/env bash
# Starts the service with a token and a Cloudflare quick tunnel so Cargo's HTTP node can reach /sink.
# Prints the public URL and the token to paste into the Cargo HTTP connector.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
export PORT="${PORT:-8787}"
export RAIDER_TOKEN="${RAIDER_TOKEN:-$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')}"
CLOUDFLARED="$(command -v cloudflared || echo "$HOME/bin/cloudflared")"

node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

echo "RAIDER_TOKEN=$RAIDER_TOKEN   (Cargo HTTP connector: secret header x-raider-token)"
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:$PORT" 2>&1 | while IFS= read -r line; do
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    echo "PUBLIC URL: ${BASH_REMATCH[1]}   (Cargo nenya_sink URL: ${BASH_REMATCH[1]}/sink)"
  fi
done
