import { expect, test } from "bun:test";
import { setupImportResult } from "../src/lib/setup-import-result";
const before = "old|";
test("setup confirms a new completed receipt before celebrating", () => {
 expect(setupImportResult({ status: "idle", lastSync: "new" }, before)).toBe("complete");
 expect(setupImportResult({ status: "idle", lastImport: "new" }, before)).toBe("complete");
 expect(setupImportResult({ status: "idle", lastSync: "old" }, before)).toBe("pending");
 expect(setupImportResult({ status: "syncing", lastSync: "new" }, before)).toBe("pending");
 expect(setupImportResult({ status: "idle", queued: true, lastSync: "new" }, before)).toBe("pending");
});
test("partial, deferred, failed or interrupted histories are not complete", () => {
 for (const progress of [{ hasMore: true }, { deferred: 1 }, { remaining: 4 }])
  expect(setupImportResult({ status: "idle", lastSync: "new", progress }, before)).toBe("partial");
 expect(setupImportResult({ status: "idle", lastSync: "new", progress: { failed: 1 } }, before)).toBe("failed");
 expect(setupImportResult({ status: "error", lastSync: "new" }, before)).toBe("failed");
 expect(setupImportResult({ status: "idle", lastSync: "old", error: "Bounded sync: more remains" }, before)).toBe("partial");
});
