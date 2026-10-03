import { expect, test } from "bun:test";
import { coverWindow, focusWindow, matchMemory } from "../src/components/brain/brain-focus";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const node = (id: string, origin: string, name: string, updated: string, extra: any = {}) =>
  ({ id, origin, name, kind: "file", val: 1, color: "#fff", updated, ...extra }) as any;
const nodes = [
  node("c1", "claude", "project_pricing_page", "2026-09-20T10:00:00Z"),
  node("c2", "claude", "Launch checklist", "2026-08-01T10:00:00Z", { meta: "pricing and launch dates" }),
  node("x1", "codex", "Pricing calculator", "2026-09-25T10:00:00Z"),
  { id: "origin:claude", origin: "claude", name: "Claude", kind: "workspace", categoryHub: true, val: 1, color: "#fff" } as any,
];

test("a question about Claude and pricing finds only Claude's pricing records, newest first", () => {
  const hits = matchMemory(nodes, { source: "claude", query: "pricing" }, NOW);
  expect(hits.map((n) => n.id)).toEqual(["c1", "c2"]);
});

test("record ids and ranges narrow further; hubs never match", () => {
  expect(matchMemory(nodes, { recordIds: ["x1", "origin:claude"] }, NOW).map((n) => n.id)).toEqual(["x1"]);
  expect(matchMemory(nodes, { query: "pricing", range: "30d" }, NOW).map((n) => n.id)).toEqual(["x1", "c1"]);
});

test("the timeline window covers the matches, or the asked-for range", () => {
  const w = coverWindow(matchMemory(nodes, { source: "claude" }, NOW), {}, NOW)!;
  expect(w.start).toBeLessThan(Date.parse("2026-08-01T10:00:00Z"));
  expect(w.end).toBeGreaterThan(Date.parse("2026-09-20T10:00:00Z"));
  expect(focusWindow("7d", NOW)).toEqual({ start: NOW - 7 * 864e5, end: NOW });
  expect(focusWindow({ start: "2026-09-01", end: "2026-09-02" }, NOW)!.end).toBe(Date.parse("2026-09-02"));
});

test("a saved file is found without its exact name", () => {
  const files = [
    node("f1", "files", "OpenAI fact sheet", "2026-09-28T09:00:00Z", { preview: "OpenAI fact sheet: five facts about OpenAI." }),
    node("f2", "claude", "Anthropic pricing notes", "2026-09-27T09:00:00Z"),
    node("f3", "notion", "Launch plan", "2026-09-10T09:00:00Z"),
  ];
  for (const q of ["OpenAI fact sheet", "the openai facts", "that sheet about OpenAI", "open the OpenAI one", "the facts file", "the file I made today", "my latest doc", "OpenAI sheets"])
    expect(matchMemory(files, { query: q }, NOW)[0]?.id).toBe("f1");
  // Nothing that fits: no match rather than a random record.
  expect(matchMemory(files, { query: "tax return from 2019" }, NOW)).toEqual([]);
});
