// ChatGPT export: find the data export zip that ChatGPT emails you, pull out
// conversations.json and put it where Memory already looks
// (~/Downloads/ChatGPT/conversations.json). No prompt, no terminal.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export type ExportZip = { path: string; name: string; modifiedAt: string; bytes: number; entry: string };

const isWin = process.platform === "win32";

/** Entry names inside a zip, or [] if it is not a readable zip. */
export function zipEntries(zip: string): string[] {
  const run = isWin
    ? spawnSync("tar", ["-tf", zip], { encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024 })
    : spawnSync("unzip", ["-Z1", zip], { encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0 || typeof run.stdout !== "string") return [];
  return run.stdout.split(/\r?\n/).filter(Boolean);
}

/** The conversations file inside a ChatGPT export, at the top or one folder down. */
export const conversationsEntry = (entries: string[]) =>
  entries.find((e) => /^(?:[^/]+\/)?conversations\.json$/i.test(e));

/** Newest zip in Downloads that holds a ChatGPT conversations.json. */
export function findChatgptExportZip(home: string, limit = 30): ExportZip | undefined {
  const dir = join(home, "Downloads");
  let zips: Array<{ path: string; name: string; mtime: number; bytes: number }> = [];
  try {
    zips = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.zip$/i.test(d.name))
      .map((d) => {
        const path = join(dir, d.name),
          stat = statSync(path);
        return { path, name: d.name, mtime: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return undefined;
  }
  for (const zip of zips) {
    const entry = conversationsEntry(zipEntries(zip.path));
    if (entry)
      return { path: zip.path, name: zip.name, modifiedAt: new Date(zip.mtime).toISOString(), bytes: zip.bytes, entry };
  }
  return undefined;
}

export const chatgptTarget = (home: string) => join(home, "Downloads", "ChatGPT", "conversations.json");

/**
 * A ChatGPT conversations.json: a JSON array of conversation objects. The file
 * can be gigabytes, so it is checked at both ends instead of parsed whole: it
 * opens with "[" then "{" (or is exactly "[]"), closes with "]", and the first
 * megabyte holds a conversation's "mapping".
 */
export function looksLikeConversations(file: string) {
  const size = statSync(file).size;
  if (size < 2) return false;
  // Most exports fit in memory: parse them whole and check every conversation.
  if (size <= FULL_PARSE_BYTES) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(data) && data.every((c) => c && typeof c === "object" && !Array.isArray(c) && c.mapping && typeof c.mapping === "object");
    } catch {
      return false;
    }
  }
  const fd = openSync(file, "r");
  try {
    const headLen = Math.min(size, 1024 * 1024);
    const head = Buffer.alloc(headLen);
    readSync(fd, head, 0, headLen, 0);
    const tailLen = Math.min(size, 64);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    const h = head.toString("utf8"), t = tail.toString("utf8");
    if (!/\]\s*$/.test(t)) return false;
    if (/^\s*\[\s*\]\s*$/.test(h) && size === headLen) return true;
    return /^\s*\[\s*\{/.test(h) && /"mapping"\s*:/.test(h);
  } finally {
    closeSync(fd);
  }
}

/** Exports up to this size are parsed whole; larger ones are checked at both ends. */
const FULL_PARSE_BYTES = 512 * 1024 * 1024;
/**
 * Swap a checked export in. The export it replaces is kept once as
 * conversations.previous.json, so even a file too large to parse whole (checked
 * at both ends only) can never cost you the export you had.
 */
export function replaceExport(fresh: string, target: string) {
  if (existsSync(target)) renameSync(target, target.replace(/\.json$/, ".previous.json"));
  renameSync(fresh, target);
}

/** Largest conversations.json we unpack, and how long unpacking may take. */
const MAX_UNPACKED = 8 * 1024 * 1024 * 1024;
const UNPACK_TIMEOUT_MS = 15 * 60 * 1000;

/** Streams conversations.json out of the zip and swaps it in only when it is complete and valid. */
export async function extractChatgptExport(zip: string, home: string, limits: { maxBytes?: number; timeoutMs?: number } = {}) {
  const entry = conversationsEntry(zipEntries(zip));
  if (!entry) throw new Error("This zip is not a ChatGPT export. It has no conversations.json.");
  const target = chatgptTarget(home);
  mkdirSync(join(home, "Downloads", "ChatGPT"), { recursive: true });
  const tmp = `${target}.${randomUUID()}.part`;
  const maxBytes = limits.maxBytes ?? MAX_UNPACKED;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = isWin ? spawn("tar", ["-xOf", zip, entry]) : spawn("unzip", ["-p", zip, entry]);
      const out = createWriteStream(tmp, { mode: 0o600, flags: "wx" });
      let bytes = 0, failed = false;
      const fail = (message: string) => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        out.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail("Unpacking the export took too long."), limits.timeoutMs ?? UNPACK_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) fail("The conversations file in this export is too large to unpack.");
      });
      child.stdout.pipe(out);
      child.on("error", () => fail("The export could not be unpacked."));
      out.on("error", () => fail("The export could not be saved. Check the free disk space."));
      child.on("close", (code) => {
        if (failed) return;
        clearTimeout(timer);
        out.end(() => (code === 0 ? resolve() : fail("The export could not be unpacked.")));
      });
    });
    if (!looksLikeConversations(tmp)) throw new Error("The conversations file in this export is not readable.");
    replaceExport(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return { path: target, bytes: statSync(target).size, from: basename(zip) };
}

/** A zip or conversations.json chosen in the app, saved first, then unpacked the same way. */
export async function importUploadedExport(
  dataDir: string,
  home: string,
  body: AsyncIterable<Buffer | string>,
  filename: string,
  maxBytes = 4 * 1024 * 1024 * 1024,
) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const isJson = /\.json$/i.test(filename);
  const upload = join(dataDir, `chatgpt-upload.${randomUUID()}.${isJson ? "json" : "zip"}`);
  const out = createWriteStream(upload, { mode: 0o600, flags: "wx" });
  let size = 0;
  try {
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error("This export is larger than 4 GB.");
        if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    if (!isJson) return await extractChatgptExport(upload, home);
    if (!looksLikeConversations(upload)) throw new Error("Choose conversations.json or the export zip.");
    mkdirSync(join(home, "Downloads", "ChatGPT"), { recursive: true });
    replaceExport(upload, chatgptTarget(home));
    return { path: chatgptTarget(home), bytes: size, from: filename };
  } finally {
    if (existsSync(upload)) rmSync(upload, { force: true });
  }
}
