export function currentConsoleSelection(snapshot) {
  const matches = snapshot.matches || [];
  const available = new Set(matches.map(match => match.matchId));
  const selection = snapshot.state?.selection;
  const current = selection?.date === snapshot.day;
  const ids = current ? selection.matches || [] : matches
    .filter(match => match.broadcastRank > 0 || match.viewingMode === 'stream')
    .sort((a, b) => (a.broadcastRank || 99) - (b.broadcastRank || 99))
    .slice(0, 8).map(match => match.matchId);
  return { enabled: current && selection.enabled === true,
    matches: [...new Set(ids)].filter(id => available.has(id)).slice(0, 8) };
}
