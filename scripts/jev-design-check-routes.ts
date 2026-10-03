import type { IncomingMessage } from "node:http";
import type { ViteDevServer } from "vite";
import { createDesignChecker, readDesignCheckHtml } from "./jev-design-check";
import { jevJson, readJevJson } from "./jev-routes";

export function installJevDesignCheckRoutes(server: ViteDevServer, options: { root: string; directory: () => string; token: string; isLoopback: (req: IncomingMessage) => boolean }) {
  const checker = createDesignChecker(options.root, id => readDesignCheckHtml(options.directory(), id));
  server.middlewares.use("/__jev/design-check", async (req, res) => {
    if (!options.isLoopback(req) || req.headers["x-claude-os-token"] !== options.token) return jevJson(res, { error: "Local workspace token required" }, 403);
    try {
      if (req.method === "GET") {
        const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("projectId") ?? "";
        return jevJson(res, { decision: checker.cached(id) });
      }
      if (req.method === "POST") {
        const body = await readJevJson(req, 1000);
        if (typeof body.projectId !== "string") return jevJson(res, { error: "Choose a Design creation" }, 400);
        return jevJson(res, { decision: await checker.check(body.projectId) });
      }
      jevJson(res, { error: "Method not allowed" }, 405);
    } catch { jevJson(res, { error: "The Design HTML is unavailable, outside the design wall, or larger than 2 MB" }, 400); }
  });
}
