# Player Ads

Edit `streaming-gateway/player/ads-config.json`, then run `npm run build:player`
and deploy. The deployed file is `/var/www/koratv-player/ads-config.json`.
Direct edits on the server are overwritten by the next deployment.

- `enabled`: master switch. No ad requests when false.
- `initial_delay_seconds`: earliest display-script load after page navigation (15).
- `click_cooldown_minutes`: shared localStorage cooldown across tabs/channels (20).
- `max_ads_per_session`: click-ad attempts per shared session window (2).
- `session_window_minutes`: fixed shared browsing window (360 minutes). Reloading,
  changing channel or opening a new tab does not reset it. Clearing site storage does.
- `click.providers[].url`: paste an HTTPS **Direct Link / Smartlink**, not a script.
  Enable the desired Adsterra/Monetag entries. Eligible clicks rotate providers.
- `display[].script_url`: HTTPS script URL for a native/banner/in-page slot.
  `slot` is `footer` or `sidebar`; one enabled ad per slot.
  Use `container_id` when required by the vendor. A banner that needs `atOptions`
  can supply an `at_options` JSON object (key, format, width, height, params).

Never paste vendor `<script>` tags into `player.html`. Global popunder scripts
have been removed. Display scripts run only inside `ad-frame.html`, with both
an iframe sandbox and an HTTP CSP sandbox. They cannot access parent storage/DOM,
navigate the top page, launch popups or install service workers. Formats that
require these privileges will not work; use a native/banner format instead.
Social Bars remain confined to their slot, never floating over the main page.

The click shield arms once per page after playable media loads. The bottom
controls and player tools remain usable. It disappears immediately on activation,
even when the browser blocks the new tab. There is no same-tab redirect fallback.
Blocked storage disables click ads. Ads or ad blockers never gate playback.

For another hosting setup, copy the route-specific CSP from the Nginx examples.
Do not apply the permissive ad-frame script policy to the parent player.
Native iOS video fullscreen may omit HTML overlays; the player requests container
fullscreen where supported. A fixed overlay cannot locate every broadcaster's
watermark automatically; its default anchor is top-right of the visible picture.
