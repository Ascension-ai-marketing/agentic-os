import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBrainPreferences, writeBrainPreferences } from "./brain-preferences";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "brain-preferences-"));
  roots.push(root);
  mkdirSync(join(root, ".operator-data"));
  return { root, workspace: join(root, ".operator-data/workspace.json"), preferences: join(root, ".operator-data/brain-preferences.json") };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("legacy preference cache notices external archive changes and never returns mutable shared state", () => {
  const { root, workspace } = fixture();
  writeFileSync(workspace, JSON.stringify({ brainSources: { codex: false }, brainRevision: 3 }));
  const first = readBrainPreferences(root);
  first.brainSources.codex = true;
  expect(readBrainPreferences(root).brainSources.codex).toBe(false);
  writeFileSync(workspace, JSON.stringify({ brainSources: { codex: true, claude: false }, brainRevision: 4 }));
  expect(readBrainPreferences(root)).toEqual({ brainSources: { codex: true, claude: false }, brainRevision: 4 });
});

test("small preferences remain authoritative over stale or unreadable legacy archives", () => {
  const { root, workspace } = fixture();
  const current = { brainSources: { codex: false }, brainRevision: 8 };
  writeBrainPreferences(root, current);
  writeFileSync(workspace, "unreadable-legacy-file");
  expect(readBrainPreferences(root)).toEqual(current);
  expect(readBrainPreferences(root, { brainSources: { codex: true }, brainRevision: 2 })).toEqual(current);
});

test("malformed authoritative preferences never silently fall back to old enabled sources", () => {
  const { root, workspace, preferences } = fixture();
  writeFileSync(workspace, JSON.stringify({ brainSources: { codex: true } }));
  for (const bad of ["null", '{"version":1,"brainSources":{},"brainRevision":-1}', '{"version":1,"brainSources":{"codex":"false"},"brainRevision":1}']) {
    writeFileSync(preferences, bad);
    expect(() => readBrainPreferences(root)).toThrow("left untouched");
    expect(readFileSync(preferences, "utf8")).toBe(bad);
  }
});
