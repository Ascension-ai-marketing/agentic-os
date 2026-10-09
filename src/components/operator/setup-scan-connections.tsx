import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Check, Copy, Cpu, Info, Loader2, MessageCircle, RefreshCw, ScanLine, Wallet, Terminal } from "lucide-react";
import { operatorRequest, type ConnectionDiscovery } from "@/lib/operator";
import { setupImportResult } from "@/lib/setup-import-result";
import { BrainConnectCards } from "@/components/brain/brain-connect";
import { SourceBrand } from "./source-brand";
import type { MemoryApp } from "./memory-connections";
import { ProviderLogo, type NativeConnection } from "./account-connections";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConnectionsPanel } from "../business/connections-panel";
import "./setup-scan-stages.css";

type Tool = { id: string; name: string; installed: boolean; detail?: string };
const WINDOWS_PROMPT = `I am setting up Agentic OS on Windows. macOS is its verified platform; Windows is portable but not fully verified. Walk me through adapting it step by step, checking each step before moving on:
1. Confirm bun (bun --version) and Node 22.12+ are installed; if not, give me the winget or PowerShell install commands.
2. In the Agentic OS folder, run "Start Agentic OS.bat" (or "Start Agentic OS.ps1"). If it fails, read the error with me and fix it.
3. Check that Codex and Claude Code are installed and signed in (codex --version, claude --version; look for codex.cmd / claude.cmd under %APPDATA%\\npm). Gmail, Outlook, Slack and Google Calendar connect in Settings → Connections. Notion and Mercury use their own sign-in. Granola uses an API key. Chat history is read from %USERPROFILE%\\.codex and %USERPROFILE%\\.claude.
4. Open http://127.0.0.1:8081/setup, run the scan, and tell me which cards are missing compared with what I have installed. For each one, find the Windows install path and tell me what to change.
5. Note anything that only works on macOS (Documents folder permission, the .command launcher) and give me the Windows equivalent or say it is not needed.
Keep answers short and one step at a time. Never copy tokens or cookies between apps.`;
type NativeBusiness = { mercury?: { available: boolean; requiresSignIn?: boolean } };
type BusinessIntegration = { id: "youtube"; configured: boolean };
type MercuryPreview = { accounts: Array<{ name: string; balance: number; currency: string | null }>; recordedAt: string };
type CalendarStatus = { available: boolean; enabled: boolean; account?: string; error?: string };
type Choice = { id: string; name: string; status: string; evidence: string; key?: string; available?: boolean; installed?: boolean; via?: string[]; action?: "agents" | "granola" | "business" | "privacy" };
type ProbeKey = "connections" | "tools" | "memory" | "accounts" | "calendar" | "finance" | "business";
type Probe = { state: "idle" | "running" | "done" | "failed"; note: string };
export const connectionStages = [
  { name: "AI", Icon: Cpu, copy: "Your AI tools, editors and the apps they can already use. Found ones are switched on." },
  { name: "Memory", Icon: BrainCircuit, copy: "Your notes, meetings and pages. Ready to recall together." },
  { name: "Communication", Icon: MessageCircle, copy: "Your messages, calendar, audience and social profiles." },
  { name: "Finances", Icon: Wallet, copy: "Your balances and business numbers. In one place." },
];
const probeLabels: Array<[ProbeKey, string]> = [
  ["connections", "Connected apps"], ["tools", "AI tools and editors on this computer"], ["memory", "Notes, meetings and pages"],
  ["accounts", "Messages"], ["calendar", "Calendar"], ["finance", "Finances"], ["business", "Audience"],
];
/** Memory apps that import history: AI histories on the AI stage, notes and pages on Memory. */
const memoryStageApps = ["granola", "notion", "obsidian"], aiHistoryApps = ["codex", "claude", "hermes"];
const aiTools: Array<[string, string]> = [["codex", "Codex"], ["claude", "Claude"], ["hermes", "Hermes"], ["chatgpt", "ChatGPT"], ["openclaw", "OpenClaw"]];
const editorNames: Array<[string, string]> = [["cursor", "Cursor"], ["vscode", "VS Code"], ["antigravity", "Antigravity"], ["windsurf", "Windsurf"], ["zed", "Zed"], ["trae", "Trae"], ["kiro", "Kiro"], ["xcode", "Xcode"], ["jetbrains", "JetBrains"], ["copilot", "GitHub Copilot"], ["gemini", "Gemini CLI"], ["opencode", "OpenCode"], ["aider", "Aider"], ["continue", "Continue"], ["goose", "Goose"], ["ollama", "Ollama"], ["lmstudio", "LM Studio"], ["warp", "Warp"], ["iterm", "iTerm"], ["terminal", "Terminal"]];
/** Connected apps already shown as a card on some stage, or platform plumbing that is not a source. */
const representedApps = /^(gmail|microsoft outlook email|outlook|slack|google calendar|mercury|granola|notion|youtube)$/i;
const systemApps = /plugin management|safety settings|document control|^hotline$|^sites$|codex-app-tools/i;
const memoryApps = /notion|drive|dropbox|onedrive|\bbox\b|evernote|obsidian|granola|fireflies|otter|confluence|docs|notes|memory|notebook|readwise/i;
const communicationApps = /mail|slack|calendar|contacts|teams|discord|telegram|whatsapp|zoom|meet\b|youtube|linkedin|instagram|tiktok|twitter|intercom|front/i;
const financeApps = /mercury|stripe|paypal|quickbooks|xero|brex|ramp|revolut|wise|bank|clay|hubspot|salesforce|pipedrive|shopify|invoice/i;
const brandSlug = (name: string) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return ({ googledrive: "googledrive", googlecontacts: "googlecontacts", github: "github", microsoftoutlookemail: "outlook", n8nmcp: "n8n", codebasememorymcp: "codebases", gmail: "gmail" } as Record<string, string>)[slug] || slug;
};
const canImport = (app: MemoryApp) => app.available && (app.canSync ?? app.mode !== "import");
const running = (app: MemoryApp) => app.queued || ["syncing", "scanning"].includes(app.status);
const stamp = (app: MemoryApp) => `${app.lastSync || ""}|${app.lastImport || ""}`;
const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString()} ${value === 1 ? one : many}`;
const money = (accounts: MercuryPreview["accounts"]) => {
  const totals = new Map<string, number>();
  for (const account of accounts) totals.set(account.currency || "USD", (totals.get(account.currency || "USD") || 0) + account.balance);
  return [...totals].map(([currency, total]) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(total); } catch { return `${currency} ${Math.round(total).toLocaleString()}`; } }).join(" · ");
};
const settled = <T,>(result: PromiseSettledResult<T>) => result.status === "fulfilled" ? result.value : undefined;

async function celebrateImport() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  confetti({ particleCount: 140, spread: 100, startVelocity: 42, origin: { y: .65 }, colors: ["#cab1f0", "#9ee7d5", "#fff7eb", "#efb9cf"], disableForReducedMotion: true, zIndex: 10000 });
}

/**
 * Scan finds what this computer, the accounts connected in this app and Claude already have. Everything found starts switched on and
 * shows what was found. The last section imports every switched-on source in one go.
 */
export function SetupScanConnections({ stage, onStageChange, onBusyChange, onScanned, onAgentChecks, socialProfiles, tools: savedTools, onToolsChange, importRef, onPendingChange, onImported }: {
  stage: number; onStageChange: (stage: number) => void; onBusyChange: (busy: "" | "scan" | "import" | "granola") => void; onScanned: (scanned: boolean) => void;
  onAgentChecks: () => void; socialProfiles: ReactNode;
  tools: string[]; onToolsChange: (tools: string[]) => void;
  importRef: MutableRefObject<(() => Promise<boolean>) | null>; onPendingChange: (pending: number) => void;
  onImported?: (summary: string[]) => void;
}) {
  const qc = useQueryClient(), lock = useRef(false), alive = useRef(true);
  const [scanned, setScanned] = useState(false), [busy, setBusy] = useState("");
  const [probes, setProbes] = useState<Record<ProbeKey, Probe>>(() => Object.fromEntries(probeLabels.map(([key]) => [key, { state: "idle", note: "" }])) as Record<ProbeKey, Probe>);
  const [inventory, setInventory] = useState<ConnectionDiscovery>();
  const [tools, setTools] = useState<Tool[]>([]), [apps, setApps] = useState<MemoryApp[]>([]), [platform, setPlatform] = useState("");
  const [accounts, setAccounts] = useState<NativeConnection[]>([]), [calendar, setCalendar] = useState<CalendarStatus>();
  const [business, setBusiness] = useState<BusinessIntegration[]>([]), [nativeBusiness, setNativeBusiness] = useState<NativeBusiness>();
  const [mercury, setMercury] = useState<MercuryPreview | "loading" | "failed">();
  const [selected, setSelected] = useState<string[]>([]), [done, setDone] = useState(false);
  const [applied, setApplied] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [details, setDetails] = useState(false);
  const [granolaOpen, setGranolaOpen] = useState(false), [granolaKey, setGranolaKey] = useState(""), [granolaError, setGranolaError] = useState("");
  const [businessOpen, setBusinessOpen] = useState(false);
  const [checked, setChecked] = useState({ tools: false, apps: false, accounts: false, calendar: false, finance: false, business: false });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange(busy as "" | "scan" | "import" | "granola"); return () => onBusyChange(""); }, [busy, onBusyChange]);
  useEffect(() => { setNotice(""); setError(""); }, [stage]);

  const toolIds = (keys: string[]) => keys.filter(key => key.startsWith("tool:") || key.startsWith("local:")).map(key => key.slice(key.indexOf(":") + 1)).filter(id => !memoryStageApps.includes(id) && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id));
  const probe = (key: ProbeKey, state: Probe["state"], note = "") => { if (alive.current) setProbes(current => ({ ...current, [key]: { state, note } })); };
  const track = <T,>(key: ProbeKey, request: Promise<T>, note: (value: T) => string) => {
    probe(key, "running");
    return request.then(value => { probe(key, "done", note(value)); return value; }, (cause: Error) => { probe(key, "failed", "Unavailable right now"); throw cause; });
  };
  const names = (list: Array<{ name: string }>) => list.map(item => item.name).join(", ");

  /** Everything else Claude exposes, sorted into the category it belongs to. */
  const connectedApps = (list: ConnectionDiscovery | undefined) => {
    const seen = new Map<string, { name: string; slug: string; via: string[]; stage: number }>();
    for (const app of list?.apps || []) {
      if (!(app.observed || app.isAccessible) || systemApps.test(app.name) || representedApps.test(app.name)) continue;
      const key = app.name.toLowerCase().replace(/[-_ ]?mcp$/, "").trim();
      const via = "Claude";
      const prior = seen.get(key);
      if (prior) { if (!prior.via.includes(via)) prior.via.push(via); continue; }
      const index = memoryApps.test(key) ? 1 : communicationApps.test(key) ? 2 : financeApps.test(key) ? 3 : 0;
      seen.set(key, { name: app.name.replace(/[-_ ]?mcp$/i, ""), slug: brandSlug(app.name), via: [via], stage: index });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const connected = connectedApps(inventory);

  async function scan() {
    if (lock.current) return;
    lock.current = true; setBusy("scan"); setError(""); setNotice(""); setMercury(undefined);
    try {
      const [connections, found, memory, native, cal, finance, integrations] = await Promise.allSettled([
        track("connections", operatorRequest<ConnectionDiscovery>("/setup/connections?refresh=1"), value => `${count(value.apps.filter(app => app.observed || app.isAccessible).length, "app")} connected`),
        track("tools", operatorRequest<{ tools: Tool[]; platform?: string }>("/setup/discovery"), value => `${count(value.tools.filter(t => t.installed && aiTools.some(([id]) => id === t.id)).length, "AI tool")} · ${count(value.tools.filter(t => t.installed && editorNames.some(([id]) => id === t.id)).length, "editor")}`),
        track("memory", operatorRequest<{ apps: MemoryApp[] }>("/memory/apps?refresh=1"), value => names(value.apps.filter(app => [...aiHistoryApps, ...memoryStageApps].includes(app.id) && canImport(app))) || "Nothing readable yet"),
        track("accounts", operatorRequest<{ providers: NativeConnection[]; error?: string }>("/native-connections"), value => names(value.providers.filter(p => p.available)) || "None connected yet"),
        track("calendar", operatorRequest<CalendarStatus>("/calendar/native"), value => value.available ? value.account || "Google Calendar" : "Not connected yet"),
        track("finance", operatorRequest<NativeBusiness>("/business/native-connections?refresh=1"), value => value.mercury?.available ? "Mercury connected" : "No bank connected yet"),
        track("business", operatorRequest<{ integrations: BusinessIntegration[] }>("/business/integrations"), value => names(value.integrations.filter(i => i.configured).map(() => ({ name: "YouTube" }))) || "Nothing configured yet"),
      ]);
      if (!alive.current) return;
      const nextInventory = settled(connections), nextTools = settled(found)?.tools || [], nextApps = settled(memory)?.apps || [], nextAccounts = settled(native)?.providers || [];
      const nextBusiness = settled(integrations)?.integrations || [], nextFinance = settled(finance), nextCalendar = settled(cal);
      setPlatform(settled(found)?.platform || "");
      setInventory(nextInventory); setTools(nextTools); setApps(nextApps); setAccounts(nextAccounts); setCalendar(nextCalendar); setBusiness(nextBusiness); setNativeBusiness(nextFinance);
      setChecked({ tools: found.status === "fulfilled", apps: memory.status === "fulfilled", accounts: native.status === "fulfilled" && !native.value.error, calendar: cal.status === "fulfilled", finance: finance.status === "fulfilled", business: integrations.status === "fulfilled" });
      if (!scanned) {
        // Found = switched on. A saved tool list from an earlier visit wins over the defaults.
        const installed = new Set(nextTools.filter(t => t.installed).map(t => t.id));
        const remembered = savedTools.length ? new Set(savedTools) : null;
        const on = (id: string) => remembered ? remembered.has(id) : true;
        const importable = (id: string) => nextApps.some(a => a.id === id && canImport(a));
        const initial = [
          ...aiTools.filter(([id]) => installed.has(id) && on(id)).map(([id]) => `${aiHistoryApps.includes(id) && importable(id) ? "local" : "tool"}:${id}`),
          ...editorNames.filter(([id]) => installed.has(id) && on(id)).map(([id]) => `tool:${id}`),
          ...connectedApps(nextInventory).filter(item => on(item.slug)).map(item => `tool:${item.slug}`),
          ...nextApps.filter(a => memoryStageApps.includes(a.id) && (a.enabled || canImport(a))).map(a => `local:${a.id}`),
          ...nextAccounts.filter(a => a.enabled || a.available).map(a => `account:${a.id}`),
          ...(nextCalendar?.available ? ["calendar:google"] : []),
          ...nextBusiness.filter(b => b.configured).map(b => `business:${b.id}`),
          ...(nextFinance?.mercury?.available ? ["business:mercury"] : []),
        ];
        setSelected(initial);
        onToolsChange(toolIds(initial));
      }
      const failures = [found, memory, native, cal, finance, integrations].filter(result => result.status === "rejected").length;
      setError(failures || (native.status === "fulfilled" && native.value.error) ? "Some checks are unavailable. Rescan to try again." : "");
      setScanned(true); onScanned(true);
      // Pull real numbers for what was found. This is a read-only preview; nothing is saved yet.
      if (nextFinance?.mercury?.available) {
        setMercury("loading");
        operatorRequest<MercuryPreview>("/business/mercury/preview").then(value => { if (alive.current) setMercury(value); }).catch(() => { if (alive.current) setMercury("failed"); });
      }
    } finally { if (alive.current) setBusy(""); lock.current = false; }
  }

  function aiChoice(id: string, name: string): Choice {
    const app = apps.find(a => a.id === id), tool = tools.find(t => t.id === id);
    const installed = !!tool?.installed, importable = aiHistoryApps.includes(id) && !!app && canImport(app);
    const counts = app?.counts;
    const found = counts ? [counts.conversations ? count(counts.conversations, "chat") : "", counts.memories ? count(counts.memories, "memory", "memories") : "", counts.skills ? count(counts.skills, "skill") : ""].filter(Boolean).join(" · ") : "";
    return { id, name, installed, key: installed ? `${importable ? "local" : "tool"}:${id}` : undefined, available: installed,
      status: !checked.tools ? "Check unavailable" : !installed ? "Not installed" : importable && found ? `Found · ${found}` : importable ? "Found · history ready" : id === "chatgpt" ? "Installed" : app?.enabled ? "History needs attention" : "Installed",
      evidence: [installed ? `${name} was detected on this computer. This does not verify sign-in or model access.` : "No installed app was detected by the supported checks.",
        app?.availabilityNote || (importable ? "Local history files were found. Import copies text only; tool payloads and account files are excluded." : ""),
        id === "chatgpt" ? "ChatGPT keeps its chats in the cloud, so there is no local history to read. Add its export in Memory to bring your conversations here." : "",
      ].filter(Boolean).join(" "),
    };
  }
  function editorChoice(id: string, name: string): Choice {
    const installed = tools.some(t => t.id === id && t.installed);
    return { id, name, installed, key: installed ? `tool:${id}` : undefined, available: installed, status: !checked.tools ? "Check unavailable" : installed ? "Detected on this computer" : "Not installed", evidence: `${name} is detected by its app bundle or command. Extensions and model sign-in are managed in the tool itself.` };
  }
  function connectedChoice(item: { name: string; slug: string; via: string[] }): Choice {
    return { id: `connected-${item.slug}`, name: item.name, installed: true, key: `tool:${item.slug}`, available: true, via: item.via, status: `Connected via ${item.via.join(" & ")}`, evidence: `${item.name} is connected inside ${item.via.join(" and ")}. Your AI tools can use it there; this OS does not read its data yet.` };
  }
  function memoryChoice(id: "granola" | "notion" | "obsidian", name: string): Choice {
    const app = apps.find(a => a.id === id), tool = tools.find(t => t.id === id);
    const available = app ? canImport(app) : false;
    const notes = app?.discovery?.fileCount || 0, vault = app?.discovery?.roots?.[0], blocked = app?.discovery?.blocked;
    const status = !checked.apps ? "Check unavailable"
      : id === "granola" ? app?.mode === "api" ? "API connected · meeting notes" : "Connect your Granola account"
      : id === "notion" ? app?.connectionMethod === "mcp" ? "Connected · recent pages" : available ? "Page export ready" : "Not connected yet"
      : available ? `${count(notes, "note")} in ${vault || "your vault"}` : blocked ? `Vault found · macOS needs your OK to read ${blocked.replace("your ", "")}` : tool?.installed ? "Installed · no vault registered yet" : "Not installed";
    return { id, name, key: `local:${id}`, installed: id === "granola" || id === "notion" ? true : !!tool?.installed || !!blocked || available, available: id === "granola" ? app?.mode === "api" : available,
      status,
      evidence: [tool?.installed ? `${name} was detected on this computer.` : "", app?.availabilityNote || "", ...(app?.warnings || [])].filter(Boolean).join(" "),
      action: id === "granola" && app?.mode !== "api" ? "granola" : id === "obsidian" && blocked ? "privacy" : undefined,
    };
  }
  function accountChoice(id: "gmail" | "outlook" | "slack", name: string): Choice {
    const account = accounts.find(a => a.id === id);
    const who = account?.workspace || account?.account;
    return { id, name, key: `account:${id}`, installed: true, available: account?.available,
      status: account?.available ? who || "Connected" : !checked.accounts ? "Check unavailable" : "Connect in Settings",
      evidence: account?.available ? `${name} is connected in this app${who ? ` as ${who}` : ""}. Import refreshes recent messages; it does not import the entire account.` : `${name} is not connected yet. Connect it in Settings → Connections and rescan.`,
    };
  }
  const calendarChoice: Choice = { id: "calendar", name: "Google Calendar", key: "calendar:google", installed: true, available: !!calendar?.available,
    status: !checked.calendar ? "Check unavailable" : calendar?.available ? calendar.account || "Connected" : "Connect in Settings",
    evidence: calendar?.available ? "Google Calendar is connected in this app. Import reads events from a month back to two months ahead; nothing is written to your calendar." : calendar?.error || "Google Calendar is not connected yet. Connect Google in Settings → Connections, allow calendar access and rescan." };
  function businessChoice(id: "youtube"): Choice {
    const available = business.some(b => b.id === id && b.configured);
    return { id, name: "YouTube", key: `business:${id}`, installed: true, available,
      status: available ? "Audience connected" : checked.business ? "Add your channel" : "Check unavailable",
      action: !available ? "business" : undefined,
      evidence: available ? "The OS already has a configured audience integration. Import refreshes its audience snapshot, not messages or full video history." : "YouTube needs a YouTube Data API key in ~/.config/agentic-os.env and your channel URL. Open Connect for the steps.",
    };
  }
  function financeChoice(): Choice {
    const available = !!nativeBusiness?.mercury?.available;
    const preview = mercury && typeof mercury === "object" ? mercury : undefined;
    return { id: "mercury", name: "Mercury", key: "business:mercury", installed: true, available,
      status: !checked.finance ? "Check unavailable" : !available ? "Connect in Settings"
        : preview ? `${count(preview.accounts.length, "account")} · ${money(preview.accounts)}` : mercury === "loading" ? "Reading balances…" : mercury === "failed" ? "Connected · balances unavailable" : "Connected",
      evidence: available ? "Mercury is connected in this app, read-only. Import refreshes account balances and recent income." : "Mercury is not connected yet. Connect it in Settings → Connections and rescan.",
    };
  }
  const allChoices: Choice[][] = [
    [...aiTools.map(([id, name]) => aiChoice(id, name)), ...editorNames.map(([id, name]) => editorChoice(id, name)), ...connected.filter(item => item.stage === 0).map(connectedChoice)],
    [memoryChoice("granola", "Granola"), memoryChoice("notion", "Notion"), memoryChoice("obsidian", "Obsidian"), ...connected.filter(item => item.stage === 1).map(connectedChoice)],
    [accountChoice("gmail", "Gmail"), accountChoice("outlook", "Outlook"), accountChoice("slack", "Slack"), calendarChoice, businessChoice("youtube"), ...connected.filter(item => item.stage === 2).map(connectedChoice)],
    [financeChoice(), ...connected.filter(item => item.stage === 3).map(connectedChoice)],
  ];
  // Things that are not on this computer stay out of the way unless asked for.
  const hidden = allChoices[stage].filter(choice => !choice.installed).length;
  const choices = allChoices[stage].filter(choice => showAll || choice.installed);
  const allKeys = allChoices.flat().map(choice => choice.key).filter((key): key is string => !!key);
  const selectedAll = allKeys.filter(key => selected.includes(key));
  const snapshot = () => selectedAll.slice().sort().join(",");
  const pending = applied === undefined ? selectedAll.length : snapshot() === applied ? 0 : selectedAll.length;
  useEffect(() => { onPendingChange(scanned ? pending : 0); }, [scanned, pending, onPendingChange]);
  function toggle(key: string) {
    setNotice("");
    setSelected(current => {
      const next = current.includes(key) ? current.filter(s => s !== key) : [...current, key];
      if (key.startsWith("tool:") || key.startsWith("local:")) onToolsChange(toolIds(next));
      return next;
    });
  }
  async function openPrivacy() {
    try { await operatorRequest("/setup/open-privacy", {}); setNotice("System Settings opened. Under Files and Folders, allow Documents Folder for the app that runs Agentic OS, then rescan."); }
    catch (cause) { setError((cause as Error).message); }
  }
  async function copyWindowsPrompt() {
    try { await navigator.clipboard.writeText(WINDOWS_PROMPT); setNotice("Windows setup prompt copied. Paste it into Claude or Codex and follow along."); }
    catch { setError("Clipboard unavailable. The prompt is in the setup guide."); }
  }
  async function copyChecklist() {
    const missing = allChoices.flat().filter(choice => choice.installed && !choice.available);
    const text = ["Help me connect my Agentic OS using my existing app connections.", "These are discovery results, not transferred account permissions:",
      ...allChoices.flat().filter(choice => choice.available).map(choice => `- ${choice.name}: ${choice.status}.`),
      "Still to set up:", ...missing.map(choice => `- ${choice.name}: ${choice.status}. ${choice.evidence}`),
      "Use supported sign-in or export flows. Never copy tokens, browser cookies or credentials between apps. Confirm which apps expose readable history and which need an OS adapter. After setup, I will rescan and choose what to import.",
    ].join("\n");
    try { await navigator.clipboard.writeText(text); setNotice("Setup list copied. Paste it into Claude or Codex."); }
    catch { setError("Clipboard unavailable. Open How we found these for the connection details."); }
  }

  /** Imports every switched-on source across all four sections. Returns true when nothing needs attention. */
  async function apply(): Promise<boolean> {
    if (lock.current) return false;
    if (!pending) return true;
    lock.current = true; setBusy("import"); setNotice(""); setError("");
    const failures: string[] = [], waiting = new Map<string, string>(), summary: string[] = []; let imported = 0;
    try {
      for (const app of apps.filter(a => [...aiHistoryApps, ...memoryStageApps].includes(a.id))) {
        const enabled = selected.includes(`local:${app.id}`);
        try {
          if (!enabled) { if (app.enabled) await operatorRequest(`/memory/apps/${app.id}`, { enabled: false }); continue; }
          if (!canImport(app)) { if (memoryStageApps.includes(app.id) || app.enabled) failures.push(`${app.name}: history is not ready to import.`); continue; }
          const before = stamp(app);
          await operatorRequest(`/memory/apps/${app.id}`, { enabled: true, scopes: { memories: app.capabilities.memories, conversations: app.capabilities.conversations, skills: app.scopes.skills && app.capabilities.skills } });
          if (!running(app)) await operatorRequest(`/memory/apps/${app.id}/sync`, {});
          waiting.set(app.id, before);
        } catch (cause) { failures.push(`${app.name}: ${(cause as Error).message}`); }
      }
      if (!checked.accounts && selectedAll.some(key => key.startsWith("account:"))) failures.push("Message connections could not be checked; no message import started.");
      if (checked.accounts) {
        try {
          const result = await operatorRequest<{ results: Array<{ provider: string; ok: boolean; error?: string; count?: number }> }>("/native-connections/sync", { providers: accounts.filter(a => selected.includes(`account:${a.id}`)).map(a => a.id), replaceSelection: true });
          imported += result.results.filter(r => r.ok).length;
          const okNames = result.results.filter(r => r.ok).map(r => accounts.find(a => a.id === r.provider)?.name || r.provider);
          if (okNames.length) summary.push(`${okNames.join(", ")} · recent messages`);
          failures.push(...result.results.filter(r => !r.ok).map(r => r.error || `${r.provider} could not refresh.`));
        } catch (cause) { failures.push((cause as Error).message); }
      }
      if (checked.calendar) {
        try {
          // The calendar reader accepts up to 100 days per window: a month back, two months ahead.
          if (selected.includes("calendar:google")) { if (calendar?.available) { const result = await operatorRequest<{ events?: number }>("/calendar/native/sync", { enable: true, timeMin: new Date(Date.now() - 30 * 86400000).toISOString(), timeMax: new Date(Date.now() + 60 * 86400000).toISOString() }); imported++; summary.push(`Google Calendar · ${typeof result.events === "number" ? count(result.events, "event") : "events"}`); } }
          else if (calendar?.enabled) await operatorRequest("/calendar/native/disconnect", {});
        } catch (cause) { failures.push(`Google Calendar: ${(cause as Error).message}`); }
      }
      for (const integration of business.filter(b => selected.includes(`business:${b.id}`))) {
        try { await operatorRequest("/business/sync", { provider: integration.id }); imported++; summary.push("YouTube · audience"); }
        catch (cause) { failures.push(`${integration.id}: ${(cause as Error).message}`); }
      }
      if (selected.includes("business:mercury")) {
        try { const result = await operatorRequest<{ accounts?: number }>("/business/mercury/sync", {}); imported++; summary.push(`Mercury · ${typeof result.accounts === "number" ? count(result.accounts, "account") : "balances"} and 30-day income`); }
        catch (cause) { failures.push(`Mercury: ${(cause as Error).message}`); }
      }
      const deadline = Date.now() + 90000;
      while (waiting.size && alive.current && Date.now() < deadline) {
        const latest = await operatorRequest<{ apps: MemoryApp[] }>("/memory/apps");
        if (!alive.current) return false;
        setApps(latest.apps);
        for (const [id, before] of waiting) {
          const app = latest.apps.find(a => a.id === id);
          if (!app) { waiting.delete(id); failures.push(`${id}: import status unavailable.`); continue; }
          const result = setupImportResult(app, before);
          if (result === "pending") continue;
          waiting.delete(id);
          if (result === "complete" || result === "partial") { imported++; const added = app.progress?.added || 0; summary.push(`${app.name} · ${added ? count(added, id === "notion" ? "page" : id === "granola" ? "meeting" : id === "obsidian" ? "note" : "record") : "history"}${result === "partial" ? " so far" : ""}`); }
          else failures.push(`${app.name}: ${app.error || "import needs attention."}`);
        }
        if (waiting.size) { setNotice(`${waiting.size} ${waiting.size === 1 ? "source is" : "sources are"} importing…`); await new Promise(resolve => window.setTimeout(resolve, 1200)); }
      }
      if (!alive.current) return false;
      if (waiting.size) { imported += waiting.size; for (const id of waiting.keys()) summary.push(`${apps.find(a => a.id === id)?.name || id} · importing in the background`); setNotice("Still importing in the background. Check Memory for progress."); }
      const stackCount = selectedAll.filter(key => key.startsWith("tool:")).length;
      if (stackCount) summary.unshift(`${count(stackCount, "tool")} in your stack`);
      onImported?.(summary);
      const receipt = imported ? `${imported} ${imported === 1 ? "source" : "sources"} imported. Large histories keep filling in from Memory.` : "Selection saved.";
      if (!failures.length) setNotice(receipt);
      setError(failures.join(" "));
      setApplied(snapshot());
      if (imported && !failures.length) { setDone(true); void celebrateImport().catch(() => {}); }
      await Promise.all(["memory-connected-apps", "native-connections", "operator-state", "business-workspace", "native-calendar"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      const [memory, native, cal] = await Promise.allSettled([operatorRequest<{ apps: MemoryApp[] }>("/memory/apps"), operatorRequest<{ providers: NativeConnection[] }>("/native-connections"), operatorRequest<CalendarStatus>("/calendar/native")]);
      if (memory.status === "fulfilled" && alive.current) setApps(memory.value.apps);
      if (native.status === "fulfilled" && alive.current) setAccounts(native.value.providers);
      if (cal.status === "fulfilled" && alive.current) setCalendar(cal.value);
      return !failures.length;
    } catch (cause) { if (alive.current) { setNotice(""); setError(`Import status could not be confirmed. ${(cause as Error).message}`); } return false; }
    finally { if (alive.current) setBusy(""); lock.current = false; }
  }
  importRef.current = apply;
  useEffect(() => () => { importRef.current = null; }, [importRef]);

  function mark(choice: Choice) {
    if (["gmail", "outlook", "slack"].includes(choice.id)) return <ProviderLogo provider={choice.id as "gmail" | "outlook" | "slack"} />;
    if (["mercury", "youtube"].includes(choice.id)) return <img src={`/business-sources/${choice.id === "youtube" ? "youtube-symbol.svg" : `${choice.id}.svg`}`} alt="" />;
    return <SourceBrand id={choice.id.replace(/^connected-/, "")} size={27} />;
  }
  const scanning = busy === "scan";
  const onHere = choices.filter(choice => choice.key && selected.includes(choice.key)).length;
  // Each account connects in this app. Say where once, while nothing is connected.
  const anyConnected = accounts.some(a => a.available) || !!calendar?.available || !!nativeBusiness?.mercury?.available || apps.some(a => ["granola", "notion"].includes(a.id) && a.mode === "api");
  const connectGuide = !checked.tools || anyConnected || stage === 0 ? null
    : { title: "Connect each account once.", copy: "Gmail, Outlook, Slack and Google Calendar connect in Settings → Connections. Notion and Mercury use their own sign-in. Granola uses an API key." };
  return <div className="ws-connect" aria-label="Scan and import apps" data-scanned={scanned}>
    {!scanned || scanning ? <div className={`ws-connect-start${scanning ? " is-scanning" : ""}`}>
      <div className="ws-connect-marks" aria-hidden="true">{["chatgpt", "codex", "claude", "hermes"].map(id => <SourceBrand key={id} id={id} size={36} />)}{scanning && <i className="ws-connect-sweep" />}</div>
      {scanning ? <ul className="ws-scan-live" aria-live="polite" aria-label="Scan progress">
        {probeLabels.map(([key, label]) => <li key={key} data-state={probes[key].state}><i aria-hidden="true">{probes[key].state === "done" ? <Check size={11} /> : probes[key].state === "failed" ? "!" : null}</i><strong>{label}</strong><small>{probes[key].note || (probes[key].state === "running" ? "Checking…" : "")}</small></li>)}
      </ul> : <>
        <RainbowButton disabled={!!busy} onClick={() => void scan()}><ScanLine size={18} />Begin your scan</RainbowButton>
        <span>AI · Memory · Communication · Finances</span>
      </>}
    </div> : <>
      <nav className="ws-connect-tabs" aria-label="Connection categories">{connectionStages.map(({ name }, index) => <button type="button" key={name} aria-label={name} title={name} aria-current={stage === index ? "step" : undefined} disabled={!!busy} onClick={() => onStageChange(index)}><i aria-hidden="true" data-done={done} /><span>{name}</span></button>)}</nav>
      <div className="ws-connect-caption"><div><h2>{connectionStages[stage].name}</h2><p>{connectionStages[stage].copy}</p></div><button type="button" aria-label="Rescan connections" disabled={!!busy} onClick={() => void scan()}><RefreshCw size={14} /></button></div>
      {platform === "win32" && stage === 0 && <div className="ws-connect-guide" role="note"><SourceBrand id="terminal" size={30} /><div><strong>You are on Windows.</strong><p>This build is verified on macOS and portable on Windows. Let your assistant walk you through the differences: copy this prompt into Claude or Codex and follow it step by step.</p></div><button type="button" onClick={() => void copyWindowsPrompt()}>Copy Windows setup prompt</button></div>}
      {connectGuide && <div className="ws-connect-guide" role="note"><SourceBrand id="gmail" size={30} /><div><strong>{connectGuide.title}</strong><p>{connectGuide.copy}</p></div><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("agentic:accounts", { detail: { group: "work" } }))}>Open Connections</button></div>}
      <div className="ws-connect-grid" key={stage}>
        {choices.map(choice => <article key={choice.id} className="ws-connect-card" data-selected={!!choice.key && selected.includes(choice.key)} data-muted={!choice.installed}
          onPointerMove={event => { if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--light-x", `${event.clientX - rect.left}px`); event.currentTarget.style.setProperty("--light-y", `${event.clientY - rect.top}px`); }}>
          <span className="ws-connect-logo" aria-hidden="true">{mark(choice)}</span><span className="ws-connect-copy"><strong>{choice.name}</strong><small title={choice.evidence}>{choice.status}</small></span>
          {choice.key && (choice.available || selected.includes(choice.key)) ? <button type="button" className="ws-connect-switch" role="switch" aria-label={`Bring in ${choice.name}`} aria-checked={selected.includes(choice.key)} disabled={!!busy} onClick={() => toggle(choice.key!)}><i /></button>
            : choice.action ? <button type="button" className="ws-connect-card-action" disabled={!!busy} onClick={() => choice.action === "agents" ? onAgentChecks() : choice.action === "granola" ? setGranolaOpen(true) : choice.action === "business" ? setBusinessOpen(true) : void openPrivacy()}>{choice.action === "agents" ? "Models" : choice.action === "privacy" ? "Allow" : "Connect"}</button>
            : <span className="ws-connect-dot" aria-label="Not available to import" />}
        </article>)}
        {!choices.length && <p className="ws-connect-small">Nothing was found for this section yet.</p>}
      </div>
      {stage === 0 && hidden > 0 && <button type="button" className="ws-connect-text" onClick={() => setShowAll(!showAll)}>{showAll ? "Hide tools that are not installed" : `Show ${count(hidden, "supported tool")} not installed`}</button>}
      {stage === 0 && <button className="ws-connect-runtime" type="button" onClick={onAgentChecks}><Terminal size={13} /> Models & local runtimes</button>}
      {stage === 1 && <section className="ws-connect-memory-cards" aria-label="Connect your memory sources"><h3>Coming in on their own</h3><p className="ws-connect-small">Everything you connect comes in by itself: Gmail and Outlook with a year of history, Granola, Notion and your AI chats. ChatGPT is the one that needs you to ask for an export.</p><BrainConnectCards ids={["chatgpt"]} /></section>}
      {stage === 2 && socialProfiles}
      {stage === 3 && <p className="ws-connect-small">Mercury refreshes balances and recent income.</p>}
      <div className="ws-connect-actions">
        <span className="ws-connect-pending">{busy === "import" ? <><Loader2 size={13} className="animate-spin" /> Importing everything you switched on…</> : done && !pending ? `${selectedAll.length} in your OS` : `${onHere} on here · ${selectedAll.length} across all sections · imported once at the end`}</span>
        <div><button type="button" onClick={() => setDetails(true)}><Info size={13} /> How we found these</button><button type="button" onClick={() => void copyChecklist()}><Copy size={13} /> Copy setup list</button></div>
      </div>
    </>}
    <div className="ws-connect-receipt" aria-live="polite"><span role={error ? "alert" : "status"} title={error || notice}>{error || notice}</span></div>
    <Dialog open={details} onOpenChange={setDetails}><DialogContent className="ws-connect-evidence"><DialogTitle>How your connections were found</DialogTitle><DialogDescription>Three checks: local app and history metadata, tools connected in Claude, and the accounts connected in this OS. Gmail, Outlook, Slack and Google Calendar connect in Settings → Connections. Notion and Mercury use their own sign-in. Granola uses an API key.</DialogDescription><div className="ws-connect-evidence-list">{allChoices.flat().filter(choice => choice.installed).map(choice => <div key={choice.id}><strong>{choice.name} · {choice.status}</strong><p>{choice.evidence}</p></div>)}</div><button type="button" onClick={() => void copyChecklist()}>Copy setup list for Claude or Codex</button></DialogContent></Dialog>
    <Dialog open={granolaOpen} onOpenChange={open => { setGranolaOpen(open); if (!open) { setGranolaKey(""); setGranolaError(""); } }}><DialogContent className="ws-connect-evidence"><DialogTitle>Connect Granola</DialogTitle><DialogDescription>Use your Granola API key to sync meeting notes directly. No export needed. The key stays on this computer.</DialogDescription><form className="ws-granola-form" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy("granola"); setGranolaError(""); try { await operatorRequest("/memory/granola-config", { apiKey: granolaKey }); setGranolaKey(""); const latest = await operatorRequest<{ apps: MemoryApp[] }>("/memory/apps?refresh=1"); setApps(latest.apps); setGranolaOpen(false); setNotice("Granola API connected. Select it to sync your notes."); } catch (cause) { setGranolaError((cause as Error).message); } finally { setBusy(""); } }}><label>Granola API key<input type="password" autoComplete="off" value={granolaKey} onChange={event => setGranolaKey(event.target.value)} required /></label><p><a href="https://docs.granola.ai/api-reference/list-notes" target="_blank" rel="noreferrer">Find your API key in Granola Settings ↗</a></p>{granolaError && <p role="alert">{granolaError}</p>}<button type="submit" disabled={!!busy || !granolaKey.trim()}>{busy ? "Connecting…" : "Connect Granola"}</button></form></DialogContent></Dialog>
    <Dialog open={businessOpen} onOpenChange={setBusinessOpen}><DialogContent className="ws-connect-evidence ws-connect-audience"><DialogTitle>Connect your audience</DialogTitle><DialogDescription>Add the channel you want in your OS. Then rescan this step.</DialogDescription>
      <details className="ws-connect-howto"><summary>How to connect YouTube</summary><ol>
        <li>Create a YouTube Data API key in Google Cloud Console (APIs & Services → Credentials).</li>
        <li>Add <code>YOUTUBE_API_KEY=…</code> to <code>~/.config/agentic-os.env</code>.</li>
        <li>Paste your channel URL below, then press Connect & load videos.</li>
      </ol></details>
      <ConnectionsPanel /></DialogContent></Dialog>
  </div>;
}
