// Brain connect: one plain answer per source, and one automatic run that brings
// in everything already signed in on this Mac. The only thing ever left for you
// is asking ChatGPT for your export; Memory finds and unpacks the zip itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FolderSearch, Upload } from "lucide-react";
import { operatorRequest, useOperator } from "@/lib/operator";
import { useLiveData } from "@/lib/use-live-data";
import { brainSourceCounts } from "@/lib/brain-sources";
import type { MemoryApp } from "@/components/operator/memory-connections";
import { BrainSourceLogo } from "./brain-source";
import "./brain-connect.css";

type NativeProvider = { id: string; name: string; available: boolean; enabled?: boolean };
export type LinkState = "connected" | "ready" | "needs" | "working";
export type SourceLink = {
  id: string;
  name: string;
  state: LinkState;
  count: number;
  /** One short line for the sources list. */
  line: string;
  /** The card: what is true now and what to do. */
  title: string;
  body: string;
  steps?: string[];
  chatgpt?: boolean;
  /** How far an import has got, for a thin bar under the row. */
  progress?: { done: number; total?: number };
};
export type ConnectStep = {
  id: string;
  name: string;
  state: "waiting" | "running" | "done" | "skipped" | "error";
  line: string;
  done?: number;
  total?: number;
};
export type ConnectAllStatus = { ranAt?: string; finishedAt?: string; running: boolean; steps: ConnectStep[] };

/** ChatGPT's own page for asking for a copy of your data. */
export const CHATGPT_EXPORT_URL = "https://chatgpt.com/#settings/DataControls";

const UNITS: Record<string, [string, string]> = {
  claude: ["note", "notes"],
  codex: ["session", "sessions"],
  hermes: ["session", "sessions"],
  chatgpt: ["chat", "chats"],
  email: ["message", "messages"],
  meetings: ["meeting", "meetings"],
  notion: ["page", "pages"],
  obsidian: ["note", "notes"],
  skills: ["skill", "skills"],
  images: ["photo", "photos"],
};
export const countLine = (id: string, n: number) =>
  `${n.toLocaleString()} ${(UNITS[id] || ["item", "items"])[n === 1 ? 0 : 1]}`;

const token = () =>
  fetch("/__token")
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => r?.token as string | undefined)
    .catch(() => undefined);

async function refreshMapData() {
  const t = await token();
  const res = await fetch("/__refresh_data", {
    method: "POST",
    headers: t ? { "X-Claude-OS-Token": t } : {},
  }).catch(() => null);
  if (!res?.ok) throw new Error("Could not re-read this Mac. Try again in a minute.");
}

/**
 * The import of every source already signed in. The first run waits for your
 * click (nothing is read before you say so); after that it runs again on every
 * Refresh all and each day, and keeps the sources you switched off.
 */
export function useConnectAll() {
  const queryClient = useQueryClient();
  const status = useQuery<ConnectAllStatus>({
    queryKey: ["memory-connect-all"],
    queryFn: () => operatorRequest("/memory/connect-all"),
    refetchInterval: (q) => (q.state.data?.running ? 2500 : 30000),
    retry: false,
  });
  const start = useCallback(async () => {
    const next = await operatorRequest<ConnectAllStatus>("/memory/connect-all", {});
    queryClient.setQueryData(["memory-connect-all"], next);
    return next;
  }, [queryClient]);
  // When a run finishes, re-read this Mac so the new records land in the map, quietly.
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = !!status.data?.running;
    if (wasRunning.current && !running)
      void refreshMapData()
        .then(() =>
          Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: ["live-data"] }),
            queryClient.invalidateQueries({ queryKey: ["memory-connected-apps"] }),
            queryClient.invalidateQueries({ queryKey: ["native-connections"] }),
          ]),
        )
        .catch(() => undefined);
    wasRunning.current = running;
  }, [status.data?.running, queryClient]);
  return { status: status.data, start };
}

/** Refresh every source quietly: sync apps and mail, then re-read this Mac. */
export function useMemoryRefresh() {
  const queryClient = useQueryClient();
  const { refresh } = useOperator();
  const live = useLiveData();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refreshAll = useCallback(
    async (quiet = false) => {
      if (busy) return;
      setBusy(true);
      if (!quiet) setMessage("");
      try {
        // sync-all also starts the mail history and connected imports on the server.
        await operatorRequest("/memory/apps/sync-all", {}).catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: ["memory-connect-all"] });
        await refreshMapData();
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["live-data"] }),
          queryClient.invalidateQueries({ queryKey: ["memory-connected-apps"] }),
          queryClient.invalidateQueries({ queryKey: ["native-connections"] }),
          refresh(),
        ]);
        window.dispatchEvent(new Event("operator:brain-change"));
      } catch (cause) {
        if (!quiet) setMessage((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, queryClient, refresh],
  );
  // Refresh on open when the map is more than six hours old, once per visit.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || live?.isExample || !live?.generatedAt) return;
    tried.current = true;
    const age = Date.now() - Date.parse(live.generatedAt);
    let seen = false;
    try {
      seen = sessionStorage.getItem("memory.autoRefresh") === "1";
      sessionStorage.setItem("memory.autoRefresh", "1");
    } catch {
      /* private window */
    }
    if (!seen && age > 6 * 36e5) void refreshAll(true);
  }, [live, refreshAll]);
  return {
    refreshAll,
    busy,
    message,
    updatedAt: live?.isExample ? undefined : (live?.generatedAt as string | undefined),
  };
}

export function agoText(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function useSourceLinks() {
  const { state } = useOperator();
  const live = useLiveData();
  const apps = useQuery<{ apps: MemoryApp[] }>({
    queryKey: ["memory-connected-apps"],
    queryFn: () => operatorRequest("/memory/apps"),
    staleTime: 15000,
  });
  const native = useQuery<{ providers: NativeProvider[] }>({
    queryKey: ["native-connections"],
    queryFn: () => operatorRequest("/native-connections"),
    retry: false,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const connect = useQuery<ConnectAllStatus>({
    queryKey: ["memory-connect-all"],
    queryFn: () => operatorRequest("/memory/connect-all"),
    staleTime: 2000,
    retry: false,
  });
  const steps = connect.data?.steps || [];
  const step = (id: string) => steps.find((s) => s.id === id);
  const counts = brainSourceCounts(state, live);
  const app = (id: string) => apps.data?.apps.find((a) => a.id === id);
  const busy = (a?: MemoryApp) => !!a && (a.queued || ["scanning", "syncing"].includes(a.status));
  const total = (id: string) => (counts[id]?.saved || 0) + (counts[id]?.mapped || 0);
  const links: SourceLink[] = [];
  const local = (id: "codex" | "claude" | "hermes", name: string) => {
    const n = total(id),
      a = app(id);
    links.push({
      id,
      name,
      count: n,
      state: n ? "connected" : a?.available ? "working" : "needs",
      line: n ? countLine(id, n) : a?.available ? "Reading this Mac" : "Not on this Mac",
      title: n ? `${name} is connected` : `${name} is not on this Mac`,
      body: n
        ? `${countLine(id, n)} read from this Mac. New ones appear every day on their own.`
        : `Install ${name} and use it once. It shows up here on its own.`,
    });
  };
  local("claude", "Claude");
  local("codex", "Codex");
  local("hermes", "Hermes");

  const chat = total("chatgpt"),
    chatStep = step("chatgpt");
  links.push({
    id: "chatgpt",
    name: "ChatGPT",
    count: chat,
    state: chatStep?.state === "running" ? "working" : chat ? "connected" : "needs",
    line: chatStep?.state === "running" ? chatStep.line : chat ? countLine("chatgpt", chat) : "Needs your export",
    title: chat ? "ChatGPT is connected" : "Bring in your ChatGPT history",
    body: chat
      ? `${countLine("chatgpt", chat)} from your export. Ask for a new export any time and Memory picks it up from Downloads.`
      : "ChatGPT keeps your chats online, so ask it for a copy once. When the email arrives, download the zip. Memory finds it in Downloads and brings it in by itself.",
    chatgpt: true,
  });

  // Email, meetings and Notion come in from the accounts connected in this app; they only need you
  // when one is not connected.
  const auto = (
    id: "email" | "meetings" | "notion",
    name: string,
    stepIds: string[],
    available: boolean,
    connect: string,
  ) => {
    const n = total(id);
    const live = stepIds.map(step).filter(Boolean) as ConnectStep[];
    const running = live.find((s) => s.state === "running");
    const failed = live.find((s) => s.state === "error");
    const done = live.reduce((s, x) => s + (x.state === "running" ? x.done || 0 : 0), 0);
    const totalAll = live.reduce((s, x) => s + (x.state === "running" ? x.total || 0 : 0), 0);
    links.push({
      id,
      name,
      count: n,
      progress: running ? { done, total: totalAll || undefined } : undefined,
      state: running ? "working" : n ? "connected" : available ? "working" : "needs",
      line: running
        ? live.filter((x) => x.state === "running").length > 1 && totalAll
          ? `Importing ${done.toLocaleString("en-GB")} of ~${totalAll.toLocaleString("en-GB")}`
          : running.line.replace(/, back to .*$/, "")
        : failed && !n
          ? failed.line
          : n
            ? countLine(id, n)
            : available
              ? "Connecting on its own"
              : "Not connected",
      title: n ? `${name} is connected` : `Connect ${name.toLowerCase()}`,
      body: n
        ? `${countLine(id, n)} in Memory. New ones come in every day on their own.`
        : `${name} comes in once you connect it.`,
      steps: n || available ? undefined : [connect, "Memory brings it in by itself within a minute."],
    });
  };
  const providers = native.data?.providers || [];
  auto("email", "Email", ["gmail", "outlook"], providers.some((p) => ["gmail", "outlook"].includes(p.id) && p.available), "Open Settings, then Connections, and connect Gmail or Outlook.");
  auto("meetings", "Meetings", ["granola"], !!app("granola")?.available, "On the Setup page, open Memory and connect Granola with its API key.");
  auto("notion", "Notion", ["notion"], !!app("notion")?.available, "Open your sources here, choose the dots beside Notion, and press Connect Notion.");
  if (busy(app("granola"))) Object.assign(links.find((l) => l.id === "meetings")!, { state: "working" });
  // Until this Mac has been read, say so rather than flashing "not connected".
  const loading = apps.isPending || !!live?.isExample;
  // Before the first answer, known counts still show; nothing flashes "checking".
  if (loading)
    for (const l of links)
      Object.assign(l, l.count ? { state: "connected", line: countLine(l.id, l.count) } : { state: "working", line: "" });
  return { links, loading, steps, running: !!connect.data?.running };
}

/** Choose the export zip, or let Memory look in Downloads. Then it unpacks and imports on its own. */
function ChatgptActions() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = async (message: string) => {
    setNote(message);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["memory-connected-apps"] }),
      queryClient.invalidateQueries({ queryKey: ["memory-connect-all"] }),
    ]);
    await refreshMapData().catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ["live-data"] });
  };
  const upload = async (file: File) => {
    setBusy(true);
    setNote(`Bringing in ${file.name}…`);
    try {
      const t = await token();
      const res = await fetch(`/__operator/memory/chatgpt/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", ...(t ? { "X-Claude-OS-Token": t } : {}) },
        body: file,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "That file could not be read.");
      await done("Your ChatGPT history is in. The chats appear in Memory in a moment.");
    } catch (cause) {
      setNote((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ol>
        <li>
          Ask ChatGPT for your export.{" "}
          <a href={CHATGPT_EXPORT_URL} target="_blank" rel="noreferrer">
            Open ChatGPT data controls <ArrowUpRight size={11} />
          </a>
        </li>
        <li>When the email arrives, download the zip. Memory finds it in Downloads on its own.</li>
      </ol>
      <div className="bcc-row">
        <button type="button" className="bcc-action" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={13} />
          Choose your ChatGPT export
        </button>
        <button
          type="button"
          className="bcc-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote("");
            try {
              const r = await operatorRequest<{ from?: string }>("/memory/chatgpt/extract", {});
              await done(`Found ${r.from || "your export"} in Downloads. Your chats are coming in.`);
            } catch (cause) {
              setNote((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FolderSearch size={13} />
          Look in Downloads
        </button>
        <input
          ref={input}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {note && (
        <p className="bcc-note" role="status">
          {note}
        </p>
      )}
    </>
  );
}

function ConnectCard({ link }: { link: SourceLink }) {
  return (
    <article className="bcc-card" data-state={link.state}>
      <header>
        <BrainSourceLogo origin={link.id} size={30} />
        <div>
          <strong>{link.title}</strong>
          <span className="bcc-state">
            {link.state === "connected" ? "Connected" : link.state === "working" ? "Coming in" : "Needs you once"}
          </span>
        </div>
      </header>
      <p>{link.body}</p>
      {link.steps && (
        <ol>
          {link.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {link.chatgpt && link.state !== "connected" && <ChatgptActions />}
    </article>
  );
}

/** Opens the connect cards from anywhere in Memory (Rings, Timeline, Neural). */
export const openConnectSources = () => window.dispatchEvent(new Event("memory:connect-sources"));

/** The one visible list for the automatic import: each source, what is happening, how far along. */
export function BrainImportProgress({
  auto = true,
  compact = false,
  whileRunning = false,
}: {
  auto?: boolean;
  compact?: boolean;
  /** Show only while something is coming in; the list folds away when it is done. */
  whileRunning?: boolean;
}) {
  const { status, start } = useConnectAll();
  const [starting, setStarting] = useState(false);
  const steps = (status?.steps || []).filter((s) => s.state !== "skipped");
  if (auto && status && !status.ranAt && !status.running && steps.length)
    return (
      <section className="bip" data-compact={compact || undefined} aria-label="Bring in your sources">
        <h4>Bring in your sources</h4>
        <p className="bip-ask">Mail, calendar and apps you are already signed in to: {steps.map((s) => s.name).join(", ")}. Nothing is read until you start.</p>
        <button type="button" className="bip-start" disabled={starting} onClick={() => { setStarting(true); void start().catch(() => undefined).finally(() => setStarting(false)); }}>
          {starting ? "Starting…" : "Start import"}
        </button>
      </section>
    );
  if (!steps.length || (whileRunning && !status?.running)) return null;
  const logo: Record<string, string> = { gmail: "email", outlook: "outlook", granola: "meetings", library: "skills" };
  return (
    <section className="bip" data-compact={compact || undefined} aria-label="Sources coming in" aria-live="polite">
      <h4>{status?.running ? "Bringing in your sources" : "Your sources"}</h4>
      <ul>
        {steps.map((s) => (
          <li key={s.id} data-state={s.state}>
            <BrainSourceLogo origin={logo[s.id] || s.id} size={compact ? 18 : 22} />
            <span>
              <b>{s.name}</b>
              <small>{s.line}</small>
            </span>
            {s.state === "running" && (
              <i
                className="bip-bar"
                style={{
                  ["--p" as string]: s.total ? `${Math.min(100, Math.round((100 * (s.done || 0)) / s.total))}%` : "35%",
                }}
                data-indeterminate={!s.total || undefined}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One card per source that still needs something. Connected ones collapse into a line. */
export function BrainConnectCards({ ids }: { ids?: string[] }) {
  const { links, loading } = useSourceLinks();
  const shown = links.filter((l) => !ids || ids.includes(l.id));
  const open = shown.filter((l) => l.state === "needs");
  const done = shown.filter((l) => l.state !== "needs");
  if (loading) return <p className="bcc-loading">Checking this Mac…</p>;
  return (
    <div className="bcc">
      <BrainImportProgress />
      {!!done.length && (
        <div className="bcc-done" aria-label="Connected sources">
          {done.map((l) => (
            <span key={l.id}>
              <BrainSourceLogo origin={l.id} size={18} />
              {l.name} <small>{l.line}</small>
            </span>
          ))}
        </div>
      )}
      {open.map((l) => (
        <ConnectCard key={l.id} link={l} />
      ))}
      {!open.length && <p className="bcc-loading">Everything here comes in on its own.</p>}
    </div>
  );
}
