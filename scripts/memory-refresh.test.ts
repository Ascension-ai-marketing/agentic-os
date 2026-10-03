import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memoryRefresh } from "./memory-refresh";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function root() {
  const path = mkdtempSync(join(tmpdir(), "memory-daily-"));
  roots.push(path);
  return path;
}
test("daily refresh persists, runs once when due and catches up after restart", async () => {
  let now = 100000,
    runs = 0;
  const path = root();
  const service = memoryRefresh(
    path,
    async () => {
      runs++;
    },
    () => now,
  );
  // On by default, and the first open refreshes straight away.
  expect(service.status().daily).toBe(true);
  expect(await service.due()).toBe(true);
  expect(await service.due()).toBe(false);
  now += 86400000;
  await Promise.all([service.due(), service.due()]);
  expect(runs).toBe(2);
  const restarted = memoryRefresh(
    path,
    async () => {
      runs++;
    },
    () => now,
  );
  expect(await restarted.due()).toBe(false);
  now += 2 * 86400000;
  expect(await restarted.due()).toBe(true);
  expect(runs).toBe(3);
  restarted.configure({ daily: false });
  now += 86400000;
  expect(await restarted.due()).toBe(false);
  expect(runs).toBe(3);
});
test("a failed enqueue does not falsely advance the daily refresh checkpoint", async () => {
  let now = 100000;
  const service = memoryRefresh(
    root(),
    async () => {
      throw Error("synthetic unavailable");
    },
    () => now,
  );
  service.configure({ daily: true });
  const before = service.status().lastQueuedAt;
  now += 86400000;
  await expect(service.due()).rejects.toThrow("synthetic unavailable");
  expect(service.status().lastQueuedAt).toBe(before);
});
