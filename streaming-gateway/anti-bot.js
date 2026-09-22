const searchEngines = /\b(?:Googlebot(?:-\w+)?|Google-InspectionTool|bingbot|BingPreview|DuckDuckBot|Slurp|Baiduspider|YandexBot|Applebot)\b/i;
const automation = /\b(?:HeadlessChrome|PhantomJS|SlimerJS|Puppeteer|Playwright|Selenium|curl|wget|python-requests|Scrapy)\b/i;
const unknownBots = /bot|crawler|spider|slurp/i;

export function shouldBlockBot(userAgent, enabled = true) {
  if (!enabled) return false;
  const ua = String(userAgent || '');
  // A search user agent only exempts this filter, never authentication or rate limits.
  if (searchEngines.test(ua)) return false;
  return automation.test(ua) || unknownBots.test(ua);
}

export function antiBotMiddleware({ enabled = true } = {}) {
  return (req, res, next) => {
    if (req.path === '/robots.txt' || /^\/sitemap(?:[-\w]*)\.xml$/.test(req.path) || req.path === '/healthz') return next();
    if (shouldBlockBot(req.headers['user-agent'], enabled)) {
      return res.status(403).json({ error: 'automated_client_blocked' });
    }
    next();
  };
}
