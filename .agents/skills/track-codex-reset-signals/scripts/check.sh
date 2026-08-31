#!/usr/bin/env bash
set -euo pipefail

watcher_url="${CODEX_RESET_WATCHER_URL:-https://codex-reset-watcher.weican16hit.workers.dev}"

case "${1:-status}" in
  status) path="/api/status" ;;
  events) path="/api/events" ;;
  history) path="/api/history" ;;
  sources) path="/api/sources" ;;
  health) path="/healthz" ;;
  *) echo "Usage: $0 [status|events|history|sources|health]" >&2; exit 2 ;;
esac

curl --fail --silent --show-error --max-time 20 "${watcher_url%/}${path}"
