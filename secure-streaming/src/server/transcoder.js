import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const processes = new Map();

export function hlsOutputDir(channelName) {
  const safeName = channelName.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.HLS_OUTPUT_DIR || "./runtime/hls", safeName);
}

export function masterPlaylistPath(channelName) {
  return path.join(hlsOutputDir(channelName), "master.m3u8");
}

export function ensureTranscoder({ channelName, sourceUrl }) {
  if (process.env.TRANSCODE_ENABLED !== "true") {
    throw new Error("Transcoding is disabled. Set TRANSCODE_ENABLED=true on a Node server with FFmpeg installed.");
  }
  if (processes.has(channelName)) return processes.get(channelName);

  const outputDir = hlsOutputDir(channelName);
  fs.mkdirSync(outputDir, { recursive: true });

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", sourceUrl,
    "-filter_complex",
    "[0:v]split=3[v1080][v720][v360];[v1080]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v1080out];[v720]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v720out];[v360]scale=w=640:h=360:force_original_aspect_ratio=decrease[v360out]",
    "-map", "[v1080out]", "-map", "0:a:0?",
    "-map", "[v720out]", "-map", "0:a:0?",
    "-map", "[v360out]", "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-g", "48",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:v:0", "5000k", "-maxrate:v:0", "5350k", "-bufsize:v:0", "7500k",
    "-b:v:1", "2800k", "-maxrate:v:1", "3000k", "-bufsize:v:1", "4200k",
    "-b:v:2", "800k", "-maxrate:v:2", "950k", "-bufsize:v:2", "1200k",
    "-b:a:0", "160k", "-b:a:1", "128k", "-b:a:2", "96k",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_list_size", "8",
    "-hls_flags", "delete_segments+independent_segments",
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:360p",
    "-hls_segment_filename", path.join(outputDir, "%v_%03d.ts"),
    path.join(outputDir, "%v.m3u8")
  ];

  const child = spawn(/* turbopackIgnore: true */ ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => console.error(`[ffmpeg:${channelName}] ${chunk}`));
  child.on("exit", () => processes.delete(channelName));
  processes.set(channelName, child);
  return child;
}
