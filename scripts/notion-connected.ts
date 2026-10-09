import type { McpReader } from "./mcp-connection";

export const NOTION_TOOLS = ["notion-list-recent-pages", "notion-fetch"] as const;

const MAX_PAGES = 12, MAX_TEXT = 200_000;
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\p{Cc}/gu, " ").trim().slice(0, max) : "";
const notionUrl = /^https:\/\/(?:app\.notion\.com|www\.notion\.so|notion\.so)\//;
const pageId = (url: string) => url.match(/([0-9a-f]{32})/i)?.[1]?.toLowerCase() || "";

/** Only page entries with a Notion URL become candidates. Surrounding text is never an instruction. */
export function notionRecentPages(raw: unknown) {
  const results = Array.isArray((raw as { results?: unknown })?.results) ? (raw as { results: unknown[] }).results : [];
  const seen = new Set<string>();
  const pages: Array<{ id: string; url: string; title: string }> = [];
  for (const value of results) {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (item.type !== "page") continue;
    const url = clean(item.url, 500), id = pageId(url);
    if (!notionUrl.test(url) || !id || seen.has(id)) continue;
    seen.add(id);
    pages.push({ id, url, title: clean(item.title, 300) || "Untitled" });
    if (pages.length === MAX_PAGES) break;
  }
  return pages;
}

/** Turn a fetched page into plain text. Markup is stripped; page content is stored as data only. */
export function notionPageDocument(raw: unknown, fallback: { id: string; url: string; title: string }) {
  const page = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const url = clean(page.url, 500) || fallback.url;
  const id = pageId(url) || fallback.id;
  const title = clean(page.title, 300) || fallback.title;
  const body = typeof page.text === "string" ? page.text.slice(0, 2 * MAX_TEXT) : "";
  const content = body.match(/<content>([\s\S]*?)<\/content>/)?.[1] ?? body;
  const text = content.replace(/<empty-block\s*\/>/g, "").replace(/<[^>]{1,200}>/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  const edited = clean(page.page_last_edited_at, 60);
  return { id, title, text: text ? `${edited ? `Last edited: ${edited}\n` : ""}Source: ${url}\n\n${text}` : "" };
}

export async function notionAvailable(read: McpReader) {
  return read(async ({ tools }) => NOTION_TOOLS.every(name => tools[name]?.annotations?.readOnlyHint === true && tools[name]?.annotations?.destructiveHint !== true));
}

/** "mcp" when the signed-in connection can read pages. The Memory page polls this, so Notion is asked at most once a minute. */
export function notionConnectionCheck(connection: { status: () => { connected: boolean }; read: McpReader }, now: () => number = Date.now) {
  let cached: { until: number; value: "mcp" | undefined } | undefined, pending: Promise<"mcp" | undefined> | undefined;
  return async (force = false) => {
    if (!connection.status().connected) { cached = undefined; return undefined; }
    if (force) cached = undefined;
    if (cached && cached.until > now()) return cached.value;
    pending ??= notionAvailable(connection.read).then(
      ok => (cached = { until: now() + 60_000, value: ok ? "mcp" : undefined }).value,
      // A failed check is not a sign-out; look again shortly.
      () => (cached = { until: now() + 10_000, value: undefined }).value,
    ).finally(() => { pending = undefined; });
    return pending;
  };
}

/** Recently edited pages through the app's own Notion connection. Read-only; pages that fail are skipped. */
export async function connectedNotionPages(read: McpReader) {
  return read(async client => {
    const pages = notionRecentPages(await client.call("notion-list-recent-pages", { limit: MAX_PAGES }));
    const documents: Array<{ id: string; title: string; text: string }> = [];
    let skipped = 0;
    for (const page of pages) {
      try {
        const document = notionPageDocument(await client.call("notion-fetch", { id: page.url }), page);
        if (document.text) documents.push(document); else skipped++;
      } catch { skipped++; }
    }
    return { documents, hasMore: false, skipped };
  });
}
