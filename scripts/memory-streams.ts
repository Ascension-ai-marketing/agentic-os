// Memory streams: the agent and inbox records the Memory view shows next to
// Claude and Obsidian notes. Everything here reads local files only, never the
// network. Each stream reports a status so the UI can show an honest empty
// state with a way to connect it.
//
//   codex     ~/.codex/state_*.sqlite threads (+ session_index names, rollout summaries)
//   chatgpt   conversations.json from a ChatGPT data export in Downloads/Documents
//   email     .operator-data/workspace.json inbox + mail-archive.sqlite headers
//   meetings  .operator-data/workspace.json calendar events
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { topicWords } from "../src/components/brain/brain-relations";
import { collapseSeries } from "../src/lib/operator";

export type StreamRecord = {
  id: string;
  title: string;
  /** ISO time the record was last active. */
  at?: string;
  kind: "session" | "file";
  /** One short line that is safe to show without the body. */
  meta?: string;
  /** Longer text. Dropped when previews are redacted. */
  preview?: string;
  project?: string;
  people?: string[];
  via?: string;
  /** A few topic words taken from the body, so records can relate without the body. */
  topics?: string[];
};
export type StreamStatus = "ok" | "empty" | "missing";
export type MemoryStream = {
  status: StreamStatus;
  records: StreamRecord[];
  total: number;
  /** Where we looked, as ~ paths, so the empty state can say it. */
  checked: string[];
  /** Records per day for the whole history, when there are more than we list. */
  daily?: Record<string, number>;
};
export type MemoryStreams = Record<
  "codex" | "chatgpt" | "email" | "meetings" | "hermes" | "skills",
  MemoryStream
>;

const LIMIT = { codex: 320, chatgpt: 300, email: 1500, meetings: 200, hermes: 700 };
const tilde = (home: string, p: string) => (p.startsWith(home) ? "~" + p.slice(home.length) : p);
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + "…";
};
const iso = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string" && Number.isFinite(Date.parse(v))) return new Date(v).toISOString();
  return undefined;
};

/** The most repeated topic words in a body. The body itself is not kept. */
export function bodyTopics(body: string, max = 8): string[] {
  const allowed = new Set(topicWords(body));
  const counts = new Map<string, number>();
  for (const raw of body.toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/)) {
    const w = raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (allowed.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/** A readable one-line title from a raw prompt: no file dumps, no long paths. */
/** The Hermes chat page puts this instruction block ahead of the first message (OUTPUT_CONTRACT in agents.hermes.tsx). */
const CHAT_WINDOW_NOTE = /^\s*\[How to answer in this chat window\]/;

export function promptTitle(raw: string, max = 78): string {
  let text = String(raw || "");
  if (CHAT_WINDOW_NOTE.test(text)) text = text.replace(/^[\s\S]*?\n\s*---\s*\n/, "");
  const ask =
    text.match(/##\s*My request for Codex:?\s*([\s\S]+)/i) ||
    text.match(/\n\s*(?:USER REQUEST|QUESTION|USER QUESTION):\s*([\s\S]+)$/);
  if (ask) text = ask[1];
  text = text
    .replace(/^#[^\n]*files mentioned[^\n]*\n+/i, "")
    .replace(/<[^>]{1,40}>/g, " ")
    .replace(/(?:~|\/Users\/[^/\s]+)(?:\/[^\s/]+)*\/([^\s/]+)/g, "$1")
    .replace(/^[#>*\-\s]+/gm, "");
  const line =
    text
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l.length > 2) || "";
  return clip(line, max) || "Untitled session";
}

/** Project name from a working folder. Scratch and home folders have none. */
export function projectFromCwd(cwd: string | undefined, home: string): string | undefined {
  if (!cwd) return undefined;
  const clean = cwd.replace(/\/+$/, "");
  if (!clean || clean === home) return undefined;
  if (/\/Documents\/Codex\//.test(clean)) return undefined;
  const wt = clean.match(/\/(?:\.codex|\.claude)\/worktrees\/[^/]+\/([^/]+)/);
  if (wt) return wt[1];
  const name = basename(clean);
  if (
    /^(Desktop|Documents|Downloads|tmp|temp|work|scratchpad|scripts|src|userproj|new project(?: \d+)?)$/i.test(
      name,
    )
  )
    return undefined;
  return name;
}

function empty(checked: string[], status: StreamStatus = "missing"): MemoryStream {
  return { status, records: [], total: 0, checked };
}

async function openReadonly(file: string): Promise<any | null> {
  try {
    const { Database } = await import("bun:sqlite");
    return new Database(file, { readonly: true });
  } catch {
    return null;
  }
}

export async function readCodexStream(home: string): Promise<MemoryStream> {
  const dir = join(home, ".codex");
  const checked = [tilde(home, dir)];
  if (!existsSync(dir)) return empty(checked);
  const names = new Map<string, string>();
  try {
    for (const line of readFileSync(join(dir, "session_index.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?.id && row.thread_name) names.set(String(row.id), String(row.thread_name));
      } catch {}
    }
  } catch {}
  // Codex writes a short summary per finished session; its heading is the best preview line.
  const summaries = new Map<string, string>();
  try {
    const sdir = join(dir, "memories", "rollout_summaries");
    for (const f of readdirSync(sdir)) {
      if (!f.endsWith(".md")) continue;
      const head = readFileSync(join(sdir, f), "utf8").slice(0, 4000);
      const id = head.match(/^thread_id:\s*(\S+)/m)?.[1];
      const title = head.match(/^#\s+(.+)$/m)?.[1];
      if (id && title) summaries.set(id, clip(title, 180));
    }
  } catch {}
  type Row = {
    id: string;
    title: string;
    name: string | null;
    first: string;
    cwd: string;
    updated: number;
    source: string;
    branch: string | null;
    model: string | null;
  };
  let rows: Row[] = [];
  const dbFile = (() => {
    try {
      return readdirSync(dir)
        .filter((f) => /^state_\d+\.sqlite$/.test(f))
        .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    } catch {
      return undefined;
    }
  })();
  if (dbFile) {
    const db = await openReadonly(join(dir, dbFile));
    if (db) {
      try {
        rows = db
          .query(
            `SELECT id, title, name, first_user_message AS first, cwd, updated_at AS updated,
                    source, git_branch AS branch, model
               FROM threads
              WHERE archived = 0 AND source NOT LIKE '{%'
              ORDER BY updated_at DESC LIMIT 3000`,
          )
          .all() as Row[];
      } catch {
        rows = [];
      } finally {
        db.close();
      }
    }
  }
  // Older installs only have the name index.
  if (!rows.length)
    for (const line of (() => {
      try {
        return readFileSync(join(dir, "session_index.jsonl"), "utf8").split("\n");
      } catch {
        return [];
      }
    })()) {
      try {
        const r = JSON.parse(line);
        if (r?.id)
          rows.push({
            id: String(r.id),
            title: String(r.thread_name || ""),
            name: r.thread_name || null,
            first: "",
            cwd: "",
            updated: Date.parse(r.updated_at) / 1000,
            source: "index",
            branch: null,
            model: null,
          });
      } catch {}
    }
  const seen = new Map<string, StreamRecord & { runs: number }>();
  for (const r of rows.sort((a, b) => b.updated - a.updated)) {
    const project = projectFromCwd(r.cwd, home);
    const title = clip(r.name || names.get(r.id) || promptTitle(r.first || r.title), 78);
    // Scheduled pipelines start many sessions with the same prompt; show one per project and prompt.
    const key = `${project || ""}\0${title.toLowerCase()}`;
    const known = seen.get(key);
    if (known) {
      known.runs++;
      continue;
    }
    const summary = summaries.get(r.id);
    seen.set(key, {
      id: r.id,
      title,
      at: iso(r.updated),
      kind: "session",
      project,
      via: r.source === "exec" ? "Codex run" : "Codex chat",
      meta:
        summary ||
        [
          r.source === "exec" ? "Codex run" : "Codex chat",
          project ? `project ${project}` : "",
          r.branch ? `branch ${r.branch}` : "",
          r.model || "",
        ]
          .filter(Boolean)
          .join(" · ") ||
        undefined,
      preview: clip(promptTitle(r.first || r.title, 600), 600),
      topics: bodyTopics(String(r.first || "").slice(0, 4000)),
      runs: 1,
    });
  }
  const all = [...seen.values()];
  const records = all
    .slice(0, LIMIT.codex)
    .map(({ runs, ...rec }) =>
      runs > 1 ? { ...rec, meta: [rec.meta, `${runs} runs`].filter(Boolean).join(" · ") } : rec,
    );
  checked.push(...(dbFile ? [tilde(home, join(dir, dbFile))] : []));
  return { status: records.length ? "ok" : "empty", records, total: all.length, checked };
}

export const CHATGPT_EXPORTS = [
  "Downloads/conversations.json",
  "Downloads/ChatGPT/conversations.json",
  "Downloads/chatgpt-export/conversations.json",
  "Documents/ChatGPT/conversations.json",
  "Documents/ChatGPT Export/conversations.json",
];

export function readChatgptStream(home: string): MemoryStream {
  const checked = CHATGPT_EXPORTS.map((p) => "~/" + p);
  // Unzipped exports keep their own folder name, e.g. Downloads/<hash>-2026-09-01/conversations.json.
  const candidates = CHATGPT_EXPORTS.map((p) => join(home, p));
  try {
    for (const d of readdirSync(join(home, "Downloads"), { withFileTypes: true }))
      if (d.isDirectory() && !d.name.startsWith("."))
        candidates.push(join(home, "Downloads", d.name, "conversations.json"));
  } catch {}
  const file = candidates
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!file) return empty(checked);
  checked.unshift(tilde(home, file));
  if (statSync(file).size > 256 * 1024 * 1024) return empty(checked, "empty");
  let list: any[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    return empty(checked, "empty");
  }
  const firstUser = (c: any) => {
    const nodes = Object.values(c?.mapping || {}) as any[];
    const msg = nodes
      .map((n) => n?.message)
      .filter((m) => m?.author?.role === "user" && Array.isArray(m.content?.parts))
      .sort((a, b) => (a.create_time || 0) - (b.create_time || 0))[0];
    return msg ? msg.content.parts.filter((p: any) => typeof p === "string").join(" ") : "";
  };
  const records: StreamRecord[] = list
    .map((c) => ({
      id: String(c?.id || c?.conversation_id || ""),
      title: clip(String(c?.title || "ChatGPT conversation"), 78),
      at: iso(c?.update_time) || iso(c?.create_time),
      kind: "session" as const,
      via: "ChatGPT",
      meta: c?.default_model_slug ? `Model ${c.default_model_slug}` : undefined,
      preview: clip(firstUser(c), 600) || undefined,
      topics: bodyTopics(firstUser(c).slice(0, 4000)),
    }))
    .filter((r) => r.id)
    .sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
  return {
    status: records.length ? "ok" : "empty",
    records: records.slice(0, LIMIT.chatgpt),
    total: records.length,
    checked,
  };
}

/** "Ana <a@b.c>" or a sent "You → Ana" both become "Ana". */
export const personName = (from: string) =>
  clip(
    String(from || "")
      .replace(/<[^>]*>/g, "")
      .replace(/^\s*you\s*(?:→|->)\s*/i, "")
      .replace(/["']/g, "")
      .trim(),
    48,
  );

export async function readEmailStream(dataDir: string, home: string): Promise<MemoryStream> {
  const checked = [
    tilde(home, join(dataDir, "workspace.json")),
    tilde(home, join(dataDir, "mail-archive.sqlite")),
  ];
  const records: StreamRecord[] = [];
  try {
    const state = JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8"));
    for (const i of Array.isArray(state?.inbox) ? state.inbox : []) {
      if (!i?.id) continue;
      const who = personName(i.from);
      const via = i.source
        ? String(i.source)[0].toUpperCase() + String(i.source).slice(1)
        : "Inbox";
      records.push({
        id: String(i.id),
        title: clip(String(i.subject || "(no subject)"), 90),
        at: iso(i.receivedAt),
        kind: "file",
        people: who ? [who] : [],
        via,
        meta: [who && `${i.direction === "outbound" ? "To" : "From"} ${who}`, via]
          .filter(Boolean)
          .join(" · "),
        preview: clip(String(i.body || ""), 360) || undefined,
        topics: bodyTopics(String(i.body || "").slice(0, 6000)),
      });
    }
  } catch {}
  const daily: Record<string, number> = {};
  let archived = 0;
  const archive = join(dataDir, "mail-archive.sqlite");
  if (existsSync(archive)) {
    const db = await openReadonly(archive);
    if (db)
      try {
        // Headers only: subject, sender and date. Bodies stay in the archive.
        // The whole history counts toward the day-by-day activity, even past the listed records.
        for (const r of db
          .query(`SELECT substr(received_at, 1, 10) AS day, COUNT(*) AS n FROM messages GROUP BY day`)
          .all() as Array<{ day: string; n: number }>)
          if (/^\d{4}-\d{2}-\d{2}$/.test(r.day)) daily[r.day] = (daily[r.day] || 0) + Number(r.n);
        archived = Number((db.query("SELECT COUNT(*) AS n FROM messages").get() as { n?: number })?.n) || 0;
        const rows = db
          .query(
            `SELECT id, provider, received_at AS at, subject, sender FROM messages
              ORDER BY received_at DESC LIMIT ${LIMIT.email}`,
          )
          .all() as Array<{
          id: string;
          provider: string;
          at: string;
          subject: string;
          sender: string;
        }>;
        for (const r of rows) {
          const who = personName(r.sender);
          const via =
            r.provider === "outlook" ? "Outlook" : r.provider === "gmail" ? "Gmail" : r.provider;
          records.push({
            id: `archive:${r.id}`,
            title: clip(r.subject || "(no subject)", 90),
            at: iso(r.at),
            kind: "file",
            people: who ? [who] : [],
            via,
            meta: [who && `From ${who}`, via].filter(Boolean).join(" · "),
          });
        }
      } catch {
      } finally {
        db.close();
      }
  }
  records.sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
  // Inbox items not in the archive still count on their day.
  for (const r of records)
    if (!r.id.startsWith("archive:") && r.at) daily[r.at.slice(0, 10)] = (daily[r.at.slice(0, 10)] || 0) + 1;
  return {
    status: records.length ? "ok" : existsSync(dataDir) ? "empty" : "missing",
    records: records.slice(0, LIMIT.email),
    total: Math.max(records.length, archived),
    checked,
    daily,
  };
}

export function readMeetingsStream(dataDir: string, home: string): MemoryStream {
  const checked = [tilde(home, join(dataDir, "workspace.json"))];
  const records: StreamRecord[] = [];
  try {
    const state = JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8"));
    for (const e of collapseSeries(Array.isArray(state?.events) ? state.events : [])) {
      if (!e?.id) continue;
      const people = String(e.attendees || "")
        .split(/[,;]+/)
        .map(personName)
        .filter(Boolean)
        .slice(0, 8);
      records.push({
        id: String(e.id),
        title: clip(String(e.title || "Meeting"), 90),
        at: iso(e.start),
        kind: "file",
        people,
        via: e.calendarName || e.source || "Calendar",
        meta:
          [e.location, people.length ? `${people.length} people` : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
        preview:
          clip(
            [e.notes, ...(Array.isArray(e.actions) ? e.actions.map((a: any) => a?.text) : [])]
              .filter(Boolean)
              .join("\n"),
            600,
          ) || undefined,
      });
    }
  } catch {}
  records.sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
  return {
    status: records.length ? "ok" : existsSync(dataDir) ? "empty" : "missing",
    records: records.slice(0, LIMIT.meetings),
    total: records.length,
    checked,
  };
}


/**
 * Hermes keeps every chat, Telegram thread and scheduled run in ~/.hermes/state.db,
 * plus its long-term notes in memories/ and SOUL.md. Read only; auth.json and
 * .env are never opened.
 */
export async function readHermesStream(home: string): Promise<MemoryStream> {
  const dir = join(home, ".hermes");
  const checked = [tilde(home, join(dir, "state.db")), tilde(home, join(dir, "memories"))];
  if (!existsSync(dir)) return empty(checked);
  const records: StreamRecord[] = [];
  for (const [file, title] of [
    [join(dir, "memories", "MEMORY.md"), "Hermes memory"],
    [join(dir, "memories", "USER.md"), "What Hermes knows about you"],
    [join(dir, "SOUL.md"), "Hermes persona"],
  ] as const) {
    try {
      const stat = statSync(file);
      const body = readFileSync(file, "utf8").slice(0, 20000);
      records.push({
        id: `file:${basename(file)}`,
        title,
        at: stat.mtime.toISOString(),
        kind: "file",
        via: "Hermes notes",
        meta: `${basename(file)} · ${body.split("\n").filter((l) => l.trim()).length} lines`,
        preview: clip(body, 600),
        topics: bodyTopics(body),
      });
    } catch {}
  }
  const dbFile = join(dir, "state.db");
  if (existsSync(dbFile)) {
    const db = await openReadonly(dbFile);
    if (db)
      try {
        const rows = db
          .query(
            `SELECT s.id, s.source, s.model, s.title, s.message_count AS messages,
                    COALESCE(s.last_activity_at, s.ended_at, s.started_at) AS at,
                    (SELECT m.content FROM messages m
                      WHERE m.session_id = s.id AND m.role = 'user' AND m.content != ''
                      ORDER BY m.id LIMIT 1) AS first
               FROM sessions s
              WHERE s.source NOT IN ('subagent', 'tool', 'curator') AND s.archived = 0
              ORDER BY s.started_at DESC LIMIT ${LIMIT.hermes}`,
          )
          .all() as Array<{
          id: string;
          source: string;
          model: string | null;
          title: string | null;
          messages: number;
          at: number;
          first: string | null;
        }>;
        const via: Record<string, string> = {
          cli: "Hermes chat",
          tui: "Hermes chat",
          acp: "Hermes in an editor",
          telegram: "Telegram",
          cron: "Scheduled run",
        };
        for (const r of rows) {
          const first = String(r.first || "");
          // Hermes names a chat from its first message, so an instruction block there becomes the title.
          const title = r.title && !CHAT_WINDOW_NOTE.test(r.title)
            ? clip(r.title.replace(/\s*·\s*[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/, ""), 78)
            : promptTitle(first);
          records.push({
            id: String(r.id),
            title,
            at: iso(r.at),
            kind: "session",
            via: via[r.source] || "Hermes",
            meta: [via[r.source] || r.source, r.messages ? `${r.messages} messages` : "", r.model || ""]
              .filter(Boolean)
              .join(" · "),
            preview: clip(promptTitle(first, 600), 600) || undefined,
            topics: bodyTopics(
              (first.match(/(?:USER REQUEST|QUESTION):\s*([\s\S]+)$/)?.[1] || first).slice(0, 4000),
            ),
          });
        }
      } catch {
      } finally {
        db.close();
      }
  }
  records.sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
  return { status: records.length ? "ok" : "empty", records, total: records.length, checked };
}

/** The description from SKILL.md front matter. A YAML block ("|", ">", ">-") continues on the indented lines below. */
function skillDescription(head: string): string | undefined {
  const lines = head.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return undefined;
  const first = lines[i].replace(/^description:\s*/, "").trim();
  if (!/^[|>][+-]?\d?$/.test(first)) return first.replace(/^["'](.*)["']$/, "$1") || undefined;
  const body: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && !/^\s/.test(l)) break;
    body.push(l.trim());
  }
  return body.filter(Boolean).join(" ") || undefined;
}

/** Skills other agents keep on this Mac: Codex, shared agent skills and Hermes. Names and dates only. */
export function readSkillsStream(home: string): MemoryStream {
  const roots: Array<[string, string]> = [
    [join(home, ".codex", "skills"), "Codex skill"],
    [join(home, ".agents", "skills"), "Agent skill"],
    [join(home, ".hermes", "skills"), "Hermes skill"],
  ];
  const records: StreamRecord[] = [];
  const seen = new Set<string>();
  const visit = (dir: string, via: string, depth: number) => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || !(e.isDirectory() || e.isSymbolicLink())) continue;
      const path = join(dir, e.name),
        skill = join(path, "SKILL.md");
      if (existsSync(skill)) {
        const key = `${via}:${e.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let at: string | undefined, meta: string | undefined;
        try {
          at = statSync(skill).mtime.toISOString();
          const head = readFileSync(skill, "utf8").slice(0, 3000);
          meta = skillDescription(head);
        } catch {}
        records.push({
          id: key,
          title: `/${e.name}`,
          at,
          kind: "file",
          via,
          meta: clip([via, meta].filter(Boolean).join(" · "), 200),
        });
      } else if (depth < 3) visit(path, via, depth + 1);
    }
  };
  for (const [dir, via] of roots) visit(dir, via, 0);
  return {
    status: records.length ? "ok" : "empty",
    records,
    total: records.length,
    checked: roots.map(([d]) => tilde(home, d)),
  };
}

export async function readMemoryStreams(opts: {
  home: string;
  dataDir: string;
}): Promise<MemoryStreams> {
  const [codex, email, hermes] = await Promise.all([
    readCodexStream(opts.home).catch(() => empty([])),
    readEmailStream(opts.dataDir, opts.home).catch(() => empty([])),
    readHermesStream(opts.home).catch(() => empty([])),
  ]);
  return {
    codex,
    chatgpt: (() => {
      try {
        return readChatgptStream(opts.home);
      } catch {
        return empty([]);
      }
    })(),
    email,
    meetings: readMeetingsStream(opts.dataDir, opts.home),
    hermes,
    skills: (() => {
      try {
        return readSkillsStream(opts.home);
      } catch {
        return empty([]);
      }
    })(),
  };
}
