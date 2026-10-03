/**
 * Export any style to mp4: headless Chrome draws each frame from the style's
 * pure render(t), ffmpeg encodes H.264 (yuv420p, CRF 18, +faststart) at 30 fps.
 * Sizes: 16:9 3840x2160, 9:16 2160x3840, 1:1 2160x2160. 5 s or 10 s (two loops).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "../engine/types";
import { LOOP } from "../engine/types";
import { launchChrome, type Browser, type Page } from "./cdp";
import { exportsDir, findBinary, slugify, tildify } from "./util";

export type Aspect = "16:9" | "9:16" | "1:1";
export const SIZES: Record<Aspect, [number, number]> = {
  "16:9": [3840, 2160],
  "9:16": [2160, 3840],
  "1:1": [2160, 2160],
};
const FPS = 30;

export interface ExportJob {
  id: string;
  style: string;
  aspect: Aspect;
  seconds: number;
  state: "starting" | "rendering" | "encoding" | "done" | "error" | "cancelled";
  frames: number;
  total: number;
  file?: string;
  display?: string;
  bytes?: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

// Kept on globalThis so a dev-server restart (which re-imports this module in
// the same process) doesn't lose track of an export that is still running.
const store = globalThis as typeof globalThis & {
  __motionExportJobs?: Map<string, ExportJob>;
  __motionExportRunning?: Map<string, { cancel: () => void }>;
};
const jobs = (store.__motionExportJobs ??= new Map<string, ExportJob>());
const running = (store.__motionExportRunning ??= new Map<string, { cancel: () => void }>());

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export function cancelJob(id: string): boolean {
  const r = running.get(id);
  if (!r) return false;
  r.cancel();
  return true;
}

export function exportTools() {
  return { ffmpeg: findBinary("ffmpeg") };
}

/**
 * Start an export. `origin` is this dev server (http://127.0.0.1:PORT); Chrome
 * loads origin + /__motion/frame.html, which runs the same engine as the wall.
 */
export function startExport(options: {
  style: string;
  theme: Theme | null;
  aspect: Aspect;
  seconds: 5 | 10;
  origin: string;
  scale?: number;
}): ExportJob {
  const [W0, H0] = SIZES[options.aspect];
  const scale = Math.max(0.1, Math.min(1, options.scale ?? 1));
  const W = Math.round((W0 * scale) / 2) * 2;
  const H = Math.round((H0 * scale) / 2) * 2;
  const total = options.seconds * FPS;
  const id = randomBytes(6).toString("hex");
  const job: ExportJob = {
    id,
    style: options.style,
    aspect: options.aspect,
    seconds: options.seconds,
    state: "starting",
    frames: 0,
    total,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  if (jobs.size > 40) jobs.delete(jobs.keys().next().value as string);

  let cancelled = false;
  let partialPath: string | null = null;
  let browser: Browser | null = null;
  let ffmpeg: ChildProcess | null = null;
  running.set(id, {
    cancel: () => {
      cancelled = true;
      ffmpeg?.kill("SIGKILL");
      void browser?.close();
    },
  });

  const run = async () => {
    const bin = findBinary("ffmpeg");
    if (!bin)
      throw new Error(
        "Export needs ffmpeg. Install it (macOS: brew install ffmpeg) and try again.",
      );
    const dir = exportsDir();
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
    const name = `${slugify(options.style)}-${options.aspect.replace(":", "x")}-${options.seconds}s-${stamp}.mp4`;
    const final = join(dir, name);
    const partial = join(dir, `.${name}.part.mp4`);
    partialPath = partial;

    browser = await launchChrome();
    const pageCount = Math.min(3, total);
    const pages: Page[] = [];
    for (let i = 0; i < pageCount; i++) {
      const page = await browser.newPage();
      await page.goto(`${options.origin}/__motion/frame.html`, "window.__ready === true", 90000);
      await page.evaluate(
        `window.__motion.setup(${JSON.stringify({ id: options.style, theme: options.theme, w: W, h: H })})`,
      );
      pages.push(page);
      if (cancelled) throw new Error("cancelled");
    }

    job.state = "rendering";
    const ff = spawn(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        String(FPS),
        "-c:v",
        "mjpeg",
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(FPS),
        "-movflags",
        "+faststart",
        partial,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    ffmpeg = ff;
    let ffErr = "";
    ff.stderr?.on("data", (c: Buffer) => (ffErr += c.toString()));
    const exited = new Promise<number>((resolve) => ff.on("close", (code) => resolve(code ?? 1)));
    const write = (buf: Buffer) =>
      new Promise<void>((resolve, reject) => {
        if (!ff.stdin || ff.stdin.destroyed) return reject(new Error("ffmpeg stopped early."));
        if (ff.stdin.write(buf)) resolve();
        else ff.stdin.once("drain", resolve);
      });

    // Pages render frames in parallel; frames are written strictly in order.
    const ready = new Map<number, Buffer>();
    let next = 0;
    let written = 0;
    let wake: (() => void) | null = null;
    const workers = pages.map(async (page) => {
      for (;;) {
        if (cancelled) return;
        const i = next++;
        if (i >= total) return;
        const t = (i / FPS) % LOOP;
        const b64 = await page.evaluate<string>(`window.__motion.frame(${t.toFixed(6)}, 0.95)`);
        ready.set(i, Buffer.from(b64, "base64"));
        wake?.();
        // Keep memory bounded: wait while this worker is far ahead of the writer.
        while (!cancelled && i - written > 24) await new Promise((r) => setTimeout(r, 15));
      }
    });
    const writer = (async () => {
      while (written < total) {
        if (cancelled) return;
        const buf = ready.get(written);
        if (!buf) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 50);
          });
          continue;
        }
        ready.delete(written);
        await write(buf);
        written++;
        job.frames = written;
      }
    })();
    await Promise.all([...workers, writer]);
    if (cancelled) throw new Error("cancelled");
    job.state = "encoding";
    ff.stdin?.end();
    const code = await exited;
    await browser.close();
    browser = null;
    if (code !== 0 || !existsSync(partial))
      throw new Error(`ffmpeg failed: ${ffErr.trim().slice(-200) || code}`);
    renameSync(partial, final);
    job.file = final;
    job.display = tildify(final);
    job.bytes = statSync(final).size;
    job.state = "done";
    job.finishedAt = Date.now();
  };

  run()
    .catch((error) => {
      job.state = cancelled ? "cancelled" : "error";
      job.error = cancelled ? undefined : error instanceof Error ? error.message : String(error);
      job.finishedAt = Date.now();
      ffmpeg?.kill("SIGKILL");
      void browser?.close();
      if (partialPath) rmSync(partialPath, { force: true });
    })
    .finally(() => running.delete(id));
  return job;
}
