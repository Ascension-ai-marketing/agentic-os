/**
 * `bun run setup:voice`: the three keys live voice and Jev need, in one step.
 *
 *   OPENAI_API_KEY      ears and brain (OpenAI Realtime)
 *   FISH_API_KEY        the voice you hear (Fish Audio, Jarvis by default)
 *   OPENROUTER_API_KEY  Jev decisions, quick typed answers and web search
 *
 * Keys are typed hidden, saved to ~/.config/agentic-os.env (mode 600) and
 * never printed. Each key is then checked with one free read-only request.
 * `bun run setup:voice --check` only checks what is already saved.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { FISH_SIGNUP_URL } from "../src/lib/fish";
import { providerKey } from "./provider-config";

export type VoiceKey = { name: "OPENAI_API_KEY" | "FISH_API_KEY" | "OPENROUTER_API_KEY"; label: string; unlocks: string; getUrl: string };

export const VOICE_KEYS: VoiceKey[] = [
  { name: "OPENAI_API_KEY", label: "OpenAI", unlocks: "live voice: it hears you, thinks and uses the app", getUrl: "https://platform.openai.com/api-keys" },
  { name: "FISH_API_KEY", label: "Fish Audio", unlocks: "the voice you hear (Jarvis, Atlas, Raven, Sage)", getUrl: FISH_SIGNUP_URL },
  { name: "OPENROUTER_API_KEY", label: "OpenRouter", unlocks: "Jev decisions, quick typed answers and web search", getUrl: "https://openrouter.ai/keys" },
];

export const envFile = (home = homedir()) => join(home, ".config", "agentic-os.env");

/** Set KEY=value lines in env text: the first line for a key is replaced, repeats of it are removed, a new key is appended. Other lines stay as they are. */
export function mergeEnv(text: string, updates: Record<string, string>): string {
  const lines = text ? text.replace(/\r\n/g, "\n").split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [name, value] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad key name: ${name}`);
    const clean = value.trim();
    if (!clean || /[\r\n"]/.test(clean)) throw new Error(`${name} has characters that cannot go in an env file`);
    const line = `${name}="${clean}"`;
    const isKey = (l: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l);
    const at = lines.findIndex(isKey);
    if (at >= 0) {
      lines[at] = line;
      for (let i = lines.length - 1; i > at; i--) if (isKey(lines[i])) lines.splice(i, 1);
    } else lines.push(line);
  }
  return lines.join("\n") + "\n";
}

export function readSaved(home = homedir()): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try { text = readFileSync(envFile(home), "utf8"); } catch { return out; }
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    // The first line for a key wins, the same as the app reads it.
    if (!m || m[1] in out) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Writes the key file in one step: a new private (600) file, then a rename over the old one. Never follows a symlink. */
export function saveKeys(updates: Record<string, string>, home = homedir()) {
  const file = envFile(home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let before = "";
  let stat: ReturnType<typeof lstatSync> | undefined;
  try { stat = lstatSync(file); } catch { stat = undefined; }
  // lstat sees a link even when it points nowhere.
  if (stat?.isSymbolicLink()) throw new Error(`${file} is a link. Replace it with a normal file, then run this again.`);
  if (stat) before = readFileSync(file, "utf8");
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, mergeEnv(before, updates));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw error;
  }
  closeSync(fd);
  renameSync(tmp, file);
}

/** One free, read-only request per provider. Returns true when the key is accepted. */
export async function checkKey(name: VoiceKey["name"], key: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = name === "OPENAI_API_KEY" ? "https://api.openai.com/v1/models" : name === "FISH_API_KEY" ? "https://api.fish.audio/model?page_size=1" : "https://openrouter.ai/api/v1/key";
  try {
    const r = await fetcher(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

function hasTool(cmd: string) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

/** Read a line without echoing it (falls back to plain input when there is no TTY). */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    for await (const line of console) return String(line).trim();
    return "";
  }
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") { stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const g = "\x1b[32m", r = "\x1b[31m", d = "\x1b[2m", b = "\x1b[1m", x = "\x1b[0m";
  console.log(`\n${b}Voice setup${x}  ${d}keys are saved to ${envFile()} and never shown${x}\n`);
  if (!checkOnly) {
    const saved = readSaved();
    const updates: Record<string, string> = {};
    for (const k of VOICE_KEYS) {
      console.log(`${b}${k.label}${x}  ${d}${k.unlocks}${x}`);
      console.log(`  Get a key: ${k.getUrl}`);
      const typed = await askHidden(`  Paste ${k.name}${saved[k.name] ? " (Enter keeps the saved one)" : " (Enter skips)"}: `);
      if (typed) updates[k.name] = typed;
      console.log("");
    }
    if (Object.keys(updates).length) saveKeys(updates);
  }
  const saved = readSaved();
  let ready = true;
  for (const k of VOICE_KEYS) {
    // The key the app will really use (shell, this folder's .env.local, then ~/.config/agentic-os.env).
    const key = providerKey(process.cwd(), k.name);
    if (key && saved[k.name] && key !== saved[k.name]) console.log(`${d}  note: ${k.name} is also set in your shell or .env.local; the app uses that one${x}`);
    if (!key) { ready = false; console.log(`${r}✗${x} ${k.label.padEnd(11)} missing   ${d}${k.getUrl}${x}`); continue; }
    const ok = await checkKey(k.name, key);
    if (!ok) ready = false;
    console.log(`${ok ? `${g}✓` : `${r}✗`}${x} ${k.label.padEnd(11)} ${ok ? "key accepted" : "was refused, check the key"}`);
  }
  if (existsSync(join(process.cwd(), ".operator-data", "openai-voice.json"))) console.log(`${d}  note: a key saved in the app's voice settings is used for live voice before OPENAI_API_KEY${x}`);
  console.log("");
  for (const [tool, why] of [["ffmpeg", "backup speech-to-text and Reels audio"], ["claude", "Claude Code runs real work"], ["codex", "Codex runs real work"]] as const) {
    const ok = hasTool(tool);
    console.log(`${ok ? `${g}✓` : `${d}·`}${x} ${tool.padEnd(11)} ${ok ? "installed" : `not found (optional: ${why})`}`);
  }
  console.log(ready ? `\n${g}Keys accepted.${x} Run ${b}bun run start${x}, open the app and tap the orb in the sidebar. (Paid calls also need credit on each account.)\n` : `\nRun ${b}bun run setup:voice${x} again after you fix the keys marked ✗.\n`);
}

if (import.meta.main) void main();
