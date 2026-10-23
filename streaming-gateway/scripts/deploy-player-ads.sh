#!/usr/bin/env bash
set -euo pipefail
operation=${1:?operation required}
payload=${2:?payload required}
run_id=${3:?run id required}
expected=${4:?expected current HTML hash required}
restore_id=${5:-}
expected_watch=${6:?expected current embed HTML hash required}
[[ $run_id =~ ^[0-9]+$ && $expected =~ ^[a-f0-9]{64}$ && $expected_watch =~ ^[a-f0-9]{64}$ ]] || exit 2
target=/var/www/koratv-player
backups=/var/backups/koratv-player-ads
current=$(sha256sum "$target/739184.html" | cut -d ' ' -f1)
[[ $current == "$expected" ]] || { echo 'Player changed since verification; deployment stopped.'; exit 1; }
current_watch=$(sha256sum "$target/watch.html" | cut -d ' ' -f1)
[[ $current_watch == "$expected_watch" ]] || { echo 'Embed changed since verification; deployment stopped.'; exit 1; }
if [[ $operation == rollback ]]; then
  [[ $restore_id =~ ^[0-9]+$ && -f "$backups/$restore_id/739184.html" ]] || exit 2
  payload=$backups/$restore_id
elif [[ $operation != deploy ]]; then
  exit 2
fi
[[ -f $payload/739184.html ]] || exit 2
assets=(monetag-window.js view-support.js view-support-state.js view-support.css ads/prebid-ads.js icons/shield-alert.svg icons/refresh-cw.svg watch.html)
if [[ $operation == deploy ]]; then
  for asset in "${assets[@]}"; do [[ -f $payload/$asset ]] || exit 2; done
  grep -q 'data-mobile-swap="off"' "$payload/739184.html"
  grep -q 'data-zones="11949898"' "$payload/739184.html"
  grep -q 'id="watch-support-panel"' "$payload/739184.html"
fi
backup=$backups/$run_id
mkdir -p "$backup"
cp -p "$target/739184.html" "$backup/739184.html"
for asset in "${assets[@]}"; do
  if [[ -f $target/$asset ]]; then
    mkdir -p "$backup/$(dirname "$asset")"
    cp -p "$target/$asset" "$backup/$asset"
  fi
done
sha256sum "$target/player.js" "$target/player.css" "$target/config.js" "$target/broadcast-control.js" > "$backup/playback.sha256"
restore_backup() {
  for asset in "${assets[@]}" 739184.html; do
    if [[ -f $backup/$asset ]]; then
      install -D -m 0644 "$backup/$asset" "$target/$asset.rollback"
      mv -f "$target/$asset.rollback" "$target/$asset"
    fi
  done
}
trap restore_backup ERR
for asset in "${assets[@]}"; do
  if [[ -f $payload/$asset ]]; then
    install -D -m 0644 "$payload/$asset" "$target/$asset.next"
    mv -f "$target/$asset.next" "$target/$asset"
  fi
done
install -m 0644 "$payload/739184.html" "$target/739184.html.next"
mv -f "$target/739184.html.next" "$target/739184.html"
sha256sum -c "$backup/playback.sha256"
curl -fsS --max-time 20 https://fabor.sbs/739184.html > /dev/null
if [[ $operation == deploy ]]; then
  for asset in "${assets[@]}"; do curl -fsS --max-time 20 "https://fabor.sbs/$asset" > /dev/null; done
fi
trap - ERR
echo "Static ad publication complete. Backup: $backup"
sha256sum "$target/739184.html" "$target/monetag-window.js" 2>/dev/null || true
