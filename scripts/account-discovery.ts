import { homedir } from "node:os";
import { findExecutable, type LookupOptions } from "./assistant-runtime";

/** The Codex CLI: PATH, then the npm/bun/volta shim folders. On Windows this is
 * `codex.cmd` (npm) or `codex.exe`; the caller launches a `.cmd` through cmd.exe. */
export function installedCodex(home = homedir(), path?: string, options: LookupOptions = {}) {
  // Tests and fixtures set this so no real Codex process is ever spawned for them.
  if ((options.env ?? process.env).AGENTIC_OS_NO_CODEX === "1") return null;
  return findExecutable("codex", { ...options, home, path }) ?? null;
}
