# Crawler access

The frontend, robots.txt and sitemap.xml are served by GitHub Pages, not Express.
Match cards render the same content for visitors and search crawlers. There is no
client-side user-agent cloaking.

The gateway's `anti-bot.js` exempts Googlebot, Google-InspectionTool, Bingbot,
BingPreview, DuckDuckBot, Yahoo Slurp, Baiduspider, YandexBot and Applebot from
the user-agent filter. Known automation tools and other bot user agents receive
403 from the gateway. The filter never grants credentials or bypasses JWT,
origin, IP-binding, match-state or rate-limit checks. User-agent strings are
spoofable; this is a traffic filter, not an identity-verification mechanism.

In `/opt/koratv/koratv-web/streaming-gateway/.env`:

```dotenv
ENABLE_ANTI_BOT=true
```

Set it to `false` to bypass only bot detection, then restart:

```sh
pm2 restart koratv-gateway --update-env
```

Set it back to `true` and restart to re-enable the filter. Deployment preserves
either value. This flag cannot change GitHub Pages or an external firewall.

Apply `secure-streaming/supabase/migrations/005_channel_quality_variants.sql`
to new databases before enabling channel-quality synchronization. It adds a
JSONB array column without deleting or changing existing channel links and
reloads the PostgREST schema cache.
