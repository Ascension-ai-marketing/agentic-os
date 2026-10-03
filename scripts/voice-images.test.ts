import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemorySource, OperatorState } from "../src/lib/operator";
import { voiceImages } from "./voice-images";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0S8AAAAASUVORK5CYII=",
  "base64",
);
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
// JPEG marker fixture: SOI, JFIF APP0 and EOI. The helper sniffs the format, not pixel decoding.
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let root: string;
let uploads: string;
let state: Pick<OperatorState, "sources" | "brainSources">;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "voice-images-"));
  uploads = join(root, ".operator-data", "uploads");
  mkdirSync(uploads, { recursive: true });
  state = { sources: [] };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function source(patch: Partial<MemorySource> = {}): MemorySource {
  return {
    id: "source-one",
    title: "Saved visual reference",
    filename: "reference.png",
    kind: "document",
    origin: "files",
    collection: "content",
    text: "Extracted image text stays in memory, not the image response.",
    createdAt: "2026-09-16T12:00:00Z",
    updatedAt: "2026-09-16T12:00:00Z",
    status: "ready",
    pinned: false,
    words: 11,
    hash: "fixture",
    ...patch,
  };
}
function save(patch: Partial<MemorySource> = {}, bytes = PNG) {
  const item = source(patch);
  state.sources.push(item);
  writeFileSync(join(uploads, `${item.id}.image`), bytes);
  return item;
}
const make = () => voiceImages(root, () => state);
function expectUnavailable(images: ReturnType<typeof voiceImages>, id = "source-one") {
  try {
    images.image(id);
    throw new Error("Expected image access to be rejected");
  } catch (error) {
    expect(error).toMatchObject({ message: "Image not available.", statusCode: 404 });
  }
}

test("lists saved image metadata and returns its original raster bytes without memory text", () => {
  save();
  const images = make();
  expect(images.list()).toEqual({
    images: [
      {
        id: "source-one",
        title: "Saved visual reference",
        filename: "reference.png",
        mimeType: "image/png",
        updatedAt: "2026-09-16T12:00:00Z",
      },
    ],
  });
  expect(images.image("source-one")).toEqual({
    bytes: PNG,
    mimeType: "image/png",
    filename: "reference.png",
  });
  expect(readFileSync(join(uploads, "source-one.image"))).toEqual(PNG);
});

test("recognizes PNG, JPEG and WebP from magic bytes and sorts newest first", () => {
  save({ id: "png", filename: "misleading.svg" });
  save({ id: "jpeg", filename: "photo.txt", updatedAt: "2026-09-16T13:00:00Z" }, JPEG);
  save({ id: "webp", filename: undefined, updatedAt: "2026-09-16T14:00:00Z" }, WEBP);
  const images = make();
  expect(images.list().images.map((item) => [item.id, item.mimeType])).toEqual([
    ["webp", "image/webp"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
  ]);
  expect(images.image("webp").filename).toBe("webp.webp");
  expect(images.image("png").mimeType).toBe("image/png");
});

test("permission changes immediately revoke both listing and direct access", () => {
  save();
  const images = make();
  expect(images.list().images).toHaveLength(1);
  state.brainSources = { files: false };
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
  state.brainSources.files = true;
  expect(images.image("source-one").bytes).toEqual(PNG);
});

test("uses sourceOrigin fallback and explicit origin when checking brain permissions", () => {
  save({ origin: undefined });
  save({ id: "web-item", origin: "web" });
  state.brainSources = { files: false, web: true };
  const images = make();
  expect(images.list().images.map((item) => item.id)).toEqual(["web-item"]);
  expectUnavailable(images);
  state.brainSources.web = false;
  expectUnavailable(images, "web-item");
});

test("trashed images disappear and become available again only after restore", () => {
  const item = save();
  const images = make();
  item.deletedAt = "2026-09-16T15:00:00Z";
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
  delete item.deletedAt;
  expect(images.list().images).toHaveLength(1);
});

test("only exact valid source IDs can open a recorded upload", () => {
  save();
  writeFileSync(join(uploads, "unrecorded.image"), PNG);
  const images = make();
  for (const id of [
    "../source-one",
    "..\\source-one",
    "/source-one",
    "%2e%2e%2fsource-one",
    "source-one.image",
    "source-one\0",
    "SOURCE-ONE",
    "unrecorded",
    "a".repeat(101),
    "",
  ])
    expectUnavailable(images, id);
  state.sources.push(source({ id: "../outside" }));
  expect(images.list().images.map((item) => item.id)).toEqual(["source-one"]);
});

test("missing uploads or upload directories never return metadata or filesystem errors", () => {
  state.sources.push(source());
  const images = make();
  expect(images.list()).toEqual({ images: [] });
  expectUnavailable(images);
  rmSync(join(root, ".operator-data"), { recursive: true });
  expect(images.list()).toEqual({ images: [] });
  expectUnavailable(images);
});

test("rejects SVG, HTML, text, empty files and raster extensions with invalid bytes", () => {
  const bodies = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from("<!DOCTYPE html><h1>Not an image</h1>"),
    Buffer.from("An ordinary saved document"),
    Buffer.alloc(0),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from("RIFFabcdefghijklWEBP"),
  ];
  bodies.forEach((body, index) => save({ id: `invalid-${index}`, filename: "image.png" }, body));
  const images = make();
  expect(images.list().images).toEqual([]);
  bodies.forEach((_, index) => expectUnavailable(images, `invalid-${index}`));
});

test("rejects images larger than 12 MiB before reading their body", () => {
  save();
  truncateSync(join(uploads, "source-one.image"), 12 * 1024 * 1024 + 1);
  const images = make();
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
});

test("linked uploads, hard links and directories are never served", () => {
  state.sources.push(source());
  const target = join(root, "outside.png");
  const upload = join(uploads, "source-one.image");
  writeFileSync(target, PNG);
  const images = make();
  symlinkSync(target, upload);
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
  rmSync(upload);
  linkSync(target, upload);
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
  rmSync(upload);
  mkdirSync(upload);
  expectUnavailable(images);
  expect(readFileSync(target)).toEqual(PNG);
});

test("linked uploads and data folders cannot expose an external image", () => {
  state.sources.push(source());
  const outside = join(root, "external");
  mkdirSync(outside);
  writeFileSync(join(outside, "source-one.image"), PNG);
  rmSync(uploads, { recursive: true });
  symlinkSync(outside, uploads);
  const images = make();
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
  rmSync(join(root, ".operator-data"), { recursive: true });
  mkdirSync(join(outside, "uploads"));
  writeFileSync(join(outside, "uploads/source-one.image"), PNG);
  symlinkSync(outside, join(root, ".operator-data"));
  expect(images.list().images).toEqual([]);
  expectUnavailable(images);
});

test("returned filenames cannot contain paths or header control characters", () => {
  save({ filename: "../../outside/visual.png\r\nX-Evil: yes" });
  expect(make().image("source-one").filename).toBe("visual.pngX-Evil: yes");
});
