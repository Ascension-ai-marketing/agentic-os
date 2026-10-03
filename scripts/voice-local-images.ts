import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export type VoiceLocalImage = {
  id: string;
  title: string;
  filename: string;
  folder: string;
  mimeType: ImageMime;
  size: number;
  modifiedAt: string;
};
export type VoiceLocalImagesOptions = {
  allowed: () => boolean;
  home?: string;
  roots?: Array<{ path: string; label: string }>;
  /** These settings may lower the fixed safety limits, never raise them. */
  maxEntries?: number;
  maxDepth?: number;
  maxResults?: number;
  ttlMs?: number;
  now?: () => number;
};
type Root = { path: string; label: string };
type Fingerprint = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs" | "ctimeMs">;
type IssuedImage = { root: Root; path: string; fingerprint: Fingerprint; expiresAt: number };

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ISSUED = 120;
const MAX_SEARCH_MS = 3_000;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp)$/i;
const OPAQUE_ID = /^[A-Za-z0-9_-]{32}$/;
const unavailable = () => Object.assign(new Error("Image not available."), { statusCode: 404 });
const bounded = (value: number | undefined, ceiling: number, floor = 1) =>
  Number.isFinite(value) ? Math.max(floor, Math.min(ceiling, Math.floor(value!))) : ceiling;
const cleanLabel = (value: string) => value.replace(/\p{Cc}/gu, "").slice(0, 200);
const skippedName = (name: string) =>
  name.startsWith(".") ||
  name === "node_modules" ||
  /\.(?:app|bundle|framework|plugin|photoslibrary|photolibrary|aplibrary)$/i.test(name);
const sameFile = (a: Fingerprint, b: Fingerprint) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/** Every ancestor is checked as well as the final file; linked folders are never followed. */
function safeDirectory(path: string) {
  const absolute = resolve(path);
  let at = parse(absolute).root;
  for (const segment of relative(at, absolute).split(sep).filter(Boolean)) {
    at = join(at, segment);
    const stat = lstatSync(at);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unavailable();
  }
  if (realpathSync(absolute) !== absolute) throw unavailable();
}

function safePath(root: Root, path: string) {
  const rel = relative(root.path, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw unavailable();
  if (rel.split(sep).some(skippedName)) throw unavailable();
  safeDirectory(dirname(path));
  if (realpathSync(root.path) !== root.path || realpathSync(path) !== path) throw unavailable();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw unavailable();
  return stat;
}

function imageMime(header: Buffer, size: number): ImageMime | undefined {
  if (
    size >= 33 &&
    header.length >= 24 &&
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    header.readUInt32BE(8) === 13 &&
    header.toString("ascii", 12, 16) === "IHDR" &&
    header.readUInt32BE(16) > 0 &&
    header.readUInt32BE(20) > 0
  )
    return "image/png";
  if (size >= 4 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
    return "image/jpeg";
  if (
    size >= 20 &&
    header.length >= 20 &&
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.readUInt32LE(4) + 8 === size &&
    header.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(header.toString("ascii", 12, 16))
  )
    return "image/webp";
}

function readRaster(root: Root, path: string, body: boolean, expected?: Fingerprint) {
  let descriptor: number | undefined;
  try {
    const before = safePath(root, path);
    if (before.size < 4 || before.size > MAX_BYTES || (expected && !sameFile(before, expected)))
      throw unavailable();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || !sameFile(before, stat)) throw unavailable();
    // Recheck containment after opening, before reading even the format header.
    if (!sameFile(safePath(root, path), stat)) throw unavailable();
    const header = Buffer.alloc(Math.min(32, stat.size));
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) throw unavailable();
    const mimeType = imageMime(header, stat.size);
    if (!mimeType) throw unavailable();
    let bytes: Buffer | undefined;
    if (body) {
      bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (!count) throw unavailable();
        offset += count;
      }
      if (imageMime(bytes.subarray(0, 32), bytes.length) !== mimeType) throw unavailable();
    }
    if (!sameFile(fstatSync(descriptor), stat) || !sameFile(safePath(root, path), stat))
      throw unavailable();
    return { bytes, mimeType, stat };
  } catch {
    throw unavailable();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** On-demand filename search. No indexing, model uploads, file writes, or arbitrary-path access. */
export function voiceLocalImages(options: VoiceLocalImagesOptions) {
  const home = resolve(options.home || homedir());
  const roots: Root[] = (
    options.roots ||
    ["Desktop", "Downloads", "Pictures"].map((label) => ({ path: join(home, label), label }))
  )
    .slice(0, 3)
    .map((root) => ({
      path: resolve(root.path),
      label: cleanLabel(basename(root.label.replaceAll("\\", "/"))) || "Local images",
    }));
  const maxEntries = bounded(options.maxEntries, 8_000);
  const maxDepth = bounded(options.maxDepth, 6, 0);
  const maxResults = bounded(options.maxResults, 30);
  const ttlMs = bounded(options.ttlMs, 5 * 60_000);
  const now = options.now || Date.now;
  const issued = new Map<string, IssuedImage>();
  const allowed = () => {
    let enabled = false;
    try {
      enabled = options.allowed() === true;
    } catch {
      // A failed permission lookup must not grant image access.
    }
    if (!enabled) issued.clear();
    return enabled;
  };
  const prune = () => {
    const time = now();
    for (const [id, item] of issued) if (time >= item.expiresAt) issued.delete(id);
    while (issued.size >= MAX_ISSUED) issued.delete(issued.keys().next().value!);
  };

  return {
    async search(query: string): Promise<{
      images: VoiceLocalImage[];
      searchedFolders: string[];
      note: string;
    }> {
      if (!allowed())
        throw Object.assign(new Error("Local image access is disabled."), { statusCode: 403 });
      if (typeof query !== "string" || query.length > 160 || /[/\\\p{Cc}]/u.test(query))
        throw Object.assign(new Error("Search using a filename or a few filename words."), {
          statusCode: 400,
        });
      prune();
      const words = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      const images: VoiceLocalImage[] = [];
      const searchedFolders = new Set<string>();
      const seen = new Set<string>();
      let visited = 0;
      let limited = false;
      let incomplete = false;

      async function* walk(root: Root) {
        const queue = [{ path: root.path, depth: 0 }];
        for (let index = 0; index < queue.length; index++) {
          const item = queue[index];
          if (seen.has(item.path)) continue;
          seen.add(item.path);
          try {
            safeDirectory(item.path);
            const directory = await opendir(item.path);
            try {
              safeDirectory(item.path);
            } catch {
              await directory.close();
              throw unavailable();
            }
            searchedFolders.add(root.label);
            for await (const entry of directory) {
              const path = join(item.path, entry.name);
              if (!skippedName(entry.name) && !entry.isSymbolicLink() && entry.isDirectory()) {
                if (item.depth < maxDepth) queue.push({ path, depth: item.depth + 1 });
                else limited = true;
              }
              yield { entry, path };
            }
          } catch {
            incomplete = true;
          }
        }
      }

      // Interleave roots one entry at a time. Each root keeps a reserved share of
      // the entry/time budget so a large Desktop cannot hide a Pictures match.
      const scans = roots.map((root, index) => ({
        root,
        iterator: walk(root),
        entries: 0,
        elapsedMs: 0,
        entryBudget:
          Math.floor(maxEntries / roots.length) + (index < maxEntries % roots.length ? 1 : 0),
        timeBudget: MAX_SEARCH_MS / roots.length,
        done: false,
      }));
      try {
        scan: while (scans.some((item) => !item.done)) {
          for (const scan of scans) {
            if (scan.done) continue;
            if (images.length >= maxResults) {
              limited = true;
              break scan;
            }
            if (scan.entries >= scan.entryBudget || scan.elapsedMs >= scan.timeBudget) {
              limited = true;
              scan.done = true;
              continue;
            }
            const started = performance.now();
            try {
              // The gate may load a large workspace. Recheck between short batches,
              // immediately before reading any candidate image, and before returning.
              if (visited % 16 === 0 && !allowed())
                throw Object.assign(new Error("Local image access is disabled."), {
                  statusCode: 403,
                });
              const next = await scan.iterator.next();
              if (next.done) {
                scan.done = true;
                continue;
              }
              scan.entries++;
              visited++;
              const { entry, path } = next.value;
              const normalized = entry.name.normalize("NFKC").toLocaleLowerCase();
              if (
                skippedName(entry.name) ||
                entry.isSymbolicLink() ||
                !entry.isFile() ||
                !IMAGE_EXTENSION.test(entry.name) ||
                !words.every((word) => normalized.includes(word))
              )
                continue;
              if (!allowed())
                throw Object.assign(new Error("Local image access is disabled."), {
                  statusCode: 403,
                });
              try {
                const { mimeType, stat } = readRaster(scan.root, path, false);
                const id = randomBytes(24).toString("base64url");
                prune();
                issued.set(id, {
                  root: scan.root,
                  path,
                  fingerprint: stat,
                  expiresAt: now() + ttlMs,
                });
                const filename = cleanLabel(entry.name);
                images.push({
                  id,
                  title: filename.replace(IMAGE_EXTENSION, ""),
                  filename,
                  folder: scan.root.label,
                  mimeType,
                  size: stat.size,
                  modifiedAt: stat.mtime.toISOString(),
                });
              } catch {
                // Unsupported, changed, oversized, inaccessible and linked files are omitted.
              }
            } finally {
              scan.elapsedMs += performance.now() - started;
            }
          }
        }
      } finally {
        // Returning an iterator also closes its currently open directory handle.
        await Promise.allSettled(scans.map((scan) => scan.iterator.return()));
      }
      // A permission change during an asynchronous directory read also revokes collected results.
      if (!allowed())
        throw Object.assign(new Error("Local image access is disabled."), { statusCode: 403 });
      images.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      return {
        images,
        searchedFolders: [...searchedFolders],
        note:
          (words.length
            ? "Matched filenames only; image contents were not searched."
            : "Showing a sample of local images, newest first within sampled files. Image contents were not searched.") +
          (limited
            ? " Search reached its folder, time or result limit; use more specific filename words."
            : "") +
          (incomplete ? " Some folders were unavailable or skipped." : ""),
      };
    },
    image(id: string): { bytes: Buffer; mimeType: ImageMime; filename: string } {
      if (!allowed() || typeof id !== "string" || !OPAQUE_ID.test(id)) throw unavailable();
      const item = issued.get(id);
      if (!item || now() >= item.expiresAt) {
        issued.delete(id);
        throw unavailable();
      }
      try {
        const { bytes, mimeType } = readRaster(item.root, item.path, true, item.fingerprint);
        if (!bytes || !allowed()) throw unavailable();
        return { bytes, mimeType, filename: cleanLabel(basename(item.path)) };
      } catch {
        issued.delete(id);
        throw unavailable();
      }
    },
  };
}
