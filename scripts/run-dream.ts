#!/usr/bin/env bun
/**
 * Engine-agnostic Dream runner — the single entry point the daily cron calls.
 *
 * Reads the operator's chosen engine + model from ~/.claude-os/config.json and
 * runs the Dream on whichever engine they picked in the dashboard:
 *   - hermes / claude : spawn the CLI with the /dream skill (agentic — the skill
 *                       reads the raw files and writes the dream JSON itself).
 *   - codex           : `codex exec` with the assembled prompt (ChatGPT OAuth,
 *                       gpt-5.5). We capture the final message and write the JSON.
 *   - openrouter      : direct API call (default anthropic/claude-sonnet-4.6, or
 *                       config.openRouterModel). We write the JSON.
 *
 * Why this exists: the cron used to hardcode hermes/claude, so a user who picked
 * Codex or OpenRouter got a 7am job that silently fell back to `claude -p` and
 * 401'd without a setup-token. Resolving the engine fresh at runtime here means
 * whatever they picked actually runs, and a later dashboard change takes effect
 * without reinstalling the cron.
 *
 * Privacy: for codex/openrouter the aggregated activity (live-data.json) is sent
 * to that provider — the same as any cloud AI feature. The dashboard picker
 * discloses this per-engine.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { IS_WIN, whichCommand, appData, localAppData } from "./platform";
import { loadKnownSecrets, setKnownSecrets } from "./hermes-progress";
import { checkDream, localDate, setDreamSecrets, redactDreamText, stateDigest, updateDreamState, type DreamState } from "./dream-schema";

const HOME = homedir();
const REPO = resolve(import.meta.dir, "..");
const STATE_DIR = join(HOME, ".claude-os");
const DREAMS_DIR = join(STATE_DIR, "dreams");
const CONFIG = join(STATE_DIR, "config.json");
const STATE_FILE = join(DREAMS_DIR, "state.json");
const LAST_RUN = join(DREAMS_DIR, "last-run.json");
// Local date: a 7am run in Toronto must not be filed under yesterday's UTC date.
const today = localDate();
const ENGINES = ["hermes", "claude", "codex", "openrouter"] as const;
type Engine = (typeof ENGINES)[number];
// Fable 5 — frontier tier. The Dream is an overnight batch job, so we spend
// the deepest model on it by default; latency is free at 7am.
const DEFAULT_OR_MODEL = "anthropic/claude-fable-5";

function readConfig(): { dreamEngine?: string; openRouterModel?: string } {
  try {
    if (existsSync(CONFIG)) return JSON.parse(readFileSync(CONFIG, "utf-8")) || {};
  } catch {
    /* malformed config */
  }
  return {};
}

// Resolve a CLI: known locations first, then PATH (nvm/npm/brew). Returns
// undefined when not found anywhere.
function resolveBin(name: string, fallbacks: string[]): string | undefined {
  for (const p of fallbacks) if (p && existsSync(p)) return p;
  try {
    const out = spawnSync(whichCommand(), [name], { encoding: "utf-8" }).stdout ?? "";
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return undefined;
}

const hermesBin = () =>
  resolveBin(
    "hermes",
    IS_WIN
      ? [join(HOME, ".local", "bin", "hermes.exe"), join(appData(), "npm", "hermes.cmd")]
      : [join(HOME, ".local", "bin", "hermes"), "/opt/homebrew/bin/hermes", "/usr/local/bin/hermes"],
  );
const claudeBin = () =>
  resolveBin(
    "claude",
    IS_WIN
      ? [join(appData(), "npm", "claude.cmd"), join(localAppData(), "Programs", "claude", "claude.exe")]
      : ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
  );
const codexBin = () =>
  resolveBin(
    "codex",
    IS_WIN
      ? [join(appData(), "npm", "codex.cmd"), join(localAppData(), "Programs", "codex", "codex.exe")]
      : ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
  );

function openRouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  for (const f of [join(HOME, ".hermes", ".env"), join(STATE_DIR, ".env.local"), join(REPO, ".env.local")]) {
    if (!existsSync(f)) continue;
    try {
      const m = readFileSync(f, "utf-8").match(/^\s*OPENROUTER_API_KEY\s*=\s*"?([^"\n\r]+)"?\s*$/m);
      if (m?.[1]) return m[1].trim();
    } catch {
      /* unreadable */
    }
  }
  return "";
}

function assemblePrompt(): { system: string; user: string } {
  const skillPath = [
    join(HOME, ".claude", "skills", "dream", "SKILL.md"),
    join(HOME, ".hermes", "skills", "dream", "SKILL.md"),
    join(REPO, "skills", "dream", "SKILL.md"),
  ].find((p) => existsSync(p));
  if (!skillPath) throw new Error("Dream SKILL.md not found in any standard location");
  const skill = readFileSync(skillPath, "utf-8");
  const liveDataPath = join(REPO, "src", "data", "live-data.json");
  // Hide credentials before the activity data leaves the machine.
  const live = redactDreamText(existsSync(liveDataPath) ? readFileSync(liveDataPath, "utf-8") : "{}");
  const system = [
    skill,
    "",
    "---",
    "IMPORTANT: You are being run non-interactively with no file tools. Your ENTIRE",
    "reply must be a single valid JSON object matching the skill's schema — no",
    "markdown fences, no prose.",
    `Set "date" to "${today}" and "generatedAt" to the current ISO timestamp.`,
  ].join("\n");
  const user = [
    "Prior prescriptions and the operator's verdicts (do not repeat dismissed or done items):",
    stateDigest(readState()),
    "",
    "Operator's aggregated activity data:",
    "",
    live,
    "",
    "Produce the dream prescription JSON now.",
  ].join("\n");
  return { system, user };
}

function parseDreamJson(raw: string): any {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function readState(): DreamState | null {
  try {
    return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : null;
  } catch {
    return null;
  }
}

/**
 * The only way a dream reaches the dashboard: repair, redact, validate, then
 * write it and update state.json. A rejected dream is kept beside it as
 * dream-{date}.rejected.json (the dashboard ignores that name), so the last
 * good dream stays on screen.
 */
export function publishDream(raw: unknown, fromTarget = false): { ok: boolean; errors: string[]; notes: string[] } {
  if (!existsSync(DREAMS_DIR)) mkdirSync(DREAMS_DIR, { recursive: true });
  const target = join(DREAMS_DIR, `dream-${today}.json`);
  const state = readState();
  const result = checkDream(raw, { today, state });
  for (const n of result.notes) console.log(`[run-dream] note: ${n}`);
  if (!result.ok || !result.dream) {
    for (const e of result.errors) console.error(`[run-dream] invalid: ${e}`);
    const body = result.dream ?? raw;
    writeFileSync(join(DREAMS_DIR, `dream-${today}.rejected.json`), redactDreamText(JSON.stringify(body, null, 2)), { mode: 0o600 });
    // The engine wrote the bad file in place: move it aside so the dashboard
    // falls back to the previous good dream instead of rendering it.
    if (fromTarget && existsSync(target)) rmSync(target);
    return { ok: false, errors: result.errors, notes: result.notes };
  }
  writeFileSync(target, JSON.stringify(result.dream, null, 2), { mode: 0o600 });
  const nowIso = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(updateDreamState(state, result.dream, nowIso), null, 2), { mode: 0o600 });
  // `mode` only applies to new files; tighten ones an older version left world-readable.
  for (const f of [target, STATE_FILE]) chmodSync(f, 0o600);
  console.log(`[run-dream] published dream-${today}.json (${result.dream.prescriptions.length} prescriptions)`);
  return { ok: true, errors: [], notes: result.notes };
}

/** Agentic engines write the file themselves; run it through the same gate afterwards. */
function publishWrittenDream(): { ok: boolean; errors: string[]; notes: string[] } {
  const target = join(DREAMS_DIR, `dream-${today}.json`);
  if (!existsSync(target)) return { ok: false, errors: [`engine finished but wrote no dream-${today}.json`], notes: [] };
  let raw: unknown;
  try {
    raw = parseDreamJson(readFileSync(target, "utf-8"));
  } catch (err) {
    raw = null;
    console.error(`[run-dream] dream-${today}.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  return publishDream(raw, true);
}

function recordRun(run: Record<string, unknown>): void {
  try {
    if (!existsSync(DREAMS_DIR)) mkdirSync(DREAMS_DIR, { recursive: true });
    writeFileSync(LAST_RUN, redactDreamText(JSON.stringify({ at: new Date().toISOString(), date: today, ...run }, null, 2)), { mode: 0o600 });
  } catch {
    /* status file is best-effort */
  }
}

/**
 * Engines to try, in order: the operator's choice first, then every other
 * installed engine. A missing CLI no longer kills the daily run — it used to
 * exit with "codex not installed" and the Dream went dark for weeks.
 */
export function engineOrder(configured: string, have: Record<Engine, boolean>): Engine[] {
  const preferred = ENGINES.find((e) => e === configured.toLowerCase());
  const rest = (["hermes", "claude", "openrouter", "codex"] as Engine[]).filter((e) => e !== preferred);
  return [...(preferred ? [preferred] : []), ...rest].filter((e) => have[e]);
}

function runAgenticCli(bin: string, args: string[], label: string): number {
  console.log(`[run-dream] ${label}: launching ${bin}`);
  const r = spawnSync(bin, args, { stdio: "inherit", timeout: 240_000 });
  return r.status ?? 1;
}

function runCodex(bin: string): void {
  const { system, user } = assemblePrompt();
  const prompt = `${system}\n\n${user}`;
  // Private per-run temp dir (not a predictable shared-tmp path) so there's no
  // symlink race or cross-run collision on the captured output file.
  const tmpDir = mkdtempSync(join(tmpdir(), "claude-os-codex-"));
  const outFile = join(tmpDir, "dream.json");
  try {
    const r = spawnSync(
      bin,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-last-message",
        outFile,
      ],
      { input: prompt, encoding: "utf-8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024 },
    );
    if (!existsSync(outFile)) {
      throw new Error(`codex produced no output (exit ${r.status}). ${(r.stderr || "").slice(-300)}`.trim());
    }
    const out = publishDream(parseDreamJson(readFileSync(outFile, "utf-8")));
    if (!out.ok) throw new Error(`codex output rejected: ${out.errors.join("; ")}`);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function runOpenRouter(model: string): Promise<void> {
  const key = openRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY not found (env, ~/.hermes/.env, or .env.local)");
  const { system, user } = assemblePrompt();
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(240_000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:8081",
      "X-Title": "Claude OS Dream",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data: any = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("OpenRouter returned no content");
  const out = publishDream(parseDreamJson(content));
  if (!out.ok) throw new Error(`openrouter output rejected: ${out.errors.join("; ")}`);
}

async function runEngine(engine: Engine, bins: { hermes?: string; claude?: string; codex?: string }, model: string): Promise<void> {
  // Agentic engines overwrite today's file in place: keep the current one so a
  // rejected re-run doesn't erase a good dream from earlier today.
  const target = join(DREAMS_DIR, `dream-${today}.json`);
  const previous = existsSync(target) ? readFileSync(target, "utf-8") : null;
  const restore = () => {
    if (previous !== null) writeFileSync(target, previous, { mode: 0o600 });
  };
  if (engine === "hermes") {
    const code = runAgenticCli(bins.hermes!, ["chat", "-Q", "--skills", "dream", "--yolo", "-q", "/dream"], "hermes");
    if (code !== 0) {
      restore();
      throw new Error(`hermes exited ${code}`);
    }
  } else if (engine === "claude") {
    const code = runAgenticCli(bins.claude!, ["-p", "/dream", "--add-dir", STATE_DIR, "--permission-mode", "acceptEdits"], "claude");
    if (code !== 0) {
      restore();
      throw new Error(`claude exited ${code} — headless needs 'claude setup-token' or ANTHROPIC_API_KEY`);
    }
  } else if (engine === "codex") {
    return runCodex(bins.codex!);
  } else {
    return runOpenRouter(model);
  }
  const out = publishWrittenDream();
  if (!out.ok) {
    restore();
    throw new Error(`${engine} output rejected: ${out.errors.join("; ")}`);
  }
}

async function main(): Promise<void> {
  const known = loadKnownSecrets(REPO);
  setKnownSecrets(known);
  setDreamSecrets(known);

  // `bun run dream:check` — validate and publish today's file after a manual /dream.
  if (process.argv.includes("--check")) {
    const out = publishWrittenDream();
    recordRun({ engine: "manual", ok: out.ok, errors: out.errors, notes: out.notes });
    process.exit(out.ok ? 0 : 1);
  }

  const cfg = readConfig();
  const model =
    cfg.openRouterModel && /^[\w./:-]{1,80}$/.test(cfg.openRouterModel)
      ? cfg.openRouterModel
      : DEFAULT_OR_MODEL;
  const bins = { hermes: hermesBin(), claude: claudeBin(), codex: codexBin() };
  const have = { hermes: !!bins.hermes, claude: !!bins.claude, codex: !!bins.codex, openrouter: !!openRouterKey() };
  const order = engineOrder(cfg.dreamEngine || "", have);
  const configured = (cfg.dreamEngine || "").toLowerCase();
  if (configured && order[0] !== configured) {
    console.warn(`[run-dream] configured engine '${configured}' is not available — falling back`);
  }
  if (order.length === 0) {
    const msg = "no engine available: install Hermes, Claude Code or Codex, or set OPENROUTER_API_KEY";
    console.error(`[run-dream] FAILED: ${msg}`);
    recordRun({ engine: configured || null, ok: false, errors: [msg] });
    process.exit(1);
  }

  const failures: string[] = [];
  for (const engine of order) {
    try {
      await runEngine(engine, bins, model);
      console.log(`[run-dream] done (engine=${engine})`);
      recordRun({ engine, configured: configured || null, ok: true, fallbackFrom: failures.length ? failures : undefined });
      return;
    } catch (err) {
      const msg = `${engine}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[run-dream] attempt failed — ${msg}`);
      failures.push(msg);
    }
  }
  console.error(`[run-dream] FAILED on every engine (${order.join(", ")})`);
  recordRun({ engine: order[0], configured: configured || null, ok: false, errors: failures });
  process.exit(1);
}

if (import.meta.main) main();
