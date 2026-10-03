import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { brainEnabled, sourceOrigin } from "../src/lib/brain-sources";
import type { MemorySource, OperatorState } from "../src/lib/operator";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,100}$/;
type ImageMime = "image/png" | "image/jpeg" | "image/webp";
type ImageState = Pick<OperatorState, "sources" | "brainSources">;
export type VoiceImage = {
  id: string;
  title: string;
  filename: string;
  mimeType: ImageMime;
  updatedAt: string;
};

function unavailable() {
  return Object.assign(new Error("Image not available."), { statusCode: 404 });
}

/** Detect a supported raster from its bytes, never its user-supplied extension. */
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

function filename(source: MemorySource, mimeType: ImageMime) {
  const value = basename((source.filename || "").replaceAll("\\", "/"))
    .replace(/\p{Cc}/gu, "")
    .slice(0, 200);
  return value && value !== "." && value !== ".."
    ? value
    : `${source.id}.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6)}`;
}

/** Read-only access to images that the user already saved in this workspace. */
export function voiceImages(root: string, loadState: () => ImageState) {
  const dataDir = join(resolve(root), ".operator-data");
  const uploads = join(dataDir, "uploads");
  const eligible = (state: ImageState, source: MemorySource) =>
    SOURCE_ID.test(source.id) && !source.deletedAt && brainEnabled(state, sourceOrigin(source));
  const safeDirectories = () =>
    [dataDir, uploads].every((dir) => {
      const stat = lstatSync(dir);
      return stat.isDirectory() && !stat.isSymbolicLink();
    });

  function read(source: MemorySource, includeBytes: boolean) {
    let descriptor: number | undefined;
    try {
      if (!SOURCE_ID.test(source.id) || !safeDirectories()) throw unavailable();
      const path = join(uploads, `${source.id}.image`);
      const before = lstatSync(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw unavailable();
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(descriptor);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.size < 4 ||
        stat.size > MAX_IMAGE_BYTES ||
        !safeDirectories()
      )
        throw unavailable();

      const header = Buffer.alloc(Math.min(32, stat.size));
      if (readSync(descriptor, header, 0, header.length, 0) !== header.length) throw unavailable();
      const mimeType = imageMime(header, stat.size);
      if (!mimeType) throw unavailable();
      const metadata: VoiceImage = {
        id: source.id,
        title: source.title,
        filename: filename(source, mimeType),
        mimeType,
        updatedAt: source.updatedAt,
      };
      if (!includeBytes) return { metadata };

      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (!count) throw unavailable();
        offset += count;
      }
      const after = fstatSync(descriptor);
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs ||
        imageMime(bytes.subarray(0, 32), bytes.length) !== mimeType
      )
        throw unavailable();
      return { metadata, bytes };
    } catch {
      // Do not expose local paths, disabled source names, or filesystem errors.
      throw unavailable();
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  return {
    list(): { images: VoiceImage[] } {
      const state = loadState();
      const images: VoiceImage[] = [];
      const seen = new Set<string>();
      for (const source of state.sources) {
        if (!eligible(state, source) || seen.has(source.id)) continue;
        seen.add(source.id);
        try {
          images.push(read(source, false).metadata);
        } catch {
          // Missing, linked, unsupported, or oversized uploads are not images to display.
        }
      }
      images.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { images };
    },
    image(id: string): { bytes: Buffer; mimeType: ImageMime; filename: string } {
      if (typeof id !== "string" || !SOURCE_ID.test(id)) throw unavailable();
      const state = loadState();
      const source = state.sources.find((entry) => entry.id === id);
      if (!source || !eligible(state, source)) throw unavailable();
      const { metadata, bytes } = read(source, true);
      if (!bytes) throw unavailable();
      return { bytes, mimeType: metadata.mimeType, filename: metadata.filename };
    },
  };
}
