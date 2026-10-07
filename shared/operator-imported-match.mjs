export function moroccoMatchDay(value = Date.now()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    : '';
}

export function isOperatorImportedMatch(row = {}) {
  const imported = row.payload?.operatorImport;
  return row.source === 'kooora' && imported?.source === 'operator-console'
    && /^\d{4}-\d{2}-\d{2}$/.test(imported.day || '')
    && Boolean(row.payload?.sourceMatchId)
    && imported.matchId === (row.match_id || row.id)
    && imported.sourceMatchId === row.payload.sourceMatchId
    && imported.day === moroccoMatchDay(row.kickoff_time);
}
