import { describe, expect, test } from "bun:test";
import { connectedNotionPages, notionPageDocument, notionRecentPages } from "./notion-connected";
import type { withConnectedRead } from "./codex-connected-read";

type Client = Parameters<Parameters<typeof withConnectedRead>[1]>[0];

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
    const read = async <T,>(_root: string, work: (client: Client) => Promise<T>) => work({ tools: {}, async call(name: string, args: unknown) {
      calls.push(name);
      const id = String((args as { id?: string }).id || "");
      if (name === "notion.notion-list-recent-pages") return { results: [page("a".repeat(32), "A"), page("b".repeat(32), "B"), page("c".repeat(32), "C")] };
      if (id.includes("b".repeat(32))) throw new Error("boom");
      if (id.includes("c".repeat(32))) return { title: "C", text: "" };
      return { title: "A", url: id, text: "<content>hello</content>" };
    } });
    const result = await connectedNotionPages("/tmp", read);
    expect(calls[0]).toBe("notion.notion-list-recent-pages");
    expect(calls.filter(name => name === "notion.fetch").length).toBe(3);
    expect(result.documents.map(document => document.title)).toEqual(["A"]);
    expect(result.skipped).toBe(2);
    expect(result.hasMore).toBe(false);
  });
});
