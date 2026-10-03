import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memoryFilePath, memoryFilesDir } from "./memory-files";

test("only plain files inside the memory files folder are served", () => {
  const root = mkdtempSync(join(tmpdir(), "mf-"));
  mkdirSync(memoryFilesDir(root), { recursive: true });
  writeFileSync(join(memoryFilesDir(root), "fact-sheet.html"), "<h1>hi</h1>");
  writeFileSync(join(root, "secret.html"), "no");
  symlinkSync(join(root, "secret.html"), join(memoryFilesDir(root), "link.html"));
  expect(memoryFilePath(root, "fact-sheet.html")).toContain("fact-sheet.html");
  expect(memoryFilePath(root, "../secret.html")).toBeNull();
  expect(memoryFilePath(root, "link.html")).toBeNull();
  expect(memoryFilePath(root, "missing.html")).toBeNull();
  expect(memoryFilePath(root, "script.js")).toBeNull();
});
