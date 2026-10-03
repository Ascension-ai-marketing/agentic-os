import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReelsAudio } from "./jev-reels-audio";
import { suggestSectionSfx, enabledEffects, SFX_NAMES } from "../src/lib/reel-sfx";
import { reelEffects } from "../src/lib/jev-reels";
const roots: string[] = []; afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const sections = [
  { id: "s1", name: "Hook: free credits", t0: 0, t1: 4.36, words: "Claude is handing out free credits right now, up to $250,", image: "" },
  { id: "s4", name: "Claim by 7 October", t0: 13.28, t1: 16.02, words: "but only if you claim by October the 7th.", image: "" },
];
test("every section gets three or four effect options from the allowed library, top one on", () => {
  expect(SFX_NAMES.every(n => (reelEffects as readonly string[]).includes(n))).toBe(true);
  const s = sections.map((x, i) => suggestSectionSfx(x, i, 7));
  expect(s[0].options[0]).toMatchObject({ effect: "impact", on: true });
  expect(s[1].options[0].effect).toBe("clock-tick");
  for (const x of s) { expect(x.options.length).toBeGreaterThanOrEqual(3); expect(x.options.length).toBeLessThanOrEqual(4); expect(x.options.filter(o => o.on)).toHaveLength(1); expect(x.sample).toBe(true); expect(x.options.reduce((n, o) => n + o.p, 0)).toBeCloseTo(1, 6); }
  expect(enabledEffects(s)).toEqual([{ sectionId: "s1", effect: "impact", at: 0 }, { sectionId: "s4", effect: "clock-tick", at: 13.28 }]);
  expect(enabledEffects(s, { "s1:impact": false, "s1:riser": true })).toEqual([{ sectionId: "s1", effect: "riser", at: 0 }, { sectionId: "s4", effect: "clock-tick", at: 13.28 }]);
});
test("the audio file route only serves its own fixed files", () => {
  const root = mkdtempSync(join(tmpdir(), "reels-audio-")); roots.push(root);
  mkdirSync(join(root, ".operator-data/reels/sfx"), { recursive: true }); writeFileSync(join(root, ".operator-data/reels/sfx/pop.mp3"), "x");
  const audio = createReelsAudio({ root, reference: root, sections: () => sections, fishKey: () => "" });
  expect(audio.file("sfx/pop.mp3").bytes).toBe(1);
  for (const bad of ["sfx/../../secret.mp3", "sfx/evil.mp3", "../hook-voice.mp3", "voice.wav", "sfx/pop.wav"]) expect(() => audio.file(bad)).toThrow("Invalid audio file");
  expect(existsSync(join(root, ".operator-data/reels/audio-demo"))).toBe(false);
});
test("without a Fish key the pipeline stops at the transcript with a plain error, no network", async () => {
  const root = mkdtempSync(join(tmpdir(), "reels-audio-")); roots.push(root);
  mkdirSync(join(root, "media"), { recursive: true }); writeFileSync(join(root, "media/reel-A.mp4"), "x");
  let called = 0;
  const audio = createReelsAudio({ root, reference: root, sections: () => sections, fishKey: () => "", fetch: (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch });
  audio.start();
  for (let i = 0; i < 50 && audio.status().running; i++) await new Promise(r => setTimeout(r, 20));
  expect(audio.status().steps[0]).toMatchObject({ id: "transcribe", state: "error", detail: "FISH_API_KEY is missing" });
  expect(called).toBe(0);
});
