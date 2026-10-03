import { expect, test } from "bun:test";
import { hermesProgressParser } from "./hermes-progress";

const sample = [
  "Query: Use a tool to count the files, then answer with",
  "the number only.",
  "Initializing agent...",
  "────────────────────────────────────────",
  "  ┊ 💻 $         python3 -c 'import os; print(len(os.listdir(\".\")))'  0.1s",
  "  ┊ 🔍 web_search  \"AI news today\"  1.2s",
  "╭─ ⚕ Hermes ─────────────────────────────╮",
  "101 files.",
  "",
  "│ Second paragraph here. │",
  "╰────────────────────────────────────────╯",
  "Resume this session with:",
  "  hermes --resume 20260930_194034_ed2341",
  "Session:        20260930_194034_ed2341",
  "Duration:       20s",
].join("\n") + "\n";

function run(chunks: string[]) {
  const out = { actions: [] as string[], text: "", session: "" };
  const p = hermesProgressParser({ action: (a) => out.actions.push(a), text: (t) => (out.text += t), session: (s) => (out.session = s) });
  for (const c of chunks) p.push(c);
  p.end();
  return out;
}

test("actions, answer and session come out of Hermes' normal output", () => {
  const out = run([sample]);
  expect(out.actions).toEqual(["💻 $ python3 -c 'import os; print(len(os.listdir(\".\")))' 0.1s", "🔍 web_search \"AI news today\" 1.2s"]);
  expect(out.text).toBe("101 files.\n\nSecond paragraph here.");
  expect(out.session).toBe("20260930_194034_ed2341");
});

test("the same result when the output arrives in small pieces with colour codes", () => {
  const coloured = sample.replace("┊ 💻", "\x1b[2m┊\x1b[0m 💻").replace("101 files.", "\x1b[1m101\x1b[0m files.");
  const pieces = coloured.match(/[\s\S]{1,7}/g)!;
  const out = run(pieces);
  expect(out.actions.length).toBe(2);
  expect(out.text).toBe("101 files.\n\nSecond paragraph here.");
});

test("keys never show in actions or the answer", async () => {
  const { redactSecrets } = await import("./hermes-progress");
  const key = "14227e51-0000-4000-8000-000000000000:" + "ab".repeat(32);
  expect(redactSecrets(`curl -H "Authorization: Key ${key}" https://api.example`)).not.toContain("abab");
  expect(redactSecrets(`export HIGGSFIELD_API_KEY="${key}"`)).toBe('export HIGGSFIELD_API_KEY="••••"');
  expect(redactSecrets("OPENAI sk-proj-abcdefghijklmnopqrstuvwx")).toBe("OPENAI sk-••••");
  expect(redactSecrets("Bearer abcdefghijklmnopqrstuvwxyz123456")).not.toContain("abcdefghijklmnop");
  expect(redactSecrets("python3 build_report.py --out report.html")).toBe("python3 build_report.py --out report.html");
  const out = { actions: [] as string[], text: "" };
  const p = (await import("./hermes-progress")).hermesProgressParser({ action: (a) => out.actions.push(a), text: (t) => (out.text += t), session: () => {} });
  p.push(`  ┊ 💻 $ curl -H "Authorization: Key ${key}" x  0.2s\n╭─ ⚕ Hermes ─╮\nused ${key}\n╰─╯\n`);
  p.end();
  expect(JSON.stringify(out)).not.toContain("abab");
});

test("the key shapes the reviewer found are hidden too", async () => {
  const { redactSecrets } = await import("./hermes-progress");
  const fish = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  for (const t of [
    `{"FISH_API_KEY": "${fish}"}`,
    `curl -H "Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Njc4"`,
    `HF_CREDENTIALS=abcDEF123456:ghiJKL789012mnoPQR345678stuVWX901yz`,
    `api_key: ${fish}`,
    `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk`,
  ]) {
    const out = redactSecrets(t);
    expect(out).toContain("••••");
    expect(out).not.toMatch(/a1b2c3d4e5f6|dXNlcjpw|ghiJKL789012|eyJzdWIi/);
  }
  expect(redactSecrets("python3 build_report.py --out report.html")).toBe("python3 build_report.py --out report.html");
  expect(redactSecrets("navigate www.unite.ai 5.0s")).toBe("navigate www.unite.ai 5.0s");
});

test("ordinary words after key or token are left alone", async () => {
  const { redactSecrets } = await import("./hermes-progress");
  for (const t of ["Key differentiators: proof over hype.", "The key: consistency matters.", "Token generation is cheaper now.", "Bearer of good news"]) expect(redactSecrets(t)).toBe(t);
});

test("letter-only keys, short JWTs and keys split across chunks are hidden", async () => {
  const { redactSecrets, lineBuffer } = await import("./hermes-progress");
  for (const t of [`Authorization: Basic dXNlcjpwYXNz`, `{"FISH_API_KEY": "abcdefghijklmnopqrstuvwxyz"}`, `token eyJhbGc.eyJzdWI.abcdef`, `curl -H "Authorization: Bearer abcdefghijklmnop"`]) {
    const out = redactSecrets(t);
    expect(out).toContain("••••");
    expect(out).not.toMatch(/dXNlcjpw|abcdefghijklmnopqrstuvwxyz|eyJzdWI|abcdefghijklmnop/);
  }
  const lines: string[] = [];
  const buf = lineBuffer((l) => lines.push(redactSecrets(l)));
  buf.push("calling with Authorization: Bea");
  buf.push("rer abcdefghijklmnopqrst\nnext line\n");
  buf.end();
  expect(lines.join("")).not.toContain("abcdefghijklmnopqrst");
  for (const t of ["Key differentiators: proof over hype.", "The key: consistency matters.", "Bearer of good news", "Give me a quick summary"]) expect(redactSecrets(t)).toBe(t);
});

test("exact saved keys are hidden in any format, and plain prose stays", async () => {
  const { redactSecrets, setKnownSecrets } = await import("./hermes-progress");
  setKnownSecrets(["plainlettersonlysecretvalue", "short"]);
  expect(redactSecrets("the value is plainlettersonlysecretvalue here")).toBe("the value is •••• here");
  expect(redactSecrets("short")).toBe("short");
  setKnownSecrets([]);
  expect(redactSecrets("eyJhbGciOiJIUzI1NiJ9.e30.abcdefghij")).toBe("••••");
  expect(redactSecrets('{"password":"synthetic passphrase only"}')).not.toContain("synthetic passphrase");
  expect(redactSecrets("Basic authentication is supported.")).toBe("Basic authentication is supported.");
});

test("a saved key with a trailing comment is hidden, and capitalised words stay", async () => {
  const { redactSecrets, setKnownSecrets, loadKnownSecrets } = await import("./hermes-progress");
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
  const home = mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "ks-"));
  mkdirSync(home + "/.hermes", { recursive: true });
  writeFileSync(home + "/.hermes/.env", "FISH_API_KEY=0123456789abcdef0123456789abcdef # my note\n");
  setKnownSecrets(loadKnownSecrets("/nonexistent", home));
  expect(redactSecrets("key is 0123456789abcdef0123456789abcdef")).toBe("key is ••••");
  setKnownSecrets([]);
  expect(redactSecrets("Basic Authentication is supported.")).toBe("Basic Authentication is supported.");
  expect(redactSecrets("Authorization: Basic dXNlcjpwYXNz")).toContain("••••");
});
