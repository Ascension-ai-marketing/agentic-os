import { describe, expect, test } from "bun:test";
import { connectedNotionPages, notionAvailable, notionConnectionCheck, notionPageDocument, notionRecentPages } from "./notion-connected";
import type { McpReader } from "./mcp-connection";

const page = (id: string, title: string) => ({ type: "page", url: `https://app.notion.com/p/${id}?pvs=204`, title });

describe("notionRecentPages", () => {
  test("keeps only Notion page entries, bounded and de-duplicated", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const list = notionRecentPages({ results: [page(id, "Today"), page(id, "Today again"), { type: "database", url: "https://app.notion.com/p/x", title: "DB" }, { type: "page", url: "https://evil.example/p/" + id, title: "Nope" }, ...Array.from({ length: 30 }, (_, i) => page(String(i).padStart(32, "a"), `Page ${i}`))] });
    expect(list[0]).toEqual({ id, url: `https://app.notion.com/p/${id}?pvs=204`, title: "Today" });
    expect(list.length).toBe(12);
    expect(list.some(item => item.url.includes("evil"))).toBe(false);
  });
  test("returns nothing for unreadable payloads", () => {
    expect(notionRecentPages(null)).toEqual([]);
    expect(notionRecentPages({ results: "x" })).toEqual([]);
  });
});

describe("notionPageDocument", () => {
  test("strips markup and keeps the page content as plain text", () => {
    const fallback = { id: "0123456789abcdef0123456789abcdef", url: "https://app.notion.com/p/0123456789abcdef0123456789abcdef", title: "Fallback" };
    const document = notionPageDocument({ title: "Today", url: fallback.url + "?pvs=204", page_last_edited_at: "2026-01-02T03:04:05.000Z", text: "Here is the result:\n<page url=\"x\">\n<content>\n<empty-block/>\n**Today: **\n- [x] Book the venue\n<empty-block/>\n</content>\n</page>" }, fallback);
    expect(document.id).toBe(fallback.id);
    expect(document.title).toBe("Today");
    expect(document.text).toContain("Last edited: 2026-01-02T03:04:05.000Z");
    expect(document.text).toContain("- [x] Book the venue");
    expect(document.text).not.toContain("<content>");
    expect(document.text).not.toContain("empty-block");
  });
  test("falls back to the listed page when the fetch omits metadata", () => {
    const fallback = { id: "0123456789abcdef0123456789abcdef", url: "https://app.notion.com/p/0123456789abcdef0123456789abcdef", title: "Fallback" };
    const document = notionPageDocument({ text: "plain" }, fallback);
    expect(document).toEqual({ id: fallback.id, title: "Fallback", text: `Source: ${fallback.url}\n\nplain` });
    expect(notionPageDocument({}, fallback).text).toBe("");
  });
});

describe("connectedNotionPages", () => {
  test("lists recent pages, fetches each and skips failures", async () => {
    const calls: string[] = [];
    const read: McpReader = async work => work({ tools: {}, async call(name: string, args: unknown) {
      calls.push(name);
      const id = String((args as { id?: string }).id || "");
      if (name === "notion-list-recent-pages") return { results: [page("a".repeat(32), "A"), page("b".repeat(32), "B"), page("c".repeat(32), "C")] };
      if (id.includes("b".repeat(32))) throw new Error("boom");
      if (id.includes("c".repeat(32))) return { title: "C", text: "" };
      return { title: "A", url: id, text: "<content>hello</content>" };
    } });
    const result = await connectedNotionPages(read);
    expect(calls[0]).toBe("notion-list-recent-pages");
    expect(calls.filter(name => name === "notion-fetch").length).toBe(3);
    expect(result.documents.map(document => document.title)).toEqual(["A"]);
    expect(result.skipped).toBe(2);
    expect(result.hasMore).toBe(false);
  });
});

test("Notion is available only when both read tools are marked read-only", async () => {
  const tool = (name: string, readOnlyHint = true) => [name, { name, annotations: { readOnlyHint } }];
  const reader = (entries: any[]) => (async (work: any) => work({ tools: Object.fromEntries(entries), call: async () => ({}) })) as McpReader;
  expect(await notionAvailable(reader([tool("notion-list-recent-pages"), tool("notion-fetch")]))).toBe(true);
  expect(await notionAvailable(reader([tool("notion-list-recent-pages"), tool("notion-fetch", false)]))).toBe(false);
  expect(await notionAvailable(reader([tool("notion-fetch")]))).toBe(false);
});

describe("notionConnectionCheck", () => {
  const readOnly = (name: string) => [name, { name, annotations: { readOnlyHint: true } }];
  const tools = Object.fromEntries([readOnly("notion-list-recent-pages"), readOnly("notion-fetch")]);
  function probe(options: { fail?: () => boolean } = {}) {
    const state = { asked: 0, clock: 0, connected: true };
    const read = (async (work: any) => { state.asked++; if (options.fail?.()) throw new Error("offline"); return work({ tools, call: async () => ({}) }); }) as McpReader;
    return { state, check: notionConnectionCheck({ status: () => ({ connected: state.connected }), read }, () => state.clock) };
  }
  test("asks Notion at most once a minute, and again when forced", async () => {
    const { state, check } = probe();
    expect([await check(), await check(), state.asked]).toEqual(["mcp", "mcp", 1]);
    state.clock = 61_000;
    expect([await check(), state.asked]).toEqual(["mcp", 2]);
    expect([await check(true), state.asked]).toEqual(["mcp", 3]);
  });
  test("a signed-out connection is never asked, and signing in again asks afresh", async () => {
    const { state, check } = probe();
    state.connected = false;
    expect([await check(), state.asked]).toEqual([undefined, 0]);
    state.connected = true;
    expect([await check(), state.asked]).toEqual(["mcp", 1]);
    state.connected = false;
    expect(await check()).toBeUndefined();
    state.connected = true;
    expect([await check(), state.asked]).toEqual(["mcp", 2]);
  });
  test("a failed check is tried again after ten seconds, not on every poll", async () => {
    let failing = true;
    const { state, check } = probe({ fail: () => failing });
    expect([await check(), await check(), state.asked]).toEqual([undefined, undefined, 1]);
    failing = false; state.clock = 11_000;
    expect([await check(), state.asked]).toEqual(["mcp", 2]);
  });
});
