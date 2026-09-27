// Retain exactly one rendition, preferring 720p without switching channel identities.
export function singleQualityManifest(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
    const height = Number(lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0);
    const bandwidth = Number(lines[i].match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1] || 0);
    variants.push({ index: i, height, bandwidth });
  }
  if (!variants.length) return text;
  const chosen = [...variants].sort((a, b) => {
    const distance = v => v.height ? Math.abs(v.height - 720) + (v.height > 720 ? 1000 : 0) : 2000;
    return distance(a) - distance(b) || a.bandwidth - b.bandwidth || a.index - b.index;
  })[0];
  const excluded = new Set(variants.filter(v => v !== chosen).flatMap(v => [v.index, v.index + 1]));
  return lines.filter((line, i) => !excluded.has(i) && !line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')).join('\n');
}
