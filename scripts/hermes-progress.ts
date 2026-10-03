/**
 * Reads the normal (not quiet) `hermes chat` output as it streams and splits it
 * into what the Chat page shows:
 *
 *   ┊ 💻 $ python3 -c '…'  0.1s        → an action ("Hermes ran a command")
 *   ╭─ ⚕ Hermes ─────╮ … ╰─────╯       → the answer text
 *   Session:        20260930_194034_ed2341 → the session to resume
 *
 * Banner lines, separators, "Initializing agent…" and the resume hint are dropped.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** API keys and tokens never reach the screen or the saved chat: they show as "••••". */
// Exact values of the keys saved on this computer: hidden wherever they appear,
// whatever their format. Pattern rules below catch the rest.
let knownSecrets: string[] = [];
export function setKnownSecrets(values: Iterable<string>) {
  knownSecrets = [...new Set([...values].map((v) => v.trim()).filter((v) => v.length >= 12))].sort((a, b) => b.length - a.length);
}
/** Credential values from the env files the OS reads and from this process. */
export function loadKnownSecrets(root: string, home = homedir()): string[] {
  const out: string[] = [];
  const credential = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)/i;
  for (const file of [join(root, ".env.local"), join(home, ".config/agentic-os.env"), join(home, ".hermes/.env")]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || !credential.test(m[1])) continue;
      // Same reading as the app's own key loader: quoted as-is, else drop a trailing "# comment".
      const raw = m[2].trim();
      out.push(/^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, "").trim());
    }
  }
  for (const [name, value] of Object.entries(process.env)) if (value && credential.test(name)) out.push(value);
  return out;
}

// Looks like a key, not a word: has a digit or base64 mark, or two capitals after the first letter.
const MIXED = String.raw`(?=[A-Za-z0-9._~+/=:-]*[0-9+/=]|[A-Za-z0-9._~-]+[A-Z][A-Za-z0-9._~-]*[A-Z])`;
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of knownSecrets) if (out.includes(secret)) out = out.split(secret).join("••••");
  return out
    // Higgsfield-style KEY_ID:KEY_SECRET pairs (hex or not).
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{16,}\b/gi, "••••")
    .replace(/\b[A-Za-z0-9_-]{12,}:[A-Za-z0-9_-]{32,}\b/g, "••••")
    .replace(/\b(sk|rk|pk)-(?:or-|proj-|ant-|fish-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "$1-••••")
    .replace(/\b(ghp|gho|github_pat|xox[abp])[_-][A-Za-z0-9_-]{10,}/g, "$1-••••")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza••••")
    // JWTs, including an empty {} payload ("e30").
    .replace(/\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{6,}/g, "••••")
    // Authorization headers: whatever follows is a credential.
    .replace(/(\bauthorization\b["']?\s*[:=]\s*["']?(?:bearer|basic|key|token)?\s*)[A-Za-z0-9._~+/=:-]{8,}/gi, "$1••••")
    // Bearer / Basic / Key / Token followed by something that looks like a key (mixed case, digits or base64 marks), not a word.
    // (Case-sensitive on purpose: the mixed-case test must see real capitals.)
    .replace(new RegExp(String.raw`(\b(?:[Bb]earer|[Bb]asic|[Kk]ey|[Tt]oken|BEARER|BASIC|KEY|TOKEN)\s+)` + MIXED + String.raw`[A-Za-z0-9._~+/=:-]{12,}`, "g"), "$1••••")
    // A quoted value under a credential name: {"FISH_API_KEY": "..."}, {"password": "a passphrase"}.
    .replace(/(["']?\b[A-Za-z0-9_.-]*(?:key|token|secret|credentials?)["']?\s*[:=]\s*["'])[^"'\s]{10,}/gi, "$1••••")
    .replace(/(["']?\b[A-Za-z0-9_.-]*(?:password|passphrase|passwd)["']?\s*[:=]\s*["'])[^"']{4,}/gi, "$1••••")
    // Unquoted name=value: only values that look like keys (they contain a digit).
    .replace(/(["']?\b[A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|credentials?|auth)\b["']?\s*[:=]\s*)(?=[^\s"',;}]*\d)[^\s"',;}]{8,}/gi, "$1••••");
}

/** Joins a stream into whole lines before they are filtered, so a key split across chunks is still hidden. */
export function lineBuffer(emit: (line: string) => void) {
  let rest = "";
  return {
    push(chunk: string) {
      rest += chunk;
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      for (const p of parts) emit(p + "\n");
    },
    end() {
      if (rest) emit(rest);
      rest = "";
    },
  };
}

export type HermesProgress = {
  action: (text: string) => void;
  text: (chunk: string) => void;
  session: (id: string) => void;
};

export function hermesProgressParser(emit: HermesProgress) {
  let buffer = "";
  let inAnswer = false;
  let answerLines = 0;
  function line(raw: string) {
    const clean = raw.replace(ANSI, "").replace(/\s+$/, "");
    const trimmed = clean.trim();
    if (!trimmed) {
      if (inAnswer && answerLines) emit.text("\n");
      return;
    }
    const session = trimmed.match(/^Session:\s+([A-Za-z0-9_-]{1,128})$/);
    if (session) return emit.session(session[1]);
    if (/^╭.*Hermes/.test(trimmed)) {
      inAnswer = true;
      answerLines = 0;
      return;
    }
    if (inAnswer && /^╰/.test(trimmed)) {
      inAnswer = false;
      return;
    }
    if (inAnswer) {
      // Rich may draw side borders on wrapped answers: "│ text │".
      const body = clean.replace(/^\s*│ ?/, "").replace(/ ?│\s*$/, "");
      emit.text((answerLines++ ? "\n" : "") + redactSecrets(body));
      return;
    }
    if (trimmed.startsWith("┊")) {
      const action = trimmed.slice(1).replace(/\s{2,}/g, " ").trim();
      if (action) emit.action(redactSecrets(action).slice(0, 300));
    }
  }
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, "\n");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
    },
    end() {
      if (buffer) line(buffer);
      buffer = "";
    },
  };
}
