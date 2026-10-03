import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Server-only configuration; values must never enter client-visible state. */
export function providerKey(root: string, name: string, options: {
  home?: string; env?: NodeJS.ProcessEnv;
} = {}): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return "";
  const env = options.env ?? process.env;
  if (env[name]?.trim()) return env[name]!.trim();
  const home = options.home ?? homedir();
  for (const file of [join(root, ".env.local"), join(home, ".config/agentic-os.env"), join(home, ".hermes/.env")]) {
    try {
      const match = readFileSync(file, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+)$`, "m"));
      if (!match) continue;
      let value = match[1].trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "").trim();
      if (value) return value;
    } catch { /* An unconfigured provider is an ordinary fresh-install state. */ }
  }
  return "";
}
