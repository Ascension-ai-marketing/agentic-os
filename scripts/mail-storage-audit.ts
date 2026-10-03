import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Read-only storage inventory. It does not print mail, account identities or credentials. */
export function mailStorageAudit(root: string) {
  const directory = join(root, ".operator-data"), path = join(directory, "mail-archive.sqlite");
  const require = createRequire(import.meta.url);
  const sqlite = require(process.versions.bun ? "bun:sqlite" : "node:sqlite");
  const db = process.versions.bun ? new sqlite.Database(path, { readonly: true }) : new sqlite.DatabaseSync(path, { readOnly: true });
  try {
    const columns = db.prepare("PRAGMA table_info(messages)").all();
    const totals = db.prepare("SELECT COUNT(*) AS messages, COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bodyBytes, COALESCE(SUM(length(CAST(item_json AS BLOB))),0) AS normalizedBytes, COALESCE(SUM(length(CAST(raw_json AS BLOB))),0) AS rawBytes FROM messages").get();
    const kinds = columns.some((column: any) => column.name === "storage_kind")
      ? db.prepare("SELECT storage_kind AS kind,COUNT(*) AS count FROM messages GROUP BY storage_kind").all()
      : [{ kind: "legacy-full", count: totals.messages }];
    let stagingBytes = 0, stagingFiles = 0;
    const staging = join(directory, "mail-staging");
    for (const provider of ["gmail", "outlook"]) {
      const folder = join(staging, provider); if (!existsSync(folder)) continue;
      for (const name of readdirSync(folder).filter(name => name.endsWith(".json"))) { stagingBytes += statSync(join(folder, name)).size; stagingFiles++; }
    }
    return { dryRun: true, integrity: db.prepare("PRAGMA quick_check").get(), ...totals, kinds, databaseBytes: statSync(path).size, walBytes: existsSync(path + "-wal") ? statSync(path + "-wal").size : 0, stagingBytes, stagingFiles, changed: false, note: "Legacy bodies, normalized records, raw payloads and staging files are preserved. Reclaiming existing disk space requires a separately reviewed cleanup and SQLite compaction; the new body cache budget does not cap legacy storage." };
  } finally { db.close(); }
}
if (import.meta.main) console.log(JSON.stringify(mailStorageAudit(resolve(process.argv[2] || "."))));
