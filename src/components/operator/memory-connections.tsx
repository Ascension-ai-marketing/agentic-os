import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, MoreHorizontal, SlidersHorizontal, Loader2, RefreshCw } from "lucide-react";
import { operatorRequest, useOperator, type OperatorState } from "@/lib/operator";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  BRAIN_SOURCES,
  brainEnabled,
  brainSourceCounts,
  type BrainSourceId,
} from "@/lib/brain-sources";
import { useLiveData } from "@/lib/use-live-data";
import type { BusinessWorkspace } from "@/lib/business-workspace";
import { MemorySetup } from "./memory-setup";
import { SourceBrand } from "./source-brand";
import { BrainSourceLogo } from "@/components/brain/brain-source";
import {
  BrainConnectCards,
  agoText,
  useMemoryRefresh,
  useSourceLinks,
} from "@/components/brain/brain-connect";
import "./memory-connections.css";

type Scope = "memories" | "conversations" | "skills";
type Scopes = Record<Scope, boolean>;
export type MemoryApp = {
  id: string;
  name: string;
  available: boolean;
  availabilityNote: string;
  capabilities: Scopes;
  counts: Record<Scope, number>;
  enabled: boolean;
  autoSync: boolean;
  scopes: Scopes;
  collection: string;
  lastSync?: string;
  lastImport?: string;
  error?: string;
  notice?: string;
  warnings?: string[];
  /** A finished pass that skipped some records (oversized or malformed) but imported the rest. */
  warning?: string;
  status: "idle" | "scanning" | "syncing" | "error";
  connectionMethod?: "mcp" | "api";
  mode?: "local" | "account" | "api" | "import";
  setupAction?: "accounts" | "import" | "notion";
  origin?: string;
  accountProvider?: string;
  accountConnected?: boolean;
  accountConfigured?: boolean;
  diagnostics?: {
    importedMessages: number;
    filteredRecords: number;
    omittedRecords: number;
    excludedSavedItems: number;
    filesDetailed: number;
    filesTotal: number;
    detailsComplete: boolean;
    recheckFiles: number;
    deferredFiles?: number;
    recordLimitBytes: number;
    filtering: string;
    issues: Array<{ code: string; count: number; file?: string; message: string }>;
  };
  localSnapshots?: number;
  discovery?: {
    checkedAt: string;
    blocked?: string;
    fileCount: number;
    totalBytes: number;
    categories: Array<{ scope: Scope; count: number; bytes: number }>;
    examples: Array<{ name: string; scope: Scope; bytes: number }>;
    roots: string[];
    limitations: string[];
  };
  canSync?: boolean;
  queued?: boolean;
  progress: {
    processed: number;
    total: number;
    added: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed?: number;
    deferred?: number;
    remaining?: number;
    hasMore?: boolean;
  };
};
type MemoryApps = { apps: MemoryApp[]; pollAfterMs?: number; refresh?: { daily: boolean; nextAt?: string; note: string } };
type SyncSummary = {
  queued: string[];
  skipped: Array<{ id: string; reason: string }>;
  alreadyRunning: string[];
  bounded: true;
};
const primarySources: BrainSourceId[] = [
  "business",
  "claude",
  "codex",
  "chatgpt",
  "email",
  "meetings",
  "notion",
  "skills",
  "hermes",
  "images",
];
const sourceNames: Record<string, string> = {
  business: "Info",
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT",
  email: "Email",
  meetings: "Meetings",
  skills: "Skills",
  hermes: "Hermes",
  personal: "Personal",
  manual: "Your notes",
  web: "Web & videos",
  openclaw: "OpenClaw",
  grokbot: "Grok",
  files: "Files",
  obsidian: "Obsidian",
  agents: "Agents",
  codebases: "Codebases",
  notion: "Notion",
  images: "Photos",
};
function running(app: MemoryApp) {
  return app.queued || app.status === "scanning" || app.status === "syncing";
}
function syncable(app: MemoryApp) {
  return app.canSync ?? app.mode !== "import";
}
function completedStamp(app: MemoryApp) {
  return [app.lastSync || "", app.lastImport || ""].join("|");
}
function recentSync(iso?: string) {
  if (!iso) return "Not synced yet";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(minutes)) return "Synced";
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  if (minutes < 1440) return `Synced ${Math.floor(minutes / 60)}h ago`;
  return `Synced ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
export function MemoryConnections({
  onAdded,
  onImport,
}: {
  onAdded: () => void;
  onImport: (id: string) => void;
}) {
  const { state, refresh } = useOperator();
  const live = useLiveData();
  const queryClient = useQueryClient();
  const sourceCounts = brainSourceCounts(state, live);
  const { links } = useSourceLinks();
  const linkOf = (id: string) => links.find((l) => l.id === id);
  const openLinks = links.filter((l) => l.state === "needs");
  const memoryRefresh = useMemoryRefresh();
  const [connectOpen, setConnectOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceBusy, setSourceBusy] = useState("");
  const sourceQueue = useRef<{
    desired: Record<string, boolean>;
    persisted: Record<string, boolean>;
    revision: number;
    sequence: number;
    versions: Record<string, number>;
    active: boolean;
    changed: Set<string>;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const initialView = useRef(false);
  const [initialApp, setInitialApp] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncSummary, setSyncSummary] = useState<SyncSummary>();
  const seenSyncs = useRef(new Map<string, string>());
  const callback = useRef(onAdded);
  callback.current = onAdded;
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const appsQuery = useQuery<MemoryApps>({
    queryKey: ["memory-connected-apps"],
    enabled: ready,
    queryFn: () => operatorRequest("/memory/apps"),
    refetchInterval: (query) =>
      query.state.data?.apps.some(running)
        ? query.state.data.pollAfterMs || 1500
        : expanded
          ? 8000
          : 30000,
  });
  const businessQuery = useQuery<BusinessWorkspace>({
    queryKey: ["business-workspace"],
    enabled: ready,
    queryFn: () => operatorRequest("/business"),
    staleTime: 30000,
    retry: 1,
  });
  const archiveQuery = useQuery<{ total: number; fullBodies?: number; metadata?: number }>({
    queryKey: ["mail-archive-status"],
    enabled: ready,
    queryFn: () => operatorRequest("/mail-archive/status"),
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });
  const business = businessQuery.data;
  const businessSaved =
    !!business &&
    (!!business.finances ||
      !!business.snapshots?.length ||
      Object.values(business.profile || {}).some(Boolean) ||
      !!business.progress?.goals?.length ||
      !!business.progress?.updates?.length);
  const apps = appsQuery.data?.apps || [];
  useEffect(() => {
    const open = (event: Event) => {
      const requested = String((event as CustomEvent<{ app?: string }>).detail?.app || "");
      setInitialApp(requested);
      setExpanded(true);
    };
    const showSources = () => setSourcesOpen(true);
    const showConnect = () => setConnectOpen(true);
    window.addEventListener("memory:connect-sources", showConnect);
    window.addEventListener("memory:connect", open);
    window.addEventListener("memory:sources", showSources);
    return () => {
      window.removeEventListener("memory:connect", open);
      window.removeEventListener("memory:sources", showSources);
      window.removeEventListener("memory:connect-sources", showConnect);
    };
  }, []);
  useEffect(() => {
    if (!appsQuery.data) return;
    if (!initialView.current) {
      initialView.current = true;
      for (const app of appsQuery.data.apps) seenSyncs.current.set(app.id, completedStamp(app));
      return;
    }
    for (const app of appsQuery.data.apps) {
      const previous = seenSyncs.current.get(app.id) || "|";
      if (!running(app) && (app.lastSync || app.lastImport) && completedStamp(app) !== previous) {
        seenSyncs.current.set(app.id, completedStamp(app));
        callback.current();
        const added = app.progress?.added || 0,
          updated = app.progress?.updated || 0,
          skipped = app.progress?.skipped || 0;
        const result = `${added} added${updated ? ` · ${updated} refreshed` : ""}${skipped ? ` · ${skipped} skipped` : ""}`;
        if (app.error || app.status === "error" || app.progress?.failed) {
          setNotice("");
          setError(`${app.name}: ${result}. Open setup to review what was left out.`);
        } else {
          setError("");
          setNotice(`${app.name} ${!syncable(app) ? "import" : "sync"} finished. ${result}.${app.warning ? ` ${app.warning}` : ""}`);
        }
      }
    }
  }, [appsQuery.data]);
  function openSetup(id = "") {
    setInitialApp(id);
    setExpanded(true);
    setError("");
    setNotice("");
  }
  async function setSourceInclusion(ids: string[], enabled: boolean) {
    let queue = sourceQueue.current;
    if (!queue) {
      const current = queryClient.getQueryData<OperatorState>(["operator-state"]) || state;
      queue = {
        desired: { ...current.brainSources },
        persisted: { ...current.brainSources },
        revision: current.brainRevision || 0,
        sequence: 0,
        versions: {},
        active: false,
        changed: new Set(),
      };
      sourceQueue.current = queue;
    }
    const job = queue;
    job.sequence++;
    for (const id of ids) {
      job.desired[id] = enabled;
      job.versions[id] = job.sequence;
      job.changed.add(id);
    }
    function publish(pending: boolean) {
      const sourceMap = { ...job.desired };
      queryClient.setQueryData<OperatorState>(["operator-state"], (current) =>
        current
          ? { ...current, brainSources: sourceMap, brainRevision: job.revision + (pending ? 1 : 0) }
          : current,
      );
      const fullMap = Object.fromEntries(
        BRAIN_SOURCES.map((source) => [source.id, sourceMap[source.id] !== false]),
      );
      window.dispatchEvent(
        new CustomEvent("memory:source-preview", { detail: { sources: fullMap, pending } }),
      );
    }
    setSourceBusy(ids.length === 1 ? ids[0] : "all");
    setError("");
    publish(true);
    if (job.active) return;
    job.active = true;
    await queryClient.cancelQueries({ queryKey: ["operator-state"] }, { revert: false });
    publish(true);
    try {
      while (true) {
        const changes = BRAIN_SOURCES.map((source) => source.id).filter(
          (id) =>
            job.changed.has(id) && (job.desired[id] !== false) !== (job.persisted[id] !== false),
        );
        if (!changes.length) break;
        const targetEnabled = job.desired[changes[0]] !== false;
        const group = changes.filter((id) => (job.desired[id] !== false) === targetEnabled);
        const submittedSequence = job.sequence;
        try {
          const result = await operatorRequest<{
            brainSources?: Record<string, boolean>;
            brainRevision: number;
          }>(
            "/brain/sources",
            group.length === 1
              ? { id: group[0], enabled: targetEnabled }
              : { ids: group, enabled: targetEnabled },
          );
          job.persisted = result.brainSources || {
            ...job.persisted,
            ...Object.fromEntries(group.map((id) => [id, targetEnabled])),
          };
          job.revision = result.brainRevision;
        } catch (e) {
          setError((e as Error).message);
          try {
            const current = await operatorRequest<{
              brainSources: Record<string, boolean>;
              brainRevision: number;
            }>("/brain/sources");
            job.persisted = current.brainSources;
            job.revision = current.brainRevision;
          } catch {
            /* Keep the last confirmed settings when reconciliation is unavailable. */
          }
          for (const id of group)
            if ((job.versions[id] || 0) <= submittedSequence)
              job.desired[id] = job.persisted[id] !== false;
        }
        for (const source of BRAIN_SOURCES)
          if (!job.changed.has(source.id))
            job.desired[source.id] = job.persisted[source.id] !== false;
        publish(true);
      }
    } finally {
      publish(false);
      window.dispatchEvent(
        new CustomEvent("operator:brain-change", {
          detail: { sourcesOnly: true, ids: [...job.changed] },
        }),
      );
      sourceQueue.current = null;
      setSourceBusy("");
    }
  }
  function sourceApps(id: string) {
    if (id === "email") return apps.filter((app) => ["gmail", "outlook"].includes(app.id));
    if (id === "meetings") return apps.filter((app) => app.id === "granola");
    if (id === "skills") return apps.filter((app) => app.capabilities.skills && app.scopes.skills);
    return apps.filter((app) => app.id === id);
  }
  function sourceStatus(id: string) {
    const related = sourceApps(id);
    const active = related.find(running);
    const failed =
      id === "skills" ? undefined : related.find((app) => app.error || app.status === "error");
    const count = sourceCounts[id] || { saved: 0, mapped: 0 };
    if (failed)
      return {
        tone: "attention",
        text:
          (failed.lastSync || failed.lastImport) &&
          failed.progress.processed === failed.progress.total &&
          !failed.progress.failed &&
          failed.progress.skipped
            ? `${failed.progress.skipped} ${failed.progress.skipped === 1 ? "item" : "items"} skipped`
            : `Could not refresh: ${(failed.error || "no reason given").split(/[.\n]/)[0].slice(0, 60)}`,
        detail: `${failed.name} could not refresh. ${failed.error || ""} Press Refresh all to try again.`,
      };
    if (active)
      return {
        tone: "working",
        text: active.queued
          ? "Waiting to refresh"
          : `Refreshing${active.progress.total ? ` ${active.progress.processed}/${active.progress.total}` : "…"}`,
        detail: `${active.name} is refreshing.`,
        progress: active.queued ? undefined : active.progress,
      };
    // Library batches finish on their own during Refresh all; they are not something to fix.
    const remaining = id === "skills" ? [] : related.filter((app) => app.progress.hasMore);
    if (remaining.length)
      return {
        tone: "attention",
        text: "Importing in batches",
        detail: `${remaining.reduce((sum, app) => sum + (app.progress.remaining || 0), 0).toLocaleString()} files left. They finish on their own.`,
      };
    const skipped =
      id === "skills" ? 0 : related.reduce((sum, app) => sum + (app.progress.skipped || 0), 0);
    if (skipped)
      return {
        tone: "attention",
        text: `${skipped} ${skipped === 1 ? "item" : "items"} to review`,
        detail: `Choose Connect a source, then ${related.map((app) => app.name).join(" or ")}, to review what was left out.`,
      };
    if (id === "business" && businessQuery.isError)
      return {
        tone: "attention",
        text: "Check connection",
        detail: "Could not check saved dashboard context.",
      };
    if (id === "business" && businessSaved)
      return {
        tone: "healthy",
        text: count.saved ? `${count.saved.toLocaleString()} saved` : "Saved context",
        detail:
          "Company information and saved Dashboard observations. Account authorization stays in Connections.",
      };
    if (id === "email")
      return {
        tone: archiveQuery.data?.total || count.saved || count.mapped ? "healthy" : "waiting",
        text: archiveQuery.data?.total ? `${archiveQuery.data.total.toLocaleString()} emails indexed` : count.saved ? `${count.saved.toLocaleString()} saved notes` : count.mapped ? `${count.mapped.toLocaleString()} messages in the map` : "No saved email notes",
        detail: `${count.saved.toLocaleString()} email notes are saved in Memory. Mailbox search is separate; open Inbox to search indexed mail.`,
      };
    if (id === "meetings" && !count.saved) return {
      tone: "waiting", text: "No notes imported",
      detail: related.some(app => app.available) ? "Granola is available, but no meeting notes are saved in Memory yet. This switch permits recall; choose Connect a source → Granola to import your notes." : "No meeting notes are saved. This switch controls recall, not an account connection.",
    };
    if (id === "meetings" && count.saved) return {
      tone: "healthy", text: `${count.saved.toLocaleString()} imported notes`,
      detail: `${count.saved.toLocaleString()} meeting notes saved locally. Recent Granola imports cover a limited date window, not your entire meeting history.`,
    };
    if (count.saved)
      return {
        tone: "healthy",
        text: `${count.saved.toLocaleString()} saved`,
        detail: `${count.saved.toLocaleString()} saved memories. Sync and inclusion are separate settings.`,
      };
    const snapshots = related.reduce((sum, app) => sum + (app.localSnapshots || 0), 0);
    if (snapshots)
      return {
        tone: "healthy",
        text: `${snapshots} saved copies`,
        detail: "Saved email copies. Refreshing these does not fetch new mail.",
      };
    if (count.mapped)
      return {
        tone: "healthy",
        text: `${count.mapped.toLocaleString()} indexed`,
        detail: "Context already indexed from this workspace.",
      };
    const stamp = related
      .map((app) => app.lastImport || app.lastSync)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1);
    if (stamp)
      return {
        tone: "healthy",
        text: "Imported",
        detail: recentSync(stamp).replace("Synced", "Imported"),
      };
    return {
      tone: "waiting",
      text: "",
      detail: "Add a source to bring context into this category.",
    };
  }
  function configureSource(id: string) {
    setSourcesOpen(false);
    if (id === "business") {
      window.location.assign("/business?view=connections");
      return;
    }
    if (id === "images") {
      openSetup("images");
      return;
    }
    const candidates = sourceApps(id);
    if (candidates.length) {
      openSetup(candidates[0].id);
      return;
    }
    onImport(id);
  }
  async function syncAll() {
    if (busy || !ready) return;
    setBusy("all");
    setError("");
    setNotice("");
    setSyncSummary(undefined);
    try {
      const result = await operatorRequest<SyncSummary>("/memory/apps/sync-all", {});
      setSyncSummary(result);
      await Promise.allSettled([appsQuery.refetch(), refresh()]);
      void queryClient.invalidateQueries({ queryKey: ["memory-graph-context"] });
      window.dispatchEvent(new Event("operator:brain-change"));
      setNotice(
        result.queued.length
          ? "Refresh started. Review progress by source."
          : result.alreadyRunning.length
            ? "Some sources are already running."
            : "No source was queued. Review the results.",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  const appName = (id: string) =>
    apps.find((app) => app.id === id)?.name || (id === "info" ? "Info" : sourceNames[id]) || id;
  const feedback = error || notice;
  const allSourceIds = BRAIN_SOURCES.map((source) => source.id);
  const enabledCount = allSourceIds.filter((id) => brainEnabled(state, id)).length;
  function sourceButton(id: BrainSourceId, compact = false) {
    const link = linkOf(id);
    const base = sourceStatus(id);
    // Running and failed states win; otherwise the plain connection line.
    const status =
      link && base.tone !== "working" && base.tone !== "attention"
        ? { ...base, tone: link.state === "connected" ? "healthy" : "waiting", text: link.line, detail: link.body }
        : base,
      enabled = brainEnabled(state, id),
      name = sourceNames[id] || id;
    const needsYou = !compact && link && link.state === "needs";
    return (
      <div className="mc-source-line" key={id} data-link={link?.state}>
      <button
        type="button"
        className={`mc-source-toggle${compact ? " is-grid" : ""}`}
        key={id}
        aria-label={needsYou ? `Connect ${name}` : `${name} AI context`}
        aria-pressed={needsYou ? undefined : enabled}
        onClick={() => (needsYou ? setConnectOpen(true) : void setSourceInclusion([id], !enabled))}
        title={needsYou ? status.detail : `${enabled ? "Included" : "Excluded"} in AI context. ${status.detail}`}
        data-status={status.tone}
      >
        <span className="mc-brand-circle mc-brand-tile">
          <BrainSourceLogo origin={id} size={compact ? 40 : 28} />

        </span>
        <span className="mc-source-label">
          <strong>{name}</strong>
          {(!enabled || status.text) && <small>{enabled ? status.text : "Off"}</small>}
        </span>
        {!compact && !needsYou && (
          <span className="mc-source-state" aria-hidden="true">
            <span />
          </span>
        )}
        {needsYou && <span className="mc-connect-chip">Set up</span>}
        {!compact && link?.progress && (
          <i
            className="mc-row-progress"
            style={{
              ["--p" as string]: link.progress.total
                ? `${Math.min(100, Math.round((100 * link.progress.done) / link.progress.total))}%`
                : "30%",
            }}
          />
        )}
        {enabled && status.progress && !compact && (
          <progress
            aria-label={`${name} import progress`}
            max={status.progress.total || 1}
            value={
              status.progress.total
                ? Math.min(status.progress.processed, status.progress.total)
                : undefined
            }
          />
        )}
      </button>
      </div>
    );
  }
  return (
    <>
      <section className="memory-connections" aria-label="Memory sources">
        <div className="mc-source-shelf">
          <header className="mc-shelf-heading">
            <span>Memory sources</span>
            <div className="mc-inclusion-actions">
              <button type="button" onClick={() => setSourcesOpen(true)} aria-haspopup="dialog">
                All sources
              </button>
            </div>
          </header>
          <div className="mc-source-row">{primarySources.map((id) => sourceButton(id))}</div>
          <footer className="mc-shelf-actions mc-shelf-simple">
            {!!openLinks.length && (
              <button
                type="button"
                className="mc-connect-more"
                onClick={() => setConnectOpen(true)}
                aria-haspopup="dialog"
              >
                <span>
                  Connect {openLinks.map((l) => l.name).join(", ")}
                </span>
                <ArrowRight size={13} />
              </button>
            )}
            <button
              type="button"
              className="mc-refresh-all"
              disabled={memoryRefresh.busy || !ready}
              onClick={() => void memoryRefresh.refreshAll()}
              title="Re-reads Codex, Claude, Hermes and your notes on this Mac, and refreshes every connected app."
            >
              <RefreshCw size={13} />
              <span>Refresh all</span>
            </button>
            <label className="mc-refresh-meta" title={appsQuery.data?.refresh?.note}>
              <input
                type="checkbox"
                checked={!!appsQuery.data?.refresh?.daily}
                disabled={busy === "daily" || !appsQuery.data?.refresh}
                onChange={async (e) => {
                  const daily = e.target.checked;
                  setBusy("daily");
                  setError("");
                  try {
                    await operatorRequest("/memory/apps/refresh-settings", { daily });
                    await appsQuery.refetch();
                  } catch (cause) {
                    setError((cause as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              />
              <span>
                {memoryRefresh.busy
                  ? "Refreshing"
                  : memoryRefresh.updatedAt
                    ? `Updated ${agoText(memoryRefresh.updatedAt)}`
                    : "Reading this Mac"}
                {appsQuery.data?.refresh
                  ? appsQuery.data.refresh.daily
                    ? " · refreshes every day"
                    : " · daily refresh off"
                  : ""}
              </span>
            </label>
            {memoryRefresh.message && !memoryRefresh.busy && (
              <small className="mc-refresh-note" role="status">
                {memoryRefresh.message}
              </small>
            )}
          </footer>
        </div>
        {syncSummary && (
          <details className="mc-sync-summary" open>
            <summary>Refresh results</summary>
            {!!syncSummary.queued.length && (
              <p>Queued: {syncSummary.queued.map(appName).join(", ")}.</p>
            )}
            {!!syncSummary.alreadyRunning.length && (
              <p>Already running: {syncSummary.alreadyRunning.map(appName).join(", ")}.</p>
            )}
            <p>
              Enabled sources only. Large imports continue in batches; use Sync all again if files
              remain.
            </p>
            {!!syncSummary.skipped.length && (
              <ul>
                {syncSummary.skipped.map((source) => (
                  <li key={source.id}>
                    <strong>{appName(source.id)}</strong>
                    <span>{source.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        {!expanded && (feedback || appsQuery.error) && (
          <div className="mc-strip-feedback" role={error || appsQuery.error ? "alert" : "status"}>
            <span title={feedback || "Could not check memory sources"}>
              {feedback ||
                `Could not check memory sources. ${(appsQuery.error as Error)?.message || ""}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setError("");
                setNotice("");
                if (appsQuery.error) void appsQuery.refetch();
              }}
            >
              {appsQuery.error ? "Retry" : "Dismiss"}
            </button>
          </div>
        )}
      </section>
      <MemorySetup
        open={expanded}
        onOpenChange={setExpanded}
        initialApp={initialApp}
        apps={apps}
        loading={!appsQuery.data && !appsQuery.error}
        loadError={(appsQuery.error as Error)?.message}
        onRefresh={() => appsQuery.refetch()}
        onAdded={onAdded}
      />
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="op-modal mc-connect-dialog">
          <div className="mc-dialog-heading">
            <DialogTitle>Connect your sources</DialogTitle>
            <DialogDescription>
              Each card says what is true now and the one thing to do. After that it refreshes on
              its own.
            </DialogDescription>
          </div>
          <BrainConnectCards />
          <button
            type="button"
            className="mc-connect-files"
            onClick={() => {
              setConnectOpen(false);
              openSetup();
            }}
          >
            Import files from a folder instead
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="op-modal mc-all-sources-dialog">
          <div className="mc-dialog-heading">
            <DialogTitle>Your sources</DialogTitle>
            <DialogDescription>
              Click a logo to include or exclude its context. Use the dots for setup.
            </DialogDescription>
          </div>
          <div className="mc-all-source-actions">
            <span>
              {enabledCount} of {allSourceIds.length} included
            </span>
            <button
              disabled={enabledCount === allSourceIds.length}
              onClick={() => void setSourceInclusion(allSourceIds, true)}
            >
              All on
            </button>
            <button
              disabled={!enabledCount}
              onClick={() => void setSourceInclusion(allSourceIds, false)}
            >
              All off
            </button>
          </div>
          {error && (
            <div className="mc-feedback" role="alert">
              {error}
            </div>
          )}
          <div className="mc-all-source-grid">
            {BRAIN_SOURCES.map((source) => (
              <div className="mc-source-cell" key={source.id}>
                {sourceButton(source.id, true)}
                <button
                  type="button"
                  className="mc-source-settings"
                  aria-label={`Set up ${sourceNames[source.id] || source.name} source`}
                  onClick={() => configureSource(source.id)}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
