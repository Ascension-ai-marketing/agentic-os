import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import type { ViteDevServer } from "vite";
import { createInboxSorter } from "./jev-inbox";
import { jevJson, readJevJson } from "./jev-routes";
import { brainEnabled } from "../src/lib/brain-sources";
import { readBrainPreferences } from "./brain-preferences";
export function installJevInboxRoutes(server: ViteDevServer, options: { root: string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  const sorter = createInboxSorter(options.root); let busy = false;
  server.middlewares.use("/__jev/inbox", async (req, res) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    let ownsBatch = false;
    try {
      if (req.method === "GET") return jevJson(res, sorter.labels());
      if (req.method !== "POST") return jevJson(res, { error: "Method not allowed" }, 405);
      if (busy) return jevJson(res, { error: "An inbox sort is already running" }, 409);
      const body = await readJevJson(req);
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some((id: unknown) => typeof id !== "string")) throw new Error("Choose 1 to 500 saved messages");
      const data = JSON.parse(readFileSync(join(options.root, ".operator-data/workspace.json"), "utf8"));
      // The mail switch in Memory sources is "email" (for Gmail and Outlook alike).
      const emailOn = () => brainEnabled({ brainSources: readBrainPreferences(options.root, data).brainSources }, "email");
      if (!emailOn()) throw new Error("Email is switched off in Memory sources");
      const messages = (data.inbox ?? []).filter((m: any) => body.ids.includes(m.id) && ["gmail", "outlook"].includes(m.source));
      if (!messages.length) throw new Error("No selected mail is available from enabled sources");
      busy = true; ownsBatch = true;
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const start = performance.now(); let costUsd = 0, count = 0;
      for (const message of messages) {
        if (res.destroyed || !emailOn()) break;
        const cached = sorter.labels().find(r => r.messageId === message.id);
        const row = await sorter.sort(message); count++; if (cached?.decision.id !== row.decision.id) costUsd += row.decision.costUsd;
        if (!res.destroyed) res.write(JSON.stringify({ row, stats: { count, total: messages.length, ms: Math.round(performance.now() - start), costUsd } }) + "\n");
      }
      res.end();
    } catch (e) {
      const raw = e instanceof Error ? e.message : ""; const error = /^(Jev HTTP|Invalid |Choose |No selected|Saved inbox|OPENROUTER_API_KEY)/.test(raw) ? raw : "Inbox sorting unavailable";
      if (res.headersSent) res.end(JSON.stringify({ error }) + "\n"); else jevJson(res, { error }, 400);
    } finally { if (ownsBatch) busy = false; }
  });
}
