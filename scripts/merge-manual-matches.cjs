const fs = require('node:fs');

function mergeManualSelections(inputs, { dateKey, maxMatches = 8 } = {}) {
  const matches = [];
  const repositories = [];
  for (const { name, selection } of inputs) {
    if (!selection || typeof selection.enabled !== 'boolean' || !Array.isArray(selection.matches)) {
      throw new Error(`${name}: enabled must be boolean and matches must be an array`);
    }
    if (!selection.enabled) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.date || '')) throw new Error(`${name}: set date to YYYY-MM-DD`);
    if (selection.date !== dateKey) continue;
    repositories.push(name);
    for (const item of selection.matches) {
      if (typeof item !== 'string' || !item.trim() || item.length > 160) throw new Error(`${name}: invalid match ID`);
      const id = item.trim();
      if (!matches.includes(id)) matches.push(id);
    }
  }
  if (matches.length > maxMatches) throw new Error(`Both projects selected ${matches.length} matches; the shared limit is ${maxMatches}`);
  return { enabled: repositories.length > 0, date: dateKey, matches, source: 'repository-manual-selection', repositories };
}

module.exports = { mergeManualSelections };
if (require.main === module) {
  const [koraPath, frajaPath, outputPath] = process.argv.slice(2);
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const output = mergeManualSelections([
    { name: 'koratv-web', selection: JSON.parse(fs.readFileSync(koraPath, 'utf8')) },
    { name: 'foottv6', selection: JSON.parse(fs.readFileSync(frajaPath, 'utf8')) },
  ], { dateKey });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ date: dateKey, enabled: output.enabled, selectedCount: output.matches.length }));
}
