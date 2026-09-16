import { parseM3u, parseStreamsJs, matchChannels, env } from "./import-m3u.js";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const channelArg = process.argv.find((arg) => arg.startsWith("--channel="));
const timeoutArg = process.argv.find((arg) => arg.startsWith("--timeout="));
const alternativesArg = process.argv.find((arg) => arg.startsWith("--alternatives="));
const limit = Number(limitArg?.split("=")[1] || 12);
const timeoutMs = Number(timeoutArg?.split("=")[1] || 12000);
const alternatives = Number(alternativesArg?.split("=")[1] || 6);
const channelFilter = channelArg ? decodeURIComponent(channelArg.split("=").slice(1).join("=")).trim() : "";

function looksLikeMpegTs(bytes) {
  return bytes[0] === 0x47 || bytes[188] === 0x47 || bytes[376] === 0x47;
}

async function checkStream(item) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(item.original_url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "KoraLiveStreamCheck/1.0",
        "Accept": "*/*",
        "Range": "bytes=0-4095"
      }
    });

    const reader = response.body?.getReader();
    const chunk = reader ? await reader.read() : { value: new Uint8Array() };
    await reader?.cancel();
    const buffer = Buffer.from(chunk.value || []);
    const sample = buffer.toString("utf8", 0, Math.min(buffer.length, 300));
    const contentType = response.headers.get("content-type") || "";
    const okStatus = response.status === 200 || response.status === 206;
    const kind = sample.includes("#EXTM3U")
      ? "hls"
      : looksLikeMpegTs(buffer)
        ? "mpegts"
        : contentType.includes("video") || contentType.includes("octet-stream")
          ? "media"
          : "unknown";

    return {
      channel: item.name,
      sourceName: item.source_name,
      status: response.status,
      contentType,
      kind,
      bytes: buffer.length,
      ms: Date.now() - started,
      ok: okStatus && kind !== "unknown" && buffer.length > 0
    };
  } catch (error) {
    return {
      channel: item.name,
      sourceName: item.source_name,
      status: "ERR",
      contentType: "",
      kind: "error",
      bytes: 0,
      ms: Date.now() - started,
      ok: false,
      error: error.name === "AbortError" ? "timeout" : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const streamsFile = env("STREAMS_JS", "../assets/js/streams.js");
  const m3uFile = env("M3U_FILE", "C:/Users/demph/Downloads/tv_channels_81Z2TPAW_plus.m3u");
  const matched = matchChannels(parseStreamsJs(streamsFile), parseM3u(m3uFile), {
    candidatesPerChannel: alternatives
  });
  const selected = matched
    .filter((item) => !channelFilter || item.name.toLowerCase().includes(channelFilter.toLowerCase()))
    .slice(0, limit);

  console.log(`Matched channels: ${matched.length}. Testing: ${selected.length}. Up to ${alternatives} hidden alternatives per channel.`);

  const results = [];
  for (const item of selected) {
    const candidates = item.candidates?.length ? item.candidates : [item];
    let finalResult = null;
    let attempt = 0;
    for (const candidate of candidates) {
      attempt += 1;
      const result = await checkStream({
        ...item,
        original_url: candidate.original_url,
        source_name: candidate.source_name
      });
      finalResult = { ...result, attempts: attempt, totalCandidates: candidates.length };
      if (result.ok) break;
    }

    results.push(finalResult);
    const flag = finalResult.ok ? "PASS" : "FAIL";
    console.log(`${flag} | ${finalResult.channel} <= ${finalResult.sourceName} | ${finalResult.status} | ${finalResult.kind} | ${finalResult.bytes} bytes | ${finalResult.ms}ms | attempts ${finalResult.attempts}/${finalResult.totalCandidates}${finalResult.error ? ` | ${finalResult.error}` : ""}`);
  }

  const passed = results.filter((item) => item.ok).length;
  console.log(JSON.stringify({ tested: results.length, passed, failed: results.length - passed }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
