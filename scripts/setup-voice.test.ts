import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkKey, envFile, mergeEnv, readSaved, saveKeys, VOICE_KEYS } from "./setup-voice";
import { FISH_SIGNUP_URL } from "../src/lib/fish";

test("mergeEnv replaces an existing key, keeps other lines and appends new keys", () => {
  const before = "# mine\nexport OPENAI_API_KEY=old\nOTHER=1\n";
  expect(mergeEnv(before, { OPENAI_API_KEY: "sk-new", FISH_API_KEY: "fish" })).toBe('# mine\nOPENAI_API_KEY="sk-new"\nOTHER=1\nFISH_API_KEY="fish"\n');
  expect(mergeEnv("", { FISH_API_KEY: " f " })).toBe('FISH_API_KEY="f"\n');
});

test("mergeEnv refuses values that could break the file", () => {
  expect(() => mergeEnv("", { FISH_API_KEY: "a\nEVIL=1" })).toThrow();
  expect(() => mergeEnv("", { FISH_API_KEY: 'a"b' })).toThrow();
  expect(() => mergeEnv("", { "bad name": "x" })).toThrow();
});

test("saveKeys writes a 600 file under ~/.config and readSaved reads it back", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-voice-"));
  saveKeys({ OPENROUTER_API_KEY: "sk-or-test" }, home);
  saveKeys({ FISH_API_KEY: "fish-test" }, home);
  expect(statSync(envFile(home)).mode & 0o777).toBe(0o600);
  expect(readSaved(home)).toEqual({ OPENROUTER_API_KEY: "sk-or-test", FISH_API_KEY: "fish-test" });
  expect(readFileSync(envFile(home), "utf8")).not.toContain("undefined");
});

test("each key is checked with one read-only request and a refusal is reported as false", async () => {
  const seen: string[] = [];
  const ok = (async (url: string, init: any) => { seen.push(`${url} ${init.headers.Authorization}`); return new Response("{}", { status: 200 }); }) as any;
  const no = (async () => new Response("{}", { status: 401 })) as any;
  expect(await checkKey("FISH_API_KEY", "k", ok)).toBe(true);
  expect(await checkKey("OPENAI_API_KEY", "k", no)).toBe(false);
  expect(seen[0]).toBe("https://api.fish.audio/model?page_size=1 Bearer k");
});

test("the Fish key points at the Fish sign-up link", () => {
  expect(VOICE_KEYS.find((k) => k.name === "FISH_API_KEY")?.getUrl).toBe(FISH_SIGNUP_URL);
});

test("repeated lines for a key collapse to one, and the first line is the one read", () => {
  expect(mergeEnv("A=1\nFISH_API_KEY=old1\nB=2\nFISH_API_KEY=old2\n", { FISH_API_KEY: "new" })).toBe('A=1\nFISH_API_KEY="new"\nB=2\n');
  const home = mkdtempSync(join(tmpdir(), "setup-voice-"));
  saveKeys({ FISH_API_KEY: "first" }, home);
  const { appendFileSync } = require("node:fs");
  appendFileSync(envFile(home), 'FISH_API_KEY="second"\n');
  expect(readSaved(home).FISH_API_KEY).toBe("first");
});

test("the key file is never written through a link", () => {
  const { mkdirSync, symlinkSync, writeFileSync } = require("node:fs");
  const home = mkdtempSync(join(tmpdir(), "setup-voice-"));
  mkdirSync(join(home, ".config"), { recursive: true });
  const elsewhere = join(home, "elsewhere.env");
  writeFileSync(elsewhere, "X=1\n");
  symlinkSync(elsewhere, envFile(home));
  expect(() => saveKeys({ FISH_API_KEY: "k" }, home)).toThrow("link");
  expect(readFileSync(elsewhere, "utf8")).toBe("X=1\n");
});

test("a link that points nowhere is refused too", () => {
  const { mkdirSync, symlinkSync, existsSync } = require("node:fs");
  const home = mkdtempSync(join(tmpdir(), "setup-voice-"));
  mkdirSync(join(home, ".config"), { recursive: true });
  symlinkSync(join(home, "missing.env"), envFile(home));
  expect(() => saveKeys({ FISH_API_KEY: "k" }, home)).toThrow("link");
  expect(existsSync(join(home, "missing.env"))).toBe(false);
});
