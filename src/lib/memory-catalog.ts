import type { MemNode, MemLink } from "@/components/memory-graph-3d";
import { BRAIN_SOURCES, sourceOrigin, nodeOrigin } from "@/lib/brain-sources";
import { collapseSeries, COLLECTIONS, type OperatorState } from "@/lib/operator";
import type { AudienceSnapshot, BusinessWorkspace } from "@/lib/business-workspace";
import {
  memoryTime,
  relateRecords,
  type Relation,
  type RelationFacet,
} from "@/components/brain/brain-relations";

export type StreamStatus = { status: "ok" | "empty" | "missing"; total: number; checked: string[] };
type StreamRecord = {
  id: string;
  title: string;
  at?: string;
  kind: "session" | "file";
  meta?: string;
  preview?: string;
  project?: string;
  people?: string[];
  via?: string;
  topics?: string[];
};
/** Claude keys a project folder as "-Users-name-folder"; the folder is the project. */
function claudeProject(workspaceId?: string) {
  const m = /-Users-[^-]+-(.+)$/.exec(workspaceId || "");
  const name = m?.[1];
  return name && !/^(Desktop|Documents|Downloads)$/i.test(name) ? name : undefined;
}
const personOf = (from: string) =>
  String(from || "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s*you\s*(?:→|->)\s*/i, "")
    .replace(/["']/g, "")
    .trim();
const COLORS: Record<string, string> = {
  claude: "#f4ad67",
  codex: "#5d8bff",
  chatgpt: "#6febc0",
  meetings: "#b89bff",
  email: "#67c8ff",
  skills: "#f77fc8",
  hermes: "#d4e47b",
  openclaw: "#ff8e92",
  grokbot: "#d5e0f5",
  notion: "#d7dceb",
  obsidian: "#b292ff",
  images: "#87d8cd",
  files: "#8dbbff",
  manual: "#70d8ba",
  business: "#edc879",
  personal: "#ef9cb2",
  web: "#7cd3bc",
  agents: "#e2ba77",
  codebases: "#6fcacb",
};
const LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT",
  email: "Email",
  meetings: "Meetings",
  skills: "Skills",
  hermes: "Hermes",
  manual: "Your notes",
  codebases: "Projects",
  web: "Web & video",
  files: "Documents",
  images: "Photos",
  business: "Info",
  personal: "Personal",
  obsidian: "Obsidian",
  grokbot: "Grok",
};
type GraphContext = {
  business:
    | null
    | (Pick<BusinessWorkspace, "profile" | "finances" | "progress"> & {
        audience: AudienceSnapshot[];
      });
};
const endpoint = (value: string | { id: string }): string =>
  typeof value === "object" ? value.id : value;

/** Retain source hubs and requested records when a large catalog needs a rendering cap. */
export function memoryGraphWindow(
  nodes: MemNode[],
  links: MemLink[],
  priorityIds: string[],
  limit = 1200,
) {
  const priority = new Set(priorityIds);
  const selected = [...nodes]
    .sort(
      (a, b) =>
        Number(!!(b.kind === "hub" || b.categoryHub)) -
          Number(!!(a.kind === "hub" || a.categoryHub)) ||
        Number(priority.has(b.id)) - Number(priority.has(a.id)),
    )
    .slice(0, limit);
  const ids = new Set(selected.map((node) => node.id));
  return {
    nodes: selected,
    links: links.filter((link) => ids.has(endpoint(link.source)) && ids.has(endpoint(link.target))),
  };
}
const recordedDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date not recorded";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** One real catalog shared by Memory and voice. No sample or decorative records. */
export function buildMemoryCatalog(
  live: any,
  state: OperatorState,
  business: GraphContext["business"] = null,
) {
  const registry = new Map<string, MemNode>(),
    edges: MemLink[] = [],
    notes = new Map<string, { id: string; vault: string }>(),
    facets = new Map<string, { project?: string; people?: string[]; topics?: string[] }>();
  const add = (node: MemNode) => {
    if (!registry.has(node.id)) registry.set(node.id, node);
  };
  const link = (source: string, target: string, kind: MemLink["kind"] = "file") =>
    edges.push({ source, target, kind });
  const raw = live?.isExample ? [] : live?.memory?.nodes || [];
  const root = raw.find((n: MemNode) => n.kind === "hub")?.id || "memory-core";
  add({
    id: root,
    name: "Memory core",
    kind: "hub",
    val: 35,
    color: "#8affd0",
    preview:
      "The shared index of your connected memory. Links show source membership and recorded connections.",
  });
  for (const n of raw) {
    if (n.kind === "hub") continue;
    const o = nodeOrigin(n);
    add({ ...n, origin: o, color: COLORS[o] || n.color });
    const project = o === "claude" ? claudeProject(n.workspaceId) : undefined;
    if (project) facets.set(n.id, { project });
  }
  for (const l of live?.isExample ? [] : live?.memory?.links || [])
    link(endpoint(l.source), endpoint(l.target), l.kind);
  if (!live?.isExample)
    for (const g of live?.memory?.knowledge?.graphs || []) {
      const vault = `vault:${g.vault}`;
      add({
        id: vault,
        name: g.vault,
        kind: "workspace",
        origin: "obsidian",
        source: "obsidian",
        val: 18,
        color: COLORS.obsidian,
      });
      for (const n of g.notes || []) {
        const id = `note:${g.vault}:${n.id}`;
        notes.set(id, { ...n, vault: g.vault });
        add({
          id,
          name: n.title,
          kind: "file",
          origin: "obsidian",
          source: "obsidian",
          preview: n.excerpt,
          updated: n.updated,
          val: 7,
          color: COLORS.obsidian,
        });
        link(vault, id);
      }
      for (const l of g.links || [])
        link(`note:${g.vault}:${l.s}`, `note:${g.vault}:${l.t}`, "cross");
    }
  for (const s of state.sources) {
    if (s.deletedAt || s.connector?.supersededAt || s.status !== "ready") continue;
    const o = sourceOrigin(s),
      c = COLLECTIONS.find((c) => c.id === s.collection);
    add({
      id: s.id,
      name: s.title,
      kind: "file",
      origin: o,
      source: "library",
      val: 8,
      color: COLORS[o] || c?.color || "#a3b4cb",
      preview: s.text.slice(0, 1000),
      // A Notion page keeps the day it was last edited, not the day it was copied in.
      // A page or meeting keeps its own day, not the day it was copied in.
      updated:
        (s.connector?.provider === "notion" &&
          /^Last edited:\s*(\S+)/.exec(s.text)?.[1]?.match(/^\d{4}-\d{2}-\d{2}T/)?.input) ||
        (s.connector?.provider === "granola" &&
          /^Date:\s*(\S+)/.exec(s.text)?.[1]?.match(/^\d{4}-\d{2}-\d{2}T/)?.input) ||
        s.updatedAt,
      url:
        s.connector?.provider === "notion" && s.connector.itemId
          ? `https://www.notion.so/${s.connector.itemId.split(":")[0].replace(/-/g, "")}`
          : s.connector?.provider === "granola" && s.connector.itemId
            ? `https://notes.granola.ai/d/${s.connector.itemId.split(":")[0]}`
            : s.url || undefined,
    });
  }
  const group = (
    o: string,
    entries: Array<
      Pick<MemNode, "id" | "name"> &
        Partial<Pick<MemNode, "preview" | "kind" | "updated" | "meta" | "source">>
    >,
  ) => {
    for (const e of entries)
      add({
        ...e,
        origin: o,
        source: e.source || o,
        kind: e.kind || "file",
        val: 6,
        color: COLORS[o] || "#a3b4cb",
      });
  };
  group(
    "email",
    state.inbox.map((i) => {
      const who = personOf(i.from);
      if (who) facets.set(`inbox:${i.id}`, { people: [who] });
      return {
        id: `inbox:${i.id}`,
        name: i.subject,
        updated: i.receivedAt,
        meta: [who && `From ${who}`, i.source].filter(Boolean).join(" · "),
        preview: `From ${i.from}\n${i.body}`,
      };
    }),
  );
  group(
    "meetings",
    collapseSeries(state.events).map((e) => {
      const people = String(e.attendees || "")
        .split(/[,;]+/)
        .map(personOf)
        .filter(Boolean);
      if (people.length) facets.set(`event:${e.id}`, { people });
      return {
        id: `event:${e.id}`,
        name: e.title,
        updated: e.start,
        meta: [e.location, e.calendarName].filter(Boolean).join(" · ") || undefined,
        preview: `${e.start}\n${e.notes}\n${e.actions.map((a) => a.text).join("\n")}`,
      };
    }),
  );
  // Codex, ChatGPT, email and meetings read from this Mac by the aggregator.
  const streams: Record<string, StreamStatus> = {};
  const daily: Record<string, Record<string, number>> = {};
  const rawStreams: Record<
    string,
    {
      status: StreamStatus["status"];
      total: number;
      checked: string[];
      records: StreamRecord[];
      daily?: Record<string, number>;
    }
  > = live?.isExample ? {} : live?.memory?.streams || {};
  const prefix: Record<string, string> = {
    codex: "codex:",
    chatgpt: "chatgpt:",
    email: "inbox:",
    meetings: "event:",
    hermes: "hermes:",
    skills: "skill:",
  };
  for (const [o, stream] of Object.entries(rawStreams)) {
    if (!prefix[o] || !stream) continue;
    streams[o] = { status: stream.status, total: stream.total, checked: stream.checked || [] };
    if (stream.daily) daily[o] = stream.daily;
    // A skill installed for Claude and for Codex shows once.
    const claudeSkills = new Set(
      (live?.skills?.active || []).map((k: { name: string }) => k.name.toLowerCase()),
    );
    group(
      o,
      (stream.records || [])
        .filter((r) => o !== "skills" || !claudeSkills.has(r.title.toLowerCase()))
        .map((r) => {
        const id = prefix[o] + r.id;
        facets.set(id, { project: r.project, people: r.people, topics: r.topics });
        return {
          id,
          name: r.title,
          kind: o === "skills" ? ("skill" as const) : r.kind,
          updated: r.at,
          meta: r.meta,
          preview: r.preview,
          source: o,
        };
      }),
    );
  }
  group(
    "business",
    [
      ["longTerm", "Long-term direction"],
      ["quarter", "Quarterly focus"],
      ["week", "This week"],
    ]
      .filter(([key]) => state.goals[key as "week"])
      .map(([key, name]) => ({ id: `goal:${key}`, name, preview: state.goals[key as "week"] })),
  );
  // Dashboard records are read from the same gated context as chat; no sample data is added.
  if (business) {
    const fields = [
      ["businessName", "Business"],
      ["whatYouDo", "What we do"],
      ["whoYouHelp", "Who we help"],
      ["quarterGoal", "Quarterly goal"],
    ] as const;
    const profile = fields.flatMap(([key, label]) =>
      business.profile?.[key]?.trim() ? [`${label}: ${business.profile[key]}`] : [],
    );
    if (profile.length) {
      // Setup also saves this profile in the library. Show one authoritative dashboard node.
      for (const source of state.sources)
        if (
          source.connector?.provider === "business-setup" &&
          source.connector.itemId === "business"
        )
          registry.delete(source.id);
      group("business", [
        {
          id: "dashboard:profile",
          name: business.profile.businessName || "Business profile",
          source: "business-dashboard",
          preview: profile.join("\n\n"),
          meta: "Business dashboard · saved profile",
        },
      ]);
    }
    for (const snapshot of business.audience || []) {
      const metrics = Object.entries(snapshot.metrics || {}).filter(
        ([, value]) => typeof value === "number" && Number.isFinite(value),
      );
      if (!metrics.length) continue;
      const platform =
        snapshot.platform === "youtube"
          ? "YouTube"
          : snapshot.platform === "linkedin"
            ? "LinkedIn"
            : snapshot.platform[0].toUpperCase() + snapshot.platform.slice(1);
      group("business", [
        {
          id: `dashboard:audience:${snapshot.platform}`,
          name: `${platform} audience`,
          source: "business-dashboard",
          updated: snapshot.recordedAt,
          meta: `${snapshot.sourceLabel || "Recorded observation"} · ${recordedDate(snapshot.recordedAt)}`,
          preview:
            metrics
              .map(
                ([key, value]) =>
                  `${key === "followers" && snapshot.platform === "youtube" ? "Subscribers" : key.replace(/([A-Z])/g, " $1")}: ${value!.toLocaleString()}`,
              )
              .join("\n") +
            `\n\nSource: ${snapshot.sourceLabel}\nRecorded: ${recordedDate(snapshot.recordedAt)}`,
        },
      ]);
    }
    const finances = business.finances;
    if (finances?.accounts.length) {
      group("business", [
        {
          id: "dashboard:finances",
          name: "Account balances",
          kind: "workspace",
          source: "business-dashboard",
          updated: finances.recordedAt,
          meta: `${finances.sourceLabel} · ${recordedDate(finances.recordedAt)}`,
          preview: `${finances.accounts.length} recorded accounts.\nSource: ${finances.sourceLabel}\nRecorded: ${recordedDate(finances.recordedAt)}`,
        },
      ]);
      for (const account of finances.accounts) {
        if (!Number.isFinite(account.balance)) continue;
        const id = `dashboard:account:${account.sourceId || `${account.name}:${account.currency || "unknown"}`}`;
        group("business", [
          {
            id,
            name: account.name,
            source: "business-dashboard",
            updated: finances.recordedAt,
            meta: `${finances.sourceLabel} · ${recordedDate(finances.recordedAt)}`,
            preview: `Account balance: ${account.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${account.currency || "(currency not recorded)"}\nSource: ${finances.sourceLabel}\nRecorded: ${recordedDate(finances.recordedAt)}`,
          },
        ]);
        link("dashboard:finances", id, "file");
      }
    }
    for (const goal of business.progress?.goals || []) {
      group("business", [
        {
          id: `dashboard:goal:${goal.id}`,
          name: goal.title,
          kind: "decision",
          source: "business-dashboard",
          updated: goal.updatedAt,
          meta: `Business progress · ${recordedDate(goal.updatedAt)}`,
          preview: `${goal.horizon} goal · ${goal.status}\n${goal.notes || ""}\nUpdated: ${recordedDate(goal.updatedAt)}`,
        },
      ]);
    }
    for (const update of business.progress?.updates || []) {
      const id = `dashboard:update:${update.id}`;
      group("business", [
        {
          id,
          name: update.text.slice(0, 70),
          source: "business-dashboard",
          updated: update.createdAt,
          meta: `Business progress · ${recordedDate(update.createdAt)}`,
          preview: `${update.text}\nRecorded: ${recordedDate(update.createdAt)}`,
        },
      ]);
      if (update.goalId && registry.has(`dashboard:goal:${update.goalId}`))
        link(`dashboard:goal:${update.goalId}`, id, "decision");
    }
  }
  if (!live?.isExample) {
    group(
      "skills",
      (
        live?.skills?.active || []
      ).map((s: { name: string; uses7d?: number; updatedAt?: string; lastUsedMs?: number }) => ({
        id: `skill:${s.name}`,
        name: s.name,
        kind: "skill",
        updated:
          s.updatedAt || (s.lastUsedMs ? new Date(s.lastUsedMs).toISOString() : undefined),
        preview: `Skill metadata. ${s.uses7d || 0} uses in the past week. Full skill instructions have not been imported.`,
      })),
    );
    // Hermes has its own lane now, so its install flag is no longer a lone "Agents" record.
  }
  const counts: Record<string, number> = {};
  // These hubs are explicit source membership, never inferred semantic relationships.
  for (const n of [...registry.values()]) {
    if (n.kind === "hub") continue;
    const o = n.origin || nodeOrigin(n);
    counts[o] = (counts[o] || 0) + 1;
    const id = `origin:${o}`;
    add({
      id,
      name: LABELS[o] || BRAIN_SOURCES.find((s) => s.id === o)?.name || o,
      kind: "workspace",
      source: o,
      origin: o,
      categoryHub: true,
      val: 26,
      color: COLORS[o] || "#a3b4cb",
      preview: `Items recorded under this source. Connections represent membership, not inferred meaning.`,
    });
    link(id, n.id, n.kind === "skill" ? "skill" : "file");
  }
  for (const o of Object.keys(counts)) link(root, `origin:${o}`, "core");
  // Cross-source relations: same person, same project, rare shared words, same day.
  const records = [...registry.values()].filter(
    (n) =>
      n.kind !== "hub" && !n.categoryHub && n.kind !== "workspace" && n.kind !== "vector_store",
  );
  const now = Date.now();
  const related = relateRecords(
    records.map<RelationFacet>((n) => ({
      id: n.id,
      origin: n.origin || nodeOrigin(n),
      name: n.name,
      text: `${n.meta || ""} ${(n.preview || "").slice(0, 240)} ${(facets.get(n.id)?.topics || []).join(" ")}`,
      time: memoryTime(n, now),
      project: facets.get(n.id)?.project,
      people: facets.get(n.id)?.people,
    })),
  );
  for (const l of related.links) link(l.source, l.target, "cross");
  const relationKeys = new Set(
    related.links.map((l) => [l.source, l.target].sort().join("\u0000")),
  );
  const keys = new Set<string>();
  const links = edges.filter((l) => {
    if (!registry.has(l.source) || !registry.has(l.target) || l.source === l.target) return false;
    const key = [l.source, l.target].sort().join("\u0000");
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return {
    graph: { nodes: [...registry.values()], links },
    notes,
    counts,
    streams,
    daily,
    relations: related.byId as Map<string, Relation[]>,
    relationKeys,
  };
}
