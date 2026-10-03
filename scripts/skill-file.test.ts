import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSkillFile } from "./skill-file";

test("finds a skill's SKILL.md by name in the known folders, and refuses paths", () => {
  const home = mkdtempSync(join(tmpdir(), "skill-file-"));
  mkdirSync(join(home, ".claude/skills/animate"), { recursive: true });
  writeFileSync(join(home, ".claude/skills/animate/SKILL.md"), "# Animate");
  mkdirSync(join(home, ".hermes/skills/creative/sketch"), { recursive: true });
  writeFileSync(join(home, ".hermes/skills/creative/sketch/SKILL.md"), "# Sketch");
  expect(readSkillFile(home, "skill:/animate").text).toBe("# Animate");
  expect(readSkillFile(home, "skill:Hermes skill:sketch").path).toBe("~/.hermes/skills/creative/sketch/SKILL.md");
  expect(() => readSkillFile(home, "skill:/../../etc")).toThrow();
  expect(() => readSkillFile(home, "skill:/missing")).toThrow("not on this Mac");
});
