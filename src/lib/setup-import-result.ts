/** A queued or bounded partial import is not a completed import. */
export function setupImportResult(app: {
  queued?: boolean; status: string; lastSync?: string; lastImport?: string; error?: string;
  progress?: { hasMore?: boolean; remaining?: number; deferred?: number; failed?: number };
}, previousStamp: string): "pending" | "complete" | "partial" | "failed" {
  if (app.queued || ["scanning", "syncing"].includes(app.status)) return "pending";
  if (app.status === "error" || app.progress?.failed) return "failed";
  if (app.progress?.hasMore || app.progress?.remaining || app.progress?.deferred || app.error) return "partial";
  const stamp = `${app.lastSync || ""}|${app.lastImport || ""}`;
  return stamp !== previousStamp ? "complete" : "pending";
}
