export function normalizeKnockoutFixtures(fixtures, leagueId, season) {
  if (!Array.isArray(fixtures) || !leagueId || !season) return null;
  const rounds = [
    { key: 'semifinal', name: 'نصف النهائي', matches: [] },
    { key: 'final', name: 'النهائي', matches: [] },
  ];
  for (const item of fixtures) {
    if (String(item?.league?.id) !== String(leagueId) || String(item?.league?.season) !== String(season)) continue;
    const stage = String(item?.league?.round || '').trim();
    const round = /^semi[ -]?finals?$/i.test(stage) ? rounds[0] : /^final$/i.test(stage) ? rounds[1] : null;
    if (!round || !item?.fixture?.id || !item?.teams?.home?.name || !item?.teams?.away?.name) continue;
    const goals = [item.goals?.home,item.goals?.away];
    const score = goals.every(goal => goal != null && Number.isInteger(Number(goal)) && Number(goal) >= 0 && Number(goal) <= 99)
      ? `${Number(goals[0])} - ${Number(goals[1])}` : 'VS';
    round.matches.push({ fixtureId: String(item.fixture.id), homeTeam: String(item.teams.home.name).slice(0,90),
      awayTeam: String(item.teams.away.name).slice(0,90), homeLogo: String(item.teams.home.logo || ''),
      awayLogo: String(item.teams.away.logo || ''), score, scheduledAt: item.fixture.date || '',
      status: String(item.fixture.status?.short || '') });
  }
  for (const round of rounds) round.matches = [...new Map(round.matches.map(item => [item.fixtureId,item])).values()]
    .sort((a,b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).slice(0,8);
  return rounds.some(round => round.matches.length) ? { leagueId, season, rounds } : null;
}
