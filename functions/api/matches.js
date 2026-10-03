import { isAllowedMatch } from '../../shared/league-whitelist.mjs';
import { sameFixture } from '../../shared/match-broadcasts.mjs';

function json(body, status, origin = '*') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0, s-maxage=0, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, OPTIONS'
    }
  });
}

function moroccoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function moroccoTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function toFrontendMatch(row) {
  const payload = row.payload || {};
  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  const homeTeam = row.home_team || payload.homeTeam?.name || payload.homeTeam || '';
  const awayTeam = row.away_team || payload.awayTeam?.name || payload.awayTeam || '';

  return {
    ...(payload || {}),
    match_id: row.match_id || row.id,
    matchId: row.match_id || row.id,
    homeTeam,
    awayTeam,
    homeLogo: payload.homeLogo || payload.homeTeam?.logo || '',
    awayLogo: payload.awayLogo || payload.awayTeam?.logo || '',
    scheduledAt,
    time: payload.time || moroccoTime(scheduledAt),
    score: payload.score || 'VS',
    league: row.league || payload.league || '',
    channel: row.channel || payload.channel || '',
    channelName: row.channel || payload.channel || '',
    source: row.source || '',
    leagueCountry: payload.leagueCountry || payload.country || '',
    commentator: payload.commentator || '',
    streams: Array.isArray(payload.streams) ? payload.streams : [],
    isLive: Boolean(payload.isLive),
    sourceAvailable: Boolean(row.channel || payload.channel || payload.broadcast?.channels?.length),
    updatedAt: row.updated_at
  };
}

function rowLike(match) {
  return {
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    kickoff_time: match.scheduledAt,
    league: match.league
  };
}

function isKoooraMatch(match) {
  return String(match.source || '').startsWith('kooora') || String(match.matchId || '').startsWith('kooora_');
}

function detailsScore(match) {
  return Number(match.score && match.score !== 'VS') * 4
    + (Array.isArray(match.goals) ? match.goals.length : 0)
    + Number(match.eventDetailsLoaded === true) * 5;
}

function enrichFromDetails(base, rows) {
  const details = rows
    .filter((candidate) => candidate !== base && sameFixture(rowLike(base), rowLike(candidate)))
    .sort((a, b) => detailsScore(b) - detailsScore(a))[0];
  if (!details || detailsScore(details) <= detailsScore(base)) return base;
  return {
    ...base,
    score: details.score || base.score,
    status: details.status || base.status,
    isLive: Boolean(base.isLive || details.isLive),
    goals: Array.isArray(details.goals) ? details.goals : base.goals,
    events: Array.isArray(details.events) ? details.events : base.events,
    lineups: Array.isArray(details.lineups) ? details.lineups : base.lineups,
    statistics: Array.isArray(details.statistics) ? details.statistics : base.statistics,
    yellowCards: details.yellowCards || base.yellowCards,
    redCards: details.redCards || base.redCards,
    venue: details.venue || base.venue,
    venueCity: details.venueCity || base.venueCity,
    referee: details.referee || base.referee,
    dataSource: details.source || details.dataSource || base.dataSource,
    detailsState: details.detailsState || base.detailsState
  };
}

export async function onRequestOptions({ request, env }) {
  const origin = env.PUBLIC_SITE_ORIGIN || request.headers.get('origin') || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

export async function onRequestGet({ request, env }) {
  const origin = env.PUBLIC_SITE_ORIGIN || request.headers.get('origin') || '*';
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Match service is not configured' }, 503, origin);
  }

  const table = env.SUPABASE_MATCHES_TABLE || 'matches';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return json({ error: 'Invalid matches table configuration' }, 500, origin);

  const endpoint = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`);
  endpoint.searchParams.set('select', 'id,match_id,home_team,away_team,league,kickoff_time,channel,payload,source,active,updated_at');
  endpoint.searchParams.set('active', 'eq.true');
  endpoint.searchParams.set('order', 'kickoff_time.asc.nullslast');
  endpoint.searchParams.set('limit', '150');

  let response;
  try {
    response = await fetch(endpoint, {
      cache: 'no-store',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
        'cache-control': 'no-cache'
      }
    });
  } catch {
    return json({ error: 'Unable to reach match storage' }, 502, origin);
  }

  if (!response.ok) return json({ error: 'Unable to read match storage' }, 502, origin);
  const rows = await response.json();
  const rowsForDisplay = (Array.isArray(rows) ? rows : [])
    .map(toFrontendMatch)
    .filter((match) => match.homeTeam && match.awayTeam && match.scheduledAt)
    .filter((match) => String(match.homeTeam).trim() !== String(match.awayTeam).trim())
    .filter((match) => String(match.homeTeam).trim().toLocaleLowerCase('ar') !== String(match.awayTeam).trim().toLocaleLowerCase('ar'))
    .filter((match) => isAllowedMatch({
      league: match.league,
      leagueCountry: match.leagueCountry,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam
    }));
  const koooraRows = rowsForDisplay.filter(isKoooraMatch);
  const canonicalRows = koooraRows.length
    ? koooraRows
    : rowsForDisplay.filter((match) => match.source !== 'api-football');
  const bases = canonicalRows.length ? canonicalRows : rowsForDisplay;
  const matches = [];
  for (const base of bases) {
    if (matches.some((current) => sameFixture(rowLike(current), rowLike(base)))) continue;
    matches.push(enrichFromDetails(base, rowsForDisplay));
  }

  const day = new URL(request.url).searchParams.get('day');
  const today = moroccoDate(new Date());
  const tomorrow = moroccoDate(Date.now() + 86400000);
  const filtered = day === 'tomorrow'
    ? matches.filter((match) => moroccoDate(match.scheduledAt) === tomorrow)
    : day === 'today'
      ? matches.filter((match) => moroccoDate(match.scheduledAt) === today)
      : matches;

  return json({ matches: filtered }, 200, origin);
}
