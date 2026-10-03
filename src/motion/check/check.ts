#!/usr/bin/env bun
/**
 * Style check: bun run check:motion [style-id ...]
 *
 * Renders every style in headless Chrome and FAILS (exit 1) on:
 *   - a blank frame (flat luminance or almost no colours) at t = 0, 1.25, 2.5, 3.75, 5
 *   - an exception, or a non-finite number reaching the canvas (NaN guard)
 *   - a loop seam: frame 0 and frame 5 differ beyond the threshold
 *   - a non-deterministic frame (same t drawn twice differs)
 *   - Math.random in a style file, or a contract field missing
 * Also renders 9:16 and 1:1 frames, and writes every still as JPEG to
 * outputs/motion-check/<id>/ so a person can look at them.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, type Page } from "../server/cdp";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const STYLES_DIR = resolve(import.meta.dir, "..", "styles");
const OUT = process.env.MOTION_CHECK_OUT || join(ROOT, "outputs", "motion-check");
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));
const W = 960;
const H = 540;
const TIMES = [0, 1.25, 2.5, 3.75, 5];
const LIMITS = { blankStd: 2.5, blankColors: 6, seamMean: 1.0, seamOver: 0.004 };

type Row = { id: string; ok: boolean; notes: string[]; ms: number };
type Meta = {
  id: string;
  name: string;
  look: string;
  move: string;
  rules: number;
  prompt: string;
  theme: Record<string, string | undefined>;
};
type Stats = {
  mean: number;
  std: number;
  colors: number;
  problems: string[];
  error: string | null;
};
type Diff = { mean: number; over: number };

/** A foreign brand for the re-brand pass: warm dark ground, lime, blue, a test logo. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M60 10a50 50 0 1 0 50 50H64V46h32A36 36 0 1 0 60 96" fill="none" stroke="#000" stroke-width="16"/></svg>`;
const BRAND = {
  bg: "#161310",
  ink: "#f0ece2",
  accent: "#bff549",
  accent2: "#6b7ff0",
  font: "Inter",
  name: "Brand",
  logo: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`,
};

function staticChecks(): { ids: string[]; failures: Map<string, string[]> } {
  const failures = new Map<string, string[]>();
  const all = readdirSync(STYLES_DIR).filter((f) => /\.(ts|js)$/.test(f) && f !== "index.ts");
  // Files starting with "_" are shared helpers, not styles: no id or import rule,
  // but they must stay deterministic too.
  const files = all.filter((f) => !f.startsWith("_"));
  for (const helper of all.filter((f) => f.startsWith("_"))) {
    const source = readFileSync(join(STYLES_DIR, helper), "utf8");
    if (/Math\.random\s*\(/.test(source))
      failures.set(helper.replace(/\.(ts|js)$/, ""), ["uses Math.random (use the seeded hash)"]);
  }
  const index = readFileSync(join(STYLES_DIR, "index.ts"), "utf8");
  const ids: string[] = [];
  for (const file of files) {
    const id = file.replace(/\.(ts|js)$/, "");
    ids.push(id);
    const source = readFileSync(join(STYLES_DIR, file), "utf8");
    const notes: string[] = [];
    if (/Math\.random\s*\(/.test(source)) notes.push("uses Math.random (use the seeded hash)");
    if (!new RegExp(`id:\\s*"${id}"`).test(source))
      notes.push(`id must equal the file name "${id}"`);
    if (!index.includes(`./${id}"`)) notes.push("not imported in styles/index.ts");
    if (notes.length) failures.set(id, notes);
  }
  return { ids, failures };
}

async function main() {
  const { ids: fileIds, failures } = staticChecks();
  // Server rendering imports every style with no DOM, so a style must not touch
  // document or a canvas at import time (build textures on first use instead).
  try {
    await import(join(STYLES_DIR, "index.ts"));
  } catch (error) {
    const stack = String((error as Error)?.stack ?? error);
    const id = /styles\/([\w-]+)\.ts/.exec(stack)?.[1] ?? "index";
    failures.set(id, [
      ...(failures.get(id) ?? []),
      `breaks server rendering at import: ${String(error).slice(0, 100)} (build canvases on first use)`,
    ]);
  }
  const bundle = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "..", "render", "frame-page.ts")],
    target: "browser",
    minify: false,
  });
  if (!bundle.success) {
    console.error(bundle.logs.join("\n"));
    process.exit(1);
  }
  const js = await bundle.outputs[0].text();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>motion check</title></head><body style="margin:0;background:#000"><script type="module" src="/frame.js"></script></body></html>`;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/frame.js")
        return new Response(js, { headers: { "Content-Type": "text/javascript" } });
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    },
  });

  const browser = await launchChrome();
  const rows: Row[] = [];
  try {
    const page: Page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`, "window.__ready === true");
    const meta = await page.evaluate<Meta[]>("window.__motion.meta()");
    const registered = meta.map((m) => m.id);
    for (const id of fileIds)
      if (!registered.includes(id) && !failures.has(id)) failures.set(id, ["not in the registry"]);
    const targets = registered.filter((id) => !only.length || only.includes(id));
    mkdirSync(OUT, { recursive: true });

    for (const id of targets) {
      const m = meta.find((x) => x.id === id);
      if (!m) continue;
      const notes: string[] = [...(failures.get(id) || [])];
      let ok = notes.length === 0;
      const fail = (note: string) => {
        ok = false;
        notes.push(note);
      };
      // Contract.
      if (!m.name || !m.look || !m.move) fail("name, look and move are required");
      if (m.rules < 5 || m.rules > 8) fail(`needs 5-8 rules (has ${m.rules})`);
      for (const head of ["R —", "I —", "S —", "E —"])
        if (!m.prompt.includes(head)) fail(`prompt is missing the "${head}" section`);
      for (const key of ["bg", "ink", "accent", "accent2", "font"])
        if (!m.theme?.[key]) fail(`theme.${key} is missing`);

      const dir = join(OUT, id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      await page.evaluate(`window.__motion.setup({ id: ${JSON.stringify(id)}, w: ${W}, h: ${H} })`);
      for (const t of TIMES) {
        const s = await page.evaluate<Stats>(`window.__motion.stats(${t})`);
        if (s.error) fail(`t=${t}: threw ${s.error.split("\n")[0]}`);
        if (s.problems.length) fail(`t=${t}: non-finite value -> ${s.problems[0]}`);
        if (s.std < LIMITS.blankStd || s.colors < LIMITS.blankColors)
          fail(`t=${t}: blank frame (std ${s.std.toFixed(2)}, colours ${s.colors})`);
        const jpg = await page.evaluate<string>(`window.__motion.frame(${t}, 0.9)`);
        writeFileSync(join(dir, `t${t.toFixed(2)}.jpg`), Buffer.from(jpg, "base64"));
      }
      const seam = await page.evaluate<Diff>("window.__motion.diff(0, 5)");
      if (seam.mean > LIMITS.seamMean || seam.over > LIMITS.seamOver)
        fail(
          `loop seam: t=0 vs t=5 differ (mean ${seam.mean.toFixed(2)}, ${(seam.over * 100).toFixed(2)}% pixels)`,
        );
      await page.evaluate("window.__motion.stats(3.3)");
      const same = await page.evaluate<Diff>("window.__motion.diff(1.7, 1.7)");
      if (same.mean > 0.01)
        fail(`not deterministic: t=1.7 drawn twice differs (mean ${same.mean.toFixed(3)})`);
      let ms = 0;
      for (const t of [0.4, 2.2, 4.1])
        ms += await page.evaluate<number>(`window.__motion.cost(${t})`);
      ms /= 3;

      for (const [label, w, h] of [
        ["9x16", 540, 960],
        ["1x1", 720, 720],
      ] as const) {
        await page.evaluate(
          `window.__motion.setup({ id: ${JSON.stringify(id)}, w: ${w}, h: ${h} })`,
        );
        for (const t of [1.25, 2.5]) {
          const s = await page.evaluate<Stats>(`window.__motion.stats(${t})`);
          if (s.error) fail(`${label} t=${t}: threw ${s.error.split("\n")[0]}`);
          if (s.problems.length) fail(`${label} t=${t}: non-finite value -> ${s.problems[0]}`);
          if (s.std < LIMITS.blankStd || s.colors < LIMITS.blankColors)
            fail(`${label} t=${t}: blank frame (std ${s.std.toFixed(2)})`);
        }
        const jpg = await page.evaluate<string>("window.__motion.frame(2.5, 0.9)");
        writeFileSync(join(dir, `${label}-t2.50.jpg`), Buffer.from(jpg, "base64"));
      }
      // Re-brand: every style must still draw with a foreign theme, font and logo.
      await page.evaluate(
        `window.__motion.setup(${JSON.stringify({ id, theme: BRAND, w: W, h: H })})`,
      );
      for (const t of [1.25, 3.75]) {
        const s = await page.evaluate<Stats>(`window.__motion.stats(${t})`);
        if (s.error) fail(`branded t=${t}: threw ${s.error.split("\n")[0]}`);
        if (s.problems.length) fail(`branded t=${t}: non-finite value -> ${s.problems[0]}`);
        if (s.std < LIMITS.blankStd || s.colors < LIMITS.blankColors)
          fail(`branded t=${t}: blank frame (std ${s.std.toFixed(2)})`);
      }
      const brandJpg = await page.evaluate<string>("window.__motion.frame(2.5, 0.9)");
      writeFileSync(join(dir, "brand-t2.50.jpg"), Buffer.from(brandJpg, "base64"));
      rows.push({ id, ok, notes, ms });
      console.log(
        `${ok ? "PASS" : "FAIL"}  ${id.padEnd(20)} ${ms.toFixed(1).padStart(6)} ms/frame @960x540${notes.length ? "\n      " + notes.join("\n      ") : ""}`,
      );
    }
    for (const [id, notes] of failures)
      if (!targets.includes(id) && (!only.length || only.includes(id))) {
        rows.push({ id, ok: false, notes, ms: 0 });
        console.log(`FAIL  ${id}\n      ${notes.join("\n      ")}`);
      }
  } finally {
    await browser.close();
    server.stop(true);
  }
  writeFileSync(
    join(OUT, "report.json"),
    JSON.stringify({ at: new Date().toISOString(), limits: LIMITS, rows }, null, 2),
  );
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} styles pass. Stills: ${OUT}`);
  if (failed.length || !rows.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
