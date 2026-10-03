import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chatgptTarget,
  conversationsEntry,
  extractChatgptExport,
  findChatgptExportZip,
  importUploadedExport,
} from "./chatgpt-export";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const home = () => {
  const p = mkdtempSync(join(tmpdir(), "chatgpt-export-"));
  roots.push(p);
  mkdirSync(join(p, "Downloads"), { recursive: true });
  return p;
};
const canZip = spawnSync("zip", ["-v"]).status === 0 && process.platform !== "win32";
function makeZip(dir: string, name: string, files: Record<string, string>) {
  const src = join(dir, `src-${name}`);
  mkdirSync(src, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(src, f, ".."), { recursive: true });
    writeFileSync(join(src, f), text);
  }
  spawnSync("zip", ["-qr", join(dir, name), "."], { cwd: src });
  rmSync(src, { recursive: true, force: true });
  return join(dir, name);
}

test("finds the conversations file at the top or one folder down", () => {
  expect(conversationsEntry(["chat.html", "conversations.json"])).toBe("conversations.json");
  expect(conversationsEntry(["export/conversations.json"])).toBe("export/conversations.json");
  expect(conversationsEntry(["a/b/conversations.json", "notes.txt"])).toBeUndefined();
});

test.if(canZip)("picks the newest ChatGPT zip in Downloads and unpacks it where Memory looks", async () => {
  const h = home();
  const dl = join(h, "Downloads");
  const other = makeZip(dl, "photos.zip", { "a.txt": "x" });
  const old = makeZip(dl, "old-export.zip", { "conversations.json": '[{"id":"old","mapping":{}}]' });
  const fresh = makeZip(dl, "2026-09-28-export.zip", { "conversations.json": '[{"id":"new","title":"Hi","mapping":{}}]', "chat.html": "<p/>" });
  utimesSync(old, new Date("2026-01-01"), new Date("2026-01-01"));
  utimesSync(other, new Date(), new Date());
  const found = findChatgptExportZip(h)!;
  expect(found.path).toBe(fresh);
  const result = await extractChatgptExport(found.path, h);
  expect(result.path).toBe(chatgptTarget(h));
  expect(readFileSync(chatgptTarget(h), "utf8")).toContain('"new"');
});

test.if(canZip)("a zip without conversations.json is refused and nothing is written", async () => {
  const h = home();
  const zip = makeZip(join(h, "Downloads"), "photos.zip", { "a.txt": "x" });
  expect(findChatgptExportZip(h)).toBeUndefined();
  await expect(extractChatgptExport(zip, h)).rejects.toThrow("not a ChatGPT export");
  expect(existsSync(chatgptTarget(h))).toBe(false);
});

test("an uploaded conversations.json is checked and moved into place", async () => {
  const h = home();
  const data = join(h, ".operator-data");
  async function* body() {
    yield Buffer.from('[{"id":"c1","mapping":{}}]');
  }
  await importUploadedExport(data, h, body(), "conversations.json");
  expect(readFileSync(chatgptTarget(h), "utf8")).toBe('[{"id":"c1","mapping":{}}]');
  async function* bad() {
    yield Buffer.from("not json");
  }
  await expect(importUploadedExport(data, h, bad(), "conversations.json")).rejects.toThrow();
});

test.if(canZip)("a fake or oversized export never replaces the saved one", async () => {
  const h = home();
  const dl = join(h, "Downloads");
  mkdirSync(join(dl, "ChatGPT"), { recursive: true });
  writeFileSync(chatgptTarget(h), '[{"id":"keep","mapping":{}}]');
  const fake = makeZip(dl, "fake.zip", { "conversations.json": "[" });
  await expect(extractChatgptExport(fake, h)).rejects.toThrow("not readable");
  const big = makeZip(dl, "big.zip", { "conversations.json": `[{"id":"x","mapping":{},"pad":"${"a".repeat(5000)}"}]` });
  await expect(extractChatgptExport(big, h, { maxBytes: 1000 })).rejects.toThrow("too large");
  expect(readFileSync(chatgptTarget(h), "utf8")).toContain('"keep"');
  expect(existsSync(`${chatgptTarget(h)}.part`)).toBe(false);
});

test("a conversations file must be real JSON with a mapping in every conversation", async () => {
  const { looksLikeConversations } = await import("./chatgpt-export");
  const dir = mkdtempSync(join(tmpdir(), "cgx-"));
  const check = (text: string) => { const f = join(dir, `${Math.random()}.json`); writeFileSync(f, text); return looksLikeConversations(f); };
  expect(check('[{"id":"a","mapping":{}}]')).toBe(true);
  expect(check("[]")).toBe(true);
  expect(check('[{"mapping":THIS IS NOT JSON}]')).toBe(false);
  expect(check('[{"mapping":null}]')).toBe(false);
  expect(check('[{"id":"a","mapping":{}},{"id":"b"}]')).toBe(false);
  expect(check("[")).toBe(false);
});

test("replacing an export keeps the one before as conversations.previous.json", async () => {
  const { replaceExport } = await import("./chatgpt-export");
  const dir = mkdtempSync(join(tmpdir(), "cgx-"));
  const target = join(dir, "conversations.json"), fresh = join(dir, "new.part");
  writeFileSync(target, "old"); writeFileSync(fresh, "new");
  replaceExport(fresh, target);
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(readFileSync(join(dir, "conversations.previous.json"), "utf8")).toBe("old");
});
