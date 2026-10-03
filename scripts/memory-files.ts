import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";

/** Files the OS made for you (fact sheets, one-pagers) live here: private, never in git or the community zip. */
export const memoryFilesDir = (root: string) => join(root, ".operator-data", "memory-files");

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };

/** A plain file name inside the memory files folder, or null. */
export function memoryFilePath(root: string, name: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) || name.includes("..") || !TYPES[extname(name).toLowerCase()]) return null;
  const dir = memoryFilesDir(root);
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  const real = realpathSync(file);
  // Inside the folder on every platform (Windows paths use backslashes).
  const rel = relative(realpathSync(dir), real);
  const inside = !!rel && !rel.startsWith("..") && !isAbsolute(rel);
  return inside && statSync(real).isFile() ? real : null;
}

/** GET /__memory_file/<name>: opens a saved OS file (for Memory's "open original"). Static only: no scripts run. */
export function installMemoryFileRoute(server: ViteDevServer, options: { root: string; isLoopback: (req: IncomingMessage) => boolean }) {
  server.middlewares.use("/__memory_file", (req, res) => {
    if (!options.isLoopback(req) || (req.method !== "GET" && req.method !== "HEAD")) {
      res.statusCode = 403;
      return res.end();
    }
    const name = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname.replace(/^\//, ""));
    const file = memoryFilePath(options.root, name);
    if (!file) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()]);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Pictures and styles inside the page load; scripts never run.
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:");
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
}
