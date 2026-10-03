import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { operatorRequest, useOperator } from "@/lib/operator";
import { SourceBrand } from "./source-brand";
import { MemorySetup } from "./memory-setup";
import type { MemoryApp } from "./memory-connections";
import { memorySourceStatus } from "@/lib/memory-source-status";
import "./onboarding-memory-sources.css";

type Scope = keyof MemoryApp["counts"];
const scopesOrder: Scope[] = ["memories", "conversations", "skills"];
const scopeNames: Record<Scope, string> = {
  memories: "Memories",
  conversations: "Conversations",
  skills: "Skills",
};
const sourceIds = ["codex", "claude", "hermes", "chatgpt", "granola"];
const running = (app: MemoryApp) => app.queued || ["scanning", "syncing"].includes(app.status);
const syncable = (app: MemoryApp) => app.available && (app.canSync ?? app.mode !== "import");

export function OnboardingMemorySources() {
  const operator = useOperator();
  const appsQuery = useQuery<{ apps: MemoryApp[]; pollAfterMs?: number }>({
    queryKey: ["memory-connected-apps"],
    queryFn: () => operatorRequest("/memory/apps"),
    staleTime: 5000,
    refetchInterval: (query) =>
      query.state.data?.apps.some(running) ? query.state.data.pollAfterMs || 1500 : 15000,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [scopes, setScopes] = useState({ memories: true, conversations: true, skills: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const apps = appsQuery.data?.apps || [];
  const choices = sourceIds.flatMap((id) => apps.filter((app) => app.id === id));
  async function refreshSources() {
    try {
      setError("");
      await operatorRequest("/memory/apps?refresh=1");
      await appsQuery.refetch();
    } catch (cause) { setError(`Could not refresh local sources: ${(cause as Error).message}`); }
  }
  const selectedApps = choices.filter(
    (app) => selected.includes(app.id) && syncable(app) && !running(app),
  );
  async function startImport() {
    if (!selectedApps.length || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const started: string[] = [],
      failures: string[] = [];
    try {
      for (const app of selectedApps) {
        const included = Object.fromEntries(
          scopesOrder.map((scope) => [scope, scopes[scope] && app.capabilities[scope]]),
        );
        if (!Object.values(included).some(Boolean)) {
          failures.push(`${app.name}: choose an available content type.`);
          continue;
        }
        try {
          await operatorRequest(`/memory/apps/${app.id}`, { enabled: true, scopes: included });
          await operatorRequest(`/memory/apps/${app.id}/sync`, {});
          started.push(app.name);
        } catch (cause) {
          failures.push(`${app.name}: ${(cause as Error).message}`);
        }
      }
      await appsQuery.refetch();
      if (started.length) {
        setNotice(`Import started for ${started.join(", ")}. You can continue while this runs.`);
        void operator.refresh();
      }
      if (failures.length) setError(failures.join(" "));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ws-memory-import ws-source-discovery">
      <div className="ws-discovery-status">
        <span>
          {appsQuery.isPending
            ? "Checking this Mac"
            : appsQuery.isFetching
              ? "Refreshing local sources…"
              : appsQuery.isError
                ? "Check unavailable"
                : "Checked on this Mac"}
        </span>
        <button
          type="button"
          className="ws-icon"
          aria-label="Check local memory sources again"
          disabled={appsQuery.isFetching || busy}
          onClick={() => void refreshSources()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {appsQuery.isPending && (
        <div className="ws-source-loading" role="status">
          <Loader2 size={18} className="motion-safe:animate-spin" />
          <p>Looking for saved memories, conversations and skills.</p>
          <div aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      )}
      {appsQuery.isError && (
        <p className="ws-error" role="alert">
          Couldn’t check your memory sources.{" "}
          <button type="button" onClick={() => void appsQuery.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="ws-source-list">
        {choices.map((app) => {
          const active = running(app), description = memorySourceStatus(app);
          return (
            <article
              key={app.id}
              className={`ws-source-card${selected.includes(app.id) ? " is-selected" : ""}`}
            >
              <label className="ws-source-choice">
                <SourceBrand id={app.id} size={27} />
                <span>
                  <strong>{app.name}</strong>
                  <small>
                    {app.queued
                      ? "Queued"
                      : active
                        ? `${app.status === "scanning" ? "Scanning" : "Importing"} · ${app.progress.processed.toLocaleString()} processed`
                        : description.label}
                  </small>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Import ${app.name} memories`}
                  checked={selected.includes(app.id)}
                  disabled={busy || active || !syncable(app)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, app.id]
                        : current.filter((id) => id !== app.id),
                    )
                  }
                />
              </label>
              {!active && <p className="ws-source-reason">{description.detail}</p>}
              {active && !app.queued && (
                <progress
                  aria-label={`${app.name} import progress`}
                  max={app.progress.total || 1}
                  value={
                    app.progress.total
                      ? Math.min(app.progress.processed, app.progress.total)
                      : undefined
                  }
                />
              )}
              <details className="ws-source-details">
                <summary>
                  What’s included <ChevronDown size={12} />
                </summary>
                <dl>
                  {scopesOrder
                    .filter((scope) => app.capabilities[scope])
                    .map((scope) => (
                      <div key={scope}>
                        <dt>{scopeNames[scope]}</dt>
                        <dd>{(app.counts[scope] || 0).toLocaleString()} files</dd>
                      </div>
                    ))}
                </dl>
                {!!app.discovery?.examples.length && (
                  <ul aria-label={`${app.name} example files`}>
                    {app.discovery.examples.slice(0, 3).map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        <span>{file.name}</span>
                        <small>{scopeNames[file.scope] || file.scope}</small>
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  {app.error ||
                    app.availabilityNote ||
                    "Local files and connected apps are checked separately."}
                </p>
                {app.discovery?.limitations.map((limitation, index) => (
                  <p key={index}>{limitation}</p>
                ))}
                {app.discovery?.checkedAt &&
                  Number.isFinite(Date.parse(app.discovery.checkedAt)) && (
                    <small>
                      Checked{" "}
                      {new Date(app.discovery.checkedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  )}
                {app.progress.hasMore && (
                  <p>
                    {(app.progress.remaining || 0).toLocaleString()} files remain. Import again to
                    continue the next batch.
                  </p>
                )}
                {!app.queued && (app.lastSync || app.lastImport || active) && (
                  <p>
                    {app.progress.added.toLocaleString()} added ·{" "}
                    {app.progress.updated.toLocaleString()} updated ·{" "}
                    {(app.progress.failed || 0).toLocaleString()} failed
                  </p>
                )}
                {app.id === "chatgpt" && !syncable(app) && (
                  <button
                    type="button"
                    className="ws-text-button"
                    onClick={() => setExportOpen(true)}
                  >
                    Choose a ChatGPT export <ArrowRight size={12} />
                  </button>
                )}
                {!app.available && app.id === "granola" && (
                  <button
                    type="button"
                    className="ws-text-button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("agentic:accounts", { detail: { group: "work" } }),
                      )
                    }
                  >
                    Check connected apps <ArrowRight size={12} />
                  </button>
                )}
              </details>
            </article>
          );
        })}
      </div>
      {!!selectedApps.length && (
        <fieldset className="ws-import-scopes">
          <legend>Bring across</legend>
          {scopesOrder.map((scope) => (
            <label key={scope}>
              <input
                type="checkbox"
                checked={scopes[scope]}
                disabled={busy || !selectedApps.some((app) => app.capabilities[scope])}
                onChange={(event) =>
                  setScopes((current) => ({ ...current, [scope]: event.target.checked }))
                }
              />
              {scopeNames[scope]}
            </label>
          ))}
        </fieldset>
      )}
      <div className="ws-import-actions">
        <button
          type="button"
          className="ws-primary"
          disabled={busy || !selectedApps.length || !Object.values(scopes).some(Boolean)}
          onClick={() => void startImport()}
        >
          {busy ? (
            <Loader2 size={14} className="motion-safe:animate-spin" />
          ) : (
            <ArrowRight size={14} />
          )}{" "}
          Import selected
        </button>
        <span>Saved on this Mac.</span>
      </div>
      {notice && (
        <p className="ws-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {!choices.some((app) => app.id === "chatgpt") && !appsQuery.isPending && (
        <button type="button" className="ws-export-entry" onClick={() => setExportOpen(true)}>
          <SourceBrand id="chatgpt" size={23} />
          <span>
            <strong>ChatGPT history</strong>
            <small>Choose a conversations export</small>
          </span>
          <ArrowRight size={14} />
        </button>
      )}
      <MemorySetup
        open={exportOpen}
        onOpenChange={setExportOpen}
        apps={apps}
        loading={appsQuery.isPending}
        loadError={appsQuery.isError ? "Memory sources could not be loaded." : undefined}
        initialApp="chatgpt"
        onRefresh={() => appsQuery.refetch()}
        onAdded={() => {
          void operator.refresh();
          void appsQuery.refetch();
        }}
      />
    </div>
  );
}
