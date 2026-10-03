import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryVault } from "./memory-vault";
import type { MemorySource } from "../src/lib/operator";
let root: string;
let instances: ReturnType<typeof memoryVault>[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "memory-vault-"));
});
afterEach(() => {
  instances.forEach((v) => v.stop());
  instances = [];
  rmSync(root, { recursive: true, force: true });
});
const make = () => {
  const v = memoryVault(root);
  instances.push(v);
  return v;
};
function source(
  text = "A complete extracted transcript with its original text.",
  patch: Partial<MemorySource> = {},
): MemorySource {
  return {
    id: "source-one",
    title: 'A title: with "quotes"\nand a newline',
    text,
    collection: "content",
    kind: "video",
    origin: "web",
    url: "https://www.youtube.com/watch?v=fixture",
    createdAt: "2026-09-16T12:00:00Z",
    updatedAt: "2026-09-16T12:00:00Z",
    status: "ready",
    pinned: false,
    words: 9,
    hash: createHash("sha256").update(text).digest("hex"),
    ...patch,
  };
}
test("portable Markdown retains full extracted content and provenance, moves to trash and restores", async () => {
  const vault = make(),
    item = source("Transcript beyond preview. ".repeat(300));
  let result = await vault.export([item]);
  const original = join(result.path, "content/source-one.md");
  expect(result.mirrored).toBe(1);
  expect(result.pending).toBe(false);
  expect(result.written).toBe(1);
  const body = readFileSync(original, "utf8");
  expect(body).toContain(
    'title: "A title: with \\"quotes\\"\\nand a newline"'.replaceAll("\\\\", "\\"),
  );
  expect(body).toContain("source_url:");
  expect(body.endsWith(item.text + "\n")).toBe(true);
  expect(statSync(original).mode & 0o777).toBe(0o600);
  result = await vault.export([{ ...item, deletedAt: "2026-09-16T13:00:00Z" }]);
  expect(result.trashed).toBe(1);
  expect(result.mirrored).toBe(0);
  expect(existsSync(original)).toBe(false);
  expect(existsSync(join(result.path, ".trash/content/source-one.md"))).toBe(true);
  result = await vault.export([{ ...item, collection: "space-custom" }]);
  expect(result.mirrored).toBe(1);
  expect(result.trashed).toBe(0);
  expect(existsSync(join(result.path, "space-custom/source-one.md"))).toBe(true);
});
test("edited mirrors and unmanaged files are preserved and reported, including after restart", async () => {
  let vault = make(),
    result = await vault.export([source()]);
  const file = join(result.path, "content/source-one.md");
  writeFileSync(file, "My edited note must survive.");
  vault.stop();
  vault = make();
  result = await vault.export([source("New source data should not overwrite my separate edit.")]);
  expect(result.conflicts).toBe(1);
  expect(result.written).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("My edited note must survive.");
  expect(result.details[0].reason).toContain("preserved");
  result = await vault.export([{ ...source(), deletedAt: "2026-09-16T13:00:00Z" }]);
  expect(result.conflicts).toBe(1);
  expect(existsSync(file)).toBe(true);
  writeFileSync(join(result.path, "content/other.md"), "Unmanaged Obsidian note.");
  result = await vault.export([source("Imported different source content.", { id: "other" })]);
  expect(result.conflicts).toBe(2);
  expect(readFileSync(join(result.path, "content/other.md"), "utf8")).toBe(
    "Unmanaged Obsidian note.",
  );
});
test("linked vault folders and files never write outside the managed root", async () => {
  const outside = join(root, "outside");
  mkdirSync(outside);
  mkdirSync(join(root, ".operator-data"));
  symlinkSync(outside, join(root, ".operator-data/vault"));
  let result = await make().export([source()]);
  expect(result.conflicts).toBe(1);
  expect(existsSync(join(outside, "content"))).toBe(false);
  rmSync(join(root, ".operator-data/vault"));
  mkdirSync(join(root, ".operator-data/vault/content"), { recursive: true });
  const original = join(outside, "original.md");
  writeFileSync(original, "Keep this external file.");
  symlinkSync(original, join(root, ".operator-data/vault/content/source-one.md"));
  result = await make().export([source()]);
  expect(result.conflicts).toBe(1);
  expect(readFileSync(original, "utf8")).toBe("Keep this external file.");
});
test("a corrupt mirror index stays untouched and does not prevent primary memory storage", async () => {
  mkdirSync(join(root, ".operator-data"));
  const index = join(root, ".operator-data/memory-vault.json");
  writeFileSync(index, "broken index");
  const result = await make().export([source()]);
  expect(result.error).toContain("index");
  expect(readFileSync(index, "utf8")).toBe("broken index");
});
test("automatic copies coalesce updates and exports re-read current sources after queued work", async () => {
  const vault = make(),
    first = source("First source text was here."),
    latest = source("Newest source text is retained.");
  vault.schedule([first]);
  vault.schedule([latest]);
  for (let n = 0; n < 30 && vault.status().pending; n++)
    await new Promise((r) => setTimeout(r, 10));
  expect(vault.status().pending).toBe(false);
  const result = await vault.export(() => [latest]);
  expect(result.written).toBe(0);
  expect(result.unchanged).toBe(1);
  expect(readFileSync(join(result.path, "content/source-one.md"), "utf8")).toContain(latest.text);
});
