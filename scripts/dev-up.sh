#!/usr/bin/env bash
# One-command local bring-up for the StepSafe demo stack: Mongo (in-memory replica
# set), API server, web map. Seeds demo hazards. See docs/DEMO.md for the live
# demo script.
#
#   scripts/dev-up.sh          start everything, print URLs, return immediately
#   scripts/dev-up.sh stop     stop exactly the PIDs this script started
#
# Env overrides (all optional):
#   MONGO_PORT   default 27018
#   API_PORT     default 8787
#   WEB_PORT     default 3000
#   HOST         default 0.0.0.0  (server bind address; phones on the LAN need this)
#   LAN_IP       default: `ipconfig getifaddr en0` (used to build the URL the phone
#                and the web build use to reach the API)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.dev-up.pids"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stepsafe-dev-up.XXXXXX")"

MONGO_PORT="${MONGO_PORT:-27018}"
API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || true)}"
if [ -z "$LAN_IP" ]; then
  echo "warning: could not determine LAN IP (ipconfig getifaddr en0 was empty); falling back to 127.0.0.1 (phones on the LAN will not reach the API)" >&2
  LAN_IP="127.0.0.1"
fi

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

require_port_free() {
  local port="$1" label="$2"
  if port_in_use "$port"; then
    echo "Refusing to start: port $port ($label) is already in use." >&2
    echo "  See what's on it: lsof -nP -iTCP:$port -sTCP:LISTEN" >&2
    echo "  Pick a different port with ${label}_PORT, or stop the process using it." >&2
    exit 1
  fi
}

wait_for() {
  # wait_for <description> <timeout_s> <check command...>
  local desc="$1" timeout="$2"; shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "Timed out waiting for $desc after ${timeout}s." >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

cmd="${1:-start}"

if [ "$cmd" = "stop" ]; then
  if [ ! -f "$PID_FILE" ]; then
    echo "No $PID_FILE — nothing recorded to stop."
    exit 0
  fi
  while read -r label pid; do
    [ -z "${pid:-}" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $label (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "$label (pid $pid) did not exit after SIGTERM; sending SIGKILL."
        kill -9 "$pid" 2>/dev/null || true
      fi
    else
      echo "$label (pid $pid) is not running; skipping."
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
  echo "Stopped. PID file removed."
  exit 0
fi

if [ "$cmd" != "start" ]; then
  echo "Usage: $0 [start|stop]" >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  echo "Refusing to start: $PID_FILE already exists (a previous run may still be up)." >&2
  echo "  Run '$0 stop' first, or remove $PID_FILE if it's stale." >&2
  exit 1
fi

require_port_free "$MONGO_PORT" MONGO
require_port_free "$API_PORT" API
require_port_free "$WEB_PORT" WEB

if curl -sf -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama: reachable on 11434 -- naming will use local Qwen (qwen3.8:27b-mlx) unless GEMINI_API_KEY is set in server/.env"
else
  echo "Ollama: not reachable on 11434 -- new hazards will save as 'obstacle' (needsNaming) until a naming provider is up"
fi

: > "$PID_FILE"

echo "Starting Mongo (single-node replica set) on port $MONGO_PORT..."
(
  export MONGO_PORT="$MONGO_PORT"
  exec node "$ROOT/server/scripts/dev-mongo.mjs"
) > "$LOG_DIR/mongo.log" 2>&1 &
MONGO_PID=$!
echo "mongo $MONGO_PID" >> "$PID_FILE"

wait_for "Mongo URI in $LOG_DIR/mongo.log" 60 grep -q '^MONGO_URI=' "$LOG_DIR/mongo.log" || {
  echo "Mongo did not report a URI in time; log:" >&2
  cat "$LOG_DIR/mongo.log" >&2 || true
  exit 1
}
MONGO_URI="$(sed -n 's/^MONGO_URI=//p' "$LOG_DIR/mongo.log" | head -1)"
echo "Mongo up: $MONGO_URI"

echo "Seeding demo hazards..."
(cd "$ROOT/server" && MONGODB_URI="$MONGO_URI" npm run seed:demo) > "$LOG_DIR/seed.log" 2>&1 || {
  echo "seed:demo failed; see $LOG_DIR/seed.log" >&2
  cat "$LOG_DIR/seed.log" >&2
  exit 1
}

echo "Starting API server on $HOST:$API_PORT..."
(
  cd "$ROOT/server"
  export HOST="$HOST" PORT="$API_PORT" MONGODB_URI="$MONGO_URI"
  exec "$ROOT/server/node_modules/.bin/tsx" src/index.ts
) > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "server $SERVER_PID" >> "$PID_FILE"

wait_for "API /health on 127.0.0.1:$API_PORT" 60 curl -sf "http://127.0.0.1:$API_PORT/health" || {
  echo "server did not come up; see $LOG_DIR/server.log" >&2
  tail -n 40 "$LOG_DIR/server.log" >&2 || true
  exit 1
}
echo "API up: http://127.0.0.1:$API_PORT/health"

echo "Building web (NEXT_PUBLIC_API_URL=http://$LAN_IP:$API_PORT)..."
(cd "$ROOT/web" && NEXT_PUBLIC_API_URL="http://$LAN_IP:$API_PORT" npm run build) > "$LOG_DIR/web-build.log" 2>&1 || {
  echo "web build failed; see $LOG_DIR/web-build.log" >&2
  tail -n 60 "$LOG_DIR/web-build.log" >&2
  exit 1
}

echo "Starting web on port $WEB_PORT..."
(
  cd "$ROOT/web"
  exec "$ROOT/web/node_modules/.bin/next" start -p "$WEB_PORT"
) > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
echo "web $WEB_PID" >> "$PID_FILE"

wait_for "web on 127.0.0.1:$WEB_PORT" 60 curl -sf "http://127.0.0.1:$WEB_PORT" || {
  echo "web did not come up; see $LOG_DIR/web.log" >&2
  tail -n 40 "$LOG_DIR/web.log" >&2
  exit 1
}

cat <<EOF

StepSafe demo stack is up. Logs: $LOG_DIR
PIDs recorded in: $PID_FILE (stop with: $0 stop)

  Web map (laptop):        http://$LAN_IP:$WEB_PORT
  API:                     http://$LAN_IP:$API_PORT
  Phone Settings server URL: http://$LAN_IP:$API_PORT

EOF
