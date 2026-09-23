import * as cheerio from "cheerio";

const DEFAULT_SOURCE_URLS = [
  "https://www.beinsports.com/ar-mena/%D8%AC%D8%AF%D9%88%D9%84-%D8%A7%D9%84%D8%A8%D8%AB",
  "https://www.beinsports.com/en-mena/tv-guide"
];

const sourceCache = new Map();

function configuredSourceUrls() {
  const fromEnv = (process.env.TRUSTED_BROADCAST_SOURCE_URLS || process.env.BROADCAST_SOURCE_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_SOURCE_URLS, ...fromEnv])];
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamTokens(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !["fc", "cf", "club", "نادي", "فريق", "football"].includes(token));
}

function hasTeam(chunk, teamName) {
  const normalizedChunk = normalize(chunk);
  const normalizedTeam = normalize(teamName);
  if (!normalizedTeam) return false;
  if (normalizedChunk.includes(normalizedTeam)) return true;

  const tokens = teamTokens(teamName);
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => normalizedChunk.includes(token)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.75));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function channelCandidatesFromText(value) {
  const text = String(value || "");
  const candidates = [];
  const patterns = [
    /beIN\s*Sports\s*Mena\s*(?:HD\s*)?\d+/gi,
    /beIN\s*SPORTS\s*(?:MENA\s*)?(?:HD\s*)?\d+/gi,
    /beIN\s*Sports\s*(?:MENA\s*)?(?:HD\s*)?\d+/gi,
    /بي\s*إن\s*سبورتس?\s*(?:HD|اتش\s*دي)?\s*\d+/gi,
    /بى\s*إن\s*سبورتس?\s*(?:HD|اتش\s*دي)?\s*\d+/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) candidates.push(match[0]);
  }

  return unique(candidates).map(normalizeBeinChannelName);
}

function normalizeBeinChannelName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const number = text.match(/\d+/)?.[0];
  if (/bein|beIN|بي\s*إن|بى\s*إن/i.test(text) && number) return `beIN SPORTS HD ${number}`;
  return text;
}

function expandChannelCandidates(value) {
  const candidates = [value];
  const number = String(value || "").match(/\d+/)?.[0];
  if (/bein|beIN|بي\s*إن|بى\s*إن/i.test(String(value || "")) && number) {
    candidates.push(
      `beIN SPORTS HD ${number}`,
      `beIN SPORTS ${number} HD`,
      `beIN Sports Mena ${number}`,
      `beIN Sports Mena ${number} HD`,
      `beIN Sports ${number} HD`,
      `beIN SPORTS ${number}`
    );
  }
  return unique(candidates);
}

async function fetchSourceText(url) {
  if (sourceCache.has(url)) return sourceCache.get(url);

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 koratv broadcast metadata resolver/1.0",
      "accept": "text/html,application/xhtml+xml,application/json"
    }
  });

  if (!response.ok) throw new Error(`Trusted source fetch failed ${response.status} for ${url}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const visibleText = $("body").text();
  const scriptText = $("script").map((_, element) => $(element).text()).get().join("\n");
  const text = `${visibleText}\n${scriptText}\n${html}`
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ");

  sourceCache.set(url, text);
  return text;
}

function nearbyChunks(text, chunkSize = 2400, step = 900) {
  const chunks = [];
  for (let index = 0; index < text.length; index += step) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function resolveFromSourceText(text, row) {
  const homeTeam = row.home_team || row.homeTeam || row.payload?.homeTeam?.name || row.payload?.homeTeam;
  const awayTeam = row.away_team || row.awayTeam || row.payload?.awayTeam?.name || row.payload?.awayTeam;
  if (!homeTeam || !awayTeam) return null;

  for (const chunk of nearbyChunks(text)) {
    if (!hasTeam(chunk, homeTeam) || !hasTeam(chunk, awayTeam)) continue;
    const candidates = channelCandidatesFromText(chunk);
    if (candidates.length) return candidates[0];
  }

  return null;
}

async function readActiveChannels(supabase) {
  const { data, error } = await supabase
    .from("channels")
    .select("name,active")
    .eq("active", true);

  if (error) throw error;
  return (data || []).map((channel) => ({ ...channel, normalized: normalize(channel.name) }));
}

function findExistingChannel(channels, candidate) {
  for (const value of expandChannelCandidates(candidate)) {
    const normalized = normalize(value);
    const exact = channels.find((channel) => channel.normalized === normalized);
    if (exact) return exact.name;

    const partial = channels.find((channel) =>
      normalized.length >= 6 &&
      (channel.normalized.includes(normalized) || normalized.includes(channel.normalized))
    );
    if (partial) return partial.name;
  }
  return candidate;
}

export async function resolveTrustedBroadcastChannel(row, { sourceUrls = configuredSourceUrls() } = {}) {
  for (const sourceUrl of sourceUrls) {
    try {
      const text = await fetchSourceText(sourceUrl);
      const channelName = resolveFromSourceText(text, row);
      if (channelName) {
        return {
          channelName,
          source: "bein-official-tv-guide",
          sourceUrl,
          confidence: 0.96,
          notes: "source: official beIN SPORTS TV guide; both teams were found near the channel name"
        };
      }
    } catch (error) {
      console.warn(`Trusted broadcast source skipped: ${sourceUrl} (${error.message})`);
    }
  }

  return null;
}

export async function applyTrustedBroadcastChannels(supabase, rows, options = {}) {
  if (!rows.length) return { rows, updated: 0 };

  let channels = [];
  try {
    channels = await readActiveChannels(supabase);
  } catch (error) {
    console.warn(`Could not read active channels before trusted broadcast matching: ${error.message}`);
  }

  let updated = 0;
  const output = [];

  for (const row of rows) {
    const resolved = await resolveTrustedBroadcastChannel(row, options);
    if (!resolved?.channelName) {
      output.push(row);
      continue;
    }

    const mappedChannel = channels.length
      ? findExistingChannel(channels, resolved.channelName)
      : resolved.channelName;

    updated += 1;
    output.push({
      ...row,
      channel: mappedChannel,
      payload: {
        ...(row.payload || {}),
        channel: mappedChannel,
        channelResolvedBy: resolved.source,
        channelConfidence: resolved.confidence,
        channelNotes: resolved.notes,
        channelSourceUrl: resolved.sourceUrl,
        channelResolvedAt: new Date().toISOString()
      }
    });

    console.log(`Trusted channel matched: ${row.home_team} vs ${row.away_team} -> ${mappedChannel}`);
  }

  return { rows: output, updated };
}
