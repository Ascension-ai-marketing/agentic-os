import { afterEach, expect, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPhotoIndex, type PhotoIndexModel, type PhotoIndexOptions } from "./photo-index";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0S8AAAAASUVORK5CYII=",
  "base64",
);
const LOCAL: PhotoIndexModel = {
  id: "ollama:fixture-vision",
  name: "Local fixture",
  location: "local",
  perImageUsd: 0,
};
const REMOTE: PhotoIndexModel = {
  id: "google/gemini-2.5-flash-lite",
  name: "Remote fixture",
  location: "remote",
  perImageUsd: 0.002,
};
const fixtures: Array<{ root: string; index: ReturnType<typeof createPhotoIndex> }> = [];
function fixture(overrides: Partial<PhotoIndexOptions> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "photo-index-"))),
    home = join(root, "home"),
    folder = join(home, "Pictures");
  mkdirSync(folder, { recursive: true });
  const imported: Parameters<PhotoIndexOptions["importSource"]>[0][] = [],
    calls: string[] = [];
  const options: PhotoIndexOptions = {
    root,
    home,
    validCollection: (value) => value === "personal",
    importSource: (input) => {
      imported.push(input);
    },
    models: async () => [LOCAL, REMOTE],
    prepareImage: async (bytes) => ({ bytes, mime: "image/png" }),
    describe: async (model) => {
      calls.push(model.id);
      return {
        text: "A burger with lettuce and cheese on a white plate, beside a glass of water.",
      };
    },
    ...overrides,
  };
  const index = createPhotoIndex(options);
  fixtures.push({ root, index });
  const image = (name: string, suffix = "") => {
    const path = join(folder, name);
    writeFileSync(path, Buffer.concat([PNG, Buffer.from(suffix)]));
    return path;
  };
  const start = async (previewId: string, rest: object = {}) =>
    index.start({
      previewId,
      modelId: LOCAL.id,
      collection: "personal",
      limit: 50,
      consent: true,
      ...rest,
    });
  return { root, home, folder, index, options, image, calls, imported, start };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for photo job");
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.index.close();
    await until(() => fixture.index.idle());
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("preview reads metadata only, excludes links, hidden files and photo-library packages", async () => {
  const f = fixture();
  f.image("IMG_4712.png");
  f.image(".private.png");
  symlinkSync(join(f.folder, "IMG_4712.png"), join(f.folder, "linked.png"));
  const hard = f.image("hard.png", "two");
  linkSync(hard, join(f.folder, "hard-copy.png"));
  mkdirSync(join(f.folder, "Private.photoslibrary"));
  writeFileSync(join(f.folder, "Private.photoslibrary", "original.png"), PNG);
  const preview = await f.index.preview({ folders: [f.folder] });
  expect(preview.count).toBe(1);
  expect(preview.samples).toEqual(["IMG_4712.png"]);
  expect(f.calls).toHaveLength(0);
  expect(f.imported).toHaveLength(0);
  await expect(f.index.preview({ folders: [f.home] })).rejects.toThrow("visible photo folder");
  await expect(f.index.preview({ folders: [f.root] })).rejects.toThrow("visible photo folder");
  await expect(
    f.index.start({ previewId: preview.id, modelId: LOCAL.id, collection: "personal", limit: 1 }),
  ).rejects.toThrow("confirm indexing");
  expect(f.calls).toHaveLength(0);
});

test("visual descriptions become persisted searchable memory, deduplicated independently of filename", async () => {
  const f = fixture();
  f.image("IMG_4712.png");
  f.image("totally-different-name.png");
  const preview = await f.index.preview({ folders: [f.folder] });
  await f.start(preview.id);
  await until(f.index.idle);
  expect(f.calls).toHaveLength(1);
  expect(f.imported).toHaveLength(1);
  expect(f.imported[0].text).toContain("burger");
  expect(f.imported[0].text).toContain("AI visual description");
  expect(f.imported[0].extraction).toBe("local-vision");
  expect(f.imported[0].collection).toBe("personal");
  expect(f.imported[0].image.original).toBe("photo-index");
  expect(
    readFileSync(join(f.root, ".operator-data", "uploads", f.imported[0].id + ".image")),
  ).toEqual(PNG);
  const status = await f.index.status();
  expect(status.jobs[0].done).toBe(1);
  expect(status.jobs[0].skipped).toBe(1);
  expect(statSync(join(f.root, ".operator-data/photo-index/state.json")).mode & 0o777).toBe(0o600);
  const again = await f.index.preview({ folders: [f.folder] });
  await f.start(again.id);
  await until(f.index.idle);
  expect(f.calls).toHaveLength(1);
});

test("cloud jobs require their own opt-in and stop before the next request exceeds the allowance", async () => {
  const f = fixture();
  f.image("one.png");
  f.image("two.png", "unique");
  const preview = await f.index.preview({ folders: [f.folder] });
  await expect(f.start(preview.id, { modelId: REMOTE.id, budgetUsd: 0.002 })).rejects.toThrow(
    "sending these photos",
  );
  expect(f.calls).toHaveLength(0);
  await f.start(preview.id, { modelId: REMOTE.id, budgetUsd: 0.002, remoteConsent: true });
  await until(f.index.idle);
  const job = (await f.index.status()).jobs[0];
  expect(f.calls).toEqual([REMOTE.id]);
  expect(job.status).toBe("paused");
  expect(job.done).toBe(1);
  expect(job.reservedUsd).toBe(0.002);
  expect(f.imported[0].extraction).toBe("cloud-vision");
  await expect(f.index.control(job.id, "resume")).rejects.toThrow("reached its budget");
});

test("modified files and new symlinks after preview never reach a vision model", async () => {
  const f = fixture(),
    changed = f.image("changed.png"),
    replaced = f.image("replace.png", "two");
  const preview = await f.index.preview({ folders: [f.folder] });
  writeFileSync(changed, Buffer.concat([PNG, Buffer.from("changed")]));
  rmSync(replaced);
  symlinkSync(changed, replaced);
  await f.start(preview.id);
  await until(f.index.idle);
  const job = (await f.index.status()).jobs[0];
  expect(job.failed).toBe(2);
  expect(job.message).toContain("finished with errors");
  expect(f.calls).toHaveLength(0);
  expect(f.imported).toHaveLength(0);
});

test("paused jobs resume after reopening, without repeating a completed description", async () => {
  let release!: () => void,
    entered = false,
    count = 0;
  const block = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture({
    describe: async () => {
      count++;
      if (count === 1) {
        entered = true;
        await block;
      }
      return { text: "A burger on a plate next to a glass of water." };
    },
  });
  f.image("first.png");
  f.image("second.png", "second");
  const preview = await f.index.preview({ folders: [f.folder] });
  const started = await f.start(preview.id);
  await until(() => entered);
  await f.index.control(started.id, "pause");
  release();
  await until(f.index.idle);
  expect((await f.index.status()).jobs[0].done).toBe(1);
  f.index.close();
  const reopened = createPhotoIndex(f.options);
  fixtures.push({ root: f.root + "-unused", index: reopened });
  expect((await reopened.status()).jobs[0].status).toBe("paused");
  expect(count).toBe(1);
  await reopened.control(started.id, "resume");
  await until(reopened.idle);
  expect(count).toBe(2);
  expect((await reopened.status()).jobs[0].done).toBe(2);
  reopened.close();
});

test("uploaded images stay staged until consent and keep their original display filename", async () => {
  const f = fixture();
  await expect(
    f.index.upload({ filename: "bad.png", base64: Buffer.from("not image").toString("base64") }),
  ).rejects.toThrow("valid image");
  const saved = await f.index.upload({ filename: "Holiday.png", base64: PNG.toString("base64") });
  const preview = await f.index.preview({ uploadIds: [saved.id] });
  expect(preview.samples).toEqual(["Holiday.png"]);
  expect(f.calls).toHaveLength(0);
  await f.start(preview.id);
  await until(f.index.idle);
  expect(f.imported[0].filename).toBe("Holiday.png");
  expect(f.imported[0].title).toBe("Holiday.png");
});

test("an unconfigured home does not prevent the workspace from opening", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "photo-index-home-")));
  const index = createPhotoIndex({
    root,
    home: join(root, "not-created"),
    validCollection: () => true,
    importSource: () => {},
    models: async () => [],
  });
  fixtures.push({ root, index });
  const status = await index.status();
  expect(status.presets).toEqual([]);
  expect(status.jobs).toEqual([]);
  expect(status.models).toEqual([]);
});

test("restart never resends a request whose previous outcome was uncertain", async () => {
  const f = fixture();
  f.image("one.png");
  f.image("two.png", "two");
  const preview = await f.index.preview({ folders: [f.folder] });
  const first = await f.start(preview.id, {
    modelId: REMOTE.id,
    remoteConsent: true,
    budgetUsd: 0.002,
  });
  await until(f.index.idle);
  f.index.close();
  const path = join(f.root, ".operator-data/photo-index/state.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.jobs[0].status = "running";
  manifest.jobs[0].items[1].status = "processing";
  manifest.jobs[0].reservedUsd = 0.004;
  writeFileSync(path, JSON.stringify(manifest));
  const resumed = createPhotoIndex(f.options);
  fixtures.push({ root: f.root + "-unused", index: resumed });
  const job = (await resumed.status()).jobs[0];
  expect(job.id).toBe(first.id);
  expect(job.status).toBe("paused");
  expect(job.failed).toBe(1);
  expect(job.errors[0].message).toContain("not sent again");
  expect(job.reservedUsd).toBe(0.004);
  expect(f.calls).toHaveLength(1);
  resumed.close();
});

test("closing a queued job preserves it without starting a vision call", async () => {
  const f = fixture();
  f.image("queued.png");
  const preview = await f.index.preview({ folders: [f.folder] });
  await f.start(preview.id);
  f.index.close();
  await until(f.index.idle);
  expect((await f.index.status()).jobs[0].status).toBe("paused");
  expect(f.calls).toHaveLength(0);
});

test.skipIf(process.platform !== "darwin")(
  "production resizing sends a bounded JPEG copy and keeps the original",
  async () => {
    let sent: Buffer | undefined;
    const f = fixture({
      prepareImage: undefined,
      describe: async (_model, image, mime) => {
        expect(mime).toBe("image/jpeg");
        sent = image;
        return { text: "A small fixture image used to validate the local resize pipeline." };
      },
    });
    f.image("original.png");
    const preview = await f.index.preview({ folders: [f.folder] });
    await f.start(preview.id);
    await until(f.index.idle);
    expect(sent?.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(f.imported).toHaveLength(1);
    expect(f.imported[0].image?.mimeType).toBe("image/png");
  },
);
