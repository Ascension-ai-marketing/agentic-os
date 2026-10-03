import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReelsService, validateReelSections, reelsReferenceDir, REELS_OPUS } from "./jev-reels";
import { safeReelSvg } from "./jev-reels-render";
// Keep the suite hermetic: never pick up the real example reel on this Mac.
process.env.JEV_REELS_REFERENCE_DIR = join(tmpdir(), "jev-reels-no-reference");
const roots: string[] = []; afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const root = () => { const r = mkdtempSync(join(tmpdir(), "jev-reels-")); roots.push(r); return r; };
const svg = '<svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#112233"/><text x="60" y="200">Synthetic</text></svg>';
test("generated art allows only declarative, local SVG", () => {
  expect(safeReelSvg(svg)).toContain("Synthetic");
  expect(safeReelSvg(svg, 960)).toContain('viewBox="0 0 1080 960"');
  for (const attack of ['<script>alert(1)</script>', '<foreignObject>bad</foreignObject>', '<image href="file:///private/data"/>', '<rect onload="alert(1)"/>', '<rect fill="url(https://example.test)"/>', '<style>body{display:none}</style>']) expect(() => safeReelSvg(`<svg>${attack}</svg>`)).toThrow();
});
test("section plans must cover the video continuously with real timing", () => {
  const section = { name: "One", words: "Synthetic words", image: "A circle", t0: 0, t1: 2 };
  expect(validateReelSections([section], 2)[0].id).toBe("s1");
  expect(() => validateReelSections([{ ...section, t0: 0.5 }], 2)).toThrow();
  expect(() => validateReelSections([section], 4)).toThrow();
  expect(() => validateReelSections([{ ...section, t1: -1 }], 2)).toThrow();
});
test("paid work requires a reviewed build request and uses catalog pricing", () => {
  const r = root(), id = "11111111-1111-4111-8111-111111111111", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 12, state: "uploaded", layout: "full", sections: [], outputs: {} }));
  const reels = createReelsService(r); const q = reels.quote(id);
  expect(q.model).toBe(REELS_OPUS); expect(q.opusUsd).toBeGreaterThan(0); expect(q.transcriptionUsd).toBe(0); expect(q.estimated).toBe(true);
  expect(() => reels.start(id, {})).toThrow("Review the estimate");
});
test("media paths cannot escape a project or serve arbitrary private files", () => {
  const r = root(), id = "11111111-1111-4111-8111-111111111111", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true }); writeFileSync(join(r, "secret"), "private"); symlinkSync(join(r, "secret"), join(dir, "reel-A.mp4"));
  const reels = createReelsService(r); expect(() => reels.media(id, "../secret")).toThrow(); expect(() => reels.media(id, "reel-A.mp4")).toThrow("path");
});
test("upload rejects arbitrary content without starting an agent", async () => {
  await expect(createReelsService(root()).upload(Buffer.from("not a movie"), "test.mp4")).rejects.toThrow("Choose an MP4");
});

test("history survives restarts and preserves section choices", () => {
  const r = root(), id = "22222222-2222-4222-8222-222222222222", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  const section = { id: "s1", name: "First", words: "Synthetic", image: "A circle", t0: 0, t1: 2, clips: { A: "s1-A-preview.mp4", B: "s1-B-preview.mp4" } };
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "ready", layout: "full", sections: [section], outputs: {}, createdAt: "2026-09-28T00:00:00Z" }));
  const reels = createReelsService(r);
  expect(reels.list()[0].sectionCount).toBe(1); expect(reels.get(id).state).toBe("ready");
  reels.update(id, { selectedSectionIds: ["s1"], ideas: { s1: "A better circle" }, picks: { s1: "B" } });
  const saved = createReelsService(r).get(id); expect(saved.picks).toEqual({ s1: "B" }); expect(saved.sections[0].image).toBe("A better circle");
  expect(reels.quote(id).buildUsd).toBeGreaterThan(0); expect(reels.list()[0]).not.toHaveProperty("sections");
  expect(() => reels.update(id, { picks: { s1: "C" } })).toThrow("available style");
  expect(() => reels.update(id, { selectedSectionIds: ["not-a-section"] })).toThrow("selection");
});

test("preparation and rendering have separate consent gates and reject an empty selection", () => {
  const r = root(), id = "33333333-3333-4333-8333-333333333333", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "ready", layout: "full", sections: [{ id: "s1", t0: 0, t1: 2, name: "First", words: "Synthetic", image: "A circle" }], selectedSectionIds: [], outputs: {} }));
  const reels = createReelsService(r);
  expect(() => reels.prepare(id, {})).toThrow("Review the estimate");
  expect(() => reels.start(id, {})).toThrow("Review the estimate");
  expect(() => reels.start(id, { confirmed: true, opusBudgetUsd: 1 })).toThrow("at least one prepared section");
  expect(reels.get(id).state).toBe("ready");
});

import { createReelStyleLibrary, randomReelStyle, validateReelStyle } from "./jev-reel-styles";
import { defaultReelStyles } from "../src/lib/reel-styles";
import { speechRanges } from "./jev-reels-cut";
test("saved custom styles survive restart and reject malformed input", () => {
  const r = root(); const library = createReelStyleLibrary(r);
  const s = library.save({ ...defaultReelStyles().A, name: "My look", brief: "Large blue diagrams on cream." });
  expect(createReelStyleLibrary(r).list()).toEqual([s]);
  expect(library.save(s).id).toBe(s.id);
  expect(() => validateReelStyle({ ...s, colors: ["red", "url(secret)", "#ffffff"] })).toThrow();
  expect(() => validateReelStyle({ ...s, brief: "a".repeat(1201) })).toThrow();
});
test("random styles mix independent dimensions and keep a replayable brief", () => {
  const choices = Array.from({ length: 40 }, randomReelStyle);
  expect(new Set(choices.map(s => s.id)).size).toBe(40);
  expect(new Set(choices.map(s => s.brief.split(". Variation seed")[0])).size).toBeGreaterThan(30);
  for (const s of choices) { expect(s.brief).toContain(s.seed!); expect(validateReelStyle(s)).toEqual(s); }
});
test("pause cutting preserves speech padding and uses the same ranges for video and audio", () => {
  expect(speechRanges("silence_start: 2\nsilence_end: 4", 6)).toEqual([[0, 2.15], [3.85, 6]]);
  expect(speechRanges("silence_start: 2\nsilence_end: 2.3", 6)).toEqual([[0, 6]]);
  expect(speechRanges("", 6)).toEqual([[0, 6]]);
  expect(speechRanges("silence_start: 0\nsilence_end: 6", 6)).toEqual([[0, 0.15], [5.85, 6]]);
});
test("project options and chosen styles persist before paid preparation", () => {
  const r = root(), id = "44444444-4444-4444-8444-444444444444", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "uploaded", layout: "full", sections: [], outputs: {} }));
  const reels = createReelsService(r), styles = defaultReelStyles(); styles.A.brief = "An original custom style";
  reels.update(id, { styles, styleMode: "random", autoCut: true, audioProcessing: "none", layout: "top", includeSfx: false });
  const p = createReelsService(r).get(id);
  expect(p.styles?.A.brief).toBe(styles.A.brief); expect(p.styleMode).toBe("random"); expect(p.autoCut).toBe(true); expect(p.layout).toBe("top"); expect(p.state).toBe("uploaded");
});

test("a style prompt survives restart and replaces legacy presets in all three versions", () => {
  const r = root(), id = "55555555-5555-4555-8555-555555555555", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "uploaded", layout: "full", sections: [], outputs: {}, styles: defaultReelStyles(), styleMode: "random" }));
  const prompt = "Warm paper textures, bold black type and orange cut-out illustrations.";
  createReelsService(r).update(id, { stylePrompt: `  ${prompt}  ` });
  const saved = createReelsService(r).get(id);
  expect(saved.stylePrompt).toBe(prompt); expect(saved.styleMode).toBe("selected"); expect(saved.state).toBe("uploaded");
  expect(Object.values(saved.styles!).map(s => s.brief)).toEqual([prompt, prompt, prompt]);
  expect(Object.values(saved.styles!).map(s => s.name)).toEqual(["Version 1", "Version 2", "Version 3"]);
  expect(saved.outputs).toEqual({});
});

test("prompt validation preserves the existing project on failure and allows an empty direction", () => {
  const r = root(), id = "66666666-6666-4666-8666-666666666666", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "ready", layout: "full", sections: [], outputs: {} }));
  const reels = createReelsService(r);
  reels.update(id, { stylePrompt: "Keep this direction" });
  expect(() => reels.update(id, { stylePrompt: "a".repeat(1201) })).toThrow("1200 characters");
  expect(() => reels.update(id, { stylePrompt: 123 as unknown as string })).toThrow("1200 characters");
  expect(reels.get(id).stylePrompt).toBe("Keep this direction");
  expect(reels.update(id, { stylePrompt: "a".repeat(1200) }).stylePrompt?.length).toBe(1200);
  const empty = reels.update(id, { stylePrompt: "   " });
  expect(empty.stylePrompt).toBe(""); expect(empty.styles?.A.brief).toContain("spoken content");
});

test("completed reels retain their original style direction", () => {
  const r = root(), id = "77777777-7777-4777-8777-777777777777", dir = join(r, ".operator-data/reels", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, name: "synthetic.mp4", duration: 2, state: "done", stylePrompt: "Original", layout: "full", sections: [], outputs: {} }));
  const reels = createReelsService(r);
  expect(() => reels.update(id, { stylePrompt: "Changed" })).toThrow("already built");
  expect(reels.get(id).stylePrompt).toBe("Original");
});

test("the example reel folder falls back to the Claude Credits Graphics site", () => {
  const home = root(), site = join(home, "Desktop/claude-credits-graphics/site"); mkdirSync(site, { recursive: true }); writeFileSync(join(site, "index.html"), "<html></html>");
  expect(reelsReferenceDir({}, home)).toBe(site);
  const refs = join(home, "Desktop/jev-os-build/refs/reels-reference"); mkdirSync(refs, { recursive: true }); writeFileSync(join(refs, "index.html"), "<html></html>");
  expect(reelsReferenceDir({}, home)).toBe(refs);
  expect(reelsReferenceDir({ JEV_REELS_REFERENCE_DIR: "/custom" }, home)).toBe("/custom");
});
test("the example reel is listed first, opens, takes picks in memory and never exports", () => {
  const r = root(), ref = join(r, "ref"); mkdirSync(join(ref, "media/full"), { recursive: true });
  const sections = [{ id: "s1", name: "Hook", t0: 0, t1: 2, words: "Synthetic words", image: "A card" }, { id: "s2", name: "Close", t0: 2, t1: 5, words: "More words", image: "A line" }];
  writeFileSync(join(ref, "index.html"), `<script type="application/json" id="data">${JSON.stringify({ sections })}</script>`);
  mkdirSync(join(ref, "media/top"), { recursive: true });
  for (const f of ["A", "B", "C"]) { writeFileSync(join(ref, "media", `reel-${f}.mp4`), "x"); for (const s of sections) { writeFileSync(join(ref, "media/full", `${s.id}-${f}.mp4`), "x"); writeFileSync(join(ref, "media/top", `${s.id}-${f}.mp4`), "xy"); } }
  writeFileSync(join(ref, "media/top", "s1-A2.mp4"), "xyz");
  const saved = process.env.JEV_REELS_REFERENCE_DIR; process.env.JEV_REELS_REFERENCE_DIR = ref;
  try {
    const reels = createReelsService(r); const listed = reels.list();
    expect(listed[0].id).toBe("demo"); expect(listed[0].name).toBe("Claude Credits Graphics"); expect(listed[0].sectionCount).toBe(2); expect(Object.keys(listed[0].outputs)).toEqual(["A", "B", "C"]);
    const opened = reels.get("demo"); expect(opened.state).toBe("done"); expect(opened.sections[1].clips?.C).toBe("full/s2-C.mp4"); expect(opened.picks).toEqual({ s1: "A", s2: "A" });
    expect(reels.update("demo", { picks: { s1: "B", s2: "C" } }).picks).toEqual({ s1: "B", s2: "C" });
    expect(() => reels.update("demo", { picks: { s9: "A" } as never })).toThrow("Choose an available style");
    expect(() => reels.exportPicks("demo")).toThrow("read only");
    expect(reels.media("demo", "reel-A.mp4").bytes).toBe(1);
    expect(opened.sections[0].variants?.map(v => v.key)).toEqual(["A", "A2", "B", "C"]);
    expect(opened.sections[0].variants?.[1]).toEqual({ key: "A2", family: "A", top: "top/s1-A2.mp4" });
    expect(reels.media("demo", "top/s1-A2.mp4").bytes).toBe(3);
    expect(() => reels.media("demo", "top/s1-A22.mp4")).toThrow("Invalid reel media");
  } finally { process.env.JEV_REELS_REFERENCE_DIR = saved; }
});
