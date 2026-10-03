import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileUp,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { memorySpaces, operatorRequest, useOperator } from "@/lib/operator";
import { WorkAccountConnectionsPanel, useAccounts } from "./account-connections";
import { MemoryPhotoConnections } from "./memory-photo-connections";
import { SourceBrand } from "./source-brand";
import type { MemoryApp } from "./memory-connections";
import "./memory-setup.css";
type Scope = "memories" | "conversations" | "skills";
const scopes: Scope[] = ["memories", "conversations", "skills"];
const labels = { memories: "Memories", conversations: "Conversations", skills: "Skills" };
const localIds = ["claude", "codex", "hermes"];
function active(app?: MemoryApp) {
  return app?.status === "scanning" || app?.status === "syncing";
}
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read the export. Choose the file again."));
    reader.readAsDataURL(file);
  });
}
function ImportDetails({
  app,
  recheck,
  onRecheck,
}: {
  app: MemoryApp;
  recheck: boolean;
  onRecheck: () => void;
}) {
  const d = app.diagnostics;
  const omitted = d?.omittedRecords || 0;
  if (!app.error && !app.progress.skipped && !d?.recheckFiles && !omitted && !d?.filteredRecords)
    return null;
  return (
    <details className="ms-diagnostics">
      <summary>
        <Info size={12} />
        {d?.recheckFiles
          ? "Some older imports can be checked again"
          : omitted || app.progress.failed || app.error
            ? "Some content needs a closer look"
            : "What was included in this import"}
        <ChevronDown size={11} />
      </summary>
      {d && d.filesTotal > 0 && (
        <>
          <p>
            {d.importedMessages.toLocaleString()} messages imported from{" "}
            {d.filesDetailed.toLocaleString()} checked files
            {!d.detailsComplete ? "; older files do not have a detailed count yet" : ""}.
          </p>
          {d.filteredRecords > 0 && (
            <p>
              {d.filteredRecords.toLocaleString()} tool, image-only or empty records were left out.
              These are not necessarily missing conversations.
            </p>
          )}
          {omitted > 0 && (
            <p>
              {omitted.toLocaleString()} records could not be included. Your original files are
              unchanged.
            </p>
          )}
          {!!d.excludedSavedItems && (
            <p>{d.excludedSavedItems} previously removed items remain excluded.</p>
          )}
          {!!d.issues.length && (
            <ul>
              {d.issues.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>
                  {issue.message}
                  {issue.count > 1 ? ` (${issue.count})` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {(!d || !d.filesTotal) && (
        <p>
          {app.error ||
            `${app.progress.skipped} items were skipped. Other imported memories remain available.`}
        </p>
      )}
      {!!d?.recheckFiles && (
        <button type="button" className="ms-recheck" onClick={onRecheck} aria-pressed={recheck}>
          {recheck ? <Check size={12} /> : <RefreshCw size={12} />}
          {recheck ? "Included in your review" : "Recheck large records"}
        </button>
      )}
    </details>
  );
}

export function MemorySetup({
  open,
  onOpenChange,
  apps,
  loading,
  loadError,
  initialApp = "",
  onRefresh,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: MemoryApp[];
  loading: boolean;
  loadError?: string;
  initialApp?: string;
  onRefresh: () => Promise<unknown>;
  onAdded: () => void;
}) {
  const { state } = useOperator();
  const spaces = memorySpaces(state);
  const accounts = useAccounts();
  const [selectedId, setSelectedId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Record<Scope, boolean>>({
    memories: true,
    conversations: true,
    skills: true,
  });
  const [collection, setCollection] = useState("business");
  const [autoSync, setAutoSync] = useState(false);
  const [file, setFile] = useState<File>();
  const [notionUrl, setNotionUrl] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const selected = apps.find((app) => app.id === selectedId);
  const accountIds: Record<string, string> = { gmail: "google", outlook: "outlook", cal: "cal" };
  const names: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    cal: "Cal.com",
    chatgpt: "ChatGPT",
    granola: "Granola",
    notion: "Notion",
    images: "Photos",
  };
  const choose = useCallback(
    (id: string) => {
      const app = apps.find((candidate) => candidate.id === id);
      setSelectedId(id);
      setFile(undefined);
      setError("");
      setNotice("");
      setRecheck(false);
      setNotionUrl("");
      setNotionToken("");
      setCollection(app?.collection || "business");
      setAutoSync(!!app?.autoSync);
      setSelectedScopes(
        Object.fromEntries(
          scopes.map((scope) => [
            scope,
            !!app?.capabilities[scope] && (app?.enabled ? !!app.scopes[scope] : true),
          ]),
        ) as Record<Scope, boolean>,
      );
    },
    [apps],
  );
  useEffect(() => {
    if (!open) {
      setOpened(false);
      setNotionToken("");
      return;
    }
    if (!opened && !loading) {
      setOpened(true);
      choose(initialApp === "email" ? "gmail" : initialApp === "meetings" ? "granola" : initialApp);
    }
  }, [open, opened, loading, initialApp, choose]);
  async function run(id: string, job: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await job();
      await onRefresh();
      onAdded();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function connectLocal(app: MemoryApp, managed = false) {
    const nextScopes = managed
      ? selectedScopes
      : Object.fromEntries(
          scopes.map((scope) => [
            scope,
            !!app.capabilities[scope] && (app.enabled ? app.scopes[scope] : true),
          ]),
        );
    if (!scopes.some((scope) => nextScopes[scope])) {
      setError("Choose at least one context type.");
      return;
    }
    await run(
      app.id,
      async () => {
        await operatorRequest(`/memory/apps/${app.id}`, {
          enabled: true,
          autoSync: managed ? autoSync : app.autoSync,
          scopes: nextScopes,
          collection: managed ? collection : app.collection,
        });
        await operatorRequest(`/memory/apps/${app.id}/sync`, {});
      },
      `${app.name} is connected. Its memory is updating in the background.`,
    );
  }
  async function signIn(id: string) {
    const provider = accountIds[id];
    const account = accounts.data?.accounts.find((item) => item.id === provider);
    if (!account?.configured || provider === "cal") {
      choose(id);
      return;
    }
    await run(
      id,
      async () => {
        if (account.redirectUri && new URL(account.redirectUri).origin !== location.origin) {
          location.assign(`${new URL(account.redirectUri).origin}/memory?connections=1`);
          return;
        }
        const result = await operatorRequest<{ url: string }>("/connections/start", { provider });
        location.assign(result.url);
      },
      "Continue with your provider to finish connecting.",
    );
  }
  async function importFile() {
    if (!file || !selected) return;
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 32 * 1024 * 1024) {
      setError("Choose a JSON export smaller than 32 MB.");
      return;
    }
    await run(
      selected.id,
      async () =>
        operatorRequest(`/memory/apps/${selected.id}/import`, {
          filename: file.name,
          base64: await fileBase64(file),
          collection,
        }),
      `${selected.name} import started. You can close this window while it finishes.`,
    );
  }
  function status(app?: MemoryApp) {
    if (!app) return "";
    if (active(app)) return `Updating ${app.progress.processed}/${app.progress.total || "…"}`;
    if (app.error || app.progress.failed)
      return `${app.progress.skipped || app.progress.failed || "Items"} to review`;
    if (app.notice) return "Updates next sync";
    if (app.enabled && localIds.includes(app.id)) return "Connected on this Mac";
    if (app.lastImport) return "Saved export";
    return app.available ? "Found on this Mac" : "Not found on this Mac";
  }
  const isAccount = selectedId in accountIds;
  const hasFile = selectedId === "chatgpt" || selectedId === "granola";
  const selectedName = selected?.name || names[selectedId] || "";
  function card(id: string, kind: "local" | "account" | "import") {
    const app = apps.find((item) => item.id === id);
    const account = accounts.data?.accounts.find((item) => item.id === accountIds[id]);
    const connected =
      kind === "account" ? !!account?.connected : kind === "local" && !!app?.enabled;
    const title = app?.name || names[id] || id;
    const subtitle =
      kind === "account"
        ? account?.connected
          ? account.email || "Connected"
          : app?.localSnapshots
            ? `${app.localSnapshots} saved copies · not live`
            : id === "cal"
              ? "Bookings & availability"
              : "Email & calendar"
        : kind === "import"
          ? app?.lastImport
            ? "Saved import"
            : id === "images"
              ? "Your photo library"
              : id === "notion"
                ? "Pages & documents"
                : id === "granola"
                  ? "Meeting notes"
                  : "Conversation export"
          : status(app);
    const label =
      busy === id
        ? "Connecting…"
        : connected
          ? "Connected"
          : kind === "import"
            ? "Import"
            : kind === "local" && !app?.available
              ? "Unavailable"
              : "Connect";
    return (
      <article className="mx-app" key={id} data-connected={connected}>
        <div className="mx-app-top">
          <SourceBrand id={id} size={38} circle />
          <button
            type="button"
            className="mx-manage"
            aria-label={`Manage ${title}`}
            onClick={() => choose(id)}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
        <strong>{title}</strong>
        <small title={subtitle}>{subtitle}</small>
        <button
          type="button"
          className={`mx-app-action${connected ? " is-connected" : ""}`}
          disabled={!!busy || active(app) || (kind === "local" && !app?.available)}
          onClick={() =>
            connected || kind === "import"
              ? choose(id)
              : kind === "local" && app
                ? void connectLocal(app)
                : void signIn(id)
          }
        >
          {busy === id || active(app) ? (
            <Loader2 size={12} className="animate-spin" />
          ) : connected ? (
            <Check size={12} />
          ) : (
            <ArrowRight size={12} />
          )}
          {active(app) ? "Updating…" : label}
        </button>
      </article>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="op-modal mx-dialog">
        <header className="mx-header">
          {selectedId ? (
            <button className="mx-back" type="button" onClick={() => choose("")}>
              <ArrowLeft size={13} />
              All connections
            </button>
          ) : (
            <span className="mx-kicker">
              <span />
              CONNECTED MEMORY
            </span>
          )}
          <DialogTitle aria-label={selectedId ? selectedName : "Connect your world."}>
            {selectedId ? (
              <>
                <SourceBrand id={selectedId} size={34} circle />
                {selectedName}
              </>
            ) : (
              "Connect your world."
            )}
          </DialogTitle>
          <DialogDescription>
            {selectedId
              ? localIds.includes(selectedId)
                ? "Choose what this app remembers."
                : isAccount
                  ? "Connect once. Keep your email and calendar together."
                  : "Bring the context you want to keep."
              : "Your apps. One memory. Add a connection whenever you need it."}
          </DialogDescription>
        </header>
        <div className="mx-body">
          {(error || loadError) && (
            <div className="mx-feedback" role="alert">
              {error || "Could not check your connections. Try again."}
            </div>
          )}
          {notice && (
            <div className="mx-feedback is-success" role="status">
              <Check size={13} />
              {notice}
            </div>
          )}
          {loading ? (
            <p className="mx-loading">
              <Loader2 size={16} className="animate-spin" />
              Finding your apps…
            </p>
          ) : !selectedId ? (
            <>
              <section className="mx-group">
                <h3>
                  On this Mac <span>Detected automatically</span>
                </h3>
                <div className="mx-grid">{localIds.map((id) => card(id, "local"))}</div>
              </section>
              <section className="mx-group">
                <h3>Email & calendar</h3>
                <div className="mx-grid">
                  {["gmail", "outlook", "cal"].map((id) => card(id, "account"))}
                </div>
              </section>
              <section className="mx-group">
                <h3>
                  More of your knowledge <span>Import a saved copy</span>
                </h3>
                <div className="mx-grid">
                  {["chatgpt", "granola", "notion", "images"].map((id) => card(id, "import"))}
                </div>
              </section>
            </>
          ) : (
            <>
              {selectedId === "images" ? (
                <MemoryPhotoConnections
                  onDevice={() => {
                    onOpenChange(false);
                    window.dispatchEvent(new Event("memory:add-photos"));
                  }}
                  onImported={onAdded}
                />
              ) : isAccount ? (
                <div className="mx-direct-account">
                  <WorkAccountConnectionsPanel
                    guided
                    directProvider={accountIds[selectedId]}
                    onBack={() => choose("")}
                    key={accountIds[selectedId]}
                  />
                  {!!selected?.localSnapshots && (
                    <div className="mx-saved-mail">
                      <span>
                        <strong>{selected.localSnapshots} saved emails are already here.</strong>
                        <small>Use these copies without connecting a live account.</small>
                      </span>
                      <button
                        className="mx-secondary"
                        disabled={!!busy || active(selected)}
                        onClick={() =>
                          void run(
                            selectedId,
                            () =>
                              operatorRequest(`/memory/apps/${selectedId}/import`, { collection }),
                            "Saved email copies are being added to memory. No new mail was fetched.",
                          )
                        }
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : null}Use saved
                        emails
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {selected && localIds.includes(selectedId) && (
                    <>
                      <div className="mx-scope-options">
                        {scopes
                          .filter((scope) => selected.capabilities[scope])
                          .map((scope) => (
                            <label key={scope}>
                              <input
                                type="checkbox"
                                checked={selectedScopes[scope]}
                                onChange={(event) =>
                                  setSelectedScopes({
                                    ...selectedScopes,
                                    [scope]: event.target.checked,
                                  })
                                }
                              />
                              {labels[scope]}
                              <small>{selected.counts[scope].toLocaleString()} found</small>
                            </label>
                          ))}
                      </div>
                      <label className="mx-autosync">
                        <input
                          type="checkbox"
                          checked={autoSync}
                          onChange={(event) => setAutoSync(event.target.checked)}
                        />
                        <span>
                          Keep this app up to date
                          <small>Every five minutes while your OS is running.</small>
                        </span>
                      </label>
                      {selected.notice && <p className="mx-help">{selected.notice}</p>}
                      <ImportDetails
                        app={selected}
                        recheck={recheck}
                        onRecheck={() => {
                          setRecheck(!recheck);
                        }}
                      />
                    </>
                  )}
                  {hasFile && (
                    <label className="mx-upload">
                      <FileUp size={25} />
                      <strong>{file?.name || "Choose your export"}</strong>
                      <span>
                        {selectedId === "chatgpt"
                          ? "conversations.json from your ChatGPT export"
                          : "A Granola meeting-notes JSON export"}
                      </span>
                      <small>JSON · up to 32 MB</small>
                      <input
                        type="file"
                        accept=".json,application/json"
                        aria-label={`${selectedName} JSON export`}
                        onChange={(event) => setFile(event.target.files?.[0])}
                      />
                    </label>
                  )}
                  {selectedId === "notion" && (
                    <div className="mx-fields">
                      <label>
                        Page URL
                        <input
                          type="url"
                          value={notionUrl}
                          onChange={(event) => setNotionUrl(event.target.value)}
                          placeholder="https://www.notion.so/…"
                        />
                      </label>
                      {!selected?.available && (
                        <label>
                          Integration token
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={notionToken}
                            onChange={(event) => setNotionToken(event.target.value)}
                          />
                          <small>
                            Share the page with your integration in Notion. The token stays on this
                            Mac.
                          </small>
                        </label>
                      )}
                    </div>
                  )}
                  <label className="mx-destination">
                    Save into
                    <select
                      aria-label="Knowledge space"
                      value={collection}
                      onChange={(event) => setCollection(event.target.value)}
                    >
                      {spaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mx-detail-actions">
                    {selected?.enabled && localIds.includes(selectedId) && (
                      <button
                        className="mx-pause"
                        disabled={!!busy || active(selected)}
                        onClick={() =>
                          void run(
                            selectedId,
                            () =>
                              operatorRequest(`/memory/apps/${selectedId}`, {
                                enabled: false,
                                autoSync: false,
                              }),
                            "Imports paused. Your saved memories remain available.",
                          )
                        }
                      >
                        Pause imports
                      </button>
                    )}
                    <button
                      className="mx-primary"
                      disabled={
                        !!busy ||
                        active(selected) ||
                        (hasFile && !file) ||
                        (selectedId === "notion" && !notionUrl.trim())
                      }
                      onClick={() =>
                        selected && localIds.includes(selectedId)
                          ? void connectLocal(selected, true)
                          : hasFile
                            ? void importFile()
                            : void run(
                                "notion",
                                async () => {
                                  if (notionToken.trim())
                                    await operatorRequest("/memory/notion-config", {
                                      token: notionToken.trim(),
                                    });
                                  else if (!selected?.available)
                                    throw new Error("Add your Notion integration token.");
                                  await operatorRequest("/memory/import-notion", {
                                    url: notionUrl.trim(),
                                    collection,
                                  });
                                  setNotionToken("");
                                },
                                "Notion page imported.",
                              )
                      }
                    >
                      {busy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ArrowRight size={13} />
                      )}
                      {busy
                        ? "Working…"
                        : hasFile || selectedId === "notion"
                          ? "Import"
                          : recheck
                            ? "Save & recheck"
                            : "Save & sync"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <footer className="mx-footer">
          <span>Sources stay yours. You choose what your AI can use.</span>
          <button type="button" disabled={!!busy} onClick={() => onOpenChange(false)}>
            Done
            <Check size={12} />
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
