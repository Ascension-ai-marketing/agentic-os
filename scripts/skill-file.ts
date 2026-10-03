// Reads one skill's SKILL.md for the Memory record panel. Names only, never paths
// from the page: the file is found inside the known skill folders on this Mac.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS: Array<[string, string[]]> = [
  ["Claude", [".claude/skills"]],
  ["Codex skill", [".codex/skills"]],
  ["Agent skill", [".agents/skills"]],
  ["Hermes skill", [".hermes/skills"]],
];

/** "skill:/animate" or "skill:Codex skill:bitly-shortener" to the SKILL.md text. */
export function readSkillFile(home: string, id: string) {
  const raw = String(id || "").replace(/^skill:/, "");
  const via = ROOTS.find(([label]) => raw.startsWith(`${label}:`))?.[0];
  const name = (via ? raw.slice(via.length + 1) : raw).replace(/^\//, "").trim();
  if (!/^[\w.-]{1,80}$/.test(name)) throw new Error("That is not a skill name.");
  const roots = (via ? ROOTS.filter(([l]) => l === via) : ROOTS).flatMap(([, dirs]) => dirs.map((d) => join(home, d)));
  const find = (dir: string, depth: number): string | undefined => {
    const direct = join(dir, name, "SKILL.md");
    if (existsSync(direct)) return direct;
    if (depth >= 3) return undefined;
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || !(e.isDirectory() || e.isSymbolicLink())) continue;
      if (e.name.toLowerCase() === name.toLowerCase() && existsSync(join(dir, e.name, "SKILL.md"))) return join(dir, e.name, "SKILL.md");
      const deeper = find(join(dir, e.name), depth + 1);
      if (deeper) return deeper;
    }
    return undefined;
  };
  for (const root of roots) {
    const file = find(root, 0);
    if (!file) continue;
    if (statSync(file).size > 400 * 1024) throw new Error("This skill file is too large to show.");
    return { name, path: "~/" + file.slice(home.length + 1), text: readFileSync(file, "utf8") };
  }
  throw new Error("This skill's SKILL.md is not on this Mac.");
}
