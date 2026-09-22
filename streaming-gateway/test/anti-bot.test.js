import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBlockBot, antiBotMiddleware } from '../anti-bot.js';

test('search engines and inspection tools bypass the user-agent filter', () => {
  for (const ua of ['Googlebot/2.1', 'Googlebot-Image/1.0', 'Google-InspectionTool/1.0', 'bingbot/2.0', 'DuckDuckBot/1.0', 'Yahoo! Slurp', 'Baiduspider', 'YandexBot', 'Applebot']) {
    assert.equal(shouldBlockBot(ua), false, ua);
  }
});

test('unknown bots and automation are blocked unless the kill switch is off', () => {
  for (const ua of ['HeadlessChrome/130', 'Puppeteer', 'Selenium', 'curl/8', 'Scrapy', 'UnknownBot']) {
    assert.equal(shouldBlockBot(ua), true, ua);
    assert.equal(shouldBlockBot(ua, false), false, ua);
  }
  assert.equal(shouldBlockBot('Mozilla/5.0 Chrome/130 Safari/537.36'), false);
});

test('robots and sitemap routes remain discoverable', () => {
  for (const path of ['/robots.txt', '/sitemap.xml', '/sitemap-news.xml']) {
    let continued = false;
    antiBotMiddleware()({ path, headers: { 'user-agent': 'UnknownBot' } }, {}, () => { continued = true; });
    assert.equal(continued, true);
  }
});
