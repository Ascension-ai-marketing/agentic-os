import type { Plugin } from "vite";
import type { IncomingMessage } from "node:http";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Sign-in providers send the browser back here from their own site; each route checks its own state. */
const OAUTH_CALLBACKS = new Set(["/__operator/connections/callback/google", "/__operator/connections/callback/outlook", "/__design_higgsfield_account/callback"]);

/** Generated private data that the app reads same-origin only. */
const PRIVATE_FILES = /^\/(?:src\/data\/live-data\.json|@fs\/)/;

function hostnameOf(host: string) {
  const raw = host.toLowerCase();
  if (raw.startsWith("[")) return raw.slice(1, raw.indexOf("]"));
  return raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
}

/**
 * Every local API route (`/__…`, TanStack server functions) and the generated
 * live data belong to the app's own pages. Another site, or another local
 * server on a different port, must never reach them: it could start agent jobs,
 * spend API credit, open links or read memory.
 *
 * - The Host must be a loopback name (no DNS rebinding).
 * - Writes (anything but GET/HEAD) must come from this exact origin.
 * - Reads a page could see (fetch/XHR, `sec-fetch-mode: cors`) must too.
 * - A cross-site GET that cannot read the answer (an image, a style, a link
 *   followed) is left to each route's own checks, so sandboxed previews and
 *   sign-in callbacks keep working.
 * Tools on this computer (no Origin, no Fetch Metadata) are not browsers and pass;
 * routes keep their own loopback and token checks on top of this.
 */
export function crossSiteBlocked(req: Pick<IncomingMessage, "url" | "method" | "headers">): string | null {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  const api = path.startsWith("/__") || path.startsWith("/_serverFn");
  if (!api && !PRIVATE_FILES.test(path)) return null;
  const host = String(req.headers.host ?? "");
  if (host && !LOOPBACK_HOSTS.has(hostnameOf(host))) return "Unknown host";
  const method = (req.method || "GET").toUpperCase();
  const read = method === "GET" || method === "HEAD";
  if (read && OAUTH_CALLBACKS.has(path)) return null;
  const site = String(req.headers["sec-fetch-site"] ?? "");
  const mode = String(req.headers["sec-fetch-mode"] ?? "");
  const origin = req.headers.origin;
  const ownOrigin = (o: string) => {
    try {
      const u = new URL(o);
      return u.protocol === "http:" && LOOPBACK_HOSTS.has(hostnameOf(u.host)) && (!host || u.host.toLowerCase() === host.toLowerCase());
    } catch {
      return false;
    }
  };
  const foreign = (site && site !== "same-origin" && site !== "none") || (origin !== undefined && (origin === "null" || !ownOrigin(String(origin))));
  if (!foreign) return null;
  if (!read) return "Cross-site request";
  if (mode === "cors" || mode === "websocket" || PRIVATE_FILES.test(path)) return "Cross-site read";
  return null;
}

export function crossSiteGuard(): Plugin {
  return {
    name: "agentic-cross-site-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reason = crossSiteBlocked(req);
        if (!reason) return next();
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: `${reason}: local API routes only answer this app's own pages` }));
      });
    },
  };
}
