import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { memoryRefresh } from "./memory-refresh";
import { isOperatorSelfPath, isOperatorSelfTranscript } from "../src/lib/memory-self-filter";

export type AppScope = "memories" | "conversations" | "skills";
export type MemoryAppId =
  | "codex"
  | "claude"
  | "hermes"
  | "granola"
  | "gmail"
  | "outlook"
  | "notion"
  | "obsidian"
  | "chatgpt";
export const MEMORY_APP_IDS: MemoryAppId[] = [
  "codex",
  "claude",
  "hermes",
  "granola",
  "gmail",
  "outlook",
  "notion",
  "obsidian",
  "chatgpt",
];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const scopes = (): Record<AppScope, boolean> => ({
  memories: true,
  conversations: true,
  skills: true,
});
const zero = () => ({
  processed: 0,
  total: 0,
  added: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  excluded: 0,
  deferred: 0,
  failed: 0,
  remaining: 0,
  hasMore: false,
});
const stamp = () => new Date().toISOString();
const forbidden =
  /^(?:auth|credentials?|secrets?|tokens?|config|settings)(?:\.|$)|private.?key|\.env/i;
// READER_VERSION 3 decodes Codex Desktop `item_completed` messages. A manual sync
// re-reads complete transcripts saved by an older reader so their text fills in.
const PART = 180000,
  MAX_LINE = 16 * 1024 * 1024,
  READER_VERSION = 3,
  MAX_SCAN = 50000;
const SYNC_BYTES = 64 * 1024 * 1024;
// JSONL is decoded one bounded record at a time. A large transcript receives
// its own pass; it must not be rejected merely because its file exceeds the
// ordinary multi-file batch budget. Documents/JSON exports keep smaller caps.
const LARGE_TRANSCRIPT_BYTES = 256 * 1024 * 1024;
export type AppFile = {
  id: string;
  absolute: string;
  path: string;
  scope: AppScope;
  fingerprint: string;
  size: number;
  /** Last modification of the source file: newest work is imported first. */
  modifiedMs: number;
  title: string;
  format: "markdown" | "jsonl" | "granola" | "chatgpt";
};
export type AppScan = {
  files: AppFile[];
  counts: Record<AppScope, number>;
  warnings: string[];
  truncated: boolean;
  /** Registered source locations (for example Obsidian vaults), shown as ~/ paths. */
  locations?: string[];
  /** A macOS-protected folder the OS process could not read. */
  blocked?: string;
};
const protectedFolder = (path: string, home: string) => {
  const first = relative(home, path).split(sep)[0];
  return ["Documents", "Desktop", "Downloads"].includes(first) ? `your ${first} folder` : `the folder ${basename(path)}`;
};
type AppPreferences = {
  enabled: boolean;
  autoSync: boolean;
  scopes: Record<AppScope, boolean>;
  collection: string;
  lastSync?: string;
  lastImport?: string;
  status: "idle" | "scanning" | "syncing" | "error";
  progress: ReturnType<typeof zero>;
  error?: string;
  /** A pass that imported everything readable but skipped malformed or
   * oversized records ends idle with this note instead of an error. */
  warning?: string;
  // Start the next bounded pass with work deferred by the previous budget.
  // A file ID survives restarts without storing another local path.
  resumeFileId?: string;
  remoteCursor?: string;
  checkpoints: Record<string, string>;
  partialCheckpoints: Record<
    string,
    { fingerprint: string; skipped: number; reason: string; readerVersion?: number }
  >;
  recordStats: Record<
    string,
    {
      fingerprint: string;
      version: number;
      importedMessages: number;
      filteredRecords: number;
      malformedRecords: number;
      oversizedRecords: number;
    }
  >;
};
export type ReadyImport = {
  title: string;
  text: string;
  origin: string;
  collection: string;
  replaceCollection?: boolean;
  connector: {
    provider: string;
    itemId: string;
    path?: string;
    syncedAt: string;
    /** When the source file itself last changed, so Chat can answer "this morning". */
    activityAt?: string;
  };
};
export type ImportResult = { unchanged?: boolean; updated?: boolean; skipped?: boolean };
export type ImportedParts = {
  provider: string;
  itemId: string;
  parts: number;
  keepParts?: number[];
};
// A final short fragment still contains source text. Keep it above the shared
// source validator's minimum without discarding a short reply or document tail.
const importText = (content: string) =>
  content.trim().length < 15 ? "Imported source text:\n" + content : content;
class ImportPaused extends Error {
  constructor() {
    super(
      "Import paused. Enable and sync this app again to continue; committed records are retained.",
    );
  }
}
/** True when `p` is `root` or lives under it. The separator is a parameter so the
 * Windows form (`C:\Users\...`) is provable from any host; both are absolute real paths. */
export const pathWithin = (p: string, root: string, separator: string = sep) =>
  p === root || p.startsWith(root + separator);
const within = (p: string, root: string) => pathWithin(p, root);
function safeRoot(path: string, home: string) {
  let p = home;
  for (const part of relative(home, path).split(sep)) {
    p = join(p, part);
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) return false;
  }
  return true;
}
export type ScanOptions = {
  platform?: NodeJS.Platform;
  /** CODEX_HOME / CLAUDE_CONFIG_DIR / APPDATA / OneDrive are read from here. */
  env?: NodeJS.ProcessEnv;
};
/** The folders Codex and Claude Code write, honouring their documented overrides.
 * Windows uses the same dot-folders under %USERPROFILE%. */
export function assistantHomes(home = homedir(), env: NodeJS.ProcessEnv = process.env) {
  return {
    codex: env.CODEX_HOME?.trim() || join(home, ".codex"),
    claude: env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude"),
  };
}
/** Skill ids ignore the cached plugin version folder so an upgrade updates, not duplicates.
 * Separator-agnostic: Windows real paths carry backslashes. */
export const skillIdentityPath = (real: string) =>
  real.replace(/(\.(?:codex|claude)[\\/]plugins[\\/]cache[\\/][^\\/]+[\\/][^\\/]+)[\\/][^\\/]+(?=[\\/])/, "$1");
/** Metadata only: contents are not read until the user starts an app sync. */
export function scanMemoryApp(app: MemoryAppId, home = homedir(), options: ScanOptions = {}): AppScan {
  const platform = options.platform ?? process.platform;
  // Environment overrides apply to the real home only: a synthetic home (tests, fixtures)
  // must never resolve to the operator's live CODEX_HOME, APPDATA or OneDrive folders.
  const env = options.env ?? (home === homedir() ? process.env : {});
  const homes = assistantHomes(home, env);
  const result: AppScan = {
    files: [],
    counts: { memories: 0, conversations: 0, skills: 0 },
    warnings: [],
    truncated: false,
  };
  const seen = new Set<string>(),
    directories = new Set<string>();
  let visited = 0;
  // Display paths always use "/" so the same source reads the same way on every platform
  // and downstream date parsing of "~/.codex/sessions/2026/09/18/..." works on Windows too.
  let homeReal = home;
  try { homeReal = realpathSync(home); } catch { /* A missing home keeps its literal path. */ }
  const display = (real: string) => {
    const base = within(real, home) ? home : within(real, homeReal) ? homeReal : undefined;
    return base ? "~/" + relative(base, real).split(sep).join("/") : real;
  };
  const add = (file: string, scope: AppScope, format: AppFile["format"], allowed: string[]) => {
    if (forbidden.test(basename(file))) return;
    const real = realpathSync(file);
    if (!allowed.some((r) => within(real, r)) || seen.has(real)) return;
    const stat = statSync(real);
    if (!stat.isFile()) return;
    seen.add(real);
    result.files.push({
      id: hash(
        app +
          ":" +
          (app === "codex" && scope === "conversations"
            ? basename(real)
            : scope === "skills"
              ? skillIdentityPath(real)
              : real),
      ),
      absolute: real,
      path: display(real),
      scope,
      fingerprint: `${stat.size}:${stat.mtimeMs}`,
      size: stat.size,
      modifiedMs: stat.mtimeMs,
      title:
        scope === "skills"
          ? basename(dirname(real))
          : basename(real).replace(/\.(md|jsonl|json)$/i, ""),
      format,
    });
    result.counts[scope]++;
  };
  const walk = (
    root: string,
    scope: AppScope,
    filter: (file: string) => boolean,
    allowSkillLinks = false,
    depth = 0,
    allowed?: string[],
  ) => {
    if (!existsSync(root)) return;
    if (depth > 10) {
      result.truncated = true;
      result.warnings.push("Some sources exceed the supported folder depth.");
      return;
    }
    if (!allowed && !safeRoot(root, home) && !allowSkillLinks) {
      result.warnings.push("A linked source folder was skipped.");
      return;
    }
    // Resolving the folder is inside the guarded block: a folder the system refuses to read
    // can fail at realpath (Bun on macOS, Windows ACLs) before the listing is attempted.
    try {
      const roots = allowed || [
        realpathSync(root),
        ...(allowSkillLinks &&
        existsSync(join(home, ".agents/skills")) &&
        safeRoot(join(home, ".agents/skills"), home)
          ? [realpathSync(join(home, ".agents/skills"))]
          : []),
      ];
      const directoryKey = scope + ":" + realpathSync(root);
      if (directories.has(directoryKey)) return;
      directories.add(directoryKey);
      for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (++visited > MAX_SCAN) {
          result.truncated = true;
          return;
        }
        if (
          [".git", ".obsidian", ".trash", "node_modules", "cache", "raw_memories.md"].includes(entry.name) ||
          forbidden.test(entry.name)
        )
          continue;
        const file = join(root, entry.name);
        if (entry.isSymbolicLink()) {
          if (!allowSkillLinks) continue;
          const real = realpathSync(file);
          if (!roots.some((r) => within(real, r))) continue;
          if (statSync(real).isDirectory()) walk(real, scope, filter, true, depth + 1, roots);
          else if (filter(real)) add(real, scope, "markdown", roots);
        } else if (entry.isDirectory())
          walk(file, scope, filter, allowSkillLinks, depth + 1, roots);
        else if (entry.isFile() && filter(file))
          add(file, scope, scope === "conversations" ? "jsonl" : "markdown", roots);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EPERM" || code === "EACCES") {
        result.blocked = protectedFolder(root, home);
        result.warnings.push(
          platform === "darwin"
            ? `macOS is blocking this app from reading ${result.blocked}. Allow the app that runs Agentic OS under System Settings → Privacy & Security → Files and Folders (or Full Disk Access), then rescan.`
            : platform === "win32"
              ? `Windows denied access to ${result.blocked}. Check the folder's permissions, Controlled folder access and OneDrive sync state, then rescan.`
              : `This system denied access to ${result.blocked}. Check the folder's permissions, then rescan.`,
        );
      } else result.warnings.push(`Some ${scope} files could not be read. Check folder permissions.`);
    }
  };
  if (app === "codex") {
    // ~/.codex on every platform (%USERPROFILE%\.codex on Windows), or CODEX_HOME when set.
    walk(
      join(homes.codex, "memories"),
      "memories",
      (p) => /\.md$/i.test(p) && !p.includes(sep + "skills" + sep),
    );
    for (const r of ["sessions", "archived_sessions"])
      walk(join(homes.codex, r), "conversations", (p) => /\.jsonl$/i.test(p));
    for (const r of [join(homes.codex, "skills"), join(home, ".agents/skills")])
      walk(r, "skills", (p) => basename(p).toLowerCase() === "skill.md", true);
  } else if (app === "claude") {
    // ~/.claude on every platform (%USERPROFILE%\.claude on Windows), or CLAUDE_CONFIG_DIR when set.
    const projects = join(homes.claude, "projects");
    if (existsSync(projects) && safeRoot(projects, home)) {
      for (const d of readdirSync(projects, { withFileTypes: true }))
        // Project folders the OS created for its own agent runs and checks are not the user's work.
        if (d.isDirectory() && !isOperatorSelfPath(d.name)) {
          walk(join(projects, d.name, "memory"), "memories", (p) => /\.md$/i.test(p));
          walk(join(projects, d.name), "conversations", (p) => /\.jsonl$/i.test(p));
        }
    }
    walk(join(homes.claude, "memory"), "memories", (p) => /\.md$/i.test(p));
    const main = join(homes.claude, "CLAUDE.md");
    if (existsSync(main) && safeRoot(main, home))
      add(main, "memories", "markdown", [realpathSync(homes.claude)]);
    walk(
      join(homes.claude, "skills"),
      "skills",
      (p) => basename(p).toLowerCase() === "skill.md",
      true,
    );
  } else if (app === "hermes") {
    walk(join(home, ".hermes/memories"), "memories", (p) => /\.md$/i.test(p));
    walk(
      join(home, ".hermes/skills"),
      "skills",
      (p) => basename(p).toLowerCase() === "skill.md",
      true,
    );
  } else if (app === "obsidian") {
    // Registered vault metadata only, then bounded markdown discovery. No whole-disk crawl.
    // Windows keeps the registry under %APPDATA% (Roaming); a redirected profile may move it.
    const registries = [
      ...["Library/Application Support/obsidian/obsidian.json", ".config/obsidian/obsidian.json", "AppData/Roaming/obsidian/obsidian.json"].map((r) => join(home, r)),
      ...(env.APPDATA ? [join(env.APPDATA, "obsidian", "obsidian.json")] : []),
    ];
    const vaults = new Set<string>();
    for (const file of new Set(registries)) {
      if (!existsSync(file) || !safeRoot(file, home)) continue;
      try {
        if (statSync(file).size > 1024 * 1024) continue;
        const entries = JSON.parse(readFileSync(file, "utf8")).vaults;
        for (const entry of Object.values(entries || {}).slice(0, 50) as Array<{ path?: unknown }>) {
          if (typeof entry.path === "string" && existsSync(entry.path) && statSync(entry.path).isDirectory()) vaults.add(entry.path);
        }
      } catch { result.warnings.push("Some registered Obsidian vaults could not be read."); }
    }
    // Windows commonly keeps Documents inside OneDrive; env.OneDrive names that root.
    const vaultFolders = [
      ...["Obsidian", "Documents/Obsidian", "Library/Mobile Documents/iCloud~md~obsidian/Documents"].map((folder) => join(home, folder)),
      ...(env.OneDrive ? [join(env.OneDrive, "Documents", "Obsidian"), join(env.OneDrive, "Obsidian")] : []),
    ];
    for (const base of new Set(vaultFolders)) {
      if (!existsSync(base) || !safeRoot(base, home)) continue;
      if (existsSync(join(base, ".obsidian"))) vaults.add(base);
      else try { for (const entry of readdirSync(base, { withFileTypes: true }).slice(0, 100)) {
        if (entry.isDirectory() && existsSync(join(base, entry.name, ".obsidian"))) vaults.add(join(base, entry.name));
      } } catch { result.warnings.push("An Obsidian folder needs read permission."); }
    }
    result.locations = [...vaults].map(vault => "~/" + relative(home, vault));
    // A registered vault may itself be a link. Resolve that one root; nested links still stay excluded.
    for (const vault of vaults) {
      const resolved = realpathSync(vault);
      walk(resolved, "memories", p => /\.md$/i.test(p), false, 0, [resolved]);
    }
  } else if (app === "granola") {
    // macOS keeps the cache in Application Support; the Windows build's %APPDATA% folder is
    // checked the same way but has not been verified on a Windows machine.
    const folder = [
      join(home, "Library/Application Support/Granola"),
      ...(env.APPDATA ? [join(env.APPDATA, "Granola")] : []),
    ].find((candidate) => existsSync(candidate) && safeRoot(candidate, home));
    if (folder) {
      for (const name of ["cache-v6.json", "cache-v5.json", "cache-v4.json", "cache-v3.json"]) {
        const file = join(folder, name);
        if (existsSync(file) && !lstatSync(file).isSymbolicLink()) {
          add(file, "memories", "granola", [realpathSync(folder)]);
          break;
        }
      }
      if (!result.files.length)
        result.warnings.push(
          "Granola is installed, but its local notes are encrypted or unavailable. Export notes from Granola and import the file; no account keys are accessed.",
        );
    }
  }
  // Cache does not reliably expose active plugin inventory. Include one newest cached
  // version per bundle, SKILL.md only, and label that scope explicitly.
  if (app === "codex" || app === "claude") {
    const bundles = join(homes[app], "plugins", "cache");
    if (existsSync(bundles) && safeRoot(bundles, home)) {
      for (const market of readdirSync(bundles, { withFileTypes: true }).filter((d) =>
        d.isDirectory(),
      )) {
        const marketPath = join(bundles, market.name);
        for (const plugin of readdirSync(marketPath, { withFileTypes: true }).filter((d) =>
          d.isDirectory(),
        )) {
          const pluginPath = join(marketPath, plugin.name);
          const versions = readdirSync(pluginPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(pluginPath, d.name))
            .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
          if (versions[0])
            walk(
              join(versions[0], "skills"),
              "skills",
              (p) => basename(p).toLowerCase() === "skill.md",
            );
        }
      }
      result.warnings.push(
        "Skills include the newest cached bundle per plugin; some cached plugins may no longer be active.",
      );
    }
  }
  if (app === "chatgpt") {
    const exports = ["Downloads/conversations.json", "Downloads/ChatGPT/conversations.json", "Downloads/chatgpt-export/conversations.json", "Documents/ChatGPT/conversations.json", "Documents/ChatGPT Export/conversations.json"];
    // Windows often redirects Documents and Downloads into OneDrive; env.OneDrive names that root.
    const bases = [home, ...(env.OneDrive ? [env.OneDrive] : [])];
    for (const file of new Set(bases.flatMap((base) => exports.map((relativePath) => join(base, relativePath))))) {
      if (existsSync(file) && safeRoot(file, home)) add(file, "conversations", "chatgpt", [realpathSync(dirname(file))]);
    }
    if (!result.files.length) result.warnings.push("No conversations.json export found in the known Downloads or Documents locations. A ChatGPT login or MCP connection does not expose local chat history.");
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}
/** Read bounded lines; oversized tool records never become a huge string/JSON allocation. */
async function* lines(
  file: AppFile,
  oversized: () => void,
  checkActive: () => void,
): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let pending = "",
    pendingBytes = 0,
    dropping = false;
  const stream = createReadStream(file.absolute, {
    highWaterMark: 65536,
    start: 0,
    end: Math.max(0, file.size - 1),
  });
  for await (const bytes of stream) {
    checkActive();
    const chunk = decoder.write(bytes as Buffer);
    let start = 0;
    for (let i = 0; i < chunk.length; i++)
      if (chunk[i] === "\n") {
        if (!dropping) {
          const piece = chunk.slice(start, i);
          pendingBytes += Buffer.byteLength(piece);
          if (pendingBytes <= MAX_LINE) yield pending + piece;
          else oversized();
        }
        pending = "";
        pendingBytes = 0;
        dropping = false;
        start = i + 1;
      }
    if (!dropping) {
      const piece = chunk.slice(start);
      pendingBytes += Buffer.byteLength(piece);
      if (pendingBytes > MAX_LINE) {
        oversized();
        pending = "";
        dropping = true;
      } else pending += piece;
    }
  }
  if (!dropping) {
    pending += decoder.end();
    if (pending.trim()) {
      if (Buffer.byteLength(pending) <= MAX_LINE) yield pending;
      else oversized();
    }
  }
}
function textParts(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (p) =>
        p && ["text", "input_text", "output_text"].includes(p.type) && typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("\n");
}
export function decodeConversationRecord(
  app: string,
  row: any,
  fallback = false,
): { role: "user" | "assistant"; text: string } | null {
  if (app === "codex") {
    const p = row?.payload;
    if (
      fallback &&
      row?.type === "event_msg" &&
      ["user_message", "agent_message"].includes(p?.type) &&
      typeof p.message === "string"
    )
      return { role: p.type === "user_message" ? "user" : "assistant", text: p.message };
    // Codex Desktop (CLI 0.154+) records each visible turn as a completed item.
    // Some replies (clarifying questions) exist only here, never as a response_item.
    // User parts are typed "text"; agent parts "Text", so the type check ignores case.
    if (row?.type === "event_msg" && p?.type === "item_completed") {
      const item = p.item;
      if (!item || !["UserMessage", "AgentMessage"].includes(item.type)) return null;
      const text = Array.isArray(item.content)
        ? (item.content as Array<{ type?: unknown; text?: unknown }>)
            .filter((part) => part && typeof part.text === "string" && ["text", "input_text", "output_text"].includes(String(part.type || "text").toLowerCase()))
            .map((part) => part.text as string)
            .join("\n")
        : typeof item.content === "string" ? item.content : "";
      return text.trim() ? { role: item.type === "UserMessage" ? "user" : "assistant", text } : null;
    }
    if (
      row?.type !== "response_item" ||
      p?.type !== "message" ||
      !["user", "assistant"].includes(p.role) ||
      p.channel === "analysis"
    )
      return null;
    const text = textParts(p.content);
    return text.trim() ? { role: p.role, text } : null;
  }
  if (
    app === "claude" &&
    ["user", "assistant"].includes(row?.type) &&
    ["user", "assistant"].includes(row?.message?.role)
  ) {
    // Claude Code project transcripts (~/.claude/projects/<cwd>/<session>.jsonl):
    // one row per visible turn plus tool_use/tool_result pairs, thinking blocks,
    // and injected context. `isMeta` rows and CLI wrappers (command echoes, task
    // notifications, reminders) are the harness talking, never the user's words.
    if (row.isMeta === true) return null;
    let text = textParts(row.message.content);
    if (row.message.role === "user") {
      text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      if (/^<(?:command-name|command-message|command-args|local-command-|task-notification|bash-input|bash-stdout|bash-stderr)/.test(text)) return null;
    }
    return text.trim() ? { role: row.message.role, text } : null;
  }
  return null;
}
async function transcript(
  file: AppFile,
  app: string,
  emit: (text: string, part: number) => Promise<void>,
  checkActive: () => void,
) {
  let part = 0,
    buffer = "",
    messages = 0,
    filtered = 0,
    malformed = 0,
    oversized = 0;
  // Codex writes the same visible message twice (response_item and
  // item_completed) within a few rows. Only hashes of the last few messages are
  // kept, so a genuinely repeated short reply later in the session survives.
  const recent: string[] = [];
  const twin = (role: string, text: string) => {
    const key = hash(role + "\n" + text.trim());
    if (recent.includes(key)) return true;
    recent.push(key);
    if (recent.length > 12) recent.shift();
    return false;
  };
  async function pass(fallback = false) {
    recent.length = 0;
    for await (const line of lines(file, () => oversized++, checkActive)) {
      checkActive();
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        malformed++;
        continue;
      }
      const msg = decodeConversationRecord(app, row, fallback);
      if (!msg || twin(msg.role, msg.text)) {
        filtered++;
        continue;
      }
      messages++;
      let text = `${msg.role === "user" ? "User" : "Assistant"}:\n${msg.text.trim()}\n\n`;
      while (text.length) {
        checkActive();
        const n = Math.min(PART - buffer.length, text.length);
        buffer += text.slice(0, n);
        text = text.slice(n);
        if (buffer.length === PART) {
          await emit(buffer, part++);
          buffer = "";
        }
      }
    }
  }
  await pass();
  if (!messages && app === "codex") {
    malformed = 0;
    oversized = 0;
    filtered = 0;
    await pass(true);
  }
  if (buffer.trim()) await emit(buffer, part++);
  return { parts: part, messages, filtered, malformed, oversized };
}
function richText(v: any, depth = 0): string {
  if (depth > 12 || !v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .map((x) => richText(x, depth + 1))
      .filter(Boolean)
      .join("\n");
  if (typeof v.text === "string") return v.text;
  return richText(v.content || v.children, depth + 1);
}
export function granolaDocuments(value: any) {
  let data = value;
  if (typeof data?.cache === "string") {
    try {
      data = JSON.parse(data.cache);
    } catch {
      throw new Error("The Granola cache is not readable JSON. Export notes instead.");
    }
  }
  const docs = data?.state?.documents || data?.documents || data?.notes;
  if (!docs || typeof docs !== "object")
    throw new Error(
      "This Granola file has an unsupported format. Export your notes as Markdown instead.",
    );
  return (Array.isArray(docs) ? docs : Object.entries(docs).map(([id, v]: any) => ({ id, ...v })))
    .map((d: any) => ({
      id: String(d.id || d.document_id || ""),
      title: String(d.title || "Granola meeting"),
      text: richText(d.notes_markdown || d.notes_plain || d.notes),
    }))
    .filter((d: any) => d.id && d.text.trim());
}
export function chatGPTDocuments(value: any) {
  if (!Array.isArray(value))
    throw new Error("Choose conversations.json from your ChatGPT data export.");
  return value
    .map((c: any, index: number) => {
      const mapping = c?.mapping;
      if (!mapping || typeof mapping !== "object") return null;
      const nodes: any[] = [];
      const seen = new Set<string>();
      let key = c.current_node;
      if (key) {
        while (key && mapping[key] && !seen.has(key)) {
          seen.add(key);
          nodes.push(mapping[key]);
          key = mapping[key].parent;
        }
        nodes.reverse();
      } else
        nodes.push(
          ...Object.values(mapping).sort(
            (a: any, b: any) => (a.message?.create_time || 0) - (b.message?.create_time || 0),
          ),
        );
      const text = nodes
        .map((n) => n.message)
        .filter(
          (m) =>
            m &&
            ["user", "assistant"].includes(m.author?.role) &&
            m.channel !== "analysis" &&
            !m.metadata?.is_visually_hidden_from_conversation,
        )
        .map((m) => {
          const content = Array.isArray(m.content?.parts)
            ? m.content.parts.filter((p: any) => typeof p === "string").join("\n")
            : "";
          return content.trim()
            ? `${m.author.role === "user" ? "User" : "Assistant"}:\n${content.trim()}`
            : "";
        })
        .filter(Boolean)
        .join("\n\n");
      return {
        id: String(c.id || c.conversation_id || hash(String(index) + String(c.title))),
        title: String(c.title || "ChatGPT conversation"),
        text,
      };
    })
    .filter((x): x is { id: string; title: string; text: string } => !!x && !!x.text.trim());
}
function importDiagnostics(preferences: AppPreferences, scan: AppScan) {
  const files = scan.files.filter((f) => f.format === "jsonl" && preferences.scopes[f.scope]);
  const issues: Array<{ code: string; count: number; file?: string; message: string }> = [];
  let importedMessages = 0,
    filteredRecords = 0,
    omittedRecords = 0,
    filesDetailed = 0,
    recheckFiles = 0;
  for (const file of files) {
    const details = preferences.recordStats[file.id],
      partial = preferences.partialCheckpoints[file.id];
    if (details?.fingerprint === file.fingerprint && details.version === READER_VERSION) {
      filesDetailed++;
      importedMessages += details.importedMessages;
      filteredRecords += details.filteredRecords;
      omittedRecords += details.malformedRecords + details.oversizedRecords;
      if (details.malformedRecords)
        issues.push({
          code: "malformed_record",
          count: details.malformedRecords,
          file: basename(file.absolute),
          message:
            "Unreadable JSON records were omitted. They may contain conversation text; other readable messages were saved.",
        });
      if (details.oversizedRecords)
        issues.push({
          code: "record_limit",
          count: details.oversizedRecords,
          file: basename(file.absolute),
          message:
            "Records above the 16 MB limit were omitted without classifying their contents. Import a text export of any needed conversation.",
        });
    } else if (partial?.fingerprint === file.fingerprint) {
      const matched = partial.reason.match(/(\d+) malformed and (\d+) records over the (\d+) MB/);
      const malformed = Number(matched?.[1] || 0),
        oversized = Number(matched?.[2] || 0);
      omittedRecords += malformed + oversized;
      if (partial.readerVersion !== READER_VERSION) recheckFiles++;
      if (oversized)
        issues.push({
          code: "legacy_record_limit",
          count: oversized,
          file: basename(file.absolute),
          message:
            "The earlier 1 MB reader could not classify these records. Sync again to recover readable text; large images and tool payloads will be filtered separately.",
        });
      if (malformed)
        issues.push({
          code: "malformed_record",
          count: malformed,
          file: basename(file.absolute),
          message: "The earlier scan found unreadable JSON records. Readable records were saved.",
        });
    } else if (preferences.checkpoints[file.id] === file.fingerprint) recheckFiles++;
  }
  if (preferences.progress.failed)
    issues.push({
      code: "source_read_error",
      count: preferences.progress.failed,
      message:
        "Some source files could not be read. They remain unchanged; retry after correcting their format or access.",
    });
  return {
    importedMessages,
    filteredRecords,
    omittedRecords,
    excludedSavedItems: preferences.progress.excluded || 0,
    deferredFiles: preferences.progress.deferred || 0,
    filesDetailed,
    filesTotal: files.length,
    detailsComplete: filesDetailed === files.length,
    recheckFiles,
    recordLimitBytes: MAX_LINE,
    filtering:
      "Tool calls/results, image data, hidden reasoning and non-conversation metadata are intentionally excluded. Counts refer to records, not necessarily messages.",
    issues,
  };
}
function legacyDeferredCount(preferences: AppPreferences) {
  if (
    preferences.status !== "error" ||
    !preferences.error ||
    preferences.progress.failed ||
    preferences.progress.excluded
  )
    return 0;
  const suffix = ": changed during the scan; sync again to include its latest content.";
  const files = preferences.error.split(suffix);
  if (files.length < 2 || files.pop() !== "" || files.some((f) => !/^ ?~\/[^:\r\n]+$/.test(f)))
    return 0;
  return preferences.progress.skipped === files.length ? files.length : 0;
}
/** Order one bounded pass. Newest work first: the most recently modified files
 * (by mtime, then path) import before older history, so today's sessions arrive
 * on the first sync. When the previous pass ran out of budget, files it never
 * reached resume from the durable pointer before already-imported files that
 * changed again; that keeps one active transcript from starving a large
 * backlog. Completed files are skipped by checkpoint and never re-imported. */
export function orderSyncFiles<T extends { id: string; path: string; modifiedMs: number }>(
  files: T[],
  imported: (id: string) => boolean,
  resumeFileId?: string,
): T[] {
  const newest = [...files].sort(
    (a, b) => b.modifiedMs - a.modifiedMs || a.path.localeCompare(b.path),
  );
  const resumeAt = resumeFileId ? newest.findIndex((file) => file.id === resumeFileId) : -1;
  if (resumeAt <= 0) return newest;
  const fresh = newest.slice(0, resumeAt).filter((file) => !imported(file.id));
  const ahead = new Set(fresh.map((file) => file.id));
  return [
    ...fresh,
    ...newest.slice(resumeAt),
    ...newest.slice(0, resumeAt).filter((file) => !ahead.has(file.id)),
  ];
}
export function memoryApps(options: {
  root: string;
  home?: string;
  importSource: (input: ReadyImport) => ImportResult | Promise<ImportResult>;
  importSources?: (inputs: ReadyImport[]) => ImportResult[] | Promise<ImportResult[]>;
  reconcileSources?: (items: ImportedParts[]) => void | Promise<void>;
  validCollection: (id: string) => boolean;
  accountStatus?: () => Promise<any>;
  syncAccount?: (provider: string) => Promise<{ messages: number; events: number }>;
  mailDocuments?: (provider: string) => Array<{ id: string; title: string; text: string }>;
  notionConfigured?: () => boolean;
  granolaConnection?: (force?: boolean) => Promise<"codex" | "api" | undefined>;
  granolaNotes?: (cursor?: string, method?: "codex" | "api") => Promise<{ documents: Array<{ id: string; title: string; text: string }>; hasMore: boolean; cursor?: string }>;
  notionConnection?: (force?: boolean) => Promise<"codex" | undefined>;
  notionPages?: () => Promise<{ documents: Array<{ id: string; title: string; text: string }>; hasMore: boolean; skipped?: number }>;
  sourceEnabled?: (origin: string) => boolean;
  syncInfo?: () => unknown | Promise<unknown>;
  /** Runs after a manual or daily Refresh all, for work outside the app list (mail history, exports). */
  afterSyncAll?: () => unknown;
}) {
  const home = options.home || homedir(),
    dir = join(options.root, ".operator-data"),
    file = join(dir, "memory-apps.json");
  const load = (): Partial<Record<MemoryAppId, AppPreferences>> => {
    if (!existsSync(file)) return {};
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!data || Array.isArray(data) || typeof data !== "object") throw Error();
      return data;
    } catch {
      throw new Error(
        "Memory app settings could not be read. Existing settings were left untouched.",
      );
    }
  };
  const prefs = (id: MemoryAppId): AppPreferences => ({
    enabled: false,
    autoSync: false,
    scopes: scopes(),
    collection: "business",
    status: "idle",
    progress: zero(),
    checkpoints: {},
    partialCheckpoints: {},
    recordStats: {},
    ...load()[id],
  });
  const update = (id: MemoryAppId, patch: Partial<AppPreferences>) => {
    const data = load();
    data[id] = { ...prefs(id), ...patch };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, file);
    return data[id]!;
  };
  const requireId = (id: string) => {
    if (!MEMORY_APP_IDS.includes(id as MemoryAppId))
      throw new Error("Choose a supported memory app.");
    return id as MemoryAppId;
  };
  const active = new Set<MemoryAppId>();
  let stopped = false,
    timer: ReturnType<typeof setInterval> | undefined;
  const originFor = (id: string) => id === "granola" ? "meetings" : ["gmail", "outlook"].includes(id) ? "email" : id;
  const allowed = (id: string) => options.sourceEnabled?.(originFor(id)) !== false;
  const queued = new Set<string>();
  /** Apps whose manual sync keeps running bounded passes until the backlog is gone. */
  const catching = new Set<MemoryAppId>();
  let draining = false;
  const checkActive = (id: MemoryAppId) => {
    if (stopped || !prefs(id).enabled || !allowed(id)) throw new ImportPaused();
  };
  const cache = new Map<MemoryAppId, { at: number; scan: AppScan }>();
  const scan = (id: MemoryAppId, force = false) => {
    const old = cache.get(id);
    if (old && !force && Date.now() - old.at < 30000) return old.scan;
    const value = scanMemoryApp(id, home);
    cache.set(id, { at: Date.now(), scan: value });
    return value;
  };
  const dailyRefresh = memoryRefresh(options.root, () => syncAll());
  async function listing(force = false) {
    if (force) cache.clear();
    const connected = options.accountStatus ? await options.accountStatus() : { accounts: [] };
    // Both checks share one Codex probe when they run together; in sequence a forced refresh would spawn it twice.
    const [granolaMethod, notionMethod] = await Promise.all([options.granolaConnection?.(force), options.notionConnection?.(force)]);
    const names: Record<MemoryAppId, string> = {
      codex: "Codex",
      claude: "Claude",
      hermes: "Hermes",
      granola: "Granola",
      gmail: "Gmail",
      outlook: "Outlook",
      notion: "Notion",
      obsidian: "Obsidian",
      chatgpt: "ChatGPT",
    };
    return {
      pollAfterMs: 1500,
      refresh: dailyRefresh.status(),
      apps: MEMORY_APP_IDS.map((id) => {
        let p = prefs(id);
        if (["syncing", "scanning"].includes(p.status) && !active.has(id)) {
          p = update(id, {
            status: "error",
            error: "Sync was interrupted. Sync again to continue; completed imports are retained.",
          });
        }
        const found = scan(id),
          provider = id === "gmail" ? "google" : id;
        const diagnostics = importDiagnostics(p, found),
          legacyDeferred = legacyDeferredCount(p);
        if (legacyDeferred && !diagnostics.omittedRecords) {
          p = {
            ...p,
            status: "idle",
            error: undefined,
            progress: {
              ...p.progress,
              skipped: 0,
              deferred: (p.progress.deferred || 0) + legacyDeferred,
            },
          };
          diagnostics.deferredFiles = p.progress.deferred;
        }
        const account = connected.accounts?.find((a: any) => a.id === provider),
          local = ["codex", "claude", "hermes", "granola", "chatgpt", "obsidian"].includes(id);
        const granolaConnected = id === "granola" && !!granolaMethod;
        const notionConnected = id === "notion" && !!notionMethod;
        const localSnapshots = connected.snapshots?.[id] || 0;
        const available = granolaConnected || notionConnected ? true : local
          ? found.files.length > 0
          : ["gmail", "outlook"].includes(id)
            ? !!account?.connected || localSnapshots > 0
            : id === "notion"
              ? !!options.notionConfigured?.()
              : false;
        const mode = granolaConnected || notionConnected ? "api" : ["gmail", "outlook"].includes(id)
          ? "account"
          : local && !(id === "granola" && !available)
            ? "local"
            : "import";
        const capability = {
          memories: !["gmail", "outlook", "chatgpt"].includes(id),
          conversations: ["codex", "claude", "gmail", "outlook", "chatgpt"].includes(id),
          skills: ["codex", "claude", "hermes"].includes(id),
        };
        const { checkpoints, partialCheckpoints, recordStats, resumeFileId, remoteCursor, ...safe } = p;
        return {
          ...safe,
          id,
          name: names[id],
          connectionMethod: id === "granola" ? granolaMethod : id === "notion" ? notionMethod : undefined,
          mode,
          setupAction: mode === "account" ? "accounts" : id === "notion" && !notionConnected ? "notion" : "import",
          origin: id === "granola" ? "meetings" : ["gmail", "outlook"].includes(id) ? "email" : id,
          accountProvider: mode === "account" ? provider : undefined,
          accountConnected: !!account?.connected,
          accountConfigured: !!account?.configured,
          localSnapshots,
          available,
          canSync: granolaConnected || notionConnected ? true : mode === "account" ? !!account?.connected || localSnapshots > 0 : available && local,
          queued: queued.has(id) || (catching.has(id) && !active.has(id)),
          catchingUp: catching.has(id),
          capabilities: capability,
          counts:
            mode === "account" ? { ...found.counts, conversations: localSnapshots } : found.counts,
          truncated: found.truncated,
          availabilityNote:
            granolaConnected ? granolaMethod === "codex" ? "Uses your existing Granola connection through Codex. Sync imports your meeting notes from the past year. No export or new key needed." : "Connected to Granola API. Sync imports up to 20 meeting notes per pass; more notes resume on the next sync." : id === "obsidian" ? "Registered Obsidian vaults are discovered automatically. Sync copies Markdown notes; plugins and settings stay in Obsidian." : id === "chatgpt"
              ? "Import conversations.json from your ChatGPT export. A desktop login does not provide complete chat history."
              : id === "notion"
                ? notionConnected ? "Uses your existing Notion connection through Codex. Sync imports up to 12 of your recently edited pages as memories. No integration key needed." : "Connect an integration and import a shared page. Only the pages you choose are copied."
                : mode === "account"
                  ? account?.connected
                    ? "Connected. Sync refreshes saved mail within the provider’s sync limits. Full mailbox history stays available in the source app."
                    : localSnapshots > 0
                      ? `${localSnapshots} saved email snapshots available in memory. Connect the account for new messages and provider sync.`
                      : "Connect this account in Connections, then sync mail here."
                  : found.warnings[0] ||
                    (available
                      ? id === "hermes"
                        ? "Local memory and skills detected. Hermes database conversations are not imported."
                        : "Local sources detected. Only selected text scopes are imported; tool payloads and account files are excluded."
                      : "No supported local store found. Import an export or note instead."),
          warnings: found.warnings,
          diagnostics,
          discovery: {
            checkedAt: new Date(cache.get(id)?.at || Date.now()).toISOString(),
            fileCount: found.files.length, totalBytes: found.files.reduce((sum, f) => sum + f.size, 0),
            categories: (["memories", "conversations", "skills"] as AppScope[]).map(scope => ({ scope, count: found.counts[scope], bytes: found.files.filter(f => f.scope === scope).reduce((sum, f) => sum + f.size, 0) })),
            examples: (["memories", "conversations", "skills"] as AppScope[]).flatMap(scope => found.files.filter(f => f.scope === scope).slice(0, 3).map(f => ({ name: basename(f.absolute), scope, bytes: f.size }))),
            roots: id === "codex" ? [".codex/memories", ".codex/sessions", ".codex/archived_sessions", ".codex/skills", ".agents/skills", ".codex/plugins/cache"] : id === "claude" ? [".claude/projects", ".claude/memory", ".claude/CLAUDE.md", ".claude/skills", ".claude/plugins/cache"] : id === "hermes" ? [".hermes/memories", ".hermes/skills"] : id === "granola" ? ["Library/Application Support/Granola/cache-v3…v6.json"] : id === "chatgpt" ? ["Downloads/conversations.json", "Downloads/ChatGPT", "Downloads/chatgpt-export", "Documents/ChatGPT", "Documents/ChatGPT Export"] : id === "obsidian" ? found.locations || [] : [],
            blocked: found.blocked,
            limitations: [...found.warnings, "Discovery reads file metadata only. A sync processes up to 40 changed files and 64 MiB, or one streamed conversation file up to 256 MiB, newest files first. Completed files resume from checkpoints; records above 16 MiB remain excluded with a visible warning.", ...(found.truncated ? ["Discovery reached its 50,000-entry or folder-depth cap; this is incomplete coverage."] : []), ...(id === "granola" ? ["Granola uses its existing Codex connection when available, then a configured API key."] : [])],
          },
          notice: p.progress.deferred
            ? `${p.progress.deferred} source${p.progress.deferred === 1 ? " is" : "s are"} being updated. Saved content stays available; new content arrives on the next sync.`
            : undefined,
        };
      }),
    };
  }
  const recordResult = (progress: ReturnType<typeof zero>, result: ImportResult) => {
    if (result.skipped) {
      progress.skipped++;
      progress.excluded++;
    } else if (result.unchanged) progress.unchanged++;
    else if (result.updated) progress.updated++;
    else progress.added++;
  };
  async function importDocuments(
    id: MemoryAppId,
    docs: Array<{ id: string; title: string; text: string }>,
    collection: string,
    progress: ReturnType<typeof zero>,
    replaceCollection = false,
  ) {
    progress.total = docs.length;
    let pending: ReadyImport[] = [];
    let completed: ImportedParts[] = [];
    const flush = async () => {
      if (!pending.length && !completed.length) return;
      if (pending.length) {
        const results = options.importSources
          ? await options.importSources(pending)
          : await Promise.all(pending.map(options.importSource));
        results.forEach((r) => recordResult(progress, r));
      }
      if (completed.length) await options.reconcileSources?.(completed);
      pending = [];
      completed = [];
      update(id, { progress: { ...progress } });
    };
    for (const doc of docs) {
      checkActive(id);
      const keepParts: number[] = [];
      for (let n = 0; n < doc.text.length; n += PART) {
        checkActive(id);
        const content = doc.text.slice(n, n + PART);
        if (!content.trim()) continue;
        keepParts.push(n / PART);
        pending.push({
          title: doc.title + (n ? " · part " + (n / PART + 1) : ""),
          text: importText(content),
          // Each page keeps its own source: Notion pages were once filed under ChatGPT.
          origin: id === "granola" ? "meetings" : ["gmail", "outlook"].includes(id) ? "email" : id,
          collection,
          ...(replaceCollection ? { replaceCollection: true } : {}),
          connector: {
            provider: id,
            itemId: doc.id + (n ? ":part:" + n / PART : ""),
            syncedAt: stamp(),
          },
        });
        if (pending.length >= 8) await flush();
      }
      completed.push({
        provider: id,
        itemId: doc.id,
        parts: Math.ceil(doc.text.length / PART),
        keepParts,
      });
      progress.processed++;
      if (progress.processed % 8 === 0) {
        await flush();
        update(id, { progress: { ...progress } });
      }
      await new Promise<void>((done) => setTimeout(done, 0));
    }
    await flush();
  }
  async function perform(id: MemoryAppId, retryOlderReader = false) {
    active.add(id);
    const progress = zero();
    update(id, { status: "scanning", error: undefined, warning: undefined, progress });
    try {
      const p = prefs(id);
      if (!p.enabled || !allowed(id)) throw new Error("Enable this app and its memory source before syncing.");
      if (["gmail", "outlook"].includes(id)) {
        if (!p.scopes.conversations) throw new Error("Choose the conversations scope for mail.");
        if (!options.syncAccount) throw new Error("Mail sync is unavailable.");
        const account = (await options.accountStatus?.())?.accounts?.find(
          (a: any) => a.id === (id === "gmail" ? "google" : id),
        );
        if (account?.connected) await options.syncAccount(id === "gmail" ? "google" : id);
        else if (!options.mailDocuments?.(id).length) throw new Error("Connect the account or import saved mail first.");
        update(id, { status: "syncing" });
        await importDocuments(id, options.mailDocuments?.(id) || [], p.collection, progress);
        const complete = progress.processed === progress.total;
        update(id, {
          ...(complete ? account?.connected ? { lastSync: stamp() } : { lastImport: stamp() } : {}),
          status: complete ? "idle" : "error",
          progress,
          error: complete
            ? undefined
            : "Mail fetched; memory import paused. Sync again to finish indexing the saved mail.",
        });
        return;
      }
      const granolaMethod = id === "granola" ? await options.granolaConnection?.() : undefined;
      if (id === "granola" && granolaMethod && options.granolaNotes) {
        if (!p.scopes.memories) throw new Error("Choose the memories scope for meeting notes.");
        update(id, { status: "syncing" });
        const batch = await options.granolaNotes(p.remoteCursor, granolaMethod);
        await importDocuments(id, batch.documents, p.collection, progress);
        checkActive(id);
        progress.hasMore = batch.hasMore;
        progress.remaining = batch.hasMore ? 1 : 0;
        update(id, { status: "idle", lastSync: stamp(), remoteCursor: batch.cursor, progress, error: undefined });
        return;
      }
      const notionMethod = id === "notion" ? await options.notionConnection?.() : undefined;
      if (id === "notion" && notionMethod && options.notionPages) {
        if (!p.scopes.memories) throw new Error("Choose the memories scope for Notion pages.");
        update(id, { status: "syncing" });
        const batch = await options.notionPages();
        await importDocuments(id, batch.documents, p.collection, progress);
        checkActive(id);
        progress.hasMore = false;
        progress.remaining = 0;
        progress.skipped += batch.skipped || 0;
        update(id, { status: "idle", lastSync: stamp(), progress, error: undefined });
        return;
      }
      if (id === "notion")
        throw new Error("This app uses an explicit page or file import.");
      const found = scan(id, true);
      if (found.truncated)
        throw new Error(
          "The source scan reached its file limit. No partial scan is presented as a complete import.",
        );
      if (!found.files.length)
        throw new Error(found.warnings[0] || "No supported local sources were found.");
      let files = found.files.filter((f) => p.scopes[f.scope] && (f.scope !== "skills" || options.sourceEnabled?.("skills") !== false));
      if (!files.length) throw new Error("Select a scope with available local sources.");
      // Newest files first, then the work the previous pass could not fit.
      // Checkpoints and each pass's size limits are unchanged.
      // A manual sync also treats files saved by an older reader as open work, so the
      // newest of them are re-read before the long tail instead of after it.
      files = orderSyncFiles(
        files,
        (fileId) =>
          (fileId in p.checkpoints || fileId in p.partialCheckpoints) &&
          !(retryOlderReader && p.recordStats[fileId]?.version !== READER_VERSION),
        p.resumeFileId,
      );
      progress.total = files.length;
      update(id, { status: "syncing", progress });
      const checkpoints = { ...p.checkpoints };
      const partialCheckpoints = { ...p.partialCheckpoints };
      const recordStats = { ...p.recordStats };
      // Real failures (unreadable files, paused imports) end in an error; records
      // skipped inside an otherwise imported file are only a warning.
      const errors: string[] = [];
      const warnings: string[] = [];
      let pending: ReadyImport[] = [];
      let completed: ImportedParts[] = [];
      let pendingCheckpoints: Record<string, string> = {};
      let pendingPartials: AppPreferences["partialCheckpoints"] = {};
      let pendingRecordStats: AppPreferences["recordStats"] = {};
      const flush = async () => {
        // Files whose every part was excluded still need their checkpoint committed, or the next pass re-reads them forever.
        if (!pending.length && !completed.length && !Object.keys(pendingPartials).length && !Object.keys(pendingCheckpoints).length) return;
        if (pending.length) {
          const batch = pending;
          const results = options.importSources
            ? await options.importSources(batch)
            : await Promise.all(batch.map(options.importSource));
          for (const result of results) recordResult(progress, result);
        }
        if (completed.length) await options.reconcileSources?.(completed);
        Object.assign(checkpoints, pendingCheckpoints);
        for (const id of Object.keys(pendingCheckpoints)) delete partialCheckpoints[id];
        Object.assign(partialCheckpoints, pendingPartials);
        Object.assign(recordStats, pendingRecordStats);
        pending = [];
        completed = [];
        pendingCheckpoints = {};
        pendingPartials = {};
        pendingRecordStats = {};
        update(id, { progress: { ...progress }, checkpoints, partialCheckpoints, recordStats });
      };
      let changedFiles = 0, changedBytes = 0;
      let resumeFileId: string | undefined;
      for (const source of files) {
        if (stopped || !prefs(id).enabled || !allowed(id)) {
          resumeFileId ??= source.id;
          break;
        }
        // A complete transcript saved by an older reader is re-read on a manual
        // sync only, so the richer decoder fills in text without churning autosync.
        const olderReader = source.format === "jsonl" && recordStats[source.id]?.version !== READER_VERSION;
        if (checkpoints[source.id] === source.fingerprint && !(retryOlderReader && olderReader)) {
          progress.unchanged++;
          progress.processed++;
          continue;
        }
        const partial = partialCheckpoints[source.id];
        if (
          partial?.fingerprint === source.fingerprint &&
          !(retryOlderReader && partial.readerVersion !== READER_VERSION)
        ) {
          progress.unchanged++;
          progress.skipped += partial.skipped;
          progress.processed++;
          warnings.push(partial.reason);
          continue;
        }
        const largeTranscript = source.format === "jsonl" && source.size > SYNC_BYTES;
        if (source.size > (source.format === "jsonl" ? LARGE_TRANSCRIPT_BYTES : SYNC_BYTES)) {
          progress.failed++; progress.processed++;
          errors.push(`${source.path}: exceeds the ${source.format === "jsonl" ? 256 : 64} MiB file limit. Export smaller text files to import this source. Other files remain available.`);
          continue;
        }
        // One large file per pass, and no smaller work in that same pass.
        if (changedFiles >= 40 || (largeTranscript ? changedFiles > 0 : changedBytes + source.size > SYNC_BYTES)) {
          resumeFileId ??= source.id;
          continue;
        }
        changedFiles++; changedBytes += source.size;
        try {
          const current = statSync(source.absolute);
          if (`${current.size}:${current.mtimeMs}` !== source.fingerprint) {
            progress.deferred++;
            progress.processed++;
            continue;
          }
          let completeFile = true;
          let partialResult: AppPreferences["partialCheckpoints"][string] | undefined;
          const fileParts: ImportedParts[] = [];
          const emittedParts = new Map<string, number[]>();
          // The OS's own check and runtime transcripts are skipped, never saved.
          // A marker in the opening part excludes the whole transcript; earlier
          // records for that file stay untouched (no reconcile), only hidden from recall.
          const excludedKeys = new Set<string>();
          let excludedParts = 0;
          const emit = async (content: string, part: number, title = source.title, subId = "") => {
            checkActive(id);
            if (!content.trim()) return;
            const key = subId || source.id;
            if (excludedKeys.has(key)) {
              excludedParts++;
              return;
            }
            if (isOperatorSelfTranscript(content)) {
              if (part === 0) excludedKeys.add(key);
              excludedParts++;
              progress.excluded++;
              return;
            }
            emittedParts.set(key, [...(emittedParts.get(key) || []), part]);
            const input: ReadyImport = {
              title: `${id === "codex" ? "Codex" : id === "claude" ? "Claude" : id === "hermes" ? "Hermes" : id === "chatgpt" ? "ChatGPT" : id === "obsidian" ? "Obsidian" : "Granola"} · ${title}${part ? " · part " + (part + 1) : ""}`,
              text: importText(content),
              origin: source.scope === "skills" ? "skills" : id === "granola" ? "meetings" : id,
              collection: p.collection,
              connector: {
                provider: id,
                itemId: (subId || source.id) + (part ? ":part:" + part : ""),
                path: source.path,
                syncedAt: stamp(),
                activityAt: new Date(source.modifiedMs).toISOString(),
              },
            };
            pending.push(input);
            if (pending.length >= 8) await flush();
          };
          if (source.format === "jsonl") {
            const r = await transcript(source, id, emit, () => checkActive(id));
            fileParts.push({ provider: id, itemId: source.id, parts: r.parts });
            pendingRecordStats[source.id] = {
              fingerprint: source.fingerprint,
              version: READER_VERSION,
              importedMessages: r.messages,
              filteredRecords: r.filtered,
              malformedRecords: r.malformed,
              oversizedRecords: r.oversized,
            };
            if (r.malformed || r.oversized) {
              completeFile = false;
              progress.skipped += r.malformed + r.oversized;
              const reason = `${source.path}: ${r.malformed} malformed and ${r.oversized} records over the 16 MB per-record limit were skipped. Other readable text was imported; tool and image-only records are counted separately.`;
              warnings.push(reason);
              partialResult = {
                fingerprint: source.fingerprint,
                skipped: r.malformed + r.oversized,
                reason,
                readerVersion: READER_VERSION,
              };
            }
          } else if (source.format === "granola" || source.format === "chatgpt") {
            if (source.size > (source.format === "chatgpt" ? 32 : 8) * 1024 * 1024)
              throw new Error(
                "The export exceeds this adapter limit (ChatGPT 32 MiB; Granola 8 MiB). Import smaller text files instead.",
              );
            const docs = (source.format === "chatgpt" ? chatGPTDocuments : granolaDocuments)(JSON.parse(readFileSync(source.absolute, "utf8")));
            if (!docs.length)
              throw new Error(
                "No readable conversations or notes were found in this export.",
              );
            for (const d of docs) {
              for (let n = 0; n < d.text.length; n += PART)
                await emit(d.text.slice(n, n + PART), n / PART, d.title, d.id);
              fileParts.push({
                provider: id,
                itemId: d.id,
                parts: Math.ceil(d.text.length / PART),
              });
            }
          } else {
            if (source.size > 2 * 1024 * 1024)
              throw new Error("A memory or skill document exceeds the 2 MB text limit.");
            const text = readFileSync(source.absolute, "utf8");
            for (let n = 0; n < text.length; n += PART)
              await emit(text.slice(n, n + PART), n / PART);
            fileParts.push({
              provider: id,
              itemId: source.id,
              parts: Math.ceil(text.length / PART),
            });
          }
          if (completeFile) {
            if (!excludedParts)
              completed.push(
                ...fileParts.map((item) => ({
                  ...item,
                  keepParts: emittedParts.get(item.itemId) || [],
                })),
              );
            pendingCheckpoints[source.id] = source.fingerprint;
          } else if (partialResult) pendingPartials[source.id] = partialResult;
        } catch (error) {
          if (error instanceof ImportPaused) {
            resumeFileId ??= source.id;
            pending = [];
            completed = [];
            pendingCheckpoints = {};
            pendingPartials = {};
            pendingRecordStats = {};
            errors.push(error.message);
            break;
          }
          progress.failed++;
          errors.push(`${source.path}: ${(error as Error).message}`);
        }
        progress.processed++;
        if (progress.processed % 8 === 0) {
          await flush();
          update(id, { progress: { ...progress }, checkpoints, partialCheckpoints, recordStats });
        }
        await new Promise<void>((done) => setTimeout(done, 0));
      }
      await flush();
      progress.remaining = progress.total - progress.processed;
      progress.hasMore = progress.remaining > 0;
      const complete = !progress.hasMore && !progress.deferred && !errors.length;
      update(id, {
        status: errors.length ? "error" : "idle",
        progress,
        checkpoints,
        partialCheckpoints,
        recordStats,
        resumeFileId,
        lastSync: complete ? stamp() : p.lastSync,
        error: errors.length
          ? errors.slice(0, 3).join(" ")
          : progress.hasMore
            ? `This bounded sync has more work: ${progress.remaining} older ${progress.remaining === 1 ? "file" : "files"} still to import. Newest files were imported first; a manual sync keeps going in the background.`
            : undefined,
        warning: warnings.length ? warnings.slice(0, 3).join(" ") : undefined,
      });
    } catch (error) {
      update(id, { status: "error", error: (error as Error).message, progress });
    } finally {
      active.delete(id);
    }
  }
  async function drainQueue() {
    if (draining) return;
    draining = true;
    try {
      while (queued.size && !stopped) {
        const id = queued.values().next().value!;
        if (id === "info") { try { if (options.sourceEnabled?.("business") !== false) await options.syncInfo?.(); } finally { queued.delete(id); } }
        else { try { if (prefs(id as MemoryAppId).enabled && allowed(id)) await perform(id as MemoryAppId); } finally { queued.delete(id); } }
      }
    } finally { draining = false; }
  }
  async function syncAll(automatic = false) {
    const summary = { queued: [] as string[], skipped: [] as {id: string; reason: string}[], alreadyRunning: [] as string[], bounded: true as const };
    for (const app of (await listing()).apps) {
      if (!app.enabled || !allowed(app.id) || (automatic && !app.autoSync)) { summary.skipped.push({ id: app.id, reason: "disabled" }); continue; }
      if (active.has(app.id) || queued.has(app.id)) { summary.alreadyRunning.push(app.id); continue; }
      if (!app.available || !app.canSync) { summary.skipped.push({ id: app.id, reason: app.availabilityNote }); continue; }
      queued.add(app.id); summary.queued.push(app.id);
    }
    if (!automatic && options.syncInfo) {
      if (options.sourceEnabled?.("business") === false) summary.skipped.push({ id: "info", reason: "disabled" });
      else if (queued.has("info")) summary.alreadyRunning.push("info");
      else { queued.add("info"); summary.queued.push("info"); }
    }
    void drainQueue().catch(() => {});
    if (!automatic) {
      try {
        void Promise.resolve(options.afterSyncAll?.()).catch(() => {});
      } catch {
        /* the app refresh above is already queued */
      }
    }
    return summary;
  }
  /** A manual sync keeps taking bounded passes (newest first) until nothing is left, so history fills in on its own. */
  async function catchUp(id: MemoryAppId) {
    catching.add(id);
    try {
      await perform(id, true);
      for (let pass = 0; pass < 200 && !stopped; pass++) {
        const current = prefs(id);
        if (!current.enabled || current.status !== "idle" || !current.progress?.hasMore) break;
        await new Promise<void>((done) => setTimeout(done, 1500));
        if (stopped || active.has(id)) break;
        await perform(id, false);
      }
    } finally {
      catching.delete(id);
    }
  }

  return {
    list: listing,
    syncAll,
    configureRefresh: dailyRefresh.configure.bind(dailyRefresh),
    configure: (raw: string, body: any) => {
      const id = requireId(raw),
        old = prefs(id),
        patch: Partial<AppPreferences> = {};
      for (const key of ["enabled", "autoSync"] as const)
        if (typeof body[key] === "boolean") patch[key] = body[key];
      if (body.scopes && typeof body.scopes === "object") {
        patch.scopes = { ...old.scopes };
        for (const key of ["memories", "conversations", "skills"] as const)
          if (typeof body.scopes[key] === "boolean") patch.scopes[key] = body.scopes[key];
      }
      if (body.collection !== undefined) {
        if (!options.validCollection(body.collection))
          throw new Error("Choose an existing memory space.");
        patch.collection = body.collection;
      }
      const configured = update(id, patch);
      const { checkpoints, partialCheckpoints, recordStats, resumeFileId, remoteCursor, ...safe } = configured;
      return { id, ...safe };
    },
    start: (raw: string, options: { catchUp?: boolean } = {}) => {
      const id = requireId(raw);
      if (active.has(id) || queued.has(id) || catching.has(id)) return { id, status: "syncing", alreadyRunning: true };
      if (!prefs(id).enabled) throw new Error("Enable this app before syncing.");
      if (options.catchUp) void catchUp(id); else void perform(id, true);
      return { id, status: "syncing" };
    },
    wait: async (raw: string) => {
      const id = requireId(raw);
      while (active.has(id) || queued.has(id)) await new Promise((done) => setTimeout(done, 10));
      return prefs(id);
    },
    importExport: async (raw: string, body: any) => {
      const id = requireId(raw);
      if (!["chatgpt", "granola", "gmail", "outlook"].includes(id))
        throw new Error("This app does not use a JSON export import.");
      if (active.has(id) || queued.has(id)) throw new Error("This app is already syncing.");
      const isMail = ["gmail", "outlook"].includes(id);
      if (
        !isMail &&
        (!/\.json$/i.test(String(body.filename || "")) || typeof body.base64 !== "string")
      )
        throw new Error("Choose a JSON export file.");
      const bytes = isMail ? Buffer.alloc(0) : Buffer.from(body.base64, "base64");
      if (bytes.length > 32 * 1024 * 1024)
        throw new Error(
          "Choose an export under 32 MB, or split it into smaller conversation exports.",
        );
      let value: any;
      try {
        value = isMail ? null : JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error("This export is not valid JSON.");
      }
      const docs = isMail
        ? options.mailDocuments?.(id) || []
        : id === "chatgpt"
          ? chatGPTDocuments(value)
          : granolaDocuments(value);
      if (!docs.length)
        throw new Error("No readable conversations or notes were found in this export.");
      const p = prefs(id),
        collection = body.collection || p.collection;
      if (!options.validCollection(collection)) throw new Error("Choose an existing memory space.");
      active.add(id);
      update(id, {
        enabled: true,
        collection,
        status: "syncing",
        error: undefined,
        progress: { ...zero(), total: docs.length },
      });
      void (async () => {
        const progress = { ...zero(), total: docs.length };
        try {
          await importDocuments(id, docs, collection, progress, typeof body.collection === "string");
          update(id, {
            status: progress.processed < progress.total ? "error" : "idle",
            lastImport: stamp(),
            progress,
            error:
              progress.processed < progress.total
                ? "Import paused. Upload the export again to continue; existing records are reused."
                : undefined,
          });
        } catch (error) {
          update(id, { status: "error", progress, error: (error as Error).message });
        } finally {
          active.delete(id);
        }
      })();
      return { id, status: "syncing", total: docs.length };
    },
    startTimer: () => {
      if (timer) return;
      void dailyRefresh.due().catch(() => {});
      timer = setInterval(
        () => {
          void Promise.resolve().then(async () => {
            if (dailyRefresh.status().daily) await dailyRefresh.due();
            else await syncAll(true);
          }).catch(() => {});
        },
        5 * 60 * 1000,
      );
      timer.unref?.();
    },
    stop: () => {
      stopped = true;
      queued.clear();
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
