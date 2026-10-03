import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { MemorySource } from "../src/lib/operator";

type Entry = { path: string; hash: string; signature: string; trashed: boolean };
type Conflict = { id: string; path: string; reason: string };
type Manifest = { version: 1; entries: Record<string, Entry>; conflicts: Record<string, Conflict> };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const segment = (s: string) =>
  /^[a-zA-Z0-9_-]{1,100}$/.test(s) ? s : "source-" + digest(s).slice(0, 24);
const scalar = (value: unknown) => JSON.stringify(value ?? null);

export function memoryMarkdown(source: MemorySource) {
  const frontmatter: Record<string, unknown> = {
    id: source.id,
    title: source.title,
    collection: source.collection,
    kind: source.kind,
    origin: source.origin || "manual",
    created: source.createdAt,
    updated: source.updatedAt,
    source_url: source.url,
    original_filename: source.filename,
    source_provider: source.connector?.provider,
    source_item: source.connector?.itemId,
    source_path: source.connector?.path,
    source_synced: source.connector?.syncedAt,
    extraction: source.extraction,
    trashed: source.deletedAt || null,
  };
  return (
    "---\n" +
    Object.entries(frontmatter)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${scalar(v)}`)
      .join("\n") +
    "\n---\n\n" +
    source.text +
    "\n"
  );
}

/** A portable, one-way copy. workspace.json remains authoritative. */
export function memoryVault(root: string) {
  const base = resolve(root),
    dataDir = join(base, ".operator-data"),
    path = join(dataDir, "vault"),
    manifestPath = join(dataDir, "memory-vault.json");
  let manifest: Manifest | undefined,
    error: string | undefined,
    stopped = false;
  let queued: MemorySource[] | undefined,
    active: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let written = 0,
    unchanged = 0;
  const safeDirectory = (dir: string) => {
    const rel = relative(base, dir);
    if (rel.startsWith("..") || rel.startsWith(sep))
      throw new Error("The memory vault must stay inside this workspace.");
    let at = base;
    for (const part of rel.split(sep).filter(Boolean)) {
      at = join(at, part);
      if (!existsSync(at)) mkdirSync(at, { mode: 0o700 });
      const stat = lstatSync(at);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("A linked or invalid vault folder was left untouched.");
    }
  };
  const diskHash = (file: string): string | null => {
    if (!existsSync(file)) return null;
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("A linked or invalid vault file was left untouched.");
    return digest(readFileSync(file, "utf8"));
  };
  const load = () => {
    if (manifest) return manifest;
    if (!existsSync(manifestPath)) return (manifest = { version: 1, entries: {}, conflicts: {} });
    if (lstatSync(dataDir).isSymbolicLink() || lstatSync(manifestPath).isSymbolicLink())
      throw new Error("A linked vault index was left untouched.");
    try {
      const value = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (value.version !== 1 || !value.entries || !value.conflicts) throw new Error();
      for (const entry of Object.values(value.entries) as Entry[]) {
        if (
          !entry ||
          typeof entry.path !== "string" ||
          entry.path.split(/[\\/]/).some((p) => p === "..") ||
          entry.path.startsWith("/")
        )
          throw new Error();
      }
      return (manifest = value as Manifest);
    } catch {
      throw new Error(
        "The vault index could not be read. Existing Markdown files were left untouched.",
      );
    }
  };
  const persist = () => {
    safeDirectory(dataDir);
    if (existsSync(manifestPath) && lstatSync(manifestPath).isSymbolicLink())
      throw new Error("A linked vault index was left untouched.");
    const temporary = manifestPath + "." + randomUUID();
    writeFileSync(temporary, JSON.stringify(load()), { mode: 0o600, flag: "wx" });
    renameSync(temporary, manifestPath);
  };
  const writeManaged = (target: string, body: string, expected: string | null) => {
    safeDirectory(dirname(target));
    if (diskHash(target) !== expected)
      throw new Error(
        "This Markdown file was edited outside the OS. Your edit was preserved; copy it into Memory to index it.",
      );
    const temp = target + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
      if (diskHash(target) !== expected)
        throw new Error(
          "The Markdown file changed during export. Your edit was preserved; export again after reviewing it.",
        );
      renameSync(temp, target);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  };
  const mirror = (source: MemorySource, force: boolean) => {
    if (source.status !== "ready") return false;
    const index = load(),
      id = source.id;
    const destination = [
      source.deletedAt ? ".trash" : "",
      segment(source.collection),
      segment(id) + ".md",
    ]
      .filter(Boolean)
      .join("/");
    const signature = digest(
      JSON.stringify([
        source.hash,
        source.title,
        source.collection,
        source.kind,
        source.origin,
        source.createdAt,
        source.updatedAt,
        source.url,
        source.filename,
        source.connector,
        source.extraction,
        source.deletedAt,
      ]),
    );
    const old = index.entries[id];
    if (!force && old?.signature === signature && !index.conflicts[id]) {
      unchanged++;
      return false;
    }
    try {
      safeDirectory(path);
      const target = join(path, destination),
        previous = old ? join(path, old.path) : undefined;
      if (previous) {
        safeDirectory(dirname(previous));
        const previousHash = diskHash(previous);
        if (previousHash !== null && previousHash !== old.hash)
          throw new Error(
            "This Markdown file was edited outside the OS. Your edit was preserved; copy it into Memory to index it.",
          );
      }
      const body = memoryMarkdown(source),
        hash = digest(body);
      safeDirectory(dirname(target));
      const currentHash = diskHash(target);
      if (currentHash !== hash) {
        const expected =
          old?.path === destination ? (currentHash === null ? null : old.hash) : null;
        writeManaged(target, body, expected);
        written++;
      } else unchanged++;
      if (previous && previous !== target && diskHash(previous) === old.hash) unlinkSync(previous);
      const changed =
        old?.signature !== signature || old?.path !== destination || !!index.conflicts[id];
      index.entries[id] = { path: destination, hash, signature, trashed: !!source.deletedAt };
      delete index.conflicts[id];
      return changed;
    } catch (e) {
      const conflict = { id, path: old?.path || destination, reason: (e as Error).message };
      const changed = JSON.stringify(index.conflicts[id]) !== JSON.stringify(conflict);
      index.conflicts[id] = conflict;
      return changed;
    }
  };
  const run = (force = false) => {
    if (active) return active;
    active = Promise.resolve()
      .then(async () => {
        try {
          error = undefined;
          while (queued && !stopped) {
            const sources = queued;
            queued = undefined;
            let dirty = false;
            if (!sources.length) safeDirectory(path);
            for (let i = 0; i < sources.length && !stopped; i++) {
              dirty = mirror(sources[i], force) || dirty;
              if ((i + 1) % 32 === 0) {
                if (dirty) {
                  persist();
                  dirty = false;
                }
                await new Promise((done) => setTimeout(done, 0));
              }
            }
            if (dirty) persist();
          }
        } catch (e) {
          error = (e as Error).message;
        }
      })
      .finally(() => {
        active = undefined;
        if (queued && !stopped && !timer)
          timer = setTimeout(() => {
            timer = undefined;
            void run();
          }, 75);
      });
    return active;
  };
  const status = () => {
    let entries: Entry[] = [],
      details: Conflict[] = [];
    try {
      entries = Object.values(load().entries);
      details = Object.values(load().conflicts);
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      path,
      mirrored: entries.filter((e) => !e.trashed).length,
      trashed: entries.filter((e) => e.trashed).length,
      conflicts: details.length,
      pending: !!queued || !!active,
      error,
      format: "markdown",
      mode: "one-way",
      editable: false,
      details,
      primary: join(dataDir, "workspace.json"),
      photos: join(dataDir, "uploads"),
      originals:
        "Photo originals are stored locally; other sources keep extracted text and references. YouTube video files are not copied.",
    };
  };
  return {
    status,
    schedule(sources: MemorySource[]) {
      if (stopped) return;
      queued = sources;
      if (!timer && !active)
        timer = setTimeout(() => {
          timer = undefined;
          void run();
        }, 75);
    },
    async export(sources: MemorySource[] | (() => MemorySource[])) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (active) await active;
      const before = written,
        same = unchanged;
      queued = typeof sources === "function" ? sources() : sources;
      await run(true);
      return { ...status(), written: written - before, unchanged: unchanged - same };
    },
    stop() {
      stopped = true;
      queued = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
