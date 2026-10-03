import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { launchChrome } from "../src/motion/server/cdp";
import { findBinary } from "../src/motion/server/util";
import type { ReelProject, ReelFamily } from "../src/lib/jev-reels";
const run = promisify(execFile);
const allowedTags = new Set(["svg", "g", "defs", "lineargradient", "radialgradient", "stop", "rect", "circle", "ellipse", "path", "line", "polyline", "polygon", "text", "tspan", "clippath", "mask", "title", "desc"]);
/** Generated graphics stay declarative. No script, foreign content or network assets. */
export function safeReelSvg(raw: string, canvasHeight = 1920): string {
  if (typeof raw !== "string" || raw.length > 40_000 || !raw.trim().startsWith("<svg")) throw new Error("A reel graphic must be an SVG under 40 KB");
  const { document } = parseHTML(`<html><body>${raw}</body></html>`);
  const svg = document.body.firstElementChild;
  if (!svg || svg.tagName.toLowerCase() !== "svg" || document.body.children.length !== 1) throw new Error("Invalid reel SVG");
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    if (!allowedTags.has(element.tagName.toLowerCase())) throw new Error("Unsupported active content in reel graphic");
    for (const attr of [...element.attributes]) {
      if (/^on|href|src|style/i.test(attr.name) || /(?:https?:|file:|data:|javascript:|@import)/i.test(attr.value) || /url\((?!#[a-zA-Z0-9_-]+\))/.test(attr.value)) throw new Error("External or active content in reel graphic");
    }
  }
  svg.setAttribute("width", "1080"); svg.setAttribute("height", String(canvasHeight)); svg.setAttribute("viewBox", `0 0 1080 ${canvasHeight}`); return svg.outerHTML;
}
export async function renderGraphic(svg: string, seconds: number, output: string, size = { width: 1080, height: 1920 }, fps = 24, canvasHeight = 1920) {
  const ffmpeg = findBinary("ffmpeg"); if (!ffmpeg) throw new Error("ffmpeg is unavailable");
  const graphic = safeReelSvg(svg, canvasHeight); const browser = await launchChrome();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const page = await browser.newPage();
    await page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101213}svg{width:100%;height:100%}</style></head><body>${graphic}</body></html>`;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { stdio: ["pipe", "ignore", "pipe"] });
    const encoder = child; let encodeError = ""; encoder.stderr?.on("data", b => { encodeError = (encodeError + b).slice(-500); });
    const finished = new Promise<void>((resolve, reject) => { encoder.on("error", reject); encoder.on("close", code => code === 0 ? resolve() : reject(new Error("Reel frame encoding failed"))); });
    // Attach a handler now, while frames are being sent, to avoid unhandled rejections.
    void finished.catch(() => {});
    for (let frame = 0; frame < Math.ceil(seconds * fps); frame++) {
      const time = frame / fps;
      // Reuse Motion's headless Chrome driver. A deterministic reveal animates Opus's art.
      await page.evaluate(`(()=>{const s=document.querySelector('svg');s.style.opacity=String(Math.min(1,${time}*5+.05));s.style.transform='scale('+String(1.025-Math.min(1,${time}/3)*.025)+')';})()`);
      const result = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 88, captureBeyondViewport: false });
      await new Promise<void>((resolve, reject) => encoder.stdin!.write(Buffer.from(result.data, "base64"), e => e ? reject(e) : resolve()));
    }
    encoder.stdin!.end(); await finished;
  } finally { child?.kill("SIGKILL"); await browser.close(); }
}

/** Join already composed sections, so omitted sections also omit their source audio/video. */
export async function joinReelClips(clips: string[], output: string, directory: string, duration: number) {
  const ffmpeg = findBinary("ffmpeg"); if (!ffmpeg) throw new Error("ffmpeg is unavailable");
  if (!clips.length || clips.some(file => !/^s\d{1,2}-[ABC]-preview\.mp4$/.test(file))) throw new Error("Choose at least one rendered section");
  const list = join(directory, `${output}.concat.txt`);
  writeFileSync(list, clips.map(file => `file '${file}'`).join("\n"));
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1", "-i", list, "-t", String(duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", join(directory, output)], { timeout: 300_000, maxBuffer: 1_000_000 });
  return output;
}

export async function muxReel(project: ReelProject, family: ReelFamily, directory: string) {
  const sections = project.sections.filter(s => !project.selectedSectionIds || project.selectedSectionIds.includes(s.id));
  return joinReelClips(sections.map(s => `${s.id}-${family}-preview.mp4`), `reel-${family}.mp4`, directory, sections.reduce((sum, s) => sum + s.t1 - s.t0, 0));
}

export async function muxSection(project: ReelProject, index: number, family: ReelFamily, directory: string, source: string, sfxDirectory?: string) {
  const section = project.sections[index], ffmpeg = findBinary("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg is unavailable");
  const duration = section.t1 - section.t0;
  const output = `${section.id}-${family}-preview.mp4`;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", join(directory, `${section.id}-${family}.mp4`), "-ss", String(section.t0), "-i", source];
  const need = section.sfxDecision?.answers.needs_sfx, effect = section.sfxDecision?.answers.sfx;
  const path = sfxDirectory && need?.type === "noul" && need.noul >= 0.5 && effect?.type === "choice" && effect.choice !== "none" ? join(sfxDirectory, `${effect.choice}.mp3`) : undefined;
  const useEffect = project.includeSfx && path && existsSync(path);
  if (useEffect) args.push("-i", path);
  const filters = [project.layout === "top" ? "[0:v]scale=1080:960,setsar=1[g];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[p];[g][p]vstack[v]" : "[0:v]setsar=1[v]"];
  filters.push(`[1:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,aresample=48000[voice]`);
  if (useEffect) filters.push("[2:a]volume=0.32[sfx]", "[voice][sfx]amix=inputs=2:duration=first:normalize=0[a]");
  else filters.push("[voice]anull[a]");
  args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-t", String(duration), "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", join(directory, output));
  await run(ffmpeg, args, { timeout: 180_000, maxBuffer: 1_000_000 });
  return output;
}
