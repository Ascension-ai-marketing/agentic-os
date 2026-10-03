import type { IncomingMessage, ServerResponse } from "node:http";
import type { createHiggsfieldMcp } from "./higgsfield-mcp";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
type Account = ReturnType<typeof createHiggsfieldMcp>;

export function installHiggsfieldAccountRoutes(
  use: (path: string, middleware: Middleware) => void,
  account: Account,
  options: {token: string; port: number; isLoopback: (req: IncomingMessage) => boolean},
) {
  const prefix = "/__design_higgsfield_account";
  const redirectUri = `http://127.0.0.1:${options.port}${prefix}/callback`;
  use(prefix, (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = url.pathname;
    if (!["/status", "/connect", "/callback", "/disconnect", "/estimate"].includes(route)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const json = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (!options.isLoopback(req)) return json(403, {ok: false, error: "Loopback only"});
    if (route === "/status" && req.method === "GET")
      return json(200, {ok: true, ...account.status()});
    if (route === "/callback" && req.method === "GET") {
      void (async () => {
        let success = false;
        try {
          if (url.searchParams.has("error")) throw new Error("Higgsfield sign-in was not completed");
          await account.complete(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "", redirectUri);
          success = true;
        } catch {
          // Do not echo provider codes or credential-bearing URLs into an HTML document.
        }
        res.statusCode = success ? 200 : 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Higgsfield connection</title></head><body style="margin:0;background:#101016;color:#efebff;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="padding:32px;max-width:420px"><h1>${success ? "Higgsfield connected." : "Sign-in wasn't completed."}</h1><p>${success ? "Nano Banana 2 is ready to select in Design. You can close this window." : "Return to Design and connect again to start a fresh sign-in."}</p><a style="color:#c6b5ff" href="/design">Return to Design</a></main></body></html>`);
      })();
      return;
    }
    if (req.method !== "POST") return json(405, {ok: false, error: "Method not allowed"});
    if (req.headers["x-claude-os-token"] !== options.token)
      return json(403, {ok: false, error: "Forbidden"});
    void (async () => {
      try {
        if (route === "/connect") {
          req.resume();
          return json(200, {ok: true, ...await account.begin(redirectUri)});
        }
        if (route === "/disconnect") {
          req.resume();
          await account.disconnect();
          return json(200, {ok: true});
        }
        if (route === "/estimate") {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 8192) return json(413, {ok: false, error: "Request too large"});
          }
          const data = JSON.parse(body || "{}");
          if (data.count !== undefined && data.count !== 1)
            return json(400, {ok: false, error: "Quote one image at a time"});
          const estimate = await account.estimate({params: data.params, count: 1});
          return json(200, {ok: true, ...estimate});
        }
        return json(404, {ok: false, error: "Not found"});
      } catch (error) {
        return json(400, {ok: false, error: error instanceof Error ? error.message : "Higgsfield connection failed"});
      }
    })();
  });
}
