import { readFileSync } from "node:fs";
import { join } from "node:path";

// Disabled unless .operator-data/private-advisor.json enables it. No account
// session is copied from a browser; the public bot accepts bounded chat requests.
const configPath = (root: string) => join(root, ".operator-data", "private-advisor.json");
const SERVICE_HOST = "www.aiwithjack.com";
/** The endpoint comes from the local config file only and must live on the advisor host over https. */
function serviceEndpoint(config: { endpoint?: unknown }): string | null {
  if (typeof config.endpoint !== "string") return null;
  try {
    const url = new URL(config.endpoint);
    if (url.protocol === "https:" && url.hostname === SERVICE_HOST && !url.search && !url.hash && !url.username && !url.password) return url.toString();
  } catch { /* not a URL */ }
  return null;
}
function readConfig(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(root), "utf8"));
}
export function privateAdvisorStatus(root: string) {
  try {
    const config = readConfig(root);
    if (config.enabled === true && config.service === "aiwithjack-advisor" && serviceEndpoint(config)) {
      const name = typeof config.name === "string" && config.name.trim() && config.name.length <= 40 ? config.name.trim() : "Private advisor";
      const avatar = typeof config.avatar === "string" && /^https:\/\/[^\s"'<>]{1,300}$/.test(config.avatar) ? config.avatar : "";
      return { enabled: true, name, avatar };
    }
  } catch { /* Community installs have no private configuration. */ }
  return { enabled: false };
}

export async function runPrivateAdvisor(
  root: string, body: { prompt?: unknown; message?: unknown }, signal: AbortSignal,
  onText: (delta: string) => void, request: typeof fetch = fetch,
) {
  let endpoint: string | null = null;
  try { endpoint = serviceEndpoint(readConfig(root)); } catch { /* no local configuration */ }
  if (!privateAdvisorStatus(root).enabled || !endpoint) throw new Error("This private advisor is not enabled on this device.");
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 12000 ||
      typeof body.prompt !== "string" || Buffer.byteLength(body.prompt, "utf8") > 100000)
    throw new Error("The private advisor request is empty or too large.");
  // The service URL comes from the local config only. Client input cannot redirect workspace context or credentials.
  const response = await request(endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: body.message, businessContext: body.prompt, history: [] }),
  });
  if (!response.ok || !response.body) throw new Error("The private advisor could not connect. Your workspace data remains saved locally.");
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error("The private advisor returned an unexpected response. Please try again.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", completed = false, total = 0;
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    let event: any;
    try { event = JSON.parse(data); } catch { throw new Error("The private advisor returned an invalid stream."); }
    if (event.error) throw new Error("The private advisor could not finish this answer. Please retry.");
    if (event.truncated) throw new Error("The private advisor stopped before finishing. Ask it to continue.");
    if (typeof event.token === "string") {
      total += event.token.length;
      if (total > 500000) throw new Error("The private advisor exceeded the answer size limit.");
      onText(event.token);
    }
    if (event.done) completed = true;
  };
  try {
    while (!completed) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) { if (!completed) consume(line); }
      if (buffer.length > 500000) throw new Error("The private advisor returned an oversized event.");
      if (done) { if (buffer.trim() && !completed) consume(buffer); break; }
    }
    signal.throwIfAborted();
    if (!completed || !total) throw new Error("The private advisor's answer is incomplete. Please retry.");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
