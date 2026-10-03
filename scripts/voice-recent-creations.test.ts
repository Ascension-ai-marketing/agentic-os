import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceRecentCreations } from "./voice-recent-creations";
import { recentVoiceIntent } from "../src/lib/voice-recent";

const roots: string[] = [];
const NOW = Date.parse("2026-09-17T14:00:00Z");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=", "base64");
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { force: true, recursive: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "voice-creations-")); roots.push(root);
  const ledgerPath = join(root, "ledger.jsonl");
  let enabled = true;
  const api = voiceRecentCreations({ ledgerPath, allowed: () => enabled, now: () => NOW });
  return { root, ledgerPath, api, disable() { enabled = false; },
    image(name: string) { const path = join(root, name + ".png"); writeFileSync(path, png); return path; },
    rows(rows: unknown[]) { writeFileSync(ledgerPath, rows.map(row => JSON.stringify(row)).join("\n")); }
  };
}
test("latest creation follows recorded generation time, excluding backfills, videos, missing and duplicate files", () => {
  const f = fixture(), old = f.image("old"), latest = f.image("latest"), imported = f.image("imported"), video = f.image("video");
  utimesSync(old, new Date(NOW), new Date(NOW));
  f.rows([
    { path: old, ts: NOW - 10000, kind: "image", prompt: "Older image" },
    { path: latest, ts: NOW - 2000, kind: "image", prompt: "English springer spaniel", model: "fixture/model" },
    { path: old, ts: NOW - 20000, kind: "image" },
    { path: imported, ts: NOW - 10, kind: "image", backfill: true },
    { path: video, ts: NOW - 20, kind: "video" },
    { path: join(f.root, "missing.png"), ts: NOW - 1, kind: "image" },
    { path: latest, ts: NOW + 999999, kind: "image", prompt: "Invalid future record" },
  ]);
  const result = f.api.list();
  expect(result.items.map(item => item.filename)).toEqual(["latest.png", "old.png"]);
  expect(result.items[0].title).toBe("English springer spaniel");
  expect(result.items[0].createdAt).toBe(new Date(NOW - 2000).toISOString());
  expect(JSON.stringify(result)).not.toContain(f.root);
  expect(result.instruction).toContain("Do not read opaque filenames aloud");
});
test("preview reads an actual recorded image and stops when its source is disabled or deleted", () => {
  const f = fixture(), path = f.image("preview");
  f.rows([{ path, kind: "image", ts: NOW - 1 }]);
  const item = f.api.list().items[0];
  expect(f.api.image(item.id)).toEqual({ bytes: png, mimeType: "image/png" });
  expect(() => f.api.image("../../private")).toThrow();
  f.disable();
  expect(() => f.api.list()).toThrow("excluded");
  expect(() => f.api.image(item.id)).toThrow();
});
test("symlinks and non-images cannot be returned as image bytes", () => {
  const f = fixture(), real = f.image("real"), linked = join(f.root, "linked.png"), invalid = join(f.root, "invalid.png");
  symlinkSync(real, linked); writeFileSync(invalid, "not an image");
  f.rows([{ path: linked, kind: "image", ts: NOW - 1 }, { path: invalid, kind: "image", ts: NOW - 2 }]);
  expect(f.api.list().items).toHaveLength(1);
  expect(() => f.api.image(f.api.list().items[0].id)).toThrow("no longer available");
});
test("a replaced file and a missing ledger are safe, bounded and not creation evidence", () => {
  const f = fixture(); expect(f.api.list().items).toEqual([]);
  const path = f.image("replaced"); f.rows([{ path, kind: "image", ts: NOW - 1 }]);
  const item = f.api.list().items[0]; rmSync(path); symlinkSync(f.ledgerPath, path);
  expect(() => f.api.image(item.id)).toThrow();
  truncateSync(f.ledgerPath, 17 * 1024 * 1024);
  expect(() => f.api.list()).toThrow("too large");
});
test("results are bounded and malformed ledger lines don't replace real recorded work", () => {
  const f = fixture(); f.rows(Array.from({ length: 9 }, (_, i) => ({ path: f.image("image" + i), kind: "image", ts: NOW - i - 1, prompt: "x".repeat(2000) })));
  const result = f.api.list(); expect(result.items).toHaveLength(6); expect(result.items[0].prompt?.length).toBe(500); expect(result.items[0].title.length).toBe(100);
});
test("latest question routing distinguishes created images from local filename search", () => {
  expect(recentVoiceIntent("What was the last image I created in my OS?")).toBe("creations");
  expect(recentVoiceIntent("show the newest picture I generated")).toBe("creations");
  expect(recentVoiceIntent("what was my last email?")).toBe("emails");
  expect(recentVoiceIntent("show recent files in my downloads")).toBe(null);
  expect(recentVoiceIntent("find images of dogs on this Mac")).toBe(null);
});
