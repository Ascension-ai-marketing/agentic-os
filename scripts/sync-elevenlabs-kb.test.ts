import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySync, loadState, planSync, readVault, redactSecrets } from "./sync-elevenlabs-kb";

let root: string;
const apiKey = "sk_unit_test_only_no_real_credentials";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentic-kb-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function vault(notes: Record<string, { title: string; text: string; trashed?: boolean }>) {
  const dir = join(root, ".operator-data/vault/business");
  mkdirSync(dir, { recursive: true });
  const entries: Record<string, object> = {};
  for (const [id, note] of Object.entries(notes)) {
    writeFileSync(join(dir, `${id}.md`), `---\nid: "${id}"\ntitle: ${JSON.stringify(note.title)}\ncollection: "business"\nsource_provider: "fixture"\n---\n\n${note.text}\n`);
    entries[id] = { path: `business/${id}.md`, hash: "h", signature: "s", trashed: !!note.trashed };
  }
  writeFileSync(join(root, ".operator-data/memory-vault.json"), JSON.stringify({ version: 1, entries, conflicts: {} }));
}
function fakeApi() {
  const calls: { method: string; url: string; body?: any }[] = [];
  let n = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(init?.method === "POST" ? { id: `doc_${++n}`, name: "x" } : {}), { status: 200 });
  };
  return { calls, fetcher };
}

test("redacts key-shaped and labelled secrets, leaves prose alone", () => {
  const fake = "sk-" + "a1B2".repeat(8);
  const out = redactSecrets(`Use ${fake} here.\nPASSWORD="hunter2hunter2"\nThe weekend reading list is the sample project.`);
  expect(out.hits).toBe(2);
  expect(out.text).not.toContain(fake);
  expect(out.text).not.toContain("hunter2hunter2");
  expect(out.text).toContain("weekend reading list");
});

test("reads live vault notes and skips trashed ones", () => {
  vault({ a: { title: "Sample project", text: "A weekend reading list." }, b: { title: "Old", text: "gone", trashed: true } });
  const docs = readVault(root);
  expect(docs.map((d) => d.id)).toEqual(["a"]);
  expect(docs[0]).toMatchObject({ title: "Sample project", collection: "business", provider: "fixture", text: "A weekend reading list." });
});

test("uploads new notes into the folder, then only what changed", async () => {
  vault({ a: { title: "One", text: "first" }, b: { title: "Two", text: "second" } });
  const api = fakeApi();
  const state = loadState(root);
  state.folderId = "folder_fixture";
  const first = planSync(readVault(root), state);
  expect([first.create.length, first.update.length, first.remove.length]).toEqual([2, 0, 0]);
  await applySync(root, first, state, apiKey, api.fetcher);
  expect(api.calls.every((c) => c.method === "POST" && c.body.parent_folder_id === "folder_fixture")).toBe(true);

  vault({ a: { title: "One", text: "first, edited" } });
  const second = planSync(readVault(root), loadState(root));
  expect([second.create.length, second.update.length, second.remove.length, second.unchanged]).toEqual([0, 1, 1, 0]);
  api.calls.length = 0;
  await applySync(root, second, loadState(root), apiKey, api.fetcher);
  expect(api.calls.map((c) => c.method)).toEqual(["POST", "DELETE", "DELETE"]);
  const after = planSync(readVault(root), loadState(root));
  expect([after.create.length, after.update.length, after.remove.length, after.unchanged]).toEqual([0, 0, 0, 1]);
});
