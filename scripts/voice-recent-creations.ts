import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import type { RecentVoiceCreations } from "../src/lib/voice-recent";

const MAX_LEDGER = 16 * 1024 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;
type Entry = { path: string; ts: number; prompt?: string; model?: string; tool?: string };
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\x00-\x1f]/g, " ").trim().slice(0, max) : "";
const idFor = (path: string) => createHash("sha256").update(path).digest("hex");
const unavailable = () => Object.assign(new Error("This creation is no longer available."), { statusCode: 404 });

/** Generation time comes from the Design ledger; file mtime and imports are not creation evidence. */
export function voiceRecentCreations(options: { allowed: () => boolean; ledgerPath?: string; now?: () => number }) {
  const ledger = options.ledgerPath || join(homedir(), ".claude-os", "design", "ledger.jsonl");
  const now = options.now || Date.now;
  function entries(): Entry[] {
    if (!options.allowed()) throw new Error("Images are excluded from your AI context.");
    let descriptor: number | undefined;
    try {
      const before = lstatSync(ledger);
      if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_LEDGER)
        throw new Error("Design history is unavailable or too large for this quick lookup. Open Design to inspect it.");
      descriptor = openSync(ledger, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > MAX_LEDGER)
        throw new Error("Design history changed during this lookup. Try again.");
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
        if (!count) throw new Error("Design history changed during this lookup. Try again.");
        offset += count;
      }
      const rows: Entry[] = [];
      for (const line of buffer.toString("utf8").split("\n")) {
        try {
          const row = JSON.parse(line);
          if (row.kind !== "image" || row.backfill || !isAbsolute(row.path || "") ||
              typeof row.ts !== "number" || !Number.isFinite(row.ts) || row.ts <= 0 || row.ts > now() + 300000 ||
              !/\.(png|jpe?g|webp)$/i.test(row.path)) continue;
          rows.push({ path: row.path, ts: row.ts, prompt: clean(row.prompt, 500), model: clean(row.model, 120), tool: clean(row.tool, 80) });
        } catch { /* An interrupted or malformed record is not a completed creation. */ }
      }
      rows.sort((a, b) => b.ts - a.ts);
      const seen = new Set<string>();
      return rows.filter(row => {
        if (seen.has(row.path)) return false;
        seen.add(row.path);
        try {
          const stat = lstatSync(row.path);
          return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= MAX_IMAGE;
        } catch { return false; }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  return {
    list(): RecentVoiceCreations {
      const items = entries().slice(0, 6).map(row => ({
        id: idFor(row.path),
        title: row.prompt?.slice(0, 100) || (row.model ? `Image created with ${row.model}` : "Created image"),
        filename: basename(row.path),
        ...(row.prompt ? { prompt: row.prompt } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.tool ? { provider: row.tool } : {}),
        createdAt: new Date(row.ts).toISOString(),
        previewUrl: `/__operator/voice/creations/${idFor(row.path)}`,
      }));
      return {
        kind: "creations", checkedAt: new Date(now()).toISOString(), items,
        freshness: "Recent completed images recorded in Design. Ordered by recorded creation time, not file modification time. Imported/backfilled files are excluded.",
        instruction: "Show the returned creation preview. Describe the recorded generation prompt as a prompt, not as observed image content. Do not read opaque filenames aloud. No results means no available image with a recorded creation time, not that the user has never created images. This lookup does not send image bytes to the voice model.",
      };
    },
    image(id: string) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw unavailable();
      const row = entries().find(row => idFor(row.path) === id);
      if (!row) throw unavailable();
      let descriptor: number | undefined;
      try {
        const before = lstatSync(row.path);
        descriptor = openSync(row.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1 || stat.size > MAX_IMAGE || stat.size < 4) throw unavailable();
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
          if (!count) throw unavailable();
          offset += count;
        }
        const after = fstatSync(descriptor);
        if (after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.size !== stat.size || !options.allowed()) throw unavailable();
        const ext = extname(row.path).toLowerCase();
        const mimeType = ext === ".png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" :
          [".jpg", ".jpeg"].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" :
          ext === ".webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
        if (!mimeType) throw unavailable();
        return { bytes, mimeType };
      } catch { throw unavailable(); }
      finally { if (descriptor !== undefined) closeSync(descriptor); }
    },
  };
}
