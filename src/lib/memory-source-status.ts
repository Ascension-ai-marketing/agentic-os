/** Local history availability is independent of an app's model sign-in. */
type SourceStatus = {
  id: string;
  available: boolean;
  availabilityNote?: string;
  error?: string;
  status: string;
  lastImport?: string;
  lastSync?: string;
  counts: Record<string, number>;
  progress: { processed: number; failed?: number; skipped?: number; hasMore?: boolean; remaining?: number };
};
export function memorySourceStatus(app: SourceStatus) {
  const count = Object.values(app.counts).reduce((sum, value) => sum + value, 0);
  const failed = app.progress.failed || 0;
  const checked = Math.max(0, app.progress.processed - failed);
  if (app.progress.hasMore && app.status !== "error")
    return { label: "More to import", detail: `${checked.toLocaleString()} files processed. Import again to continue the next bounded batch; saved memories stay available.` };
  if (app.error && app.status === "error") {
    const legacySize = /exceeds the 64 MiB file limit/.test(app.error) && /\.jsonl/.test(app.error);
    return {
      label: legacySize ? "Large conversation ready to retry" : failed ? `${failed} file${failed === 1 ? "" : "s"} need${failed === 1 ? "s" : ""} retry` : "Import paused",
      detail: `${checked ? `${checked.toLocaleString()} files already processed. ` : ""}${legacySize ? "The earlier import stopped at its size limit. Large conversations now stream in their own batch; import again to continue." : app.error}`,
    };
  }
  if (count)
    return { label: `${count.toLocaleString()} files found`, detail: "Saved local files are available to import. Model sign-in is checked separately and is not required to read this history." };
  if (app.id === "chatgpt")
    return { label: "Export needed", detail: "ChatGPT does not expose its full chat history as local files. Import conversations.json from your ChatGPT data export; signing in or connecting an app does not provide that archive." };
  if (app.id === "granola" && /encrypted/i.test(app.availabilityNote || ""))
    return { label: "Notes stored encrypted", detail: "Granola was found, but this version encrypts its local notes. Import a notes export, or use an authorized Granola connection; no account keys are read." };
  return {
    label: app.lastImport || app.lastSync ? "Saved import available" : "No saved files found",
    detail: app.availabilityNote || "No supported local history files were found. Open What’s included to see the checked folders, or import an export.",
  };
}
