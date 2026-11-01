const fs = require('node:fs/promises');
const path = require('node:path');

async function readBuildState(directory, url, origin) {
  const target = new URL(url);
  if (target.origin !== origin) throw Error('Unexpected build-state origin');
  const route = decodeURIComponent(target.pathname).slice(1);
  if (!/^(?:archive\/catalog\.json|archive\/data\/(?:\d{4}-\d{2}|undated)-[a-f0-9]{16}\.json|news\/catalog\.json)$/.test(route))
    throw Error('Unexpected build-state path');
  const base = await fs.realpath(directory);
  const filename = await fs.realpath(path.join(base, route));
  if (!filename.startsWith(base + path.sep)) throw Error('Build-state path escapes its directory');
  const info = await fs.stat(filename);
  if (!info.isFile() || info.size > 48 * 1024 * 1024) throw Error('Invalid build-state file size');
  return fs.readFile(filename, 'utf8');
}
module.exports = { readBuildState };
