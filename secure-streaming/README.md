# KoraLive Secure Streaming

This is a Node/Next.js streaming control plane for purchased IPTV links. The original URLs stay server-side in Supabase and are never returned to browser APIs.

## Folder Structure

- `scripts/import-m3u.js` parses the private M3U file and matches entries with `../assets/js/streams.js`.
- `supabase/migrations/001_channels.sql` creates the private `channels` table and audit table.
- `src/app/api/stream-token/route.js` issues short-lived stream tokens.
- `src/app/api/stream/[channelName]/route.js` proxies HLS playlists and media segments with encrypted opaque segment tickets.
- `src/server/transcoder.js` starts FFmpeg ABR transcoding when enabled.
- `src/app/api/abr/[channelName]/[[...path]]/route.js` serves FFmpeg-generated 1080p/720p/360p HLS output.
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

5. Optional provider URL auto-sync:

Set `IPTV_PROVIDER_URL` in `.env.local` to the provider's dynamic M3U URL. The sync command refreshes URLs for existing Supabase channels only, so provider token changes do not require a manual import.

```bash
npm run sync:iptv:dry
npm run sync:iptv
```

Run the background cron next to the Next.js PM2 app:

```bash
pm2 start npm --name "iptv-provider-sync" -- run cron:iptv-provider
pm2 save
```

The default schedule is every 6 hours (`IPTV_PROVIDER_SYNC_CRON=0 */6 * * *`) using `Africa/Casablanca`. Missing provider entries are not deactivated unless `IPTV_SYNC_DEACTIVATE_MISSING=true`. Provider sync is sports-only by default (`IPTV_SYNC_ONLY_SPORTS=true`) so movie, VOD, and series links are ignored.

6. Run locally:

```bash
npm run dev
```

## Important Deployment Note

Real FFmpeg transcoding cannot run on Cloudflare Pages. Deploy this `secure-streaming` app to a Node server/VPS/container with FFmpeg installed, or keep `TRANSCODE_ENABLED=false` and use the secure HLS proxy only.
