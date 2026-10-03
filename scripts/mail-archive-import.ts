import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { mailArchive } from "./mail-archive";
export function ingestMailStage(root: string) {
const base = join(root, ".operator-data/mail-staging");
mkdirSync(base, { recursive: true, mode: 0o700 });
const lock = join(base, "import.lock");
if (existsSync(lock)) {
  const pidFile = join(lock, "pid");
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
  let alive = true;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
  } else if (Date.now() - statSync(lock).mtimeMs > 60000) {
    alive = false; // A process died before recording its PID.
  }
  if (alive) return { busy: true };
  rmSync(lock, { recursive: true });
}
try { mkdirSync(lock, { mode: 0o700 }); }
catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return { busy: true }; throw error; }
let archive: ReturnType<typeof mailArchive> | undefined;
try {
writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
archive = mailArchive(root);
  const checkpoint = join(base, "ingested-pages.json");
  const ingested = new Set<string>(
    existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : [],
  );
  let processed = 0;
  for (const provider of ["gmail", "outlook"] as const) {
    const folder = join(base, provider);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const key = provider + "/" + file;
      if (ingested.has(key)) continue;
      const data = JSON.parse(readFileSync(join(folder, file), "utf8"));
      const records = provider === "gmail" ? data.responses : data.value;
      if (!Array.isArray(records) || typeof data.account !== "string" || !data.account.trim())
        throw new Error(`Invalid staged page: ${key}. The page has not been checkpointed.`);
      for (let offset = 0; offset < records.length; offset += 100)
        archive.import(provider, data.account, records.slice(offset, offset + 100));
      processed += records.length;
      ingested.add(key);
      const temporary = checkpoint + ".tmp";
      writeFileSync(temporary, JSON.stringify([...ingested]), { mode: 0o600 });
      renameSync(temporary, checkpoint);
    }
  }
  return { processed, ...archive.stats() };
} finally {
  archive?.close();
  rmSync(lock, { recursive: true, force: true });
}
}
if (import.meta.main) {
  try { console.log(JSON.stringify(ingestMailStage(resolve(process.argv[2] || ".")))); }
  catch { console.error("Staged import stopped. The current page remains pending; fix the staged page and retry. Existing mail is preserved."); process.exitCode = 1; }
}
