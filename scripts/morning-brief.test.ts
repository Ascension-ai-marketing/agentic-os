import { expect, test } from "bun:test";
import { morningBriefOptions, refreshMorningBrief } from "./morning-brief";

const instant = new Date("2026-09-17T05:00:00Z");
const report = { id: "saved-brief", date: "2026-09-17", timezone: "Europe/Vienna", updatedAt: instant.toISOString(), priorities: ["PRIVATE PRIORITY"], recommendations: [{ title: "PRIVATE RECOMMENDATION" }] };

test("runner restricts tokens and writes to a loopback origin", () => {
  expect(morningBriefOptions([])).toEqual({ baseUrl: "http://127.0.0.1:8081", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  for (const url of ["https://example.com", "http://localhost.evil.test", "http://user:pass@localhost", "http://localhost/path", "http://localhost?redirect=example.com"]) expect(() => morningBriefOptions(["--base-url", url])).toThrow();
  expect(() => morningBriefOptions(["--timezone", "Mars/Sea"])).toThrow();
  expect(() => morningBriefOptions(["--unknown", "yes"])).toThrow();
});

test("runner verifies persistence and prints only a compact receipt", async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const request = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    if (url.endsWith("/__token")) return Response.json({ token: "private-test-token" });
    if (url.endsWith("/today")) return Response.json({ weather: { temperatureC: 20 }, news: [{}, {}, {}] });
    return Response.json({ latest: report, schedule: { enabled: true, hour: 7, minute: 0, timezone: "Europe/Vienna" } });
  }) as typeof fetch;
  const result = await refreshMorningBrief(morningBriefOptions(["--timezone", "Europe/Vienna"]), { request, now: () => instant });
  expect(result).toMatchObject({ saved: true, date: "2026-09-17", priorities: 1, recommendations: 1, weather: "available", newsArticles: 3 });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).not.toContain("private-test-token");
  expect(calls[1].options).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ timezone: "Europe/Vienna" }) });
  expect(calls[2].url).toEndWith("/business/brief");
  expect(calls.filter(call => call.options?.method === "POST")).toHaveLength(1);
});

test("runner rejects an unchanged report instead of claiming a refresh", async () => {
  const request = (async (url: string) => Response.json(url.endsWith("/__token") ? { token: "private-test-token" } : { latest: { ...report, updatedAt: "2026-09-16T05:00:00Z" } })) as typeof fetch;
  await expect(refreshMorningBrief(morningBriefOptions(["--timezone", "Europe/Vienna"]), { request, now: () => instant })).rejects.toThrow("could not be verified");
});

test("independent public feed failure keeps a verified report", async () => {
  const request = (async (url: string) => url.endsWith("/today") ? new Response("private backend error", { status: 500 }) : Response.json(url.endsWith("/__token") ? { token: "private-test-token" } : { latest: report })) as typeof fetch;
  const result = await refreshMorningBrief(morningBriefOptions(["--timezone", "Europe/Vienna"]), { request, now: () => instant });
  expect(result).toMatchObject({ saved: true, weather: "unavailable", newsArticles: 0 });
});
