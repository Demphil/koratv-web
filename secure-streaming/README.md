# koratv Secure Streaming

This is a Node/Next.js streaming control plane for purchased IPTV links. The original URLs stay server-side in Supabase and are never returned to browser APIs.

## Folder Structure

- `scripts/import-m3u.js` parses the private M3U file and matches entries with `../assets/js/streams.js`.
- `scripts/refresh-streaming-data.js` is the manual full refresh pipeline: clean match data, fetch matches, refresh IPTV URLs, then audit working channel links.
- `supabase/migrations/001_channels.sql` creates the private `channels` table and audit table.
- `src/app/api/stream-token/route.js` issues short-lived stream tokens.
- `src/app/api/stream/[channelName]/route.js` proxies HLS playlists and media segments with encrypted opaque segment tickets.
- The player uses the original provider HLS quality only. FFmpeg/ABR transcoding has been removed.
- `src/app/watch/[channelName]/page.jsx` is the first-party watch page.
- `src/app/embed/[channelName]/page.jsx` is the iframe-friendly embed page with ad/integrity checks.

## Setup

1. Create the Supabase tables with `supabase/migrations/001_channels.sql`.
2. Copy `.env.example` to `.env.local`.
3. Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Import channels:

```bash
npm install
npm run import:m3u:dry
npm run import:m3u
```

5. Provider URL auto-sync:

Set either `IPTV_PROVIDER_URL` to the provider's full dynamic M3U URL, or set the Xtream-style pieces separately:

```bash
IPTV_PROVIDER_HOST=http://your-provider-host
IPTV_PROVIDER_BACKUP_HOST=http://optional-backup-host
IPTV_PROVIDER_USERNAME=your_username
IPTV_PROVIDER_PASSWORD=your_password
IPTV_PROVIDER_TYPE=m3u_plus
IPTV_PROVIDER_OUTPUT=m3u8
```

The sync command builds the provider M3U URL, refreshes URLs for existing Supabase channels only, and never logs the raw provider URL or password.

```bash
npm run sync:iptv:dry
npm run sync:iptv
```

To run the full manual refresh in the exact operational order:

```bash
npm run refresh:manual:dry
npm run refresh:manual
```

From the repository root you can run the same pipeline with:

```bash
npm run refresh:streaming:dry
npm run refresh:streaming
```

Run the background cron next to the Next.js PM2 app:

```bash
pm2 start npm --name "iptv-provider-sync" -- run cron:iptv-provider
pm2 save
```

The default schedule is every 6 hours (`IPTV_PROVIDER_SYNC_CRON=0 */6 * * *`) using `Africa/Casablanca`. Missing provider entries are not deactivated unless `IPTV_SYNC_DEACTIVATE_MISSING=true`. Provider sync is sports-only by default (`IPTV_SYNC_ONLY_SPORTS=true`) so movie, VOD, and series links are ignored.

The sync updates existing Supabase channels by channel name. It also detects native HLS qualities from provider master playlists when `IPTV_SYNC_MASTER_QUALITIES=true` (default). Those variants are stored in `channels.quality_variants` for the isolated player quality selector; no FFmpeg transcoding is used.

```bash
IPTV_SYNC_MASTER_QUALITIES=true
IPTV_MASTER_PROBE_CONCURRENCY=4
IPTV_MASTER_PROBE_TIMEOUT_MS=8000
```

6. Run locally:

```bash
npm run dev
```

## Important Deployment Note

No FFmpeg process is required. Deploy this app with the secure HLS proxy and keep the provider URL as the single source quality.
