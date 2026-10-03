import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slackWorkspaceHints } from "./slack-workspaces";
let home: string, file: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slack-hints-"));
  const directory = join(home, "Library/Application Support/Slack/storage");
  mkdirSync(directory, { recursive: true });
  file = join(directory, "root-state.json");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
test("desktop workspace hints omit credentials, unrelated data and URL query strings", () => {
  writeFileSync(file, JSON.stringify({ token: "never-return-this", workspaces: {
    valid: { id: "T12345678", name: "Studio", url: "https://studio.slack.com/?token=secret", accessToken: "secret-token", channels: ["private"] },
    duplicate: { id: "T12345678", name: "Studio", url: "https://studio.slack.com/" },
    hostile: { id: "T98765432", name: "Wrong host", url: "https://slack.com.attacker.test/" },
    credentials: { id: "T22222222", name: "Credentials", url: "https://secret@studio.slack.com/" },
  } }));
  expect(slackWorkspaceHints(home)).toEqual([{ id: "T12345678", name: "Studio", url: "https://studio.slack.com/" }]);
});
test("missing or damaged desktop settings do not prevent account setup", () => {
  expect(slackWorkspaceHints(home)).toEqual([]);
  writeFileSync(file, "broken");
  expect(slackWorkspaceHints(home)).toEqual([]);
  writeFileSync(file, " ".repeat(2 * 1024 * 1024 + 1));
  expect(slackWorkspaceHints(home)).toEqual([]);
});
