import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findBinary } from "../src/motion/server/util";
const run = promisify(execFile);
// Remove only the interior of long pauses, preserving 150 ms around speech.
export function speechRanges(log: string, duration: number): [number, number][] {
  let start = 0; const cuts: [number, number][] = [];
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const value = Math.min(duration, Number(match[2]));
    if (match[1] === "start") start = value;
    else if (value - start >= 0.7) cuts.push([start + 0.15, value - 0.15]);
  }
  let cursor = 0; const keep: [number, number][] = [];
  for (const [a, b] of cuts.slice(0, 160)) { if (a > cursor) keep.push([cursor, a]); cursor = b; }
  if (cursor < duration) keep.push([cursor, duration]);
  return keep.filter(([a, b]) => b - a >= 0.04);
}
export async function cutReelPauses(source: string, target: string, duration: number) {
  const ffmpeg = findBinary("ffmpeg"); if (!ffmpeg) throw new Error("ffmpeg is unavailable");
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", source, "-af", "silencedetect=noise=-38dB:d=0.7", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 2_000_000 });
  const ranges = speechRanges(stderr, duration);
  if (ranges.reduce((n, [a, b]) => n + b - a, 0) < 0.5) throw new Error("Choose a video with audible speech for auto-cut");
  const filters = ranges.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
  filters.push(`${ranges.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${ranges.length}:v=1:a=1[v][a]`);
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", target], { timeout: 240_000, maxBuffer: 1_000_000 });
}
