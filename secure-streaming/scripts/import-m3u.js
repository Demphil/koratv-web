import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

export function env(name, fallback = "") {
  return process.env[name] || fallback;
}

export function readText(filePath) {
  return fs.readFileSync(path.resolve(root, filePath), "utf8");
}

export function parseStreamsJs(filePath) {
  const text = readText(filePath);
  const names = new Set();
  const pairPattern = /(['"`])((?:\\.|(?!\1).)+)\1\s*:/g;
  let match;
  while ((match = pairPattern.exec(text))) {
    names.add(match[2].replace(/\\(['"`\\])/g, "$1").trim());
  }
  return [...names].filter(Boolean);
}

export function parseAttributes(line) {
  const attrs = {};
  line.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => {
    attrs[key.toLowerCase()] = value.trim();
    return "";
  });
  return attrs;
}

export function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/[|•●✦]+/g, " ")
    .trim();
}

export function normalizeName(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\bhd\s*([1-9])\b/g, "$1")
    .replace(/\bmax\s*([1-9])\b/g, "max $1")
    .replace(/\bar\b/g, " ")
    .replace(/\bsp\b/g, " ")
    .replace(/\buae\b/g, " ")
    .replace(/\bksa\b/g, " ")
    .replace(/\begy\b/g, " ")
    .replace(/\bma\b/g, " ")
    .replace(/\bhevc\b/g, " ")
    .replace(/\bfhd\b/g, " ")
    .replace(/\bhd\b/g, "")
    .replace(/\bsd\b/g, "")
    .replace(/\b0([1-9])\b/g, "$1")
    .replace(/\bsports\b/g, "sport")
    .replace(/\bbein\b/g, "bein")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entrySearchText(entry) {
  return normalizeName(`${entry.name} ${entry.group || ""}`);
}

export function parseM3uText(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const attrs = parseAttributes(line);
      const commaName = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1) : "";
      const rawName = attrs["tvg-name"] || commaName;
      current = {
        rawName,
        name: cleanName(rawName),
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || ""
      };
      continue;
    }
    if (!line.startsWith("#") && current) {
      const entry = { ...current, url: line };
      entry.search = entrySearchText(entry);
      entries.push(entry);
      current = null;
    }
  }
  return entries;
}

export function parseM3u(filePath) {
  return parseM3uText(fs.readFileSync(filePath, "utf8"));
}

function channelRule(name) {
  const normalized = normalizeName(name);
  const number = normalized.match(/\b([1-9])\b/)?.[1];
  const maxNumber = normalized.match(/\bmax\s*([1-9])\b/)?.[1] || (normalized.includes("max") ? number : "");

  if (normalized.includes("bein") && normalized.includes("max") && maxNumber) {
    return { required: ["bein", "sport", "max", maxNumber], preferred: ["hd", "arab"] };
  }
  if (normalized.includes("bein") && normalized.includes("xtra")) {
    return { required: ["bein", "sport", "xtra"], preferred: [number || "1"] };
  }
  if (normalized.includes("bein") && number) {
    return { required: ["bein", "sport", number], preferred: ["hd"] };
  }
  if (normalized.includes("bein")) {
    return { required: ["bein", "sport"], preferred: ["global", "hd"] };
  }
  if (normalized.includes("arryadia") || normalized.includes("الرياضيه") || normalized.includes("المغربيه")) {
    return { required: ["arryadia"], preferred: ["tnt", "hd"] };
  }
  if (normalized.includes("on sport plus") || normalized.includes("اون سبورت بلس") || normalized.includes("on time sport 2") || normalized.includes("اون سبورت 2")) {
    return { required: ["on", "sport", "plus"], preferred: ["hd"] };
  }
  if (normalized.includes("on sport") || normalized.includes("on time") || normalized.includes("اون سبورت")) {
    return { required: ["on", "sport"], preferred: ["hd"] };
  }
  if (normalized.includes("ad sport") || normalized.includes("ابو ظبي") || normalized.includes("ابوظبي")) {
    const adNumber = normalized.match(/\b([12])\b/)?.[1] || "1";
    return { required: ["ad", "sport", adNumber], preferred: ["fhd", "hd"] };
  }
  if (normalized.includes("ثمانيه") || normalized.includes("thmanyah")) {
    const thNumber = normalized.match(/\b([123])\b/)?.[1] || "1";
    return { required: ["thmanyah", thNumber], preferred: ["fhd", "hd"] };
  }
  if (normalized.includes("mbc action")) {
    return { required: ["mbc", "action"], preferred: ["fhd", "hd"] };
  }
  if (normalized.includes("starzplay") || normalized.includes("starz")) {
    return { required: ["starzplay"], preferred: ["sport", "hd"] };
  }
  if (normalized.includes("shahid") || normalized.includes("شاهد")) {
    return { required: ["shahid", "vip"], preferred: ["live", "hd"] };
  }
  if (normalized.includes("alkass") || normalized.includes("الكاس") || normalized.includes("الكأس")) {
    const alkassNumber = normalized.match(/\b([1-8])\b/)?.[1] || "1";
    return { required: ["alkass", alkassNumber], preferred: ["hd"] };
  }
  if (normalized.includes("ssc") || normalized.includes("ksa sport")) {
    const ksaNumber = normalized.match(/\b([1-4])\b/)?.[1] || "1";
    return { required: ["ksa", "sport", ksaNumber], preferred: ["hd"] };
  }
  return null;
}

function scoreEntry(entry, rule) {
  const text = entry.search;
  const raw = `${entry.rawName || entry.name} ${entry.group || ""}`.toLowerCase();
  if (!rule.required.every((token) => text.includes(token))) return -1;
  let score = rule.required.length * 10;
  for (const token of rule.preferred || []) {
    if (text.includes(token)) score += 3;
  }
  if (entry.group && /AR \| BEIN SPORTS/i.test(entry.group)) score += 5;
  if (entry.group && /AR \| ARAB SPORT/i.test(entry.group)) score += 3;
  if (!raw.includes("[bk")) score += 10;
  if (text.includes("bk") || raw.includes("[bk")) score -= 8;
  if (text.includes("wafcon")) score -= 8;
  if (text.includes("ppv")) score -= 6;
  if (text.includes("event")) score -= 2;
  if (text.includes("sd")) score -= 2;
  return score;
}

function findByRule(name, entries) {
  const rule = channelRule(name);
  if (!rule) return null;
  let best = null;
  let bestScore = -1;
  for (const entry of entries) {
    const score = scoreEntry(entry, rule);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

function findByRuleCandidates(name, entries, limit = 8) {
  const rule = channelRule(name);
  if (!rule) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, rule) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

function pushUniqueEntry(target, entry) {
  if (!entry || target.some((item) => item.url === entry.url)) return;
  target.push(entry);
}

export function matchChannels(streamNames, m3uEntries, options = {}) {
  const candidatesPerChannel = Number(options.candidatesPerChannel || 1);
  const exact = new Map();
  const normalized = new Map();
  for (const entry of m3uEntries) {
    if (!exact.has(entry.name)) exact.set(entry.name, []);
    exact.get(entry.name).push(entry);
    const norm = normalizeName(entry.name);
    if (norm) {
      if (!normalized.has(norm)) normalized.set(norm, []);
      normalized.get(norm).push(entry);
    }
  }

  return streamNames
    .map((name) => {
      const candidates = [];
      for (const entry of exact.get(name) || []) pushUniqueEntry(candidates, entry);
      for (const entry of normalized.get(normalizeName(name)) || []) pushUniqueEntry(candidates, entry);
      for (const entry of findByRuleCandidates(name, m3uEntries, Math.max(candidatesPerChannel, 8))) {
        pushUniqueEntry(candidates, entry);
      }

      const entry = candidates[0] || findByRule(name, m3uEntries);
      if (!entry) return null;

      const item = { name, original_url: entry.url, active: true, source_name: entry.name };
      if (candidatesPerChannel > 1) {
        item.candidates = candidates.slice(0, candidatesPerChannel).map((candidate) => ({
          original_url: candidate.url,
          source_name: candidate.name
        }));
      }
      return item;
    })
    .filter(Boolean);
}

async function main() {
  const streamsFile = env("STREAMS_JS", "../assets/js/streams.js");
  const m3uFile = env("M3U_FILE", "C:/Users/demph/Downloads/tv_channels_81Z2TPAW_plus.m3u");
  const streamNames = parseStreamsJs(streamsFile);
  const entries = parseM3u(m3uFile);
  const matched = matchChannels(streamNames, entries);

  console.log(JSON.stringify({
    streamNames: streamNames.length,
    m3uEntries: entries.length,
    matched: matched.length,
    dryRun
  }, null, 2));

  for (const item of matched.slice(0, 20)) {
    console.log(`${item.name} <= ${item.source_name}`);
  }

  if (dryRun) return;

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for import.");
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const payload = matched.map(({ name, original_url, active }) => ({ name, original_url, active }));
  const { error } = await supabase
    .from("channels")
    .upsert(payload, { onConflict: "name" });

  if (error) throw error;
  console.log(`Imported ${payload.length} channel links into Supabase.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
