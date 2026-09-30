import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChannelNameMatch } from '../../shared/channel-name-match.mjs';
import { broadcastChannelCandidates, normalizeBroadcastChannel } from '../../shared/match-broadcasts.mjs';

const DEFAULT_POOL_DIR = '/etc/koratv';
const DEFAULT_TIMEZONE = 'Africa/Casablanca';

function dateKeyFor(value, timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function createServerClient(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configure Supabase URL and key');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(Number(env.ROUTE_SYNC_FETCH_TIMEOUT_MS || 7000)) }) },
  });
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, data, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode });
  await rename(tmp, path);
  await chmod(path, mode).catch(() => {});
}

export function buildAvailableRoutes(providerCatalog = {}) {
  const providers = providerCatalog.providers || {};
  return Object.entries(providerCatalog.channels || {})
    .map(([catalogName, entry]) => {
      const providerIds = Object.keys(entry || {})
        .filter((key) => key !== 'sourceNames' && providers[key]?.enabled && entry[key]);
      if (!providerIds.length) return null;
      const sourceNames = Object.fromEntries(providerIds
        .map((id) => [id, entry.sourceNames?.[id] || catalogName]));
      return {
        catalogName,
        aliases: [...new Set([catalogName, ...Object.values(sourceNames)].filter(Boolean))],
        providerIds,
        sourceNames,
      };
    })
    .filter(Boolean);
}

export function resolveRouteName(targetName, routes) {
  const aliasRows = routes.flatMap((route) => route.aliases.map((alias) => ({ alias, route })));
  const normalizedTarget = normalizeBroadcastChannel(targetName);
  const matchedAlias = findChannelNameMatch(normalizedTarget, aliasRows.map((row) => row.alias));
  if (!matchedAlias) return null;
  const matches = aliasRows.filter((row) => row.alias === matchedAlias);
  if (matches.length !== 1) return null;
  const route = matches[0].route;
  return {
    requestedName: targetName,
    matchedName: route.catalogName,
    matchedAlias,
    providerIds: route.providerIds,
    sourceNames: route.sourceNames,
  };
}

async function readTodayMatches(env, dateKey, timezone) {
  const client = createServerClient(env);
  const table = env.SUPABASE_MATCHES_TABLE || 'matches';
  const lookbackHours = Number(env.ROUTE_SYNC_LOOKBACK_HOURS || 18);
  const lookaheadHours = Number(env.ROUTE_SYNC_LOOKAHEAD_HOURS || 36);
  const from = new Date(Date.now() - lookbackHours * 60 * 60_000).toISOString();
  const to = new Date(Date.now() + lookaheadHours * 60 * 60_000).toISOString();
  const { data, error } = await client
    .from(table)
    .select('id,match_id,home_team,away_team,league,kickoff_time,channel,source,payload,active,updated_at')
    .eq('active', true)
    .gte('kickoff_time', from)
    .lte('kickoff_time', to)
    .order('kickoff_time', { ascending: true, nullsFirst: false })
    .limit(Number(env.ROUTE_SYNC_MATCH_LIMIT || 700));
  if (error) throw new Error(`Match storage unavailable (${error.code || 'network'})`);
  return (data || []).filter((row) => dateKeyFor(row.kickoff_time, timezone) === dateKey);
}

function targetChannelsForMatch(row) {
  const candidates = broadcastChannelCandidates(row);
  if (candidates.length) return candidates;
  const direct = row.channel || row.payload?.channel;
  return typeof direct === 'string' && direct.trim() ? [direct.trim()] : [];
}

export async function runMaintenanceSync(env = process.env) {
  const timezone = env.ROUTE_SYNC_TIMEZONE || DEFAULT_TIMEZONE;
  const dateKey = env.ROUTE_SYNC_DATE || dateKeyFor(Date.now(), timezone);
  const dir = env.PROVIDER_POOL_DIR || DEFAULT_POOL_DIR;
  const providerCatalogPath = env.PROVIDER_CATALOG_PATH || `${dir}/provider-catalog.json`;
  const activeCatalogPath = env.ACTIVE_CATALOG_PATH || `${dir}/active-catalog.json`;
  const missingRoutesPath = env.MISSING_ROUTES_PATH || `${dir}/missing-routes.json`;
  const providerCatalog = await readJson(providerCatalogPath, { providers: {}, channels: {} });
  const routes = buildAvailableRoutes(providerCatalog);
  const matches = await readTodayMatches(env, dateKey, timezone);
  const activeChannels = {};
  const matchRoutes = {};
  const missing = [];
  for (const row of matches) {
    const matchId = row.match_id || row.id;
    const targets = [...new Set(targetChannelsForMatch(row))];
    const resolved = [];
    for (const target of targets) {
      const route = resolveRouteName(target, routes);
      if (route) {
        activeChannels[route.matchedName] ||= {
          routeId: `channel:${route.matchedName}`,
          name: route.matchedName,
          providerIds: route.providerIds,
          sourceNames: route.sourceNames,
          requestedBy: [],
        };
        activeChannels[route.matchedName].requestedBy.push(matchId);
        resolved.push({
          requestedName: route.requestedName,
          routeId: activeChannels[route.matchedName].routeId,
          channel: route.matchedName,
          providerIds: route.providerIds,
          matchedAlias: route.matchedAlias,
        });
      } else {
        missing.push({
          matchId,
          requestedName: target,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          kickoffTime: row.kickoff_time,
        });
      }
    }
    if (resolved.length || targets.length) {
      matchRoutes[matchId] = {
        matchId,
        date: dateKey,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        league: row.league,
        kickoffTime: row.kickoff_time,
        requestedNames: targets,
        routes: resolved,
      };
    }
  }
  for (const channel of Object.values(activeChannels)) {
    channel.requestedBy = [...new Set(channel.requestedBy)].sort();
  }
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    date: dateKey,
    timezone,
    source: 'maintenance-sync',
    routeCount: Object.keys(activeChannels).length,
    matchCount: Object.keys(matchRoutes).length,
    activeChannels,
    matches: matchRoutes,
  };
  const missingOutput = {
    generatedAt: output.generatedAt,
    date: dateKey,
    timezone,
    missingCount: missing.length,
    missing,
  };
  await writeJsonAtomic(activeCatalogPath, output);
  await writeJsonAtomic(missingRoutesPath, missingOutput);
  return {
    generatedAt: output.generatedAt,
    date: dateKey,
    matches: output.matchCount,
    activeRoutes: output.routeCount,
    missingRoutes: missing.length,
    activeCatalogPath,
    missingRoutesPath,
  };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  runMaintenanceSync()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    });
}
