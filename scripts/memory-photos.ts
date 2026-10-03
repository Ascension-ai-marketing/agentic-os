import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MemorySource } from "../src/lib/operator";

const run = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_INDEX = 32 * 1024 * 1024;
const MAX_RECORDS = 25000;
const clean = (value: unknown, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const unavailable = () =>
  new Error("This photo is no longer available. Refresh the photo library.");

export function photoMime(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  if (bytes.length >= 8 && ["49492a00", "4d4d002a"].includes(bytes.subarray(0, 4).toString("hex")))
    return "image/tiff";
  if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") return "image/bmp";
}

function readRaster(file: string) {
  const before = lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > MAX_IMAGE ||
    before.size < 4
  )
    throw unavailable();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (st.ino !== before.ino || st.dev !== before.dev || st.size !== before.size)
      throw unavailable();
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) throw unavailable();
      offset += n;
    }
    const after = fstatSync(fd),
      mimeType = photoMime(bytes);
    if (!mimeType || after.mtimeMs !== st.mtimeMs || after.size !== st.size) throw unavailable();
    return { bytes, mimeType, mtimeMs: st.mtimeMs };
  } finally {
    closeSync(fd);
  }
}

function uploads(root: string) {
  let folder = resolve(root);
  for (const part of [".operator-data", "uploads"]) {
    folder = join(folder, part);
    if (!existsSync(folder)) mkdirSync(folder, { mode: 0o700 });
    const st = lstatSync(folder);
    if (!st.isDirectory() || st.isSymbolicLink())
      throw new Error("Photo storage is linked or unavailable; originals were left untouched.");
  }
  return folder;
}

export function saveMemoryPhoto(
  root: string,
  id: string,
  bytes: Buffer,
  original: "upload" | "design-library" | "photo-index",
  extra: { designId?: string; indexedAt?: string } = {},
): NonNullable<MemorySource["image"]> {
  if (!ID.test(id) || bytes.length > MAX_IMAGE || !photoMime(bytes))
    throw new Error("Use a PNG, JPEG, WebP, GIF, HEIC, AVIF, TIFF or BMP image under 12 MB.");
  const folder = uploads(root),
    target = join(folder, id + ".image");
  if (existsSync(target)) {
    const st = lstatSync(target);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw unavailable();
  }
  const temp = join(folder, `${id}.${randomUUID()}.tmp`);
  writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
  renameSync(temp, target);
  return {
    url: `/__operator/memory/photos/${id}/image`,
    thumbnailUrl: `/__operator/memory/photos/${id}/thumbnail`,
    mimeType: photoMime(bytes)!,
    bytes: bytes.length,
    sha256: hash(bytes),
    original,
    ...extra,
  };
}

const thumbnailJobs = new Map<string, Promise<{ bytes: Buffer; mimeType: string }>>();
let activeThumbnails = 0;
const thumbnailWaiters: Array<() => void> = [];
async function thumbnailSlot() {
  if (activeThumbnails >= 2) await new Promise<void>((done) => thumbnailWaiters.push(done));
  else activeThumbnails++;
  return () => {
    const next = thumbnailWaiters.shift();
    if (next) next();
    else activeThumbnails--;
  };
}

/** Byte-sniffed images only. Thumbnails are local derived copies, never model calls. */
export async function readMemoryPhoto(root: string, id: string, thumbnail: boolean) {
  if (!ID.test(id)) throw unavailable();
  const folder = uploads(root),
    file = join(folder, id + ".image"),
    original = readRaster(file);
  const needsConversion = ![
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
  ].includes(original.mimeType);
  if ((!thumbnail && !needsConversion) || process.platform !== "darwin") return original;
  const key = `${file}:${original.mtimeMs}:${original.bytes.length}:${thumbnail ? 560 : 1600}`;
  const target = join(folder, `${id}.${hash(key).slice(0, 16)}.thumb.png`);
  if (existsSync(target)) return readRaster(target);
  if (!thumbnailJobs.has(key))
    thumbnailJobs.set(
      key,
      (async () => {
        const release = await thumbnailSlot(),
          temporary = `${target}.${randomUUID()}.png`;
        try {
          await run(
            "/usr/bin/sips",
            ["-s", "format", "png", "-Z", thumbnail ? "560" : "1600", file, "--out", temporary],
            { timeout: 15000, maxBuffer: 1024 * 1024 },
          );
          const converted = readRaster(temporary);
          chmodSync(temporary, 0o600);
          renameSync(temporary, target);
          return converted;
        } catch {
          return original;
        } finally {
          release();
          rmSync(temporary, { force: true });
          thumbnailJobs.delete(key);
        }
      })(),
    );
  return thumbnailJobs.get(key)!;
}

type Entry = {
  path: string;
  desc?: string;
  text?: string;
  tags?: string[];
  ocr?: string;
  model?: string;
  ts?: number;
  mtimeMs?: number;
};
export function memoryPhotos(root: string, home = homedir()) {
  const design = join(home, ".claude-os", "design"),
    indexFile = join(design, "index.jsonl");
  type Candidate = Entry & {
    id: string;
    real: string;
    bytes: number;
    extraction?: "local-ocr" | "design-vision";
  };
  let cached:
    | { stamp: string; at: number; result: { entries: Candidate[]; unavailable: number } }
    | undefined;
  const fileStamp = (path: string) => {
    try {
      const st = statSync(path);
      return `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      return "missing";
    }
  };
  function index() {
    if (!existsSync(indexFile)) return { entries: [] as Entry[], malformed: 0 };
    const st = lstatSync(indexFile);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_INDEX)
      throw new Error(
        "The Design photo index exceeds the safe local reading limit. Open Design to review its index.",
      );
    const latest = new Map<string, Entry>();
    let malformed = 0,
      records = 0;
    for (const line of readFileSync(indexFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      if (++records > MAX_RECORDS)
        throw new Error(
          "The Design index contains over 25,000 records. Narrow its library before importing photos.",
        );
      if (line.length > 500000) {
        malformed++;
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (typeof entry.path === "string" && typeof entry.desc === "string")
          latest.set(entry.path, {
            ...entry,
            tags: Array.isArray(entry.tags)
              ? entry.tags.filter((tag: unknown) => typeof tag === "string").slice(0, 24)
              : [],
          });
        else malformed++;
      } catch {
        malformed++;
      }
    }
    return { entries: [...latest.values()], malformed };
  }
  function allowedRoots() {
    const config = join(home, ".claude-os/config.json");
    let roots = ["Desktop", "Documents", "Downloads"].map((name) => join(home, name));
    if (existsSync(config)) {
      if (statSync(config).size > 1024 * 1024)
        throw new Error("Design folder configuration is too large.");
      const picked = JSON.parse(readFileSync(config, "utf8"))?.design?.roots;
      if (Array.isArray(picked) && picked.length)
        roots = picked
          .filter((value: unknown) => typeof value === "string" && value.trim())
          .map((value: string) =>
            value.startsWith("~") ? join(home, value.slice(1)) : resolve(value),
          );
    }
    roots.push(join(design, "references"));
    return roots.filter((p) => existsSync(p)).map((p) => realpathSync(p));
  }
  function candidates(fresh = false) {
    const stamp = fileStamp(indexFile) + ":" + fileStamp(join(home, ".claude-os/config.json"));
    if (!fresh && cached?.stamp === stamp && Date.now() - cached.at < 5000) return cached.result;
    const loaded = index(),
      roots = allowedRoots();
    const entries: Candidate[] = [];
    let unavailableCount = loaded.malformed;
    for (const entry of loaded.entries) {
      try {
        const real = realpathSync(entry.path);
        if (!roots.some((folder) => real.startsWith(folder + sep))) {
          unavailableCount++;
          continue;
        }
        const st = lstatSync(real);
        if (
          !st.isFile() ||
          st.nlink !== 1 ||
          st.size > MAX_IMAGE ||
          st.size < 4 ||
          !/\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp)$/i.test(real) ||
          (entry.mtimeMs && Math.abs(st.mtimeMs - entry.mtimeMs) > 1)
        ) {
          unavailableCount++;
          continue;
        }
        const desc = clean(entry.desc, 4000),
          text = clean(entry.text, 100000);
        entries.push({
          ...entry,
          desc,
          text,
          id: hash(real),
          real,
          bytes: st.size,
          extraction: desc ? "design-vision" : text ? "local-ocr" : undefined,
        });
      } catch {
        unavailableCount++;
      }
    }
    entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const result = { entries, unavailable: unavailableCount };
    cached = { stamp, at: Date.now(), result };
    return result;
  }
  return {
    catalog(query = "", offset = 0, limit = 48, sources: MemorySource[] = []) {
      const { entries, unavailable } = candidates(),
        q = query.toLowerCase().trim().slice(0, 200);
      const filtered = entries.filter(
        (e) =>
          !q ||
          `${basename(e.real)} ${e.desc} ${e.text} ${(e.tags || []).join(" ")}`
            .toLowerCase()
            .includes(q),
      );
      const selected = filtered.slice(offset, offset + limit);
      return {
        images: selected.map((e) => ({
          id: e.id,
          path: e.real,
          title: basename(e.real),
          url: `/__operator/memory/photos/design/${e.id}/image`,
          thumbnailUrl: `/__operator/memory/photos/design/${e.id}/image`,
          description: e.desc || e.text?.slice(0, 280),
          extraction: e.extraction,
          indexed: !!e.extraction,
          indexedAt:
            typeof e.ts === "number" && Number.isFinite(new Date(e.ts).getTime())
              ? new Date(e.ts).toISOString()
              : undefined,
          importedSourceId: sources.find(
            (s) =>
              !s.deletedAt &&
              s.connector?.provider === "design-photos" &&
              s.connector.itemId === e.id,
          )?.id,
        })),
        total: filtered.length,
        availableDesign: entries.length,
        indexedText: entries.filter((e) => e.text).length,
        indexedVision: entries.filter((e) => e.desc).length,
        unavailable,
        nextOffset: offset + selected.length < filtered.length ? offset + selected.length : null,
        note: "Existing Design photos, descriptions and image text. Choose indexed photos to add to Memory; photos without readable text need a description first. Importing saved text has no new AI charge; Apple Photos is not connected. Missing, changed and unsupported images are omitted.",
      };
    },
    selected(ids: unknown, requireIndexed = true) {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 24 ||
        ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) ||
        new Set(ids).size !== ids.length
      )
        throw new Error("Choose between 1 and 24 different Design photos.");
      const { entries } = candidates(requireIndexed);
      return ids.map((id) => {
        const entry = entries.find((e) => e.id === id);
        if (!entry) throw unavailable();
        if (requireIndexed && !entry.extraction)
          throw new Error(
            "A selected photo has no readable text or visual description yet. Describe it in Design first, or upload it and add your own description.",
          );
        return entry;
      });
    },
    image(id: string) {
      const entry = this.selected([id], false)[0];
      return readRaster(entry.real);
    },
    prepare(entry: ReturnType<typeof candidates>["entries"][number], sourceId: string) {
      const original = readRaster(entry.real);
      if (entry.mtimeMs && Math.abs(original.mtimeMs - entry.mtimeMs) > 1) throw unavailable();
      const indexedAt =
        typeof entry.ts === "number" && Number.isFinite(entry.ts)
          ? new Date(entry.ts).toISOString()
          : undefined;
      const image = saveMemoryPhoto(root, sourceId, original.bytes, "design-library", {
        designId: entry.id,
        indexedAt,
      });
      return {
        id: sourceId,
        title: basename(entry.real),
        filename: basename(entry.real),
        origin: "images",
        extraction: entry.extraction,
        image,
        text: [
          `Photo: ${basename(entry.real)}`,
          entry.desc
            ? `Existing AI visual description (may be imperfect): ${entry.desc}`
            : "Local OCR only: the text below was read from this image; its scene has not been visually described.",
          entry.tags?.length
            ? `Design tags: ${entry.tags
                .map((tag) => clean(tag, 80))
                .slice(0, 24)
                .join(", ")}`
            : "",
          entry.text ? `Text recognized in image:\n${entry.text}` : "",
          indexedAt ? `Design indexed at: ${indexedAt}` : "Design index date was not recorded.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        connector: {
          provider: "design-photos",
          itemId: entry.id,
          path: entry.real,
          syncedAt: new Date().toISOString(),
        },
      };
    },
  };
}
