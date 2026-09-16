import fs from "node:fs";
import path from "node:path";
import { parseM3u, parseStreamsJs, matchChannels, env } from "./import-m3u.js";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Number(limitArg?.split("=")[1] || 69);
const streamsFile = env("STREAMS_JS", "../assets/js/streams.js");
const m3uFile = env("M3U_FILE", "C:/Users/demph/Downloads/tv_channels_81Z2TPAW_plus.m3u");
const output = path.resolve("runtime/channels.local.json");

const matched = matchChannels(parseStreamsJs(streamsFile), parseM3u(m3uFile)).slice(0, limit);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(matched.map((item, index) => ({
  id: `local-${index + 1}`,
  name: item.name,
  original_url: item.original_url,
  active: true
})), null, 2));

console.log(`Wrote ${matched.length} local channels to ${output}`);
