/**
 * Run in Claude Code / Codex: make ~/motion-studio-projects/<slug>/ with
 * PROMPT.md (and any dropped assets), then open a new Terminal window running
 * `claude` or `codex` there. The exact command is shown to the person first;
 * this only runs on click. MOTION_STUDIO_DRY_RUN=1 writes the folder but never
 * opens a window.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PromptAsset } from "../engine/prompt";
import { assetsDir, slugify, studioHome, tildify, uniqueChild } from "./util";

export type Tool = "claude" | "codex";

export interface LaunchPlan {
  folder: string;
  display: string;
  command: string;
  terminal: boolean;
  tool: Tool;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function planLaunch(
  name: string,
  tool: Tool = "claude",
  env: NodeJS.ProcessEnv = process.env,
): LaunchPlan {
  const home = studioHome(env);
  const folder = uniqueChild(home, slugify(name));
  const display = tildify(folder);
  return {
    folder,
    display,
    command: `cd ${/^[~\w./-]+$/.test(display) ? display : shellQuote(folder)} && ${tool} "$(cat PROMPT.md)"`,
    terminal: process.platform === "darwin",
    tool,
  };
}

/** Assets live in the project folder, so the prompt points at ./assets/<file>. */
function localiseAssets(prompt: string, folder: string, assets: PromptAsset[]): string {
  let out = prompt;
  const safe = assets.filter((a) => a.path.startsWith(assetsDir()) && existsSync(a.path));
  if (!safe.length) return out;
  mkdirSync(join(folder, "assets"), { recursive: true });
  for (const a of safe) {
    const file = basename(a.path);
    copyFileSync(a.path, join(folder, "assets", file));
    out = out
      .split(a.path)
      .join(`./assets/${file}`)
      .split(tildify(a.path))
      .join(`./assets/${file}`);
    for (const f of a.frames ?? [])
      if (existsSync(f)) {
        const name = `${file.replace(/\.[a-z0-9]+$/i, "")}-${basename(f)}`;
        copyFileSync(f, join(folder, "assets", name));
        out = out.split(f).join(`./assets/${name}`);
      }
  }
  return out;
}

export async function launch(
  name: string,
  prompt: string,
  assets: PromptAsset[],
  options: { dryRun: boolean; env?: NodeJS.ProcessEnv; tool?: Tool },
): Promise<LaunchPlan & { launched: boolean; dryRun: boolean }> {
  const tool = options.tool ?? "claude";
  const plan = planLaunch(name, tool, options.env);
  mkdirSync(plan.folder, { recursive: true });
  const body = localiseAssets(prompt.trim(), plan.folder, assets);
  writeFileSync(join(plan.folder, "PROMPT.md"), body + "\n");
  if (options.dryRun || !plan.terminal) return { ...plan, launched: false, dryRun: options.dryRun };
  const shell = `cd ${shellQuote(plan.folder)} && ${tool} "$(cat PROMPT.md)"`;
  const script = shell.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  await new Promise<void>((resolve, reject) =>
    execFile(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script "${script}"`,
        "-e",
        'tell application "Terminal" to activate',
      ],
      { timeout: 15000 },
      (error) =>
        error
          ? reject(new Error("Couldn't open Terminal. Copy the command and run it yourself."))
          : resolve(),
    ),
  );
  return { ...plan, launched: true, dryRun: false };
}
