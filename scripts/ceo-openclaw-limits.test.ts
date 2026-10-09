import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFolder, DEFAULT_LIMITS, openclawLimits, overLimits } from "./ceo-openclaw-limits";
import type { CeoTask } from "./ceo-store";

const HOME = "/Users/sample";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "openclaw-limits-")); roots.push(root); return root; };
const LIMITS = { folder: `${HOME}/agents/openclaw`, model: "openai/sample-model@openai:setup-1", minutes: 15, tasksPerDay: 3, dollarsPerDay: 2 };
const task = (patch: Partial<CeoTask>): CeoTask => ({
  id: crypto.randomUUID(), key: crypto.randomUUID(), agent: "openclaw", title: "t", task: "t", status: "done",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch,
});

test("the suggested work folder is one of its own, outside OpenClaw's own folder", () => {
  expect(DEFAULT_LIMITS(HOME)).toEqual({ folder: `${HOME}/Jarvis/openclaw`, minutes: 15, tasksPerDay: 10, dollarsPerDay: 5 });
  expect(checkFolder(DEFAULT_LIMITS(HOME).folder, HOME)).toBe(`${HOME}/Jarvis/openclaw`);
});

test("there is nothing to agree to until OpenClaw has named its model", () => {
  const root = temporary(), limits = openclawLimits(root, HOME);
  const { model: _, ...unnamed } = LIMITS;
  for (const bad of [unnamed, { ...LIMITS, model: "" }, { ...LIMITS, model: "sample-model" }, { ...LIMITS, model: "openai/sample model" }, { ...LIMITS, model: `openai/${"m".repeat(200)}` }, { ...LIMITS, model: 'openai/x", "tools": {' }])
    expect(() => limits.agree(bad)).toThrow("which model");
  expect(limits.read()).toBeUndefined();
  for (const model of ["openai/sample-model", "openai/sample-model@openai:setup-1", "openrouter/meta/sample-3.1:free"]) expect(limits.agree({ ...LIMITS, model }).model).toBe(model);
});

test("the work folder must be a folder of its own inside the person's home", () => {
  expect(checkFolder(`${HOME}/agents/openclaw/`, HOME)).toBe(`${HOME}/agents/openclaw`);
  for (const bad of ["agents", HOME, `${HOME}/`, "/tmp/work", "/Users/other/work", `${HOME}/../other`, `${HOME}/Documents`, `${HOME}/Desktop/`, `${HOME}/.ssh`, `${HOME}/.openclaw`])
    expect(() => checkFolder(bad, HOME)).toThrow();
});

test("an agreement is kept privately, read back, and withdrawn", () => {
  const root = temporary(), limits = openclawLimits(root, HOME);
  expect(limits.read()).toBeUndefined();
  const agreed = limits.agree({ ...LIMITS, dollarsPerDay: 2.555, minutes: 15.9 });
  expect(agreed).toMatchObject({ ...LIMITS, dollarsPerDay: 2.56, minutes: 15 });
  expect(limits.read()).toEqual(agreed);
  expect(statSync(join(root, ".operator-data", "ceo", "openclaw-limits.json")).mode & 0o777).toBe(0o600);
  limits.withdraw();
  expect(limits.read()).toBeUndefined();
});

test("limits out of range are refused and nothing is recorded", () => {
  const root = temporary(), limits = openclawLimits(root, HOME);
  for (const bad of [{ ...LIMITS, minutes: 0 }, { ...LIMITS, minutes: 600 }, { ...LIMITS, tasksPerDay: 500 }, { ...LIMITS, dollarsPerDay: -1 }, { ...LIMITS, dollarsPerDay: "lots" }, null, []])
    expect(() => limits.agree(bad)).toThrow();
  expect(limits.read()).toBeUndefined();
});

test("a file that was not written by the button counts as no agreement", () => {
  const root = temporary(), folder = join(root, ".operator-data", "ceo"), file = join(folder, "openclaw-limits.json");
  mkdirSync(folder, { recursive: true });
  const limits = openclawLimits(root, HOME);
  writeFileSync(file, "not json");
  expect(limits.read()).toBeUndefined();
  writeFileSync(file, JSON.stringify({ version: 1, ...LIMITS }));
  expect(limits.read()).toBeUndefined();
  writeFileSync(file, JSON.stringify({ version: 1, ...LIMITS, folder: "/", agreedAt: new Date().toISOString() }));
  expect(limits.read()).toBeUndefined();
  rmSync(file);
  const elsewhere = join(root, "elsewhere.json");
  writeFileSync(elsewhere, JSON.stringify({ version: 1, ...LIMITS, agreedAt: new Date().toISOString() }));
  symlinkSync(elsewhere, file);
  expect(limits.read()).toBeUndefined();
});

test("one task at a time, so many a day, and so much spend a day", () => {
  expect(overLimits(LIMITS, [])).toBeUndefined();
  expect(overLimits(LIMITS, [task({ status: "running" })])).toContain("already working");
  expect(overLimits(LIMITS, [task({ agent: "hermes", status: "running" })])).toBeUndefined();
  expect(overLimits(LIMITS, [task({}), task({}), task({})])).toContain("its 3 tasks for today");
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  expect(overLimits(LIMITS, [task({ createdAt: yesterday }), task({ createdAt: yesterday }), task({ createdAt: yesterday })])).toBeUndefined();
  expect(overLimits(LIMITS, [task({ costUsd: 1.5 }), task({ status: "failed", costUsd: 0.6 })])).toContain("used its $2 for today");
});
