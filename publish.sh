#!/bin/bash
# サーバーを起動して、Cloudflare の無料トンネル（quick tunnel）でインターネットに出す。
# この Mac が起きていてこのスクリプトの処理が動いている間だけ遊べる。URL は起動するたびに変わる。
# 使い方: ./publish.sh        止める: ./publish.sh stop
cd "$(dirname "$0")"
PORT=${PORT:-8110}
LOG="${TMPDIR:-/tmp}/shop-coop"
mkdir -p "$LOG"
if [ "$1" = "stop" ]; then
  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT"
  pkill -f "shop-coop/server.mjs"
  echo "止めた"; exit 0
fi
if ! curl -s "http://localhost:$PORT/healthz" > /dev/null 2>&1; then
  [ -d node_modules ] || npm install --omit=dev
  PORT=$PORT nohup node "$(pwd)/server.mjs" > "$LOG/server.log" 2>&1 &
  sleep 1
fi
pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" 2>/dev/null
nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG/tunnel.log" 2>&1 &
for i in $(seq 1 40); do
  u=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG/tunnel.log" | head -1)
  [ -n "$u" ] && break
  sleep 1
done
echo "$u" | tee urls.txt
