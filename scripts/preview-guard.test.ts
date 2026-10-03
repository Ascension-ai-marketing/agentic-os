import { expect, test } from "bun:test";
import { previewAllowsMutation } from "./preview-guard";

test("memory app sync remains workspace-local in isolated previews", () => {
  expect(previewAllowsMutation("/__operator/memory/apps/codex")).toBe(true);
  expect(previewAllowsMutation("/__operator/memory/apps/claude/sync")).toBe(true);
  expect(previewAllowsMutation("/__operator/memory/apps/chatgpt/import")).toBe(true);
  expect(previewAllowsMutation("/__operator/memory/apps/codex/execute")).toBe(false);
  expect(previewAllowsMutation("/__operator/memory/apps/unknown/sync")).toBe(false);
});
test("preview workspaces can save local work without changing installed agents", () => {
  for (const p of [
    "/__website-os/connect",
    "/__operator/memory",
    "/__operator/memory/a-note",
    "/__operator/brain/sources",
    "/__operator/calendar",
    "/__operator/inbox",
    "/__operator/connections/sync",
  ])
    expect(previewAllowsMutation(p)).toBe(true);
  for (const p of [
    "/__hermes_chat",
    "/__hermes_moa_save",
    "/__dream",
    "/__operator/models/local",
    "/__operator/memory/../../settings",
    "/__operator/connections/send",
  ])
    expect(previewAllowsMutation(p)).toBe(false);
});
