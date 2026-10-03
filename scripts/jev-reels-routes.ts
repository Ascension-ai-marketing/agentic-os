import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import { createReelsService, reelsReferenceDir } from "./jev-reels";
import { createReelsAudio } from "./jev-reels-audio";
import { providerKey } from "./provider-config";
import { jevJson, readJevJson } from "./jev-routes";
export function installJevReelsRoutes(server: ViteDevServer, options: { root: string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  const service = createReelsService(options.root);
  // The audio pipeline on the example reel: Fish ASR + TTS, local SFX and mix.
  const audio = createReelsAudio({ root: options.root, reference: reelsReferenceDir(), sections: () => service.demo().sections, fishKey: () => providerKey(options.root, "FISH_API_KEY") });
  server.middlewares.use("/__reels", async (req, res) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    try {
      const url = new URL(req.url ?? "/", "http://localhost"); const id = url.searchParams.get("id") ?? "";
      if (req.method === "GET") {
        if (url.pathname === "/styles") return jevJson(res, service.styles.list());
        if (url.pathname === "/audio/status") return jevJson(res, audio.status());
        if (url.pathname === "/audio/sfx") return jevJson(res, await audio.sfxLibrary());
        if (url.pathname === "/audio/file") { const f = audio.file(url.searchParams.get("name") ?? ""); res.writeHead(200, { "Content-Type": f.type, "Content-Length": f.bytes, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); f.stream.on("error", () => res.destroy()); f.stream.pipe(res); return; }
        if (url.pathname === "/projects") return jevJson(res, service.list());
        if (url.pathname === "/demo") return jevJson(res, service.demo());
        if (url.pathname === "/status") return jevJson(res, id ? service.get(id) : service.toolsStatus());
        if (url.pathname === "/estimate") return jevJson(res, service.quote(id));
        if (url.pathname === "/media") { const media = service.media(id, url.searchParams.get("file") ?? ""); res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": media.bytes, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); media.stream.on("error", () => res.destroy()); media.stream.pipe(res); return; }
      }
      if (req.method === "POST" && url.pathname === "/audio/run") { const body = await readJevJson(req).catch(() => ({})); return jevJson(res, audio.start(body?.toggles), 202); }
      if (req.method === "POST" && url.pathname === "/audio/mix") { const body = await readJevJson(req).catch(() => ({})); return jevJson(res, audio.remix(body?.toggles), 202); }
      if (req.method === "POST" && url.pathname === "/styles/randomize") return jevJson(res, service.styles.randomize());
      if (req.method === "POST" && url.pathname === "/styles") return jevJson(res, service.styles.save(await readJevJson(req)), 201);
      if (req.method === "POST" && url.pathname === "/upload") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 250 * 1024 * 1024) throw new Error("Choose an MP4 or MOV under 250 MB"); chunks.push(Buffer.from(chunk)); }
        return jevJson(res, await service.upload(Buffer.concat(chunks), url.searchParams.get("name") ?? ""), 201);
      }
      if (req.method === "POST" && url.pathname === "/build") { const body = await readJevJson(req); return jevJson(res, service.start(body.id, body), 202); }
      if (req.method === "POST" && url.pathname === "/prepare") { const body = await readJevJson(req); return jevJson(res, service.prepare(body.id, body), 202); }
      if (req.method === "PATCH" && url.pathname === "/project") { const body = await readJevJson(req); return jevJson(res, service.update(body.id, body)); }
      if (req.method === "POST" && url.pathname === "/export") { const body = await readJevJson(req); return jevJson(res, service.exportPicks(body.id), 202); }
      jevJson(res, { error: "Unknown Reels endpoint" }, 404);
    } catch (e) { const message = e instanceof Error ? e.message : ""; jevJson(res, { error: /^(Invalid |Choose |Review |A reel |Build needs|Opus |This reel|ffprobe|ffmpeg|FISH_API_KEY)/.test(message) ? message : "Reels data is unavailable. Check the reference folder or uploaded project." }, 400); }
  });
}
