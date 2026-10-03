/**
 * Motion Library's local API, mounted on the dev server under /__motion/*.
 * Every route is loopback + same-origin only. Framework-neutral handlers live
 * in the sibling modules; this file only adapts them to Vite's middleware.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { madeById } from "../collections/made";
import type { PromptAsset } from "../engine/prompt";
import type { MotionStyle, Theme } from "../engine/types";
import { STYLES, styleById } from "../styles";
import { brandFromUrl, BrandError, FIRECRAWL_SETUP } from "./brand";
import { findChrome } from "./cdp";
import { cancelJob, getJob, startExport, type Aspect } from "./export";
import { improve, type Launch } from "./improve";
import { launch, planLaunch, type Tool } from "./launch";
import {
  assetsDir,
  findBinary,
  isLocalRequest,
  readJson,
  send,
  slugify,
  studioHome,
  tildify,
} from "./util";

export interface MotionStudioOptions {
  /** Server-side key lookup (the OS passes its env/settings reader). */
  firecrawlKey: () => string;
  /** Resolve the claude CLI (the OS passes its own resolver). */
  claudeBinary?: () => string | null | undefined;
  /** Resolve the codex CLI (the OS passes its own resolver). */
  codexBinary?: () => string | null | undefined;
  /** Wrap a binary + args for spawn (Windows .cmd shims). */
  launch?: Launch;
  /** Never open Terminal or Finder windows (MOTION_STUDIO_DRY_RUN=1). */
  dryRun?: () => boolean;
}

const FALLBACK: Theme = {
  bg: "#0c0c0e",
  ink: "#f2efe9",
  accent: "#d97757",
  accent2: "#7f93a8",
  font: "Inter",
};
const UPLOAD_TYPES: Record<string, { ext: string; kind: "image" | "video"; limit: number }> = {
  "image/png": { ext: "png", kind: "image", limit: 25e6 },
  "image/jpeg": { ext: "jpg", kind: "image", limit: 25e6 },
  "image/webp": { ext: "webp", kind: "image", limit: 25e6 },
  "image/gif": { ext: "gif", kind: "image", limit: 25e6 },
  "image/svg+xml": { ext: "svg", kind: "image", limit: 5e6 },
  "video/mp4": { ext: "mp4", kind: "video", limit: 600e6 },
  "video/quicktime": { ext: "mov", kind: "video", limit: 600e6 },
  "video/webm": { ext: "webm", kind: "video", limit: 600e6 },
  "video/x-m4v": { ext: "m4v", kind: "video", limit: 600e6 },
};

const isTheme = (t: unknown): t is Theme =>
  !!t &&
  typeof t === "object" &&
  ["bg", "ink", "accent", "accent2", "font"].every(
    (k) => typeof (t as Record<string, unknown>)[k] === "string",
  );

function cleanTheme(t: unknown): Theme | null {
  if (!isTheme(t)) return null;
  const hexish = (v: string) => (/^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
  const out: Theme = {
    bg: hexish(t.bg) || FALLBACK.bg,
    ink: hexish(t.ink) || FALLBACK.ink,
    accent: hexish(t.accent) || FALLBACK.accent,
    accent2: hexish(t.accent2) || FALLBACK.accent2,
    font: /^[A-Za-z0-9 -]{1,48}$/.test(t.font) ? t.font : FALLBACK.font,
    name: typeof t.name === "string" ? t.name.slice(0, 40) : null,
    logo:
      typeof t.logo === "string" && t.logo.startsWith("data:image/") && t.logo.length < 6_000_000
        ? t.logo
        : null,
  };
  return out;
}

function cleanAssets(list: unknown): PromptAsset[] {
  if (!Array.isArray(list)) return [];
  const root = assetsDir() + sep;
  return list
    .filter(
      (a): a is PromptAsset =>
        !!a && typeof a === "object" && typeof (a as PromptAsset).path === "string",
    )
    .map((a) => ({
      name: String(a.name || "").slice(0, 120),
      path: resolve(a.path),
      kind:
        a.kind === "logo"
          ? ("logo" as const)
          : a.kind === "video"
            ? ("video" as const)
            : ("image" as const),
      frames: Array.isArray(a.frames)
        ? a.frames
            .map((f) => resolve(String(f)))
            .filter((f) => f.startsWith(root))
            .slice(0, 6)
        : undefined,
    }))
    .filter((a) => a.path.startsWith(root))
    .slice(0, 8);
}

function cleanUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((u): u is string => typeof u === "string" && /^https?:\/\/\S+$/.test(u))
    .map((u) => u.slice(0, 500))
    .slice(0, 6);
}

/** Picked styles (or "Made in this video" pieces) by id, in order. */
function pickedStyles(ids: unknown): MotionStyle[] {
  if (!Array.isArray(ids)) return [];
  const out: MotionStyle[] = [];
  for (const id of ids.slice(0, 12)) {
    if (typeof id !== "string") continue;
    const s = styleById(id) ?? madeById(id.replace(/^made-/, ""))?.style;
    if (s) out.push(s);
  }
  return out;
}

/** Stream a request body to disk, hashing as it goes. */
function saveUpload(req: IncomingMessage, dir: string, limit: number) {
  return new Promise<{ tmp: string; hash: string; bytes: number }>((ok, fail) => {
    const tmp = join(dir, `.upload-${randomBytes(6).toString("hex")}`);
    const out = createWriteStream(tmp);
    const hash = createHash("sha1");
    let bytes = 0;
    let failed = false;
    const stop = (e: Error & { status?: number }) => {
      if (failed) return;
      failed = true;
      out.destroy();
      rmSync(tmp, { force: true });
      fail(e);
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        stop(Object.assign(new Error("That file is too big."), { status: 413 }));
        req.destroy();
        return;
      }
      hash.update(chunk);
    });
    req.on("error", (e) => stop(e));
    out.on("error", (e) => stop(e));
    out.on("finish", () => !failed && ok({ tmp, hash: hash.digest("hex").slice(0, 8), bytes }));
    req.pipe(out);
  });
}

/** Four key frames of a video (10/35/60/85%), so a model can look at it. */
function videoFrames(file: string, dir: string): Promise<string[]> {
  const ffmpeg = findBinary("ffmpeg");
  const ffprobe = findBinary("ffprobe");
  if (!ffmpeg || !ffprobe) return Promise.resolve([]);
  return new Promise((done) => {
    execFile(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { timeout: 15000 },
      async (error, stdout) => {
        const duration = Number(String(stdout).trim());
        if (error || !Number.isFinite(duration) || duration <= 0) return done([]);
        mkdirSync(dir, { recursive: true });
        const frames: string[] = [];
        for (const [i, k] of [0.1, 0.35, 0.6, 0.85].entries()) {
          const out = join(dir, `frame-${i + 1}.jpg`);
          await new Promise<void>((r) =>
            execFile(
              ffmpeg,
              [
                "-loglevel",
                "error",
                "-y",
                "-ss",
                (duration * k).toFixed(2),
                "-i",
                file,
                "-frames:v",
                "1",
                "-vf",
                "scale='min(1280,iw)':-2",
                "-q:v",
                "4",
                out,
              ],
              { timeout: 20000 },
              () => r(),
            ),
          );
          if (existsSync(out)) frames.push(out);
        }
        done(frames);
      },
    );
  });
}

const FRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Motion Library frame</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
</head><body style="margin:0;background:#000">
<script type="module" src="/src/motion/render/frame-page.ts"></script>
</body></html>`;

export function motionStudioPlugin(options: MotionStudioOptions): Plugin {
  const dryRun = () => options.dryRun?.() ?? process.env.MOTION_STUDIO_DRY_RUN === "1";
  // MOTION_STUDIO_IMPROVER=template keeps the improver on the built-in template (no model calls).
  const claude = () =>
    process.env.MOTION_STUDIO_IMPROVER === "template"
      ? null
      : options.claudeBinary
        ? options.claudeBinary()
        : findBinary("claude");
  const codex = () => (options.codexBinary ? options.codexBinary() : findBinary("codex"));

  const routes: Record<
    string,
    (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void
  > = {
    "GET /__motion/frame.html": (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(FRAME_HTML);
    },
    "GET /__motion/status": (_req, res) => {
      send(res, 200, {
        claude: Boolean(claude()),
        claudeCli: Boolean(options.claudeBinary ? options.claudeBinary() : findBinary("claude")),
        codex: Boolean(codex()),
        firecrawl: Boolean(options.firecrawlKey()),
        firecrawlSetup: FIRECRAWL_SETUP,
        chrome: Boolean(findChrome()),
        ffmpeg: Boolean(findBinary("ffmpeg")),
        terminal: process.platform === "darwin",
        dryRun: dryRun(),
        home: tildify(studioHome()),
      });
    },
    "POST /__motion/improve": async (req, res) => {
      const body = await readJson<Record<string, unknown>>(req, 96_000);
      const idea = typeof body.idea === "string" ? body.idea.trim().slice(0, 4000) : "";
      const picked = pickedStyles(body.styleIds);
      if (idea.length < 3 && !picked.length)
        return send(res, 400, { message: "Pick a style or write a few words about your idea." });
      const theme = cleanTheme(body.theme) || STYLES[0].theme;
      const urls = cleanUrls(body.urls);
      const assets = cleanAssets(body.assets);
      const seconds = Math.round(Math.min(60, Math.max(3, Number(body.seconds) || 5)));
      const result = await improve(
        {
          idea,
          theme: { ...theme, logo: null },
          referenceUrl: null,
          referenceImage: null,
          assets,
          branded: body.branded === true,
          picked,
          seconds,
          urls,
        },
        STYLES,
        {
          claude,
          launch: options.launch,
          template: body.engine === "template" || process.env.MOTION_STUDIO_IMPROVER === "template",
        },
      );
      send(res, 200, result);
    },
    "POST /__motion/brand": async (req, res) => {
      const body = await readJson<Record<string, unknown>>(req, 4096);
      try {
        const result = await brandFromUrl(body.url, options.firecrawlKey(), FALLBACK);
        send(res, 200, result);
      } catch (error) {
        if (error instanceof BrandError)
          return send(res, error.status, {
            message: error.message,
            setup: error.setup,
            setupUrl: FIRECRAWL_SETUP,
          });
        throw error;
      }
    },
    "POST /__motion/upload": async (req, res, url) => {
      const type = String(req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const spec = UPLOAD_TYPES[type];
      if (!spec)
        return send(res, 415, {
          message: "Drop an image (PNG, JPG, WebP, GIF, SVG) or a video (MP4, MOV, WebM).",
        });
      const dir = assetsDir();
      mkdirSync(dir, { recursive: true });
      const saved = await saveUpload(req, dir, spec.limit);
      const base = slugify(
        (url.searchParams.get("name") || "file").replace(/\.[a-z0-9]+$/i, ""),
        "asset",
      );
      const path = join(dir, `${base}-${saved.hash}.${spec.ext}`);
      renameSync(saved.tmp, path);
      const frames =
        spec.kind === "video"
          ? await videoFrames(path, join(dir, `${base}-${saved.hash}-frames`))
          : [];
      send(res, 200, {
        path,
        display: tildify(path),
        name: `${base}-${saved.hash}.${spec.ext}`,
        kind: spec.kind,
        bytes: saved.bytes,
        frames,
      });
    },
    "POST /__motion/launch": async (req, res) => {
      const body = await readJson<Record<string, unknown>>(req, 200_000);
      const name = typeof body.name === "string" ? body.name.slice(0, 80) : "motion";
      const tool: Tool = body.tool === "codex" ? "codex" : "claude";
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 60_000) : "";
      if (body.preview) return send(res, 200, { ...planLaunch(name, tool), dryRun: dryRun() });
      if (prompt.trim().length < 20)
        return send(res, 400, { message: "There's no prompt to run yet." });
      try {
        const result = await launch(name, prompt, cleanAssets(body.assets), {
          dryRun: dryRun(),
          tool,
        });
        send(res, 200, result);
      } catch (error) {
        send(res, 500, {
          message: error instanceof Error ? error.message : "Couldn't open Terminal.",
        });
      }
    },
    "POST /__motion/reveal": async (req, res) => {
      const body = await readJson<Record<string, unknown>>(req, 4096);
      const target = typeof body.path === "string" ? resolve(body.path) : "";
      if (!target.startsWith(studioHome() + sep))
        return send(res, 400, { message: "Only Motion Library files can be shown." });
      if (dryRun() || process.platform !== "darwin")
        return send(res, 200, { revealed: false, dryRun: dryRun() });
      execFile("open", ["-R", target], { timeout: 8000 }, () => undefined);
      send(res, 200, { revealed: true });
    },
    "POST /__motion/export": async (req, res, url) => {
      const body = await readJson<Record<string, unknown>>(req, 7_000_000);
      const style = typeof body.style === "string" && styleById(body.style) ? body.style : null;
      const aspect = (["16:9", "9:16", "1:1"] as const).includes(body.aspect as Aspect)
        ? (body.aspect as Aspect)
        : null;
      const seconds = body.seconds === 10 ? 10 : 5;
      if (!style || !aspect) return send(res, 400, { message: "Pick a style and a size." });
      if (!findChrome())
        return send(res, 412, { message: "Export needs Google Chrome installed." });
      if (!findBinary("ffmpeg"))
        return send(res, 412, { message: "Export needs ffmpeg (macOS: brew install ffmpeg)." });
      const host = req.headers.host || url.host;
      const scale = Number(process.env.MOTION_STUDIO_EXPORT_SCALE || 1);
      const job = startExport({
        style,
        theme: cleanTheme(body.theme),
        aspect,
        seconds,
        origin: `http://${host}`,
        scale,
      });
      send(res, 200, job);
    },
    "GET /__motion/export": (_req, res, url) => {
      const job = getJob(url.searchParams.get("id") || "");
      if (!job) return send(res, 404, { message: "No such export." });
      send(res, 200, job);
    },
    "POST /__motion/export/cancel": async (req, res) => {
      const body = await readJson<Record<string, unknown>>(req, 1024);
      send(res, 200, { cancelled: cancelJob(String(body.id || "")) });
    },
  };

  return {
    name: "motion-studio",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (!url.pathname.startsWith("/__motion/")) return next();
        const handler = routes[`${req.method} ${url.pathname}`];
        if (!handler) return send(res, 404, { message: "Not found." });
        if (!isLocalRequest(req)) return send(res, 403, { message: "Local requests only." });
        Promise.resolve(handler(req, res, url)).catch((error: Error & { status?: number }) => {
          if (res.headersSent) return;
          send(res, error.status || 500, { message: error.message || "Something went wrong." });
        });
      });
    },
  };
}
