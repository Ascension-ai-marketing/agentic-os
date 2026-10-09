/**
 * ceo-openclaw-limits.ts
 *
 * The limits OpenClaw works within when Jarvis hands it something, and the
 * person's agreement to them. Without an agreement on record OpenClaw takes no
 * work. Only the dashboard's token-checked button writes this file; the voice
 * brain reads it and has no tool that changes it.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { CeoTask } from "./ceo-store";

export type OpenclawLimits = {
  /** Every task gets its own folder in here. The settings each run is pinned to keep its file tools inside it. */
  folder: string;
  /** The model that does the work, as OpenClaw named it when the person agreed. A change in OpenClaw needs a new agreement. */
  model: string;
  /** A task still working after this long is stopped. */
  minutes: number;
  /** Tasks started in one day. */
  tasksPerDay: number;
  /** What OpenClaw's model calls may cost in one day, as OpenClaw reports it. */
  dollarsPerDay: number;
};
export type OpenclawAgreement = OpenclawLimits & { agreedAt: string };

/** What the page suggests. The folder is outside OpenClaw's own, which its everyday agent reads; the model is OpenClaw's to name. */
export const DEFAULT_LIMITS = (home = homedir()): Omit<OpenclawLimits, "model"> => ({
  folder: join(home, "Jarvis", "openclaw"), minutes: 15, tasksPerDay: 10, dollarsPerDay: 5,
});
/** A model as OpenClaw writes one: provider/model, with the sign-in it uses after an @ when there is one. */
export const MODEL = /^([a-z0-9][a-z0-9_-]*)\/([\w.:\/-]+?)(@[\w.:-]+)?$/i;
const RANGE = { minutes: [1, 60], tasksPerDay: [1, 50], dollarsPerDay: [0.5, 100] } as const;

const fileOf = (root: string) => join(root, ".operator-data", "ceo", "openclaw-limits.json");

/** A folder inside the person's home, and not the home itself, one of the folders their own files live in, or anywhere in OpenClaw's own. */
export function checkFolder(folder: unknown, home = homedir()): string {
  if (typeof folder !== "string" || !isAbsolute(folder) || folder.includes("\0")) throw new Error("The work folder must be a full path.");
  const clean = normalize(folder).replace(/[\\/]+$/, "");
  const inside = clean.startsWith(home + sep) ? clean.slice(home.length + 1).split(sep) : [];
  if (!inside.length || inside.includes("..")) throw new Error("The work folder must be inside your home folder.");
  if (inside[0] === ".openclaw") throw new Error("Pick a work folder outside OpenClaw's own folder, which its everyday agent reads.");
  if (inside.length === 1 && ["Desktop", "Documents", "Downloads", "Library", "Pictures", "Movies", "Music", ".ssh"].includes(inside[0]))
    throw new Error("Pick a folder of its own for OpenClaw's work, not one your own files live in.");
  return clean;
}

function checkLimits(input: unknown, home?: string): OpenclawLimits {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Set the limits first.");
  const given = input as Record<string, unknown>;
  const number = (key: keyof typeof RANGE) => {
    const value = Number(given[key]), [low, high] = RANGE[key];
    if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${key} must be between ${low} and ${high}.`);
    return key === "dollarsPerDay" ? Math.round(value * 100) / 100 : Math.floor(value);
  };
  if (typeof given.model !== "string" || given.model.length > 200 || !MODEL.test(given.model)) throw new Error("OpenClaw has not said which model it uses, so there is nothing to agree to yet.");
  return { folder: checkFolder(given.folder, home), model: given.model, minutes: number("minutes"), tasksPerDay: number("tasksPerDay"), dollarsPerDay: number("dollarsPerDay") };
}

export function openclawLimits(root: string, home?: string) {
  const file = fileOf(root);
  return {
    /** The agreement on record, or nothing. One that cannot be read safely counts as nothing. */
    read(): OpenclawAgreement | undefined {
      if (!existsSync(file)) return undefined;
      try {
        const info = lstatSync(file);
        if (info.isSymbolicLink() || info.size > 16_384) return undefined;
        const stored = JSON.parse(readFileSync(file, "utf8"));
        if (stored?.version !== 1 || typeof stored.agreedAt !== "string" || Number.isNaN(Date.parse(stored.agreedAt))) return undefined;
        return { ...checkLimits(stored, home), agreedAt: stored.agreedAt };
      } catch {
        return undefined;
      }
    },
    /** The person agreed, with the dashboard's button. */
    agree(input: unknown): OpenclawAgreement {
      const agreement = { ...checkLimits(input, home), agreedAt: new Date().toISOString() };
      mkdirSync(join(root, ".operator-data", "ceo"), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, ...agreement }, null, 2), { mode: 0o600 });
      renameSync(temporary, file);
      chmodSync(file, 0o600);
      return agreement;
    },
    /** Takes the agreement back. Work already running finishes or times out as before. */
    withdraw() { rmSync(file, { force: true }); },
  };
}

/** Why the next task cannot start within these limits, or nothing when it can. */
export function overLimits(limits: OpenclawLimits, tasks: CeoTask[], now = new Date()): string | undefined {
  const mine = tasks.filter((task) => task.agent === "openclaw");
  if (mine.some((task) => task.status === "queued" || task.status === "running")) return "OpenClaw is already working on a task. It takes one at a time; task_status says how it is going.";
  const today = now.toDateString(), started = mine.filter((task) => new Date(task.createdAt).toDateString() === today);
  if (started.length >= limits.tasksPerDay) return `OpenClaw has had its ${limits.tasksPerDay} tasks for today, the limit the person set. Hermes, Claude Code and Codex can take work.`;
  const spent = started.reduce((sum, task) => sum + (task.costUsd ?? 0), 0);
  if (spent >= limits.dollarsPerDay) return `OpenClaw has used its $${limits.dollarsPerDay} for today, the limit the person set. Hermes, Claude Code and Codex can take work.`;
  return undefined;
}
