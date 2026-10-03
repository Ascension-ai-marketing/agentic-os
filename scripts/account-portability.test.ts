import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountConnections } from "./account-connections";
import { EMPTY_STATE } from "../src/lib/operator";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() { const root = mkdtempSync(join(tmpdir(), "optional-accounts-")); roots.push(root); const home = join(root, "new-user"); mkdirSync(home); return { root, home }; }
test("fresh-user Slack remains optional, disconnected and network-free without local files", async () => {
  const { root, home } = fixture();
  const accounts = accountConnections(root, () => structuredClone(EMPTY_STATE), () => { throw new Error("No writes expected"); }, { homeDir: home });
  const status = await accounts.handle("/connections", "GET", {}, {});
  expect(status.accounts.find((account: any) => account.id === "slack")).toMatchObject({ configured: false, connected: false, detectedWorkspaces: [] });
  expect(existsSync(join(root, ".operator-data/accounts.json"))).toBe(false);
});
