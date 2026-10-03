/**
 * Prompt improver. Uses the local `claude` CLI headless (`claude -p`), so it
 * runs on the member's own Claude Code login with no keys. Without `claude`
 * (or if it fails) it falls back to the built-in template improver.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { improverSystem, parseRise, templateImprove, type PromptAsset } from "../engine/prompt";
import type { MotionStyle, Theme } from "../engine/types";

export interface ImproveRequest {
  idea: string;
  theme: Theme;
  referenceUrl?: string | null;
  /** Absolute path of an attached reference image (saved by the asset endpoint). */
  referenceImage?: string | null;
  assets?: PromptAsset[];
  branded?: boolean;
  /** Styles picked as references (chips). */
  picked?: MotionStyle[];
  /** Loop length in seconds. */
  seconds?: number;
  /** Reference URLs. */
  urls?: string[];
}

export interface ImproveResult {
  prompt: string;
  engine: "claude" | "template";
  note?: string;
  ms: number;
}

export type Launch = (
  binary: string,
  args: string[],
) => { file: string; args: string[]; windowsVerbatimArguments: boolean };

export interface ImproveDeps {
  claude: () => string | null | undefined;
  launch?: Launch;
  timeoutMs?: number;
  /** Force the template path (tests, or members who switch Claude off). */
  template?: boolean;
}

function userMessage(r: ImproveRequest): string {
  const t = r.theme;
  const seconds = r.seconds ?? 5;
  return [
    r.idea.trim()
      ? `Rough idea: ${r.idea.trim()}`
      : "Rough idea: (none; adapt the picked style to this brand)",
    `Length: ${seconds} seconds, a seamless loop.`,
    `Theme: ground ${t.bg}, ink ${t.ink}, accent ${t.accent}, second accent ${t.accent2}, display font ${t.font}${t.name ? `, brand name "${t.name}"` : ""}.`,
    ...(r.urls ?? []).map((u) => `Reference URL (cite it verbatim in R): ${u}`),
    r.referenceUrl ? `Reference URL (cite it verbatim in R): ${r.referenceUrl}` : "",
    r.referenceImage
      ? `Reference image on disk (cite this path verbatim in R; you may open it): ${r.referenceImage}`
      : "",
    ...(r.assets ?? []).map((a) =>
      a.kind === "video"
        ? `Reference video on disk (cite this path verbatim in R): ${a.path}${a.frames?.length ? `; key frames you may open: ${a.frames.join(", ")}` : ""}`
        : `Brand ${a.kind} on disk (cite this path verbatim in R and use it as the ${a.kind}): ${a.path}`,
    ),
    ...(r.picked ?? []).map(
      (s, i) =>
        `${i === 0 ? "Lead style" : "Also borrow from"} "${s.name}" (${s.look}). Its own prompt, for reference:\n${s.prompt.slice(0, 3000)}`,
    ),
    "Write the RISE prompt now.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Same hygiene as the OS chat: if this server was itself started from a Claude
 * Code / Desktop session, its markers would make the child act as a nested SDK
 * run. Strip them (and that session's base URL) so `claude` signs in exactly
 * as it does in the member's own terminal.
 */
export function freshClaudeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  const nested = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT);
  for (const k of Object.keys(env))
    if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID$)/.test(k)) delete env[k];
  if (nested) delete env.ANTHROPIC_BASE_URL;
  return env;
}

function runClaude(
  binary: string,
  args: string[],
  input: string,
  deps: ImproveDeps,
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = deps.launch
      ? deps.launch(binary, args)
      : { file: binary, args, windowsVerbatimArguments: false };
    const child = spawn(cmd.file, cmd.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: cmd.windowsVerbatimArguments,
      env: freshClaudeEnv(),
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude Code took too long to answer."));
    }, deps.timeoutMs ?? 150_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      // With --output-format json the reason is on stdout, not stderr.
      let reason = err.trim().split("\n").slice(-1)[0];
      try {
        const last = JSON.parse(out.trim().split("\n").filter(Boolean).slice(-1)[0] || "{}");
        reason = String(last.result || last.error || reason || "");
      } catch {
        reason = reason || out.trim().split("\n").slice(-1)[0] || "";
      }
      reject(new Error(reason || `claude exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

export async function improve(
  r: ImproveRequest,
  styles: MotionStyle[],
  deps: ImproveDeps,
): Promise<ImproveResult> {
  const started = Date.now();
  const fallback = (note?: string): ImproveResult => ({
    prompt: templateImprove({
      idea: r.idea,
      theme: r.theme,
      styles,
      referenceUrl: r.referenceUrl,
      referenceImage: r.referenceImage,
      assets: r.assets,
      branded: r.branded,
      picked: r.picked,
      seconds: r.seconds,
      urls: r.urls,
    }).prompt,
    engine: "template",
    note,
    ms: Date.now() - started,
  });
  const binary = deps.template ? null : deps.claude();
  if (!binary)
    return fallback(
      deps.template
        ? undefined
        : "Claude Code isn't installed, so the built-in improver wrote this.",
    );
  const cwd = join(tmpdir(), "motion-studio-improver");
  mkdirSync(cwd, { recursive: true });
  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--system-prompt",
    improverSystem(styles, r.seconds ?? 5),
    ...(r.referenceImage || r.assets?.some((a) => a.kind !== "logo" || a.frames?.length)
      ? ["--tools", "Read", "--allowedTools", "Read"]
      : ["--tools", ""]),
    ...(process.env.MOTION_STUDIO_MODEL ? ["--model", process.env.MOTION_STUDIO_MODEL] : []),
  ];
  try {
    const raw = await runClaude(binary, args, userMessage(r), deps, cwd);
    const json = JSON.parse(raw.trim().split("\n").filter(Boolean).slice(-1)[0] || "{}");
    const text = String(json.result ?? "").trim();
    if (json.is_error || !text) throw new Error(text || "Claude Code returned nothing.");
    const rise = parseRise(text);
    if (!rise.R || !rise.I || !rise.S || !rise.E)
      return fallback(
        "Claude's answer wasn't in RISE format, so the built-in improver wrote this.",
      );
    return { prompt: text, engine: "claude", ms: Date.now() - started };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/auth|log ?in|oauth|401|credential/i.test(reason))
      return fallback(
        "Claude Code needs you to sign in again (run `claude` in Terminal, then /login). The built-in improver wrote this one.",
      );
    return fallback(
      `Claude Code couldn't answer (${reason.slice(0, 140)}), so the built-in improver wrote this.`,
    );
  }
}
