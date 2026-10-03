import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type BrainPreferences = { brainSources: Record<string, boolean>; brainRevision: number };
type Legacy = { brainSources?: unknown; brainRevision?: unknown };
const legacyCache = new Map<string, { stamp: string; value: BrainPreferences }>();
const projection = (value: Legacy): BrainPreferences => ({
  brainSources: value.brainSources && typeof value.brainSources === "object" && !Array.isArray(value.brainSources)
    ? Object.fromEntries(Object.entries(value.brainSources).filter(([, enabled]) => typeof enabled === "boolean")) : {},
  brainRevision: Number.isSafeInteger(value.brainRevision) && Number(value.brainRevision) >= 0 ? Number(value.brainRevision) : 0,
});

/** Source switches are small, authoritative preferences, separate from full memory text. */
export function readBrainPreferences(root: string, legacy?: Legacy): BrainPreferences {
  const directory = join(resolve(root), ".operator-data"), file = join(directory, "brain-preferences.json");
  if (existsSync(file)) {
    try {
      if (statSync(file).size > 65536) throw new Error();
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (saved.version !== 1 || !saved.brainSources || typeof saved.brainSources !== "object" || Array.isArray(saved.brainSources) ||
        Object.values(saved.brainSources).some((v) => typeof v !== "boolean") || !Number.isSafeInteger(saved.brainRevision) || saved.brainRevision < 0) throw new Error();
      return projection(saved);
    } catch { throw new Error("Brain source preferences could not be read. Existing settings were left untouched."); }
  }
  const workspace = join(directory, "workspace.json"), info = existsSync(workspace) ? statSync(workspace) : undefined;
  const stamp = info ? `${info.ino}:${info.size}:${info.mtimeMs}` : "empty";
  const old = legacyCache.get(workspace);
  if (!legacy && old?.stamp === stamp) return { brainSources: { ...old.value.brainSources }, brainRevision: old.value.brainRevision };
  let value = legacy;
  if (!value) {
    try { value = info ? JSON.parse(readFileSync(workspace, "utf8")) : {}; }
    catch { throw new Error("Workspace context could not be read. Source preferences cannot be confirmed."); }
  }
  const result = projection(value || {});
  legacyCache.set(workspace, { stamp, value: result });
  return { brainSources: { ...result.brainSources }, brainRevision: result.brainRevision };
}

export function writeBrainPreferences(root: string, preferences: BrainPreferences) {
  const directory = join(resolve(root), ".operator-data"), file = join(directory, "brain-preferences.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, ...preferences }), { mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}

/**
 * The saved daily brief is built from many sources (mail, calendar, Notion,
 * meetings...). It may go to a model only while every source is switched on.
 */
export function briefAllowed(root: string): boolean {
  let legacy: Legacy | undefined;
  try {
    legacy = JSON.parse(readFileSync(join(resolve(root), ".operator-data", "workspace.json"), "utf8"));
  } catch {
    legacy = undefined;
  }
  return !Object.values(readBrainPreferences(root, legacy).brainSources).some((on) => on === false);
}
