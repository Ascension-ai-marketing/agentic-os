import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryPhotos, readMemoryPhoto, saveMemoryPhoto } from "./memory-photos";
import { operatorPlugin } from "./operator-plugin";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0S8AAAAASUVORK5CYII=",
  "base64",
);
const fixtures: Array<{ root: string; server?: Server; stop?: () => void }> = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-photo-test-")),
    home = join(root, "home"),
    design = join(home, ".claude-os/design"),
    desktop = join(home, "Desktop");
  mkdirSync(design, { recursive: true });
  mkdirSync(desktop, { recursive: true });
  const holder = { root } as (typeof fixtures)[number];
  fixtures.push(holder);
  const entries: any[] = [];
  const saveIndex = () =>
    writeFileSync(
      join(design, "index.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  const image = (name: string, data: Record<string, unknown> = {}) => {
    const path = join(desktop, name);
    writeFileSync(path, PNG);
    const entry = {
      path,
      desc: "",
      text: "Invoice reference BLUE-JUNE-42",
      ocr: "apple-vision",
      model: "apple-vision-ocr",
      mtimeMs: statSync(path).mtimeMs,
      ts: Date.now(),
      ...data,
    };
    entries.push(entry);
    saveIndex();
    return entry;
  };
  return {
    root,
    home,
    design,
    desktop,
    holder,
    entries,
    saveIndex,
    image,
    photos: memoryPhotos(root, home),
  };
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.stop?.();
    if (f.server) await new Promise<void>((done) => f.server!.close(() => done()));
    rmSync(f.root, { recursive: true, force: true });
  }
});
async function api() {
  const fixtureData = fixture();
  let handler: any;
  const plugin = operatorPlugin({
    root: fixtureData.root,
    memoryHome: fixtureData.home,
    token: "photo-fixture",
  });
  (plugin.configureServer as any)({
    middlewares: {
      use(_path: string, fn: any) {
        handler = fn;
      },
    },
  });
  const server = createServer((req, res) => handler(req, res, () => res.end()));
  fixtureData.holder.server = server;
  fixtureData.holder.stop = () => (plugin.closeBundle as any)?.();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = async (path: string, body?: any) => {
    const response = await fetch(
      base + path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Claude-OS-Token": "photo-fixture" },
            body: JSON.stringify(body),
          },
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  return { ...fixtureData, base, request };
}

test("Design catalog distinguishes existing OCR and vision, paginates and searches without importing", () => {
  const f = fixture();
  f.image("receipt.png");
  f.image("mountain.png", { desc: "A purple mountain at sunset", text: "", tags: ["mountain"] });
  const page = f.photos.catalog("", 0, 1);
  expect(page.availableDesign).toBe(2);
  expect(page.indexedText).toBe(1);
  expect(page.indexedVision).toBe(1);
  expect(page.nextOffset).toBe(1);
  const found = f.photos.catalog("purple").images;
  expect(found).toHaveLength(1);
  expect(found[0].extraction).toBe("design-vision");
  expect(found[0].id).toMatch(/^[a-f0-9]{64}$/);
  expect(f.photos.catalog("BLUE-JUNE-42").images[0].extraction).toBe("local-ocr");
  expect(() => f.photos.selected(["not-in-index"])).toThrow();
});

test("changed and escaping photos stay out; empty OCR stays visible but cannot pretend to be indexed", () => {
  const f = fixture();
  const changed = f.image("changed.png");
  changed.mtimeMs -= 10000;
  f.image("empty.png", { text: "" });
  const outside = join(f.home, "outside.png");
  writeFileSync(outside, PNG);
  symlinkSync(outside, join(f.desktop, "escape.png"));
  f.entries.push(
    { path: outside, desc: "Unrelated indexed file" },
    { path: join(f.desktop, "escape.png"), desc: "Linked outside" },
  );
  f.saveIndex();
  const catalog = f.photos.catalog();
  expect(catalog.images).toHaveLength(1);
  expect(catalog.unavailable).toBe(3);
  expect(catalog.images[0].indexed).toBe(false);
  expect(catalog.images[0].extraction).toBeUndefined();
  expect(() => f.photos.selected([catalog.images[0].id])).toThrow("no readable text");
  expect(f.photos.image(catalog.images[0].id).bytes).toEqual(PNG);
});

test("selected Design import persists original, deduplicates, retrieves evidence and respects trash and source gates", async () => {
  const f = await api();
  const entry = f.image("receipt.png");
  const selected = (await f.request("/memory/photos")).data.images[0];
  expect(
    (
      await f.request("/memory/photos/import", {
        ids: [selected.id, "unknown"],
        collection: "business",
      })
    ).status,
  ).toBe(400);
  expect((await f.request("/state")).data.sources).toHaveLength(0);
  const imported = await f.request("/memory/photos/import", {
    ids: [selected.id],
    collection: "business",
  });
  expect(imported.status).toBe(200);
  expect(imported.data.added).toBe(1);
  const source = imported.data.sources[0];
  expect(source.origin).toBe("images");
  expect(source.extraction).toBe("local-ocr");
  expect(source.text).toContain("scene has not been visually described");
  expect(source.image.url).toBe(`/__operator/memory/photos/${source.id}/image`);
  expect(statSync(join(f.root, ".operator-data/uploads", source.id + ".image")).mode & 0o777).toBe(
    0o600,
  );
  expect(
    (await f.request("/memory/photos/import", { ids: [selected.id], collection: "business" })).data
      .unchanged,
  ).toBe(1);
  const result = (await f.request("/search?q=BLUE-JUNE-42")).data.results[0];
  expect(result.imageUrl).toBe(source.image.url);
  expect(result.extraction).toBe("local-ocr");
  const recalled = await f.request("/voice/memory/read", { id: source.id, query: "BLUE-JUNE-42" });
  expect(recalled.status).toBe(200);
  expect(recalled.data.hasImage).toBe(true);
  expect(recalled.data.text).toContain("BLUE-JUNE-42");
  const original = await fetch(f.base + `/memory/photos/${source.id}/image`);
  expect(original.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await original.arrayBuffer())).toEqual(PNG);
  await f.request(`/memory/${source.id}`, { action: "trash" });
  expect(
    (await f.request("/memory/photos/import", { ids: [selected.id], collection: "business" })).data
      .skipped,
  ).toBe(1);
  expect((await fetch(f.base + `/memory/photos/${source.id}/image`)).status).toBe(404);
  await f.request(`/memory/${source.id}`, { action: "restore" });
  await f.request("/brain/sources", { id: "images", enabled: false });
  expect((await f.request("/search?q=BLUE-JUNE-42")).data.results).toHaveLength(0);
  expect((await fetch(f.base + `/memory/photos/${source.id}/image`)).status).toBe(404);
  await f.request("/brain/sources", { id: "images", enabled: true });
  rmSync(entry.path);
  expect(
    Buffer.from(await (await fetch(f.base + `/memory/photos/${source.id}/image`)).arrayBuffer()),
  ).toEqual(PNG);
});

test("an uploaded photo remains displayable when OCR cannot produce indexed text", async () => {
  const f = await api();
  const added = await f.request("/memory", {
    filename: "no-text.png",
    base64: PNG.toString("base64"),
    origin: "images",
    collection: "personal",
  });
  expect(added.status).toBe(201);
  let source: any;
  for (let attempt = 0; attempt < 30; attempt++) {
    source = (await f.request(`/memory/${added.data.source.id}`)).data.source;
    if (source.status !== "indexing") break;
    await new Promise((done) => setTimeout(done, 10));
  }
  expect(source.status).toBe("error");
  expect(source.image.original).toBe("upload");
  expect(source.text).toBe("");
  const response = await fetch(f.base + `/memory/photos/${source.id}/image`);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  expect((await f.request("/search?q=no-text")).data.results).toHaveLength(0);
});

test("photo persistence rejects active formats and linked destination folders", async () => {
  const f = fixture();
  expect(() =>
    saveMemoryPhoto(f.root, "image1", Buffer.from('<svg onload="alert(1)"></svg>'), "upload"),
  ).toThrow("Use a PNG");
  mkdirSync(join(f.root, ".operator-data"), { recursive: true });
  symlinkSync(f.desktop, join(f.root, ".operator-data/uploads"));
  expect(() => saveMemoryPhoto(f.root, "image1", PNG, "upload")).toThrow("linked");
  await expect(readMemoryPhoto(f.root, "../../outside", false)).rejects.toThrow();
});
