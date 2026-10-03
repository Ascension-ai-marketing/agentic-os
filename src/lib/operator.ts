import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const COLLECTIONS = [
  {
    id: "business",
    name: "Business",
    color: "#c8afe9",
    description: "Strategy, offers & decisions",
  },
  { id: "content", name: "Content", color: "#e6be84", description: "Ideas, research & your voice" },
  { id: "projects", name: "Projects", color: "#96c7bd", description: "The things you're building" },
  {
    id: "personal",
    name: "Personal",
    color: "#c49ab3",
    description: "Preferences & life outside work",
  },
] as const;
export type SourceKind = "note" | "article" | "video" | "document" | "meeting";
export interface MemorySpace {
  id: string;
  name: string;
  color: string;
  description: string;
  icon?: string;
}
export function memorySpaces(state: Pick<OperatorState, "memorySpaces">): MemorySpace[] {
  return [...COLLECTIONS, ...(state.memorySpaces || [])];
}
export interface MemorySource {
  id: string;
  title: string;
  kind: SourceKind;
  origin?: string;
  collection: string;
  text: string;
  textTruncated?: boolean;
  url?: string;
  filename?: string;
  createdAt: string;
  updatedAt: string;
  status: "indexing" | "ready" | "error";
  error?: string;
  deletedAt?: string;
  pinned: boolean;
  words: number;
  hash: string;
  connector?: {
    provider: string;
    itemId: string;
    path?: string;
    syncedAt: string;
    supersededAt?: string;
    /** When the imported source file itself last changed (set by memory app sync). */
    activityAt?: string;
  };
  extraction?: "local-ocr" | "design-vision" | "local-vision" | "cloud-vision";
  image?: {
    url: string;
    thumbnailUrl: string;
    mimeType: string;
    bytes: number;
    sha256: string;
    original: "upload" | "design-library" | "photo-index";
    designId?: string;
    indexedAt?: string;
  };
}
export interface InboxItem {
  bodyStatus?: "legacy-full" | "metadata" | "cached";
  bodyTruncated?: boolean;
  direction?: "inbound" | "outbound";
  remoteId?: string;
  threadId?: string;
  account?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  rfcMessageId?: string;
  references?: string;
  labelIds?: string[];
  gmailDraftId?: string;
  draftTo?: string;
  draftCc?: string;
  draftBcc?: string;
  url?: string;
  gmailSendState?: "sent" | "uncertain";
  gmailSendRequestId?: string;
  gmailSentAt?: string;
  gmailSentMessageId?: string;
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  category: "needs-you" | "sponsors" | "waiting" | "updates";
  status: "open" | "done";
  draft?: string;
  read?: boolean;
  readOverride?: boolean;
  starred?: boolean;
  triageReason?: string;
  source: "capture" | "gmail" | "outlook" | "slack";
}

export type ExistingAppConnection = {
  harness?: "codex" | "claude";
  id: string;
  name: string;
  isAccessible: boolean | null;
  isEnabled: boolean | null;
  runtimeEnabled: boolean | null;
  callable: boolean | null;
  observed: boolean;
  directAuthorization: false;
};
export type ConnectionDiscovery = {
  version: 1;
  harness: "codex";
  harnesses?: Array<{ id: string; detail: string }>;
  scope: "global";
  status: "available" | "unavailable" | "unsupported" | "timeout" | "error";
  checkedAt: string;
  expiresAt: string;
  runtimeFresh: boolean;
  apps: ExistingAppConnection[];
  plugins?: Array<{ id: string; name: string; enabled: boolean }>;
  truncated: boolean;
  detail: string;
};
export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  account?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  color?: { backgroundColor: string; textColor: string };
}
export interface CalendarEvent {
  /** Repeating event: the id of its series, so Memory can show one entry per series. */
  series?: string;
  calendarId?: string;
  calendarName?: string;
  importedAt?: string;
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  attendees?: string;
  notes: string;
  source: "local" | "ics" | "google" | "outlook" | "cal";
  actions: Array<{ id: string; text: string; done: boolean }>;
  sourceUid?: string;
}
export interface OperatorSettings {
  mission: boolean;
  openclaw: boolean;
  news: boolean;
  inboxAccounts?: {
    gmail: boolean;
    outlook: boolean;
    capture: boolean;
    slack?: boolean;
  };
  inboxAutoRead?: boolean;
  inboxShowAccounts?: boolean;
  inboxShowCategories?: boolean;
}
export interface WorkspaceGoals {
  longTerm: string;
  quarter: string;
  week: string;
  metrics: Array<{
    id: string;
    label: string;
    kind: "leading" | "lagging";
    value: number;
    target: number;
    unit: string;
  }>;
}
export interface OperatorState {
  gmailLabels?: GmailLabel[];
  gmailLabelsUpdatedAt?: string;
  memorySpaces?: MemorySpace[];
  inboxImports?: Array<{
    provider: "gmail" | "outlook" | "slack";
    account: string;
    importedAt: string;
    count: number;
    via: "codex" | "file";
  }>;
  brainSources?: Record<string, boolean>;
  brainRevision?: number;
  goals: WorkspaceGoals;
  hiddenMemoryTitles: string[];
  version: number;
  sources: MemorySource[];
  inbox: InboxItem[];
  events: CalendarEvent[];
  settings: OperatorSettings;
}
export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  source: string;
  source_url: string;
  published_at: string;
  category?: string;
  image_url?: string;
}
export const EMPTY_STATE: OperatorState = {
  version: 1,
  goals: { longTerm: "", quarter: "", week: "", metrics: [] },
  hiddenMemoryTitles: [],
  sources: [],
  inbox: [],
  events: [],
  settings: { mission: false, openclaw: false, news: true },
};

export async function operatorRequest<T = any>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const token = body !== undefined ? (await (await fetch("/__token")).json()).token : undefined;
  const response = await fetch(
    `/__operator${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
export function useOperator() {
  const qc = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const query = useQuery<OperatorState>({
    enabled: hydrated,
    queryKey: ["operator-state"],
    queryFn: () => operatorRequest("/state"),
    refetchInterval: (q) =>
      q.state.data?.sources.some((s) => s.status === "indexing") ? 1200 : 15000,
  });
  return {
    ...query,
    state: hydrated ? (query.data ?? EMPTY_STATE) : EMPTY_STATE,
    isLoading: !hydrated || query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ["operator-state"] }),
  };
}
export function askOperator(
  question = "",
  context = "",
  submit = false,
  modelKey?: string,
  contextSource?: string,
  persona?: "advisor" | "assistant",
) {
  window.dispatchEvent(
    new CustomEvent("operator:ask", {
      detail: { question, context, submit, modelKey, contextSource, persona },
    }),
  );
}
export function humanDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * One entry per repeating series for Memory: a daily routine becomes one
 * record (the next time it happens, else the latest), not hundreds of copies.
 */
export function collapseSeries<T extends { series?: string; start: string; calendarId?: string; source?: string }>(events: T[], now = Date.now()): T[] {
  const out: T[] = [];
  const bySeries = new Map<string, T>();
  for (const e of events) {
    if (!e.series) {
      out.push(e);
      continue;
    }
    // Series ids are only unique inside one calendar.
    const key = `${e.source || ""}:${e.calendarId || ""}:${e.series}`;
    const kept = bySeries.get(key);
    const t = Date.parse(e.start), k = kept ? Date.parse(kept.start) : NaN;
    // Prefer the next upcoming one; among past ones the latest.
    const better = !kept || (t >= now ? !(k >= now) || t < k : !(k >= now) && t > k);
    if (better) bySeries.set(key, e);
  }
  return [...out, ...bySeries.values()];
}
