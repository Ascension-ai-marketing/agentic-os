import { businessBrief } from "./business-brief";
import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import { createVoiceBackend, isAuthError } from "./jev-voice";
import { createOsAssistant } from "./os-assistant";
import { briefAllowed } from "./brain-preferences";
import { jevJson, readJevJson } from "./jev-routes";
import { transcribeVoice } from "./voice-stt";
import { providerKey } from "./provider-config";
export function installJevVoiceRoutes(server: ViteDevServer, options: { root: string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  async function local(path: string, body?: unknown) {
    const address = server.httpServer?.address(); const port = typeof address === "object" && address ? address.port : server.config.server.port;
    const r = await fetch(`http://127.0.0.1:${port}/__operator${path}`, { method: body ? "POST" : "GET", headers: { "x-claude-os-token": options.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error("Local context or agent jobs unavailable"); return r.json();
  }
  // What the agents can run right now, so Jev's model pick maps to a real id.
  async function catalog() {
    const address = server.httpServer?.address(); const port = typeof address === "object" && address ? address.port : server.config.server.port;
    const out: { name: string; provider?: string }[] = [];
    const [claude, live] = await Promise.all([fetch(`http://127.0.0.1:${port}/__claude_models`).then(r => r.json()).catch(() => null), fetch(`http://127.0.0.1:${port}/__operator/models`).then(r => r.json()).catch(() => null)]);
    for (const g of Array.isArray(claude?.catalog) ? claude.catalog : []) for (const m of g.models ?? []) out.push({ name: m.name, provider: g.provider });
    for (const m of Array.isArray(live?.models) ? live.models : []) if (m?.backend === "claude") out.push({ name: m.name, provider: m.provider });
    return out;
  }
  // Signed in per agent: the CLI's own check, overridden by an auth failure in the last 15 minutes
  // (an expired OAuth session can still report as logged in).
  async function agentStatus() {
    const [status, jobs] = await Promise.all([local("/agent-jobs/status").catch(() => null), local("/agent-jobs").catch(() => null)]);
    const out: { claude?: boolean; codex?: boolean } = {};
    for (const a of status?.agents ?? []) if (a.id === "claude" || a.id === "codex") out[a.id as "claude"] = a.installed !== false && a.signedIn !== false;
    const recent = Date.now() - 15 * 60e3;
    for (const job of jobs?.jobs ?? []) for (const run of job.runs ?? [])
      if (run.status === "failed" && Date.parse(job.updatedAt) > recent && isAuthError(run.error)) out[run.agent as "claude"] = false;
    return out;
  }
  const raw = async (path: string) => {
    const address = server.httpServer?.address(); const port = typeof address === "object" && address ? address.port : server.config.server.port;
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "x-claude-os-token": options.token } }); if (!r.ok) throw new Error("Local route unavailable"); return r.json();
  };
  const os = createOsAssistant({ root: options.root, key: (name) => providerKey(options.root, name), local, raw });
  const voice = createVoiceBackend({ root: options.root, catalog, agentStatus, osAsk: async (text) => { let costUsd: number | null = null; const r = await os.ask({ text, voice: true }, (e) => { if (e.type === "done") costUsd = e.costUsd; }); return { ...r, costUsd }; }, context: async query => ({ memory: await local(`/search?q=${encodeURIComponent(query)}&limit=6`), savedBrief: briefAllowed(options.root) ? JSON.stringify(businessBrief(options.root).read().latest).slice(0, 12000) : "Not shared: a Memory source is switched off." }), startJob: body => local("/agent-jobs", body), continueJob: body => local("/agent-jobs/continue", body) });
  const activeTaskOf = (v: any) => v && typeof v === "object" && ["claude", "codex"].includes(v.agent) && typeof v.prompt === "string" ? { agent: v.agent, prompt: v.prompt.slice(0, 2000), ...(typeof v.jobId === "string" && /^[A-Za-z0-9-]{1,80}$/.test(v.jobId) ? { jobId: v.jobId } : {}) } : undefined;
  const handler = async (req: IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/voices" && req.method === "GET") return jevJson(res, await voice.voices());
      if (path === "/stt" && req.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) throw new Error("Audio exceeds 12 MB"); chunks.push(Buffer.from(chunk)); }
        const fishKey = providerKey(options.root, "FISH_API_KEY");
        return jevJson(res, await transcribeVoice(Buffer.concat(chunks), { key: providerKey(options.root, "OPENAI_API_KEY"), fishKey: fishKey?.startsWith("sk-fish") || fishKey ? fishKey : undefined, contentType: req.headers["content-type"], timings: !fishKey }));
      }
      if (req.method !== "POST") return next();
      const body = await readJevJson(req, 30_000);
      if (path === "/route") return jevJson(res, await voice.route(body.text, { confirm: body.confirm === true, force: body.force === "tier-2" ? "tier-2" : undefined, cast: body.cast === true, activeTask: activeTaskOf(body.activeTask) }));
      // Chat: the same executor decision, with no action taken. Chat opens the page or starts the task itself.
      // Chat's OS assistant, streamed as server-sent events: tool, chunk, action, done, error.
      if (path === "/ask") {
        res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-store");
        const send = (event: string, data: unknown) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client left */ } };
        const controller = new AbortController(); req.on("close", () => controller.abort());
        try {
          const history = Array.isArray(body.history) ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string").slice(-8) : [];
          await os.ask({ text: body.text, history, chatModel: typeof body.chatModel === "string" ? body.chatModel.slice(0, 120) : undefined, page: typeof body.page === "string" ? body.page.slice(0, 60) : undefined, personality: body.personality }, (e) => send(e.type, e), controller.signal);
        } catch (e) { send("error", { type: "error", message: e instanceof Error && /^(OS assistant HTTP \d+|OPENROUTER_API_KEY is missing|Ask something)$/.test(e.message) ? e.message : "The OS assistant is unavailable" }); }
        res.end(); return;
      }
      // Live voice: one OS lookup, called straight from the realtime model's tool call.
      if (path === "/tool") {
        const name = String(body.name ?? "");
        const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
        if (name === "web_search" || name === "search_email" || name === "search_memory") args.query = String(args.query ?? "").slice(0, 300);
        return jevJson(res, { result: await os.lookup(name, args) });
      }
      if (path === "/agents") return jevJson(res, await agentStatus());
      if (path === "/task") return jevJson(res, await voice.decideTask(body.text, { ...(body.agent === "codex" || body.agent === "claude" ? { agent: body.agent } : {}), confirm: body.confirm === true, activeTask: activeTaskOf(body.activeTask), chatModel: typeof body.chatModel === "string" ? body.chatModel.slice(0, 80) : undefined }));
      if (path === "/speak-warm") { void voice.warm(); return jevJson(res, { ok: true }); }
      if (path === "/speak-stream") {
        const controller = new AbortController(); req.on("close", () => controller.abort());
        const stream = await voice.speakStream(body.text, body.voiceId, { speed: typeof body.speed === "number" ? body.speed : undefined, signal: controller.signal });
        res.setHeader("Content-Type", "audio/L16; rate=24000; channels=1"); res.setHeader("Cache-Control", "no-store");
        const reader = stream.getReader();
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); } } catch { /* the listener interrupted */ }
        res.end(); return;
      }
      if (path === "/speak" || path === "/") {
        const audio = await voice.speak(body.text, body.voiceId ?? body.voice, { tone: typeof body.tone === "string" ? body.tone : undefined, speed: typeof body.speed === "number" ? body.speed : undefined }); res.setHeader("Content-Type", "audio/mpeg"); res.setHeader("Cache-Control", "no-store"); res.end(audio); return;
      }
      next();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // Fish refusing the key (401/403) or the credit (402) keeps its code, so the app can say which.
      const fishCode = Number(message.match(/^Fish .* HTTP (40[123])$/)?.[1]) || 0;
      jevJson(res, { error: /^(Choose |Speech requires|Fish .* HTTP|Fish transcription|FISH_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|Voice .* HTTP|Audio |A voice request|Local context|Local context or agent jobs)/.test(message) ? message : "Voice request unavailable" }, fishCode || (/FISH_API_KEY is missing/.test(message) ? 401 : 400));
    }
  };
  server.middlewares.use("/__voice", handler);
  server.middlewares.use("/__fish_tts", handler);
}
