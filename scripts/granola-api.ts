import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { providerKey } from "./provider-config";

const endpoint = "https://public-api.granola.ai/v1/notes";
/** Official Granola API. Keys stay server-side; each import fetches at most 20 notes. */
export function granolaApi(root: string, options: { fetcher?: typeof fetch; key?: () => string } = {}) {
  const fetcher = options.fetcher || fetch;
  const file = join(root, ".operator-data/granola.json");
  function key() {
    if (options.key) return options.key();
    if (existsSync(file)) {
      try { return String(JSON.parse(readFileSync(file, "utf8")).apiKey || ""); } catch { throw new Error("Granola configuration could not be read. Your saved key was preserved."); }
    }
    return providerKey(root, "GRANOLA_API_KEY");
  }
  async function request(url: string, token = key()) {
    if (!token) throw new Error("Connect Granola with your API key first.");
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Granola could not authorize this key. Check API access in Granola Settings." : `Granola request failed (${response.status}). Try again shortly.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Granola returned an empty response.");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("This Granola note exceeds the supported import size."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  function validatePage(page: any, limit: number) {
    if (!Array.isArray(page?.notes) || page.notes.length > limit || typeof page.hasMore !== "boolean" || (page.hasMore && (typeof page.cursor !== "string" || !page.cursor || page.cursor.length > 4096))) throw new Error("Granola returned an incomplete notes page. Saved notes were preserved.");
    return page;
  }
  return {
    configured: () => !!key(),
    status: () => ({ configured: !!key(), method: "api", docsUrl: "https://docs.granola.ai/api-reference/list-notes" }),
    async configure(value: unknown) {
      if (typeof value !== "string" || value.trim().length < 10 || value.length > 4096 || /\s/.test(value.trim())) throw new Error("Enter a valid Granola API key.");
      const apiKey = value.trim();
      validatePage(await request(endpoint + "?page_size=1", apiKey), 1);
      mkdirSync(join(root, ".operator-data"), { recursive: true, mode: 0o700 });
      const temp = file + ".tmp";
      writeFileSync(temp, JSON.stringify({ apiKey }), { mode: 0o600 }); renameSync(temp, file);
      return { configured: true, method: "api" };
    },
    async notes(cursor?: string) {
      const url = new URL(endpoint); url.searchParams.set("page_size", "20");
      if (cursor) url.searchParams.set("cursor", cursor);
      const page = validatePage(await request(url.toString()), 20);
      const documents: Array<{ id: string; title: string; text: string }> = [];
      const seen = new Set<string>();
      for (const item of page.notes) {
        if (typeof item?.id !== "string" || !/^not_[a-zA-Z0-9]{14}$/.test(item.id) || seen.has(item.id)) throw new Error("Granola returned an invalid note reference.");
        seen.add(item.id);
        const note = await request(`${endpoint}/${encodeURIComponent(item.id)}`);
        if (note?.id !== item.id) throw new Error("Granola returned a mismatched note.");
        const text = [note.summary_markdown || note.summary_text, note.private_notes_markdown || note.private_notes_text].filter(v => typeof v === "string" && v.trim()).join("\n\n");
        if (!text) continue;
        documents.push({ id: note.id, title: typeof note.title === "string" ? note.title.slice(0, 300) : "Granola meeting", text: `Date: ${typeof note.created_at === "string" ? note.created_at : "Unknown"}\n\n${text}` });
      }
      return { documents, hasMore: page.hasMore, cursor: page.hasMore ? page.cursor as string : undefined };
    },
  };
}
