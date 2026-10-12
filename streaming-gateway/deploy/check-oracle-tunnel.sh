#!/usr/bin/env bash
set -euo pipefail

state=/run/koratv-oracle-tunnel.failures
if /usr/bin/curl --fail --silent --max-time 5 http://127.0.0.1:3100/healthz >/dev/null; then
  printf '0\n' > "$state"
  exit 0
fi

failures=$(cat "$state" 2>/dev/null || printf '0')
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0
failures=$((failures + 1))
printf '%s\n' "$failures" > "$state"
if (( failures >= 3 )); then
  /usr/bin/logger -t koratv-tunnel-health 'Gateway forward failed three health checks; restarting the SSH tunnel'
  /usr/bin/systemctl restart koratv-oracle-tunnel.service
  printf '0\n' > "$state"
fi
