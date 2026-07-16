#!/usr/bin/env bash
# Stop FlowMind local dev processes started by scripts/dev-up.sh
#
# Usage:
#   ./scripts/dev-down.sh           # stop API + web + desktop pids
#   ./scripts/dev-down.sh --infra   # also stop Docker infra containers
#   ./scripts/dev-down.sh --wipe    # stop apps + docker compose down -v (DESTRUCTIVE)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="${ROOT}/.dev-pids"
STOP_INFRA=0
WIPE=0

for arg in "$@"; do
  case "$arg" in
    --infra) STOP_INFRA=1 ;;
    --wipe) STOP_INFRA=1; WIPE=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

stop_pidfile() {
  local name="$1"
  local pidf="${PID_DIR}/${name}.pid"
  if [[ ! -f "$pidf" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$pidf" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    # Kill process group children if possible
    kill "$pid" 2>/dev/null || true
    # Nest/Next often spawn children — best-effort tree kill
    pkill -P "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    ok "Stopped $name (pid $pid)"
  else
    warn "$name not running (stale pid file)"
  fi
  rm -f "$pidf"
}

log "Stopping app processes"
for name in api web desktop; do
  stop_pidfile "$name"
done

# Also stop common orphan listeners on dev ports (best effort)
for port in 4000 3000; do
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids:-}" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      warn "Freed port :$port (pids: $pids)"
    fi
  fi
done

if [[ "$STOP_INFRA" -eq 1 ]]; then
  log "Stopping Docker infra"
  cd "$ROOT"
  if [[ "$WIPE" -eq 1 ]]; then
    warn "Wiping containers + named volumes (data under infra/data bind mounts is kept unless you delete it)"
    docker compose -f infra/docker-compose.yml down -v
  else
    docker compose -f infra/docker-compose.yml stop
  fi
  ok "Infra stopped"
fi

ok "Done"
