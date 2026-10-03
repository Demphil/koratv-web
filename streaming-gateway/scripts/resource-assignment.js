import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basePriority } from '../priority.js';

const DEFAULT_MAX_RESOURCES = 8;
const DEFAULT_NATIONAL_TEAM_POINTS = 1000;
const DEFAULT_VIP_TEAM_POINTS = 500;
const DEFAULT_TIER_POINTS = {
  1: 300,
  2: 150,
  3: 50,
};
const DEFAULT_POOL_DIR = '/etc/koratv';
const DEFAULT_TIMEZONE = 'Africa/Casablanca';
const SITE_MANUAL_KEYS = [
  'matches',
  'koratv.click',
  'koratv',
  'fraja.online',
  'www.fraja.online',
  'frajatv.online',
  'www.frajatv.online',
  'frajatv.fun',
  'www.frajatv.fun',
  'frajatv',
  'fraja'
];

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function manualMatchIdFromItem(item) {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') return String(item.matchId || item.match_id || item.id || '').trim();
  return '';
}

export function parseManualMatchSelection(input = {}, { dateKey = '' } = {}) {
  if (!input || typeof input !== 'object' || input.enabled === false) return [];
  if (input.date && dateKey && String(input.date) !== String(dateKey)) return [];
  const ids = [];
  for (const key of SITE_MANUAL_KEYS) {
    const value = input[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const id = manualMatchIdFromItem(item);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function dateKeyFor(value, timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
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

export function scoreEvent(event = {}, {
  vipTeams = [],
  nationalTeamPoints = DEFAULT_NATIONAL_TEAM_POINTS,
  vipTeamPoints = DEFAULT_VIP_TEAM_POINTS,
  tierPoints = DEFAULT_TIER_POINTS,
} = {}) {
  let score = 0;
  if (event.national_team === true || event.is_national_team === true) score += nationalTeamPoints;

  const teams = [event.home_team, event.away_team, event.homeTeam, event.awayTeam]
    .map(normalizeName)
    .filter(Boolean);
  const vip = new Set(vipTeams.map(normalizeName).filter(Boolean));
  if (teams.some((team) => vip.has(team))) score += vipTeamPoints;

  const tier = Number(event.competition_tier ?? event.tier ?? 3);
  score += Number(tierPoints[tier] || 0);
  return score;
}

export function buildAssignmentPlan({
  events = [],
  resources = [],
  maxResources = DEFAULT_MAX_RESOURCES,
  now = new Date(),
  options = {},
} = {}) {
  const usableResources = resources
    .filter((resource) => resource && resource.enabled !== false)
    .slice(0, maxResources);

  const rankedEvents = events
    .filter((event) => event && event.id)
    .map((event) => ({ ...event, priority_score: scoreEvent(event, options) }))
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      const aTime = Date.parse(a.start_time || a.kickoff_time || a.starts_at || '') || Number.MAX_SAFE_INTEGER;
      const bTime = Date.parse(b.start_time || b.kickoff_time || b.starts_at || '') || Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.id).localeCompare(String(b.id));
    });

  const selected = rankedEvents.slice(0, usableResources.length);
  const ignored = rankedEvents.slice(usableResources.length);
  const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  const assignments = selected.map((event, index) => ({
    event,
    resource: usableResources[index],
    priorityScore: event.priority_score,
    assignedAt: generatedAt,
  }));

  return {
    generatedAt,
    maxResources,
    assignments,
    ignored,
    selectedEventIds: selected.map((event) => event.id),
    ignoredEventIds: ignored.map((event) => event.id),
    resourceIds: usableResources.map((resource) => resource.id),
  };
}

function matchNationalFlag(match = {}) {
  const payload = match.payload || {};
  return Boolean(match.national_team || match.is_national_team || payload.national_team || payload.is_national_team
    || payload.homeTeam?.national || payload.awayTeam?.national || payload.teams?.home?.national || payload.teams?.away?.national);
}

export function scoreProjectMatch(match = {}, channel = '', options = {}) {
  const explicitTier = match.competition_tier ?? match.tier ?? match.payload?.competitionTier ?? match.payload?.tier;
  const eventScore = scoreEvent({
    national_team: matchNationalFlag(match),
    home_team: match.home_team || match.homeTeam,
    away_team: match.away_team || match.awayTeam,
    competition_tier: explicitTier ?? 0,
  }, options);
  return eventScore + basePriority(match, channel);
}

export function buildProjectAssignmentPlan({
  matches = [],
  routeStates = {},
  providerCatalog = {},
  maxResources = DEFAULT_MAX_RESOURCES,
  manualMatchIds = [],
  now = new Date(),
  options = {},
} = {}) {
  const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const manualRank = new Map(manualMatchIds
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, maxResources)
    .map((id, index) => [id, index]));
  const enabledProviders = Object.entries(providerCatalog.providers || {})
    .filter(([, provider]) => provider?.enabled !== false)
    .map(([id]) => id)
    .slice(0, maxResources);

  const rows = matches
    .map((match) => {
      const matchId = match.match_id || match.id;
      const state = routeStates[matchId];
      if (!matchId || !state || state.status !== 'RESOLVED' || !state.resolvedChannel) return null;
      const providerIds = (state.providerIds || []).filter((id) => enabledProviders.includes(id));
      if (!providerIds.length) return null;
      return {
        matchId,
        match,
        state,
        providerIds,
        manualRank: manualRank.has(matchId) ? manualRank.get(matchId) : null,
        priorityScore: scoreProjectMatch(match, state.resolvedChannel, options),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aManual = a.manualRank !== null;
      const bManual = b.manualRank !== null;
      if (aManual !== bManual) return aManual ? -1 : 1;
      if (aManual && bManual && a.manualRank !== b.manualRank) return a.manualRank - b.manualRank;
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      const aTime = Date.parse(a.match.kickoff_time || a.match.start_time || '') || Number.MAX_SAFE_INTEGER;
      const bTime = Date.parse(b.match.kickoff_time || b.match.start_time || '') || Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.matchId).localeCompare(String(b.matchId));
    });

  const usedProviders = new Set();
  const assignments = [];
  const ignored = [];
  for (const row of rows) {
    const providerId = row.providerIds.find((id) => !usedProviders.has(id));
    if (!providerId || assignments.length >= maxResources) {
      ignored.push({ ...row, reason: providerId ? 'capacity' : 'no_available_provider' });
      continue;
    }
    usedProviders.add(providerId);
    assignments.push({
      matchId: row.matchId,
      homeTeam: row.match.home_team,
      awayTeam: row.match.away_team,
      league: row.match.league,
      kickoffTime: row.match.kickoff_time,
      requestedChannel: row.state.requestedChannel,
      resolvedChannel: row.state.resolvedChannel,
      providerId,
      candidateProviderIds: row.providerIds,
      priorityScore: row.priorityScore,
      manual: row.manualRank !== null,
      assignedAt: generatedAt,
    });
  }
  const represented = new Set([...assignments.map((item) => item.matchId), ...ignored.map((item) => item.matchId)]);
  for (const matchId of manualRank.keys()) {
    if (!represented.has(matchId)) {
      const match = matches.find((row) => (row.match_id || row.id) === matchId);
      ignored.push({
        matchId,
        match: match || {},
        state: routeStates[matchId] || {},
        providerIds: [],
        priorityScore: match ? scoreProjectMatch(match, routeStates[matchId]?.resolvedChannel || '', options) : 0,
        manualRank: manualRank.get(matchId),
        reason: 'manual_unresolved_route',
      });
    }
  }

  return {
    version: 1,
    generatedAt,
    maxResources,
    resourceCount: enabledProviders.length,
    assignedCount: assignments.length,
    ignoredCount: ignored.length,
    assignments,
    ignored: ignored.map((row) => ({
      matchId: row.matchId,
      homeTeam: row.match.home_team,
      awayTeam: row.match.away_team,
      league: row.match.league,
      kickoffTime: row.match.kickoff_time,
      resolvedChannel: row.state.resolvedChannel,
      candidateProviderIds: row.providerIds,
      priorityScore: row.priorityScore,
      manual: row.manualRank !== null,
      reason: row.reason,
    })),
  };
}

function createSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchLiveEvents(supabase, table) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('is_live', true);
  if (error) throw error;
  return data || [];
}

async function fetchEnabledResources(supabase, table, maxResources) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('enabled', true)
    .order('name', { ascending: true })
    .limit(maxResources);
  if (error) throw error;
  return data || [];
}

async function updateAssignments(supabase, {
  eventsTable,
  resourcesTable,
  plan,
}) {
  const timestamp = plan.generatedAt;

  if (plan.resourceIds.length) {
    const { error } = await supabase
      .from(resourcesTable)
      .update({ current_event_id: null, updated_at: timestamp })
      .in('id', plan.resourceIds);
    if (error) throw error;
  }

  for (const assignment of plan.assignments) {
    const { event, resource, priorityScore } = assignment;
    const { error: resourceError } = await supabase
      .from(resourcesTable)
      .update({ current_event_id: event.id, updated_at: timestamp })
      .eq('id', resource.id);
    if (resourceError) throw resourceError;

    const { error: eventError } = await supabase
      .from(eventsTable)
      .update({
        assigned_resource_id: resource.id,
        assignment_status: 'assigned',
        priority_score: priorityScore,
        updated_at: timestamp,
      })
      .eq('id', event.id);
    if (eventError) throw eventError;
  }

  if (plan.ignoredEventIds.length) {
    const { error } = await supabase
      .from(eventsTable)
      .update({
        assigned_resource_id: null,
        assignment_status: 'waiting',
        updated_at: timestamp,
      })
      .in('id', plan.ignoredEventIds);
    if (error) throw error;
  }
}

export async function assignEventResources({
  supabase = createSupabaseClient(),
  eventsTable = process.env.EVENTS_TABLE || 'events',
  resourcesTable = process.env.RESOURCES_TABLE || 'resources',
  maxResources = Number(process.env.MAX_EVENT_RESOURCES || DEFAULT_MAX_RESOURCES),
  vipTeams = parseList(process.env.VIP_TEAMS || 'Real Madrid,Barcelona,Manchester City,Bayern Munich'),
  tierPoints = DEFAULT_TIER_POINTS,
  now = new Date(),
} = {}) {
  const [events, resources] = await Promise.all([
    fetchLiveEvents(supabase, eventsTable),
    fetchEnabledResources(supabase, resourcesTable, maxResources),
  ]);

  const plan = buildAssignmentPlan({
    events,
    resources,
    maxResources,
    now,
    options: { vipTeams, tierPoints },
  });

  await updateAssignments(supabase, { eventsTable, resourcesTable, plan });
  return {
    generatedAt: plan.generatedAt,
    assignedCount: plan.assignments.length,
    ignoredCount: plan.ignored.length,
    assigned: plan.assignments.map(({ event, resource, priorityScore }) => ({
      eventId: event.id,
      eventName: event.name,
      resourceId: resource.id,
      resourceName: resource.name,
      priorityScore,
    })),
    ignored: plan.ignored.map((event) => ({
      eventId: event.id,
      eventName: event.name,
      priorityScore: event.priority_score,
    })),
  };
}

async function readProjectMatches(supabase, env, dateKey, timezone) {
  const table = env.SUPABASE_MATCHES_TABLE || 'matches';
  const lookbackHours = Number(env.RESOURCE_ASSIGNMENT_LOOKBACK_HOURS || env.ROUTE_SYNC_LOOKBACK_HOURS || 18);
  const lookaheadHours = Number(env.RESOURCE_ASSIGNMENT_LOOKAHEAD_HOURS || env.ROUTE_SYNC_LOOKAHEAD_HOURS || 36);
  const from = new Date(Date.now() - lookbackHours * 60 * 60_000).toISOString();
  const to = new Date(Date.now() + lookaheadHours * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from(table)
    .select('id,match_id,home_team,away_team,league,kickoff_time,channel,source,payload,active,updated_at')
    .eq('active', true)
    .gte('kickoff_time', from)
    .lte('kickoff_time', to)
    .order('kickoff_time', { ascending: true, nullsFirst: false })
    .limit(Number(env.RESOURCE_ASSIGNMENT_MATCH_LIMIT || 700));
  if (error) throw new Error(`Match storage unavailable (${error.code || 'network'})`);
  return (data || []).filter((row) => dateKeyFor(row.kickoff_time, timezone) === dateKey);
}

async function writeProjectAssignmentsToSupabase(supabase, env, dateKey, plan) {
  if (String(env.RESOURCE_ASSIGNMENT_WRITE_SUPABASE_STATE || 'true').trim().toLowerCase() === 'false') {
    return { enabled: false, written: 0 };
  }
  const table = env.RESOURCE_ASSIGNMENT_TABLE || 'match_resource_assignments';
  const rows = plan.assignments.map((assignment) => ({
    match_id: assignment.matchId,
    assignment_date: dateKey,
    provider_id: assignment.providerId,
    requested_channel: assignment.requestedChannel,
    resolved_channel: assignment.resolvedChannel,
    priority_score: assignment.priorityScore,
    status: 'ASSIGNED',
    updated_at: assignment.assignedAt,
  }));
  for (const row of plan.ignored) {
    rows.push({
      match_id: row.matchId,
      assignment_date: dateKey,
      provider_id: null,
      requested_channel: null,
      resolved_channel: row.resolvedChannel,
      priority_score: row.priorityScore,
      status: 'WAITING',
      updated_at: plan.generatedAt,
    });
  }
  if (!rows.length) return { enabled: true, written: 0 };
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'match_id' })
    .select('match_id');
  if (error) throw error;
  return { enabled: true, written: data?.length || rows.length };
}

export async function assignProjectMatchResources(env = process.env) {
  const timezone = env.RESOURCE_ASSIGNMENT_TIMEZONE || env.ROUTE_SYNC_TIMEZONE || DEFAULT_TIMEZONE;
  const dateKey = env.RESOURCE_ASSIGNMENT_DATE || env.ROUTE_SYNC_DATE || dateKeyFor(Date.now(), timezone);
  const dir = env.PROVIDER_POOL_DIR || DEFAULT_POOL_DIR;
  const providerCatalogPath = env.PROVIDER_CATALOG_PATH || `${dir}/provider-catalog.json`;
  const routeStatePath = env.DIRECT_MATCH_ROUTE_STATE_PATH || `${dir}/direct-match-route-state.json`;
  const outputPath = env.MATCH_RESOURCE_ASSIGNMENT_PATH || `${dir}/match-resource-assignments.json`;
  const manualSelectionPath = env.MANUAL_MATCH_SELECTION_PATH || `${dir}/manual-match-selection.json`;
  const supabase = createSupabaseClient(env);
  const [matches, providerCatalog, routeState, manualSelection] = await Promise.all([
    readProjectMatches(supabase, env, dateKey, timezone),
    readJson(providerCatalogPath, { providers: {}, channels: {} }),
    readJson(routeStatePath, { matches: {} }),
    readJson(manualSelectionPath, { enabled: false }),
  ]);
  const manualMatchIds = parseManualMatchSelection(manualSelection, { dateKey });
  const plan = buildProjectAssignmentPlan({
    matches,
    routeStates: routeState.matches || {},
    providerCatalog,
    maxResources: Number(env.MAX_EVENT_RESOURCES || DEFAULT_MAX_RESOURCES),
    manualMatchIds,
    options: {
      vipTeams: parseList(env.VIP_TEAMS || 'Real Madrid,Barcelona,Manchester City,Liverpool,Arsenal,Bayern Munich,Paris Saint-Germain,Raja Casablanca,Wydad AC,FAR Rabat,Renaissance Berkane'),
      tierPoints: DEFAULT_TIER_POINTS,
    },
  });
  const output = {
    ...plan,
    date: dateKey,
    timezone,
    source: 'resource-assignment',
    manualSelection: {
      enabled: manualMatchIds.length > 0,
      path: manualSelectionPath,
      matchIds: manualMatchIds.slice(0, Number(env.MAX_EVENT_RESOURCES || DEFAULT_MAX_RESOURCES)),
    },
  };
  await writeJsonAtomic(outputPath, output);
  const supabaseState = await writeProjectAssignmentsToSupabase(supabase, env, dateKey, output);
  return {
    generatedAt: output.generatedAt,
    date: dateKey,
    matches: matches.length,
    assigned: output.assignedCount,
    ignored: output.ignoredCount,
    resources: output.resourceCount,
    outputPath,
    supabaseState,
  };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const runner = process.env.RESOURCE_ASSIGNMENT_MODE === 'generic'
    ? assignEventResources
    : assignProjectMatchResources;
  runner()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    });
}
