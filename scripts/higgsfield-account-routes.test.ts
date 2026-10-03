import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { installHiggsfieldAccountRoutes } from "./higgsfield-account-routes";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture() {
  const calls: string[] = [];
  let connected = false;
  let handler: any;
  const account = {
    status: () => ({connected, requiresSignIn: !connected}),
    begin: async (redirect: string) => {calls.push(`begin:${redirect}`); return {authorizationUrl: "https://clerk.higgsfield.ai/oauth/authorize?state=fixture", expiresAt: Date.now() + 60_000};},
    complete: async (code: string, state: string) => {if (code !== "good" || state !== "fixture") throw new Error("provider-secret-not-for-html"); connected = true;},
    disconnect: async () => {calls.push("disconnect"); connected = false;},
    estimate: async () => {calls.push("estimate"); return {credits: 1.5, creditsExact: 1.5};},
  };
  installHiggsfieldAccountRoutes((_path, callback) => {handler = callback;}, account as any, {token: "fixture-token", port: 8081, isLoopback: (req) => req.headers.host?.startsWith("127.0.0.1:") ?? false});
  const server = createServer((req, res) => handler(req, res, () => {res.statusCode = 404; res.end();}));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port missing");
  return {base: `http://127.0.0.1:${address.port}`, calls};
}

describe("Higgsfield app-owned account endpoints", () => {
  test("requires loopback host and OS token before any account mutation", async () => {
    const {base, calls} = await fixture();
    expect((await fetch(`${base}/connect`, {method: "POST"})).status).toBe(403);
    expect((await fetch(`${base}/status`, {headers: {host: "attacker.example"}})).status).toBe(403);
    expect(calls).toEqual([]);
    const response = await fetch(`${base}/connect`, {method: "POST", headers: {"X-Claude-OS-Token": "fixture-token"}});
    expect(response.status).toBe(200);
    expect(calls).toEqual(["begin:http://127.0.0.1:8081/__design_higgsfield_account/callback"]);
  });
  test("OAuth callback conceals provider errors and safely completes the app's grant", async () => {
    const {base} = await fixture();
    const bad = await fetch(`${base}/callback?code=bad&state=fixture`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("provider-secret");
    expect(bad.headers.get("referrer-policy")).toBe("no-referrer");
    const good = await fetch(`${base}/callback?code=good&state=fixture`);
    expect(good.status).toBe(200);
    expect(good.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await (await fetch(`${base}/status`)).json()).connected).toBe(true);
  });
  test("quotes one image and rejects oversized requests before provider calls", async () => {
    const {base, calls} = await fixture();
    const headers = {"X-Claude-OS-Token": "fixture-token", "Content-Type": "application/json"};
    expect((await fetch(`${base}/estimate`, {method: "POST", headers, body: JSON.stringify({count: 8})})).status).toBe(400);
    expect((await fetch(`${base}/estimate`, {method: "POST", headers, body: "x".repeat(9000)})).status).toBe(413);
    expect(calls).toEqual([]);
    const quote = await fetch(`${base}/estimate`, {method: "POST", headers, body: JSON.stringify({count: 1, params: {resolution: "1k"}})});
    expect((await quote.json()).creditsExact).toBe(1.5);
    expect(calls).toEqual(["estimate"]);
  });
});
