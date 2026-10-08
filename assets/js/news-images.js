export function newsImageCandidates(article, origin, parseHTML) {
  const values = [article.thumbnail, article.enclosure?.thumbnail, article.enclosure?.link, article.image];
  for (const html of [article.description, article.content]) {
    if (!html || !parseHTML) continue;
    for (const image of parseHTML(html).querySelectorAll('img')) values.push(image.getAttribute('src'), image.getAttribute('data-src'));
  }
  const urls = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value, article.link || origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      if (article.enclosure?.type && value === article.enclosure.link && !article.enclosure.type.startsWith('image/')) continue;
      if (!urls.includes(url.href)) urls.push(url.href);
    } catch {}
  }
  return urls;
}
