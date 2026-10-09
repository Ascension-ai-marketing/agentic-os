import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
function files(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (name === "node_modules" || name === "dist") return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = [...files(join(root, "scripts")), ...files(join(root, "src"))].filter(path => !path.endsWith("no-codex-connectors.test.ts"));

test("no connector routes through the Codex app-server bridge", () => {
  expect(existsSync(join(root, "scripts", "codex-connected-read.ts"))).toBe(false);
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    expect([path, /codex-connected-read|withConnectedRead|codex_apps|mcpServer\/tool\/call/.test(text)]).toEqual([path, false]);
  }
});
test("connector modules do not start Codex", () => {
  for (const name of ["native-inbox-sync", "mail-backfill", "native-calendar-sync", "native-business-sync", "notion-connected", "mcp-connection"]) {
    const text = readFileSync(join(root, "scripts", name + ".ts"), "utf8");
    expect([name, /child_process|app-server|installedCodex/.test(text)]).toEqual([name, false]);
  }
});
