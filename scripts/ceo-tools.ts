/**
 * ceo-tools.ts
 *
 * What the voice can do besides talk. Everything here only reads. Lookups go
 * through the OS's own lookup route, the one the chat's live voice already uses,
 * so the Memory source switches and size limits there apply here too.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { RunTool } from "./ceo-brain";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const LOOKUPS = ["calendar", "meetings", "inbox", "search_email", "usage", "business", "skills", "reels", "web_search"];
const OS_DOWN = "The Agentic OS dashboard is not running, so nothing can be looked up until it is started.";
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Tool => ({
  name, description,
  // Inputs stream as they are written and arrive unvalidated; run() below checks them.
  eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export function brainTools(deps: { baseUrl?: string; request?: Fetch } = {}): { tools: Anthropic.Tool[]; runTool: RunTool } {
  const base = deps.baseUrl ?? "http://127.0.0.1:8081";
  // The local token and the person's data only ever travel to this machine.
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("The OS address must be a local http address.");
  const request = deps.request ?? fetch;

  async function lookup(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const limit = () => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    let response: Response;
    try {
      const { token } = await (await request(`${base}/__token`, { redirect: "error", signal: limit() })).json();
      if (typeof token !== "string" || token.length < 8 || token.length > 512) throw new Error("no token");
      response = await request(`${base}/__voice/tool`, {
        method: "POST", redirect: "error", signal: limit(),
        headers: { "Content-Type": "application/json", "x-claude-os-token": token, Origin: base },
        body: JSON.stringify({ name, args }),
      });
    } catch {
      throw new Error(OS_DOWN);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) throw new Error(`The OS could not run the ${name} lookup.`);
    return JSON.stringify(body.result).slice(0, 12_000);
  }

  const tools = [
    tool(
      "os_lookup",
      "Read live information from the person's Agentic OS. calendar: events for a day (default today) and the days after. " +
        "meetings: calendar events around this week plus imported meeting notes. inbox: open inbox items (sender, subject, date). " +
        "search_email: search the imported email archive, headers only (needs query). usage: Claude and Codex plan usage and reset times. " +
        "business: goals, business profile and the latest morning brief. skills: installed skills and how often each ran this week. " +
        "reels: Reels projects in Design. web_search: live information from the web, such as news, prices and facts (needs query).",
      {
        name: { type: "string", enum: LOOKUPS },
        query: { type: "string", description: "What to search for. Required for search_email and web_search; optional for meetings." },
        date: { type: "string", description: "calendar only: YYYY-MM-DD, default today" },
        days: { type: "integer", description: "calendar only: how many days to cover, 1 to 31, default 1" },
      },
      ["name"],
    ),
    tool("search_memory", "Search what the person has saved: notes, past chats, meetings and documents.", { query: { type: "string" } }, ["query"]),
    tool("task_status", "What the person's agents (Claude Code, Codex) have been working on recently, and each task's status."),
  ];

  const runTool: RunTool = async (called, input, signal) => {
    const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
    // The model now and then gets the letter case of a tool name wrong.
    const name = called.toLowerCase();
    if (name === "task_status") return lookup("agent_jobs", {}, signal);
    if (name === "search_memory") {
      if (!query) throw new Error("search_memory needs a query.");
      return lookup("search_memory", { query }, signal);
    }
    if (name !== "os_lookup") throw new Error(`There is no tool called ${called}. The tools are: ${tools.map((t) => t.name).join(", ")}.`);
    const what = String(args.name ?? "");
    if (!LOOKUPS.includes(what)) throw new Error(`name must be one of: ${LOOKUPS.join(", ")}.`);
    if ((what === "search_email" || what === "web_search") && !query) throw new Error(`${what} needs a query.`);
    if (what !== "calendar") return lookup(what, query ? { query } : {}, signal);
    const date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : undefined;
    if (args.date !== undefined && !date) throw new Error("date must look like 2026-01-31.");
    const days = Number(args.days);
    return lookup("calendar", { ...(date ? { date } : {}), ...(days >= 1 && days <= 31 ? { days: Math.floor(days) } : {}) }, signal);
  };
  return { tools, runTool };
}
