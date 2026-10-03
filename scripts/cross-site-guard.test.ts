import { expect, test } from "bun:test";
import { crossSiteBlocked } from "./cross-site-guard";

const req = (url: string, headers: Record<string, string> = {}, method = "POST") => ({ url, method, headers: { host: "localhost:8081", ...headers } });

test("the app's own pages and local tools reach the API", () => {
  expect(crossSiteBlocked(req("/__chat_title", { origin: "http://localhost:8081", "sec-fetch-site": "same-origin" }))).toBeNull();
  expect(crossSiteBlocked(req("/__voice/speak"))).toBeNull();
  expect(crossSiteBlocked(req("/__token", { "sec-fetch-site": "none" }, "GET"))).toBeNull();
  expect(crossSiteBlocked(req("/src/data/live-data.json?import", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }, "GET"))).toBeNull();
});

test("another website or local port cannot write to a local API route", () => {
  expect(crossSiteBlocked(req("/__chat_title", { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" }))).toContain("Cross-site");
  expect(crossSiteBlocked(req("/__operator/missions", { origin: "https://evil.example" }))).not.toBeNull();
  expect(crossSiteBlocked(req("/__open_url", { origin: "http://localhost:9999" }))).not.toBeNull();
  expect(crossSiteBlocked(req("/__open_url", { origin: "https://localhost:8081" }))).not.toBeNull();
  expect(crossSiteBlocked(req("/__open_url", { "sec-fetch-site": "same-site" }))).not.toBeNull();
  expect(crossSiteBlocked(req("/__jev/decide", { origin: "null" }))).not.toBeNull();
  expect(crossSiteBlocked(req("/_serverFn/x", { origin: "https://evil.example" }))).not.toBeNull();
});

test("another site cannot read API answers or the generated live data", () => {
  expect(crossSiteBlocked(req("/__token", { origin: "http://localhost:5173", "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }, "GET"))).toContain("read");
  expect(crossSiteBlocked(req("/src/data/live-data.json", { origin: "http://localhost:5173", "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }, "GET"))).toContain("read");
  expect(crossSiteBlocked(req("/src/data/live-data.json", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }, "GET"))).toContain("read");
});

test("sign-in callbacks and sandboxed preview assets still load", () => {
  expect(crossSiteBlocked(req("/__operator/connections/callback/google?code=x&state=y", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }, "GET"))).toBeNull();
  expect(crossSiteBlocked(req("/__design_higgsfield_account/callback?code=x", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }, "GET"))).toBeNull();
  expect(crossSiteBlocked(req("/__design_file?path=a.png", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" }, "GET"))).toBeNull();
});

test("a rebound hostname is refused (DNS rebinding)", () => {
  expect(crossSiteBlocked({ url: "/__token", method: "GET", headers: { host: "attacker.example:8081" } })).toContain("host");
  expect(crossSiteBlocked({ url: "/__token", method: "GET", headers: { host: "localhost.attacker.example" } })).toContain("host");
});

test("pages and assets are not affected", () => {
  expect(crossSiteBlocked(req("/memory", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, "GET"))).toBeNull();
  expect(crossSiteBlocked(req("/brand-logos/fish.svg", { "sec-fetch-site": "cross-site" }, "GET"))).toBeNull();
});
