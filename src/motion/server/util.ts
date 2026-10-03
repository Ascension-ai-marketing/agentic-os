/** Small Node helpers for the Motion Library server: paths, binaries, requests. */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Where projects, assets and exports live (override with MOTION_STUDIO_HOME). */
export function studioHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.MOTION_STUDIO_HOME || join(homedir(), "motion-studio-projects");
}
export const exportsDir = (env?: NodeJS.ProcessEnv) => join(studioHome(env), "exports");
export const assetsDir = (env?: NodeJS.ProcessEnv) => join(studioHome(env), "assets");

/** ~/… form of a path, for showing people. */
export function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home + "/") || path === home ? "~" + path.slice(home.length) : path;
}

export function slugify(text: string, fallback = "motion"): string {
  const slug = (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** First free "<slug>", "<slug>-2", … inside base. */
export function uniqueChild(base: string, slug: string): string {
  if (!existsSync(join(base, slug))) return join(base, slug);
  for (let i = 2; i < 1000; i++)
    if (!existsSync(join(base, `${slug}-${i}`))) return join(base, `${slug}-${i}`);
  return join(base, `${slug}-${Date.now()}`);
}

const executable = (p: string) => {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Find a CLI on PATH or in the usual per-user folders. */
export function findBinary(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const home = homedir();
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const dirs = [
    ...(env.PATH || "").split(delimiter),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].filter(Boolean);
  for (const dir of dirs) for (const n of names) if (executable(join(dir, n))) return join(dir, n);
  return null;
}

// ── requests ─────────────────────────────────────────────────────────────
export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Local, same-origin requests only (the same rule as the Website tab). */
export function isLocalRequest(req: IncomingMessage): boolean {
  const host = req.headers.host || "";
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== `http://${host}` &&
    origin !== `http://${host.replace("127.0.0.1", "localhost")}` &&
    origin !== `http://${host.replace("localhost", "127.0.0.1")}`
  )
    return false;
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(String(site))) return false;
  return true;
}

export function readJson<T = Record<string, unknown>>(
  req: IncomingMessage,
  limit: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      reject(Object.assign(new Error("JSON is required."), { status: 415 }));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T);
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}
