import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, extname, join, sep } from "node:path";
import { realpathSync, statSync } from "node:fs";
const run = promisify(execFile);
const roots = ["Documents", "Desktop", "Downloads"].map((x) => join(homedir(), x));
const extensions = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".html",
  ".htm",
  ".vtt",
  ".srt",
]);
export function allowedMemoryFile(path: string, hidden: string[]) {
  const real = realpathSync(path);
  if (
    !roots.some((r) => real.startsWith(r + sep)) ||
    !extensions.has(extname(real).toLowerCase()) ||
    real.split(sep).some((p) => p.startsWith(".") || ["node_modules", "references"].includes(p)) ||
    /credential|password|private.?key|secret|token|\.env/i.test(basename(real)) ||
    hidden.some((h) => basename(real, extname(real)).toLowerCase() === h.toLowerCase())
  )
    throw new Error("This file is not available for memory import.");
  const stat = statSync(real);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024)
    throw new Error("Choose a document smaller than 5 MB.");
  return real;
}
export async function findMemoryFiles(q: string, hidden: string[]) {
  const safe = q
    .replace(/[^\p{L}\p{N} -]/gu, " ")
    .trim()
    .slice(0, 100);
  if (safe.length < 2) return [];
  const tokens = safe.split(/\s+/).slice(0, 5),
    query = tokens.map((t) => `kMDItemFSName == '*${t}*'cd`).join(" && ");
  const results = await Promise.allSettled(
    roots.map((root) =>
      run("/usr/bin/mdfind", ["-onlyin", root, query], { timeout: 8000, maxBuffer: 1024 * 1024 }),
    ),
  );
  const found = new Set<string>();
  for (const r of results)
    if (r.status === "fulfilled")
      for (const path of r.value.stdout.trim().split("\n")) {
        try {
          found.add(allowedMemoryFile(path, hidden));
        } catch {}
      }
  return [...found]
    .slice(0, 40)
    .map((path) => ({
      id: Buffer.from(path).toString("base64url"),
      name: basename(path),
      path,
      kind: extname(path).slice(1),
    }));
}
