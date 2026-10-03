import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceLocalImages, type VoiceLocalImagesOptions } from "./voice-local-images";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0S8AAAAASUVORK5CYII=",
  "base64",
);
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let home: string;
let enabled: boolean;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "voice-local-images-")));
  for (const folder of ["Desktop", "Downloads", "Pictures"]) mkdirSync(join(home, folder));
  enabled = true;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function save(path = "Desktop/Reference.png", body = PNG) {
  const target = join(home, path);
  const segments = path.split("/");
  segments.pop();
  mkdirSync(join(home, ...segments), { recursive: true });
  writeFileSync(target, body);
  return target;
}
const make = (options: Partial<VoiceLocalImagesOptions> = {}) =>
  voiceLocalImages({ home, allowed: () => enabled, ...options });
function expectUnavailable(images: ReturnType<typeof voiceLocalImages>, id: string) {
  try {
    images.image(id);
    throw new Error("Expected access rejection");
  } catch (error) {
    expect(error).toMatchObject({ message: "Image not available.", statusCode: 404 });
    expect(String(error)).not.toContain(home);
  }
}

test("explicit search returns private metadata and only issued IDs can retrieve original bytes", async () => {
  const target = save();
  const images = make();
  expectUnavailable(images, target);
  const result = await images.search("reference");
  expect(result.images).toHaveLength(1);
  expect(result.searchedFolders).toEqual(["Desktop", "Downloads", "Pictures"]);
  expect(result.note).toContain("filenames only");
  expect(result.images[0]).toMatchObject({
    title: "Reference",
    filename: "Reference.png",
    folder: "Desktop",
    mimeType: "image/png",
    size: PNG.length,
  });
  expect(result.images[0].id).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(JSON.stringify(result)).not.toContain(home);
  expect(JSON.stringify(result)).not.toContain("bytes");
  expect(images.image(result.images[0].id)).toEqual({
    bytes: PNG,
    mimeType: "image/png",
    filename: "Reference.png",
  });
  expect(readFileSync(target)).toEqual(PNG);
});

test("matches filename words case-insensitively, without searching image contents or parent names", async () => {
  save("Desktop/Launch Brand HERO.png");
  save("Pictures/Launch/other.png");
  save("Pictures/other.png", Buffer.concat([PNG, Buffer.from("Launch Brand")]));
  const result = await make().search("brand LAUNCH");
  expect(result.images.map((image) => image.filename)).toEqual(["Launch Brand HERO.png"]);
});

test("search accepts verified PNG, JPEG and WebP files, independent of the claimed raster extension", async () => {
  save("Desktop/Reference.png");
  save("Downloads/reference.jpg", JPEG);
  save("Pictures/Reference.webp", WEBP);
  save("Pictures/reference-fake.png", Buffer.from("<svg><script>not a raster</script></svg>"));
  save("Pictures/reference-fake.jpg", Buffer.from("A document pretending to be a photo"));
  save("Pictures/reference.svg", PNG);
  save("Pictures/reference.txt", PNG);
  const images = make();
  const result = await images.search("reference");
  expect(result.images.map((item) => item.mimeType).sort()).toEqual([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  result.images.forEach((image) => expect(images.image(image.id).mimeType).toBe(image.mimeType));
});

test("a disabled source prevents searches and revokes previously issued image access", async () => {
  save();
  const images = make();
  const result = await images.search("reference");
  enabled = false;
  await expect(images.search("reference")).rejects.toMatchObject({ statusCode: 403 });
  expectUnavailable(images, result.images[0].id);
  enabled = true;
  expectUnavailable(images, result.images[0].id);
  expect((await images.search("reference")).images).toHaveLength(1);
});

test("failed permission lookups fail closed without leaking the underlying error", async () => {
  const images = make({
    allowed: () => {
      throw new Error("private lookup failure at " + home);
    },
  });
  await expect(images.search("reference")).rejects.toMatchObject({
    message: "Local image access is disabled.",
    statusCode: 403,
  });
  expectUnavailable(images, "x".repeat(32));
});

test("permission changes during async traversal discard collected results", async () => {
  save();
  let checks = 0;
  const images = make({ allowed: () => ++checks < 4 });
  await expect(images.search("reference")).rejects.toMatchObject({ statusCode: 403 });
});

test("blank queries explicitly browse a bounded sample sorted newest first within sampled files", async () => {
  for (let index = 0; index < 4; index++) {
    const path = save(`Desktop/Visual-${index}.png`);
    const time = new Date(`2026-09-1${index + 1}T12:00:00Z`);
    utimesSync(path, time, time);
  }
  const images = make({ maxResults: 2 });
  for (const query of ["", "  "]) {
    const result = await images.search(query);
    expect(result.images).toHaveLength(2);
    expect(result.images[0].modifiedAt > result.images[1].modifiedAt).toBe(true);
    expect(result.note).toContain("sample of local images, newest first within sampled files");
    expect(result.note).toContain("limit");
    expect(images.image(result.images[0].id).bytes).toEqual(PNG);
  }
  enabled = false;
  await expect(images.search("")).rejects.toMatchObject({ statusCode: 403 });
});

test("path-like and oversized queries do not scan the filesystem", async () => {
  const images = make();
  for (const query of ["../secret", "/Users/me/photo", "..\\photo", "x\0", "a".repeat(161)])
    await expect(images.search(query)).rejects.toMatchObject({ statusCode: 400 });
});

test("path traversal, guessed IDs and IDs issued by a different instance cannot serve files", async () => {
  const target = save();
  const images = make();
  const result = await images.search("reference");
  for (const id of [target, "Reference.png", "../Reference.png", "%2e%2e", "x".repeat(32), ""])
    expectUnavailable(images, id);
  expectUnavailable(make(), result.images[0].id);
});

test("short-lived IDs expire and are replaced by an explicit new search", async () => {
  save();
  let time = 100;
  const images = make({ now: () => time, ttlMs: 20 });
  const result = await images.search("reference");
  time = 119;
  expect(images.image(result.images[0].id).bytes).toEqual(PNG);
  time = 120;
  expectUnavailable(images, result.images[0].id);
  const next = await images.search("reference");
  expect(next.images[0].id).not.toBe(result.images[0].id);
  expect(images.image(next.images[0].id).bytes).toEqual(PNG);
});

test("hidden directories, dependency folders and app bundles are excluded", async () => {
  save();
  for (const folder of [
    ".private",
    ".git",
    ".operator-data",
    "node_modules",
    "Editor.app",
    "Photos.photoslibrary",
  ])
    save(`Desktop/${folder}/Reference.png`);
  save("Desktop/.Reference.png");
  save("Documents/Reference.png");
  const result = await make().search("reference");
  expect(result.images).toHaveLength(1);
  expect(result.images[0].folder).toBe("Desktop");
});

test("linked files, linked folders and hard-linked files never become results", async () => {
  const outside = save("Outside/Reference.png");
  symlinkSync(outside, join(home, "Desktop/Reference-linked.png"));
  symlinkSync(join(home, "Outside"), join(home, "Pictures/Linked"));
  linkSync(outside, join(home, "Downloads/Reference-hardlinked.png"));
  expect((await make().search("reference")).images).toEqual([]);
});

test("a symlinked search root or ancestor is not traversed", async () => {
  save("Outside/Reference.png");
  rmSync(join(home, "Desktop"), { recursive: true });
  symlinkSync(join(home, "Outside"), join(home, "Desktop"));
  expect((await make().search("reference")).images).toEqual([]);
  symlinkSync(home, join(home, "LinkedHome"));
  const images = make({ roots: [{ path: join(home, "LinkedHome/Outside"), label: "Photos" }] });
  expect((await images.search("reference")).images).toEqual([]);
});

test("replacing an image, changing its contents or removing it invalidates its issued ID", async () => {
  const path = save();
  const images = make();
  let result = await images.search("reference");
  writeFileSync(path, Buffer.concat([PNG, Buffer.from("changed")]));
  expectUnavailable(images, result.images[0].id);
  result = await images.search("reference");
  renameSync(path, path + ".old");
  writeFileSync(path, PNG);
  expectUnavailable(images, result.images[0].id);
  result = await images.search("reference");
  rmSync(path);
  expectUnavailable(images, result.images[0].id);
});

test("changing a parent directory into a link revokes previously issued image IDs", async () => {
  save("Desktop/Project/Reference.png");
  save("Outside/Reference.png");
  const images = make();
  const result = await images.search("reference");
  renameSync(join(home, "Desktop/Project"), join(home, "Desktop/Project-old"));
  symlinkSync(join(home, "Outside"), join(home, "Desktop/Project"));
  expectUnavailable(images, result.images[0].id);
});

test("files over 12 MiB are omitted before body reads", async () => {
  const target = save();
  truncateSync(target, 12 * 1024 * 1024 + 1);
  expect((await make().search("reference")).images).toEqual([]);
});

test("results have a hard cap of 30, even when configuration requests more", async () => {
  for (let index = 0; index < 40; index++) save(`Desktop/Reference-${index}.png`);
  const result = await make({ maxResults: 1_000 }).search("reference");
  expect(result.images).toHaveLength(30);
  expect(result.note).toContain("limit");
});

test("visited entries and recursion depth have independent bounded limits", async () => {
  for (let index = 0; index < 5; index++) save(`Desktop/Reference-${index}.png`);
  const boundedResult = await make({
    maxEntries: 2,
    roots: [{ path: join(home, "Desktop"), label: "Desktop" }],
  }).search("reference");
  expect(boundedResult.images).toHaveLength(2);
  expect(boundedResult.note).toContain("limit");
  save("Pictures/Project/Nested/Deep-reference.png");
  save("Pictures/Project/Shallow-reference.png");
  const shallow = await make({ maxDepth: 1 }).search("reference");
  expect(shallow.images.some((image) => image.filename === "Shallow-reference.png")).toBe(true);
  expect(shallow.images.some((image) => image.filename === "Deep-reference.png")).toBe(false);
  expect(shallow.note).toContain("limit");
});

test("large earlier roots cannot consume the budget reserved for a later root", async () => {
  for (let index = 0; index < 100; index++) {
    save(`Desktop/Unrelated-${index}.png`);
    save(`Downloads/Unrelated-${index}.png`);
  }
  save("Pictures/Later-root-match.png");
  const images = make({ maxEntries: 9 });
  const result = await images.search("Later-root-match");
  expect(result.images).toHaveLength(1);
  expect(result.images[0].folder).toBe("Pictures");
  expect(result.searchedFolders).toEqual(["Desktop", "Downloads", "Pictures"]);
  expect(result.note).toContain("limit");
  expect(images.image(result.images[0].id).bytes).toEqual(PNG);
});

test("configured roots and friendly folder labels do not expose absolute paths", async () => {
  save("Custom/Reference.png");
  const images = make({ roots: [{ path: join(home, "Custom"), label: "My references" }] });
  const result = await images.search("reference");
  expect(result.searchedFolders).toEqual(["My references"]);
  expect(result.images[0].folder).toBe("My references");
  expect(JSON.stringify(result)).not.toContain(home);
  expect(images.image(result.images[0].id).bytes).toEqual(PNG);
});

test("missing folders produce an honest generic note with no raw filesystem details", async () => {
  rmSync(join(home, "Downloads"), { recursive: true });
  save();
  const result = await make().search("reference");
  expect(result.images).toHaveLength(1);
  expect(result.searchedFolders).toEqual(["Desktop", "Pictures"]);
  expect(result.note).toContain("unavailable");
  expect(JSON.stringify(result)).not.toContain(home);
});
