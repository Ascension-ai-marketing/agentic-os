import { createRequire } from "node:module";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { classifyMessage } from "./account-connections";
import { addressList } from "./gmail-mailbox";
import type { InboxItem } from "../src/lib/operator";

type Provider = "gmail" | "outlook";
type Sql = string | number | null;
type Row = Record<string, unknown>;
type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: Sql[]): unknown;
    all(...args: Sql[]): Row[];
    get(...args: Sql[]): Row | undefined;
  };
  close(): void;
};
const require = createRequire(import.meta.url);
const clean = (x: unknown) => (typeof x === "string" ? x : "");
const object = (x: unknown): Row =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {};
const array = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const searchStopwords = new Set("a an and are as at be been but by can could do does for from had has have hey how i in is it me my of on or our please that the their them there these they this those to was were what when where which who why with would you your".split(" "));
const address = (x: unknown): string => {
  if (typeof x === "string") return x;
  const row = object(x),
    email = object(row.emailAddress || row.email_address);
  return [clean(email.name || row.name), clean(email.address || row.address || row.email)]
    .filter(Boolean)
    .join(" ");
};
function readable(html: string) {
  const document = parseHTML(html).document;
  document.querySelectorAll("head,script,style,noscript").forEach((n) => n.remove());
  document.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  document
    .querySelectorAll("p,div,li,tr")
    .forEach((n) => n.appendChild(document.createTextNode("\n")));
  return Array.from(document.childNodes)
    .map((n) => n.textContent || "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function normalizeArchiveMessage(
  provider: Provider,
  account: string,
  raw: unknown,
): InboxItem {
  const m = object(raw),
    payload = object(m.payload);
  if (!clean(m.id)) throw new Error("A mail record needs its provider ID.");
  const headers = Object.fromEntries(
    array(payload.headers).map((h) => {
      const v = object(h);
      return [clean(v.name).toLowerCase(), clean(v.value)];
    }),
  );
  const plain: string[] = [],
    html: string[] = [];
  function mime(value: unknown) {
    const part = object(value);
    if (part.filename) return;
    const data = clean(object(part.body).data),
      type = clean(part.mime_type || part.mimeType);
    if (!data && ["text/plain", "text/html"].includes(type) && (object(part.body).attachment_id || object(part.body).attachmentId))
      throw new Error(`Message ${clean(m.id)} has an external text body that still needs downloading.`);
    if (data && ["text/plain", "text/html"].includes(type))
      (type === "text/plain" ? plain : html).push(Buffer.from(data, "base64url").toString("utf8"));
    for (const child of array(part.parts)) mime(child);
  }
  if (provider === "gmail") mime(payload);
  const outlookBody = object(m.body);
  const body =
    provider === "gmail"
      ? plain.join("\n").trim() || readable(html.join("\n")) || clean(m.snippet)
      : /html/i.test(clean(outlookBody.contentType || outlookBody.content_type))
        ? readable(clean(outlookBody.content))
        : clean(outlookBody.content) || clean(m.bodyPreview);
  const from =
    provider === "gmail" ? headers.from || account : address(m.sender || m.from) || account;
  const subject = (provider === "gmail" ? headers.subject : clean(m.subject)) || "(No subject)";
  const time =
    provider === "gmail"
      ? Number(m.internal_date || m.internalDate)
      : Date.parse(clean(m.receivedDateTime || m.received_date_time));
  if (!Number.isFinite(time)) throw new Error("A mail record needs a valid received date.");
  const labelIds =
    provider === "gmail"
      ? array(m.label_ids || m.labelIds).filter((x): x is string => typeof x === "string")
      : array(m.categories).filter((x): x is string => typeof x === "string");
  const remoteId = clean(m.id),
    prefix = provider === "gmail" ? "google" : provider;
  const to =
    provider === "gmail" ? addressList(headers.to) : array(m.toRecipients).map(address);
  return {
    id: `${prefix}:${createHash("sha256").update(account).digest("hex").slice(0, 12)}:${remoteId}`,
    remoteId,
    account,
    source: provider,
    subject,
    from,
    to,
    ...(provider === "gmail" ? {
      ...(headers.cc ? { cc: addressList(headers.cc) } : {}),
      ...(headers.bcc ? { bcc: addressList(headers.bcc) } : {}),
      ...(headers["reply-to"] ? { replyTo: headers["reply-to"] } : {}),
    } : {
      ...(Array.isArray(m.ccRecipients) ? { cc: array(m.ccRecipients).map(address) } : {}),
      ...(Array.isArray(m.bccRecipients) ? { bcc: array(m.bccRecipients).map(address) } : {}),
    }),
    body: body || "(No readable message text)",
    receivedAt: new Date(time).toISOString(),
    status: "open",
    ...classifyMessage(subject, body),
    triageReason: classifyMessage(subject, body).reason,
    read: provider === "gmail" ? !labelIds.includes("UNREAD") : Boolean(m.isRead),
    labelIds,
    threadId: clean(m.thread_id || m.threadId || m.conversationId) || remoteId,
    direction:
      labelIds.includes("SENT") || from.toLowerCase().includes(account.toLowerCase())
        ? "outbound"
        : "inbound",
    url:
      provider === "gmail"
        ? `https://mail.google.com/mail/u/0/#all/${clean(m.thread_id || m.threadId) || remoteId}`
        : clean(m.web_link || m.webLink || m.display_url),
    rfcMessageId: headers["message-id"] || clean(m.internetMessageId) || undefined,
  };
}
export function mailArchive(root: string, options: { cacheBudgetBytes?: number; cacheTtlMs?: number; now?: () => number } = {}) {
  const cacheBudgetBytes = options.cacheBudgetBytes ?? 100 * 1024 * 1024;
  const cacheTtlMs = options.cacheTtlMs ?? 7 * 86400000;
  const now = options.now || Date.now;
  const dir = join(root, ".operator-data");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "mail-archive.sqlite");
  const moduleName = process.versions.bun ? "bun:sqlite" : "node:sqlite";
  const module = require(moduleName);
  const db: Db = process.versions.bun
    ? new module.Database(path, { create: true })
    : new module.DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, provider TEXT NOT NULL, account TEXT NOT NULL, remote_id TEXT NOT NULL, received_at TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, item_json TEXT NOT NULL, raw_json TEXT NOT NULL, UNIQUE(provider,account,remote_id));
    CREATE INDEX IF NOT EXISTS mail_received ON messages(received_at DESC);
    CREATE INDEX IF NOT EXISTS mail_provider ON messages(provider,account);
    CREATE VIRTUAL TABLE IF NOT EXISTS mail_search USING fts5(subject,sender,body,content=messages,content_rowid=rowid,tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS mail_added AFTER INSERT ON messages BEGIN INSERT INTO mail_search(rowid,subject,sender,body) VALUES(new.rowid,new.subject,new.sender,new.body); END;
    CREATE TRIGGER IF NOT EXISTS mail_updated AFTER UPDATE ON messages BEGIN INSERT INTO mail_search(mail_search,rowid,subject,sender,body) VALUES('delete',old.rowid,old.subject,old.sender,old.body); INSERT INTO mail_search(rowid,subject,sender,body) VALUES(new.rowid,new.subject,new.sender,new.body); END;
    CREATE TABLE IF NOT EXISTS imports (provider TEXT NOT NULL, account TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'importing', enumerated INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, completed_at TEXT, error TEXT, PRIMARY KEY(provider,account));`);
  if (!db.prepare("PRAGMA table_info(messages)").all().some(row => row.name === "storage_kind"))
    db.exec("ALTER TABLE messages ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'legacy-full'");
  db.exec(`CREATE TABLE IF NOT EXISTS mail_body_cache (message_id TEXT PRIMARY KEY, item_json TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS mail_cache_expiry ON mail_body_cache(expires_at);
    CREATE INDEX IF NOT EXISTS mail_cache_access ON mail_body_cache(accessed_at);`);
  const statement = db.prepare(
    "INSERT INTO messages(id,provider,account,remote_id,received_at,subject,sender,body,item_json,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET received_at=excluded.received_at,subject=excluded.subject,sender=excluded.sender,body=excluded.body,item_json=excluded.item_json,raw_json=excluded.raw_json,storage_kind='legacy-full'",
  );
  const metadataStatement = db.prepare("INSERT INTO messages(id,provider,account,remote_id,received_at,subject,sender,body,item_json,raw_json,storage_kind) VALUES(?,?,?,?,?,?,?,?,?,'{}','metadata') ON CONFLICT(id) DO UPDATE SET received_at=excluded.received_at,subject=excluded.subject,sender=excluded.sender,body=excluded.body,item_json=excluded.item_json WHERE messages.storage_kind='metadata'");
  const parse = (row: Row) => ({ ...JSON.parse(String(row.item_json)), bodyStatus: row.storage_kind || "cached" }) as InboxItem;
  let closed = false;
  function expireCache() { db.prepare("DELETE FROM mail_body_cache WHERE expires_at<=?").run(now()); }
  function cacheStats() {
    expireCache();
    const row = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM mail_body_cache").get()!;
    return { count: Number(row.count), bytes: Number(row.bytes), budgetBytes: cacheBudgetBytes, ttlDays: cacheTtlMs / 86400000 };
  }
  function stats() {
    const accounts = db
      .prepare(
        `SELECT i.*,COUNT(m.id) AS count,SUM(CASE WHEN m.storage_kind='legacy-full' THEN 1 ELSE 0 END) AS fullBodies,SUM(CASE WHEN m.storage_kind='metadata' THEN 1 ELSE 0 END) AS metadata,MIN(m.received_at) AS oldest,MAX(m.received_at) AS newest FROM imports i LEFT JOIN messages m ON i.provider=m.provider AND i.account=m.account GROUP BY i.provider,i.account`,
      )
      .all();
    return {
      total: Number(db.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count || 0),
      accounts,
      storage: ".operator-data/mail-archive.sqlite",
      searchable: true,
      syncMode: "metadata" as const,
      fullBodies: accounts.reduce((sum, account) => sum + Number(account.fullBodies), 0),
      metadata: accounts.reduce((sum, account) => sum + Number(account.metadata), 0),
      cache: cacheStats(),
    };
  }
  return {
    importMetadata(provider: Provider, account: string, raw: unknown[]) {
      if (!["gmail", "outlook"].includes(provider) || !account || !Array.isArray(raw) || raw.length > 100)
        throw new Error("Choose a mailbox and up to 100 messages per batch.");
      // Only normalized metadata/snippets are retained. Raw provider payloads are never stored here.
      const items = raw.map(value => {
        const message = object(value), payload = object(message.payload);
        const safe = provider === "gmail" ? { ...message, payload: { headers: payload.headers } } : { ...message, body: undefined };
        const item = normalizeArchiveMessage(provider, account, safe);
        return { ...item, body: clean(provider === "gmail" ? message.snippet : message.bodyPreview).slice(0, 1000), bodyStatus: "metadata" as const };
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of items) metadataStatement.run(item.id, provider, account, item.remoteId!, item.receivedAt, item.subject, item.from, item.body, JSON.stringify(item));
        db.prepare("INSERT INTO imports(provider,account,status,updated_at) VALUES(?,?,'paused',?) ON CONFLICT(provider,account) DO UPDATE SET updated_at=excluded.updated_at").run(provider, account, new Date(now()).toISOString());
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return items;
    },
    cacheBody(provider: Provider, account: string, raw: unknown): InboxItem {
      const item = normalizeArchiveMessage(provider, account, raw);
      const stored = db.prepare("SELECT storage_kind FROM messages WHERE id=?").get(item.id);
      if (!stored) throw new Error("Index this message before opening its body.");
      if (stored.storage_kind === "legacy-full") return this.get(item.id)!;
      const text = JSON.stringify({ ...item, bodyStatus: "cached" }), bytes = Buffer.byteLength(text);
      expireCache();
      if (bytes > cacheBudgetBytes) throw new Error("This email exceeds the local body cache budget. Open the original email in your provider.");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM mail_body_cache WHERE message_id=?").run(item.id);
        let used = Number(db.prepare("SELECT COALESCE(SUM(bytes),0) AS bytes FROM mail_body_cache").get()?.bytes);
        for (const row of db.prepare("SELECT message_id,bytes FROM mail_body_cache ORDER BY accessed_at,message_id").all()) {
          if (used + bytes <= cacheBudgetBytes) break;
          db.prepare("DELETE FROM mail_body_cache WHERE message_id=?").run(String(row.message_id)); used -= Number(row.bytes);
        }
        // Evict before inserting so SQLite can reuse freed pages without doubling the cache footprint.
        db.prepare("INSERT INTO mail_body_cache(message_id,item_json,bytes,expires_at,accessed_at) VALUES(?,?,?,?,?)").run(item.id, text, bytes, now() + cacheTtlMs, now());
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { ...item, bodyStatus: "cached" as const };
    },
    import(provider: Provider, account: string, raw: unknown[]) {
      if (
        !["gmail", "outlook"].includes(provider) ||
        !account ||
        !Array.isArray(raw) ||
        raw.length > 100
      )
        throw new Error("Choose a mailbox and up to 100 messages per batch.");
      const records = raw.map((x) => ({
        item: normalizeArchiveMessage(provider, account, x),
        raw: JSON.stringify(x),
      }));
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { item, raw } of records)
          statement.run(
            item.id,
            provider,
            account,
            item.remoteId!,
            item.receivedAt,
            item.subject,
            item.from,
            item.body,
            JSON.stringify(item),
            raw,
          );
        db.prepare(
          "INSERT INTO imports(provider,account,updated_at) VALUES(?,?,?) ON CONFLICT(provider,account) DO UPDATE SET updated_at=excluded.updated_at",
        ).run(provider, account, new Date().toISOString());
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
      return { processed: records.length, ...stats() };
    },
    progress(
      provider: Provider,
      account: string,
      enumerated: number,
      complete = false,
      error: string | null = null,
      status?: "running" | "paused" | "needs-attention" | "complete",
    ) {
      const count = Number(
        db
          .prepare("SELECT COUNT(*) AS count FROM messages WHERE provider=? AND account=?")
          .get(provider, account)?.count || 0,
      );
      if (complete && count !== enumerated)
        throw new Error(`Mailbox has ${count} stored messages, expected ${enumerated}.`);
      db.prepare(
        "INSERT INTO imports(provider,account,status,enumerated,updated_at,completed_at,error) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,account) DO UPDATE SET status=excluded.status,enumerated=excluded.enumerated,updated_at=excluded.updated_at,completed_at=excluded.completed_at,error=excluded.error",
      ).run(
        provider,
        account,
        error ? "needs-attention" : complete ? "complete" : status === "paused" ? "paused" : "importing",
        enumerated,
        new Date().toISOString(),
        complete ? new Date().toISOString() : null,
        error,
      );
      return stats();
    },
    stats,
    search(query = "", limit = 50, offset = 0, provider = "") {
      const words = [...new Set(
        query.slice(0, 600).toLowerCase()
          .match(/[\p{L}\p{N}@._-]+/gu)
          ?.filter((x) => x.length > 1 && !searchStopwords.has(x)) || [])].slice(0, 12);
      // Expanding every conversational word as a prefix can merge enormous FTS
      // posting lists and block the local server. Search literal tokens instead.
      if (query.trim() && !words.length) return { items: [], total: 0, offset, hasMore: false };
      const term = words.map((w) => '"' + w.replaceAll('"', '""') + '"').join(" OR ");
      const filters: string[] = [],
        args: Sql[] = [];
      if (term) {
        filters.push("mail_search MATCH ?");
        args.push(term);
      }
      if (provider && ["gmail", "outlook"].includes(provider)) {
        filters.push("provider=?");
        args.push(provider);
      }
      const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
      const from = " FROM messages" + (term ? " JOIN mail_search ON mail_search.rowid=messages.rowid" : "");
      const total = Number(
        db.prepare("SELECT COUNT(*) AS count" + from + where).get(...args)?.count || 0,
      );
      const items = db
        .prepare(
          "SELECT item_json,storage_kind" + from + where + (term ? " AND rank MATCH 'bm25(6,3,1)' ORDER BY rank" : " ORDER BY received_at DESC,id") + " LIMIT ? OFFSET ?",
        )
        .all(...args, Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 500)) : 50, Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0)
        .map(parse);
      return { items, total, offset, hasMore: offset + items.length < total };
    },
    get(id: string): InboxItem | undefined {
      expireCache();
      const row = db.prepare("SELECT item_json,storage_kind FROM messages WHERE id=?").get(id);
      if (row?.storage_kind === "legacy-full") return parse(row);
      const cached = db.prepare("SELECT item_json FROM mail_body_cache WHERE message_id=?").get(id);
      if (cached) { db.prepare("UPDATE mail_body_cache SET accessed_at=? WHERE message_id=?").run(now(), id); return parse(cached); }
      return row ? parse(row) : undefined;
    },
    ids(provider: Provider, account?: string) {
      return db
        .prepare("SELECT remote_id FROM messages WHERE provider=?" + (account ? " AND account=?" : ""))
        .all(...(account ? [provider, account] : [provider]))
        .map((r) => String(r.remote_id));
    },
    close() {
      if (!closed) { db.close(); closed = true; }
    },
  };
}
