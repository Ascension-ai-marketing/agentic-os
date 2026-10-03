import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/**
 * Paced outbox for replies. The operator clicks Send on as many cards as they
 * like; each click puts one reply here, and a background worker sends them one
 * at a time with a human gap between sends. Every item carries its own request
 * ID, so the underlying YouTube sender can never post the same reply
 * twice. Nothing enters the outbox without a click.
 */

export type OutboxSource = "youtube";
export type OutboxItem = {
  id: string;
  source: OutboxSource;
  targetId: string;
  name: string;
  content: string;
  queuedAt: string;
  status: "queued" | "sending" | "sent" | "failed" | "uncertain" | "cancelled";
  attempts: number;
  notBefore?: string;
  error?: string;
  sentAt?: string;
  finishedAt?: string;
  messageId?: string;
};
export type OutboxSendResult = { status: "sent" | "failed" | "uncertain"; error?: string; retryable?: boolean; messageId?: string };
type Sender = (item: OutboxItem) => Promise<OutboxSendResult>;
type Store = { version: 1; paused: boolean; items: OutboxItem[]; lastSentAt: Partial<Record<OutboxSource, string>> };
type Options = {
  paceMs?: Partial<Record<OutboxSource, number>>;
  jitterMs?: number;
  tickMs?: number;
  now?: () => number;
  /** Resolves an item that was mid-send when the process died, from the sender's own durable record. */
  resolvePending?: (item: OutboxItem) => "sent" | "failed" | "uncertain" | undefined;
};
const DEFAULT_PACE: Record<OutboxSource, number> = { youtube: 8000 };
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF = 90000;
const KEEP_FINISHED = 300;
const ID: Record<OutboxSource, RegExp> = { youtube: /^[A-Za-z0-9_.-]{8,120}$/ };
const SOURCES = Object.keys(ID) as OutboxSource[];
const isSource = (value: unknown): value is OutboxSource => SOURCES.includes(value as OutboxSource);

function atomicWrite(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}
/** A fixed jitter per item so the gap between sends is never exactly the same twice. */
export function jitterFor(id: string, jitterMs: number) {
  if (jitterMs <= 0) return 0;
  return parseInt(createHash("sha256").update(id).digest("hex").slice(0, 6), 16) % jitterMs;
}
/** Seconds until an item is expected to send, given its place in line. */
export function etaSeconds(items: OutboxItem[], id: string, paceSeconds: Record<OutboxSource, number>, lastSentAt: Partial<Record<OutboxSource, string>>, now = Date.now()) {
  const target = items.find(i => i.id === id);
  if (!target || (target.status !== "queued" && target.status !== "sending")) return 0;
  if (target.status === "sending") return 0;
  const ahead = items.filter(i => i.source === target.source && (i.status === "sending" || (i.status === "queued" && i.queuedAt < target.queuedAt))).length;
  const last = lastSentAt[target.source] ? Date.parse(lastSentAt[target.source]!) : 0;
  const firstGap = Math.max(0, paceSeconds[target.source] - (now - last) / 1000);
  return Math.round(firstGap + ahead * paceSeconds[target.source]);
}

export function replyOutbox(root: string, senders: Record<OutboxSource, Sender>, options: Options = {}) {
  const directory = join(root, ".operator-data");
  const file = join(directory, "reply-outbox.json");
  const now = options.now || Date.now;
  const pace: Record<OutboxSource, number> = { ...DEFAULT_PACE, ...options.paceMs };
  const jitterMs = options.jitterMs ?? 3000;
  let ticking = false;
  let timer: NodeJS.Timeout | undefined;

  const read = (): Store => {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.items)) throw new Error();
      const lastSentAt = Object.fromEntries(Object.entries(value.lastSentAt && typeof value.lastSentAt === "object" ? value.lastSentAt : {}).filter(([source]) => isSource(source)));
      return { paused: false, ...value, lastSentAt, items: value.items.filter((i: any) => i && typeof i.id === "string" && isSource(i.source) && typeof i.targetId === "string" && typeof i.content === "string") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, paused: false, items: [], lastSentAt: {} };
      throw new Error("The reply outbox could not be read. The file was left unchanged.");
    }
  };
  const write = (value: Store) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const finished = value.items.filter(i => !["queued", "sending"].includes(i.status)).sort((a, b) => (b.finishedAt || b.queuedAt).localeCompare(a.finishedAt || a.queuedAt)).slice(0, KEEP_FINISHED);
    atomicWrite(file, { ...value, items: [...value.items.filter(i => ["queued", "sending"].includes(i.status)), ...finished] });
  };
  // Items caught mid-send by a restart are settled from the sender's own record, never re-sent blindly.
  try {
    const store = read();
    let changed = false;
    for (const item of store.items) {
      if (item.status !== "sending") continue;
      const resolved = options.resolvePending?.(item) || "uncertain";
      Object.assign(item, { status: resolved, finishedAt: new Date(now()).toISOString(), ...(resolved === "sent" ? { sentAt: new Date(now()).toISOString() } : { error: resolved === "uncertain" ? "The OS restarted while this reply was being sent. Check the conversation before sending again." : item.error || "The reply was not sent." }) });
      changed = true;
    }
    if (changed) write(store);
  } catch { /* A broken file surfaces on the next request instead. */ }

  function status() {
    const store = read();
    const queued = store.items.filter(i => i.status === "queued");
    const sending = store.items.find(i => i.status === "sending");
    const paceSeconds = Object.fromEntries(SOURCES.map(source => [source, pace[source] / 1000])) as Record<OutboxSource, number>;
    return {
      paused: store.paused,
      paceSeconds,
      lastSentAt: store.lastSentAt,
      counts: { queued: queued.length, sending: sending ? 1 : 0, sent: store.items.filter(i => i.status === "sent").length, failed: store.items.filter(i => i.status === "failed").length, uncertain: store.items.filter(i => i.status === "uncertain").length },
      items: store.items.map(i => ({ ...i, eta: etaSeconds(store.items, i.id, paceSeconds, store.lastSentAt, now()) })),
    };
  }
  function enqueue(body: { source?: unknown; targetId?: unknown; content?: unknown; name?: unknown } = {}) {
    const source = isSource(body.source) ? body.source : undefined;
    if (!source) throw new Error("Choose where this reply goes.");
    if (typeof body.targetId !== "string" || !ID[source].test(body.targetId)) throw new Error("Choose a conversation first.");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 10000 || body.content.includes("\0")) throw new Error("Write a reply first.");
    const store = read();
    if (store.items.some(i => i.source === source && i.targetId === body.targetId && i.status === "sending")) throw new Error("That reply is being sent right now.");
    // A second click on the same card replaces the waiting reply with the newer text.
    for (const item of store.items) if (item.source === source && item.targetId === body.targetId && item.status === "queued") Object.assign(item, { status: "cancelled", finishedAt: new Date(now()).toISOString(), error: "Replaced by a newer reply." });
    const item: OutboxItem = { id: randomUUID(), source, targetId: body.targetId, name: typeof body.name === "string" ? body.name.slice(0, 120) : "", content: body.content.trim(), queuedAt: new Date(now()).toISOString(), status: "queued", attempts: 0 };
    store.items.push(item);
    write(store);
    void tick();
    return item;
  }
  function cancel(body: { id?: unknown } = {}) {
    const store = read();
    const item = store.items.find(i => i.id === body.id);
    if (!item) throw new Error("That reply is not in the outbox.");
    if (item.status !== "queued") throw new Error(item.status === "sending" ? "That reply is being sent right now." : "That reply already finished.");
    Object.assign(item, { status: "cancelled", finishedAt: new Date(now()).toISOString() });
    write(store);
    return item;
  }
  function pause(body: { paused?: unknown } = {}) {
    const store = read();
    store.paused = body.paused === true;
    write(store);
    if (!store.paused) void tick();
    return status();
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const store = read();
      if (store.paused || store.items.some(i => i.status === "sending")) return;
      const current = now();
      const next = store.items.filter(i => i.status === "queued" && (!i.notBefore || Date.parse(i.notBefore) <= current)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
      if (!next) return;
      const last = store.lastSentAt[next.source] ? Date.parse(store.lastSentAt[next.source]!) : 0;
      if (current - last < pace[next.source] + jitterFor(next.id, jitterMs)) return;
      Object.assign(next, { status: "sending", attempts: next.attempts + 1 });
      write(store);
      let result: OutboxSendResult;
      try { result = await senders[next.source](next); } catch (error) { result = { status: "failed", error: (error as Error).message || "The reply was not sent.", retryable: true }; }
      const latest = read();
      const item = latest.items.find(i => i.id === next.id);
      if (!item) return;
      const stamp = new Date(now()).toISOString();
      if (result.status === "sent") {
        Object.assign(item, { status: "sent", sentAt: stamp, finishedAt: stamp, messageId: result.messageId, error: undefined });
        latest.lastSentAt[item.source] = stamp;
      } else if (result.status === "failed" && /limit|rate|quota|busy|wait/i.test(result.error || "") && item.attempts < MAX_ATTEMPTS) {
        // Rate limits are a pause, not a verdict: try again later, in the same place in line.
        Object.assign(item, { status: "queued", error: result.error, notBefore: new Date(now() + RATE_LIMIT_BACKOFF).toISOString() });
      } else {
        Object.assign(item, { status: result.status, error: result.error || "The reply was not sent.", finishedAt: stamp });
      }
      write(latest);
    } finally { ticking = false; }
  }
  function start(tickMs = options.tickMs ?? 1000) {
    if (timer) return;
    timer = setInterval(() => void tick(), tickMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  return {
    status, enqueue, cancel, pause, tick, start, stop,
    async handle(path: string, method: string, body: any = {}) {
      if (path === "/connections/outbox" && method === "GET") return status();
      if (path === "/connections/outbox/enqueue" && method === "POST") return enqueue(body || {});
      if (path === "/connections/outbox/cancel" && method === "POST") return cancel(body || {});
      if (path === "/connections/outbox/pause" && method === "POST") return pause(body || {});
      throw new Error("Choose a supported outbox action.");
    },
  };
}
