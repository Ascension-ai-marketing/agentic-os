/** Refresh the saved morning report through the running local OS, without printing its contents. */
import { pathToFileURL } from "node:url";

export function morningBriefOptions(args: string[]) {
  const options = { baseUrl: "http://127.0.0.1:8081", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || !["--base-url", "--timezone"].includes(flag)) throw new Error("Use --base-url and/or --timezone followed by a value.");
    if (flag === "--base-url") options.baseUrl = value;
    else options.timezone = value;
  }
  const url = new URL(options.baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The morning brief runner only connects to the local OS on a loopback HTTP address.");
  }
  new Intl.DateTimeFormat("en-CA", { timeZone: options.timezone }).format();
  return { ...options, baseUrl: url.origin };
}

async function readJson(response: Response) {
  if (!response.ok || !response.body) throw new Error(`The local OS returned HTTP ${response.status}. Open the Dashboard and check the brief's connection status.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512 * 1024) throw new Error("The local response exceeded its size limit.");
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed?.error) throw new Error("The local OS could not refresh the brief. Check the configured assistant in Settings; the saved report was preserved.");
    return parsed;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

function localDate(timezone: string, date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function refreshMorningBrief(
  input: { baseUrl: string; timezone: string },
  dependencies: { request?: typeof fetch; now?: () => Date } = {},
) {
  const options = morningBriefOptions(["--base-url", input.baseUrl, "--timezone", input.timezone]);
  const request = dependencies.request || fetch, now = dependencies.now || (() => new Date());
  const startedAt = now();
  const get = (path: string) => request(`${options.baseUrl}${path}`, { redirect: "error", signal: AbortSignal.timeout(20000) }).then(readJson);
  const { token } = await get("/__token");
  if (typeof token !== "string" || token.length < 8 || token.length > 512) throw new Error("The local OS did not provide a valid request token.");
  const generated = await request(`${options.baseUrl}/__operator/business/brief/refresh`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(210000),
    headers: { "Content-Type": "application/json", "x-claude-os-token": token, Origin: options.baseUrl },
    body: JSON.stringify({ timezone: options.timezone }),
  }).then(readJson);
  const state = await get("/__operator/business/brief");
  const latest = state?.latest;
  // Read back the saved record. A successful HTTP response alone is not proof of persistence.
  if (!latest?.id || latest.id !== generated?.latest?.id || latest.timezone !== options.timezone || ![localDate(options.timezone, startedAt), localDate(options.timezone, now())].includes(latest.date) || Date.parse(latest.updatedAt) < startedAt.getTime() - 1000 || !Number.isFinite(Date.parse(latest.updatedAt))) {
    throw new Error("The refreshed report could not be verified in the saved archive. The runner did not replace or remove any report.");
  }
  // Public feeds are independent of brief generation; a feed outage does not discard the report.
  let today: any;
  try { today = await get("/__operator/business/today"); } catch { today = null; }
  return {
    saved: true, date: latest.date, timezone: latest.timezone, updatedAt: latest.updatedAt,
    priorities: Array.isArray(latest.priorities) ? latest.priorities.length : 0,
    recommendations: Array.isArray(latest.recommendations) ? latest.recommendations.length : 0,
    weather: today?.weather ? "available" : "unavailable",
    newsArticles: Array.isArray(today?.news) ? today.news.length : 0,
    schedule: { enabled: state.schedule?.enabled === true, hour: state.schedule?.hour, minute: state.schedule?.minute, timezone: state.schedule?.timezone },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await refreshMorningBrief(morningBriefOptions(process.argv.slice(2))))); }
  catch (error) {
    // Do not print provider payloads, request headers, evidence packets or the private report.
    console.error(error instanceof Error ? error.message : "The morning brief could not be refreshed.");
    process.exitCode = 1;
  }
}
