import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { jevEngine } from "./jev";

export async function readJevJson(req: IncomingMessage, max = 250_000): Promise<any> {
  let body = ""; let bytes = 0;
  for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > max) throw new Error("Request too large"); body += chunk; }
  return JSON.parse(body || "{}");
}
export function jevJson(res: ServerResponse, data: unknown, status = 200) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(data)); }
export function installJevRoutes(server: ViteDevServer, options: { root: string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  const engine = jevEngine(options.root);
  server.middlewares.use("/__jev", async (req, res, next) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/decide" && req.method === "POST") return jevJson(res, await engine.decide(await readJevJson(req)));
      if (url.pathname === "/log" && req.method === "GET") return jevJson(res, engine.log(url.searchParams.get("surface") ?? undefined, Number(url.searchParams.get("limit") ?? 100)));
      if (url.pathname === "/savings" && req.method === "GET") return jevJson(res, engine.savings());
      if (url.pathname === "/health" && req.method === "GET") return jevJson(res, engine.health());
      if (url.pathname === "/stream" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": connected\n\n");
        const unsubscribe = engine.subscribe(d => { if (!res.write(`data: ${JSON.stringify(d)}\n\n`)) res.end(); });
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
        res.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
        return;
      }
      next();
    } catch { jevJson(res, { error: "Invalid or oversized Jev request" }, 400); }
  });
}
