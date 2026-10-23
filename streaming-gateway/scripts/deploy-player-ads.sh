#!/usr/bin/env bash
set -euo pipefail
operation=${1:?operation required}
payload=${2:?payload required}
run_id=${3:?run id required}
expected=${4:?expected current HTML hash required}
restore_id=${5:-}
[[ $run_id =~ ^[0-9]+$ && $expected =~ ^[a-f0-9]{64}$ ]] || exit 2
target=/var/www/koratv-player
backups=/var/backups/koratv-player-ads
current=$(sha256sum "$target/739184.html" | cut -d ' ' -f1)
[[ $current == "$expected" ]] || { echo 'Player changed since verification; deployment stopped.'; exit 1; }
if [[ $operation == rollback ]]; then
  [[ $restore_id =~ ^[0-9]+$ && -f "$backups/$restore_id/739184.html" ]] || exit 2
  payload=$backups/$restore_id
elif [[ $operation != deploy ]]; then
  exit 2
fi
[[ -f $payload/739184.html ]] || exit 2
if [[ $operation == deploy ]]; then
  [[ -f $payload/monetag-window.js ]] || exit 2
  grep -q 'data-mobile-swap="off"' "$payload/739184.html"
  grep -q 'data-zones="11949898"' "$payload/739184.html"
fi
backup=$backups/$run_id
mkdir -p "$backup"
cp -p "$target/739184.html" "$backup/739184.html"
if [[ -f $target/monetag-window.js ]]; then cp -p "$target/monetag-window.js" "$backup/monetag-window.js"; fi
sha256sum "$target/player.js" "$target/player.css" "$target/config.js" "$target/broadcast-control.js" > "$backup/playback.sha256"
restore_backup() {
  install -m 0644 "$backup/739184.html" "$target/739184.html.rollback"
  mv -f "$target/739184.html.rollback" "$target/739184.html"
  if [[ -f $backup/monetag-window.js ]]; then
    install -m 0644 "$backup/monetag-window.js" "$target/monetag-window.js.rollback"
    mv -f "$target/monetag-window.js.rollback" "$target/monetag-window.js"
  fi
}
trap restore_backup ERR
if [[ -f $payload/monetag-window.js ]]; then
  install -m 0644 "$payload/monetag-window.js" "$target/monetag-window.js.next"
  mv -f "$target/monetag-window.js.next" "$target/monetag-window.js"
fi
install -m 0644 "$payload/739184.html" "$target/739184.html.next"
mv -f "$target/739184.html.next" "$target/739184.html"
sha256sum -c "$backup/playback.sha256"
curl -fsS --max-time 20 https://fabor.sbs/739184.html > /dev/null
if [[ $operation == deploy ]]; then curl -fsS --max-time 20 https://fabor.sbs/monetag-window.js > /dev/null; fi
trap - ERR
echo "Static ad publication complete. Backup: $backup"
sha256sum "$target/739184.html" "$target/monetag-window.js" 2>/dev/null || true
