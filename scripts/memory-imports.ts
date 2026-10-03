import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export const imageFile = (name: string) => /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp)$/i.test(name);
export const imageOCRAvailable = () =>
  process.platform === "darwin" &&
  (existsSync("/Library/Developer/CommandLineTools/usr/bin/clang") ||
    existsSync("/Applications/Xcode.app/Contents/Developer/usr/bin/clang"));
export type LocalProvider = "codex" | "claude";
const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex");
export function localMemoryFiles(provider: string, home = homedir()) {
  if (!["codex", "claude"].includes(provider)) throw new Error("Choose Codex or Claude memory.");
  const roots: string[] = [];
  if (provider === "codex") roots.push(join(home, ".codex/memories"));
  else {
    const projects = join(home, ".claude/projects");
    if (existsSync(projects))
      for (const d of readdirSync(projects, { withFileTypes: true }))
        if (d.isDirectory()) roots.push(join(projects, d.name, "memory"));
    roots.push(join(home, ".claude/memory"));
  }
  const files: Array<{
    id: string;
    title: string;
    path: string;
    bytes: number;
    updatedAt: string;
    absolute: string;
  }> = [];
  let truncated = false;
  const visit = (folder: string, root: string, depth: number) => {
    if (!existsSync(folder) || depth > 4 || lstatSync(folder).isSymbolicLink()) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (files.length >= 500) {
        truncated = true;
        return;
      }
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        /^(skills|extensions|node_modules|raw_memories\.md)$/.test(entry.name)
      )
        continue;
      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(file, root, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.md$/i.test(entry.name) ||
        /credential|password|private.?key|secret|token|\.env/i.test(entry.name)
      )
        continue;
      const real = realpathSync(file),
        stat = statSync(real);
      if (!real.startsWith(realpathSync(root) + sep) || stat.size > 1024 * 1024 || stat.size < 15)
        continue;
      files.push({
        id: fingerprint(provider + ":" + real),
        title: basename(file, ".md").replace(/[_-]+/g, " "),
        path: "~/" + relative(home, file),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        absolute: real,
      });
    }
  };
  for (const root of roots) {
    // Never follow a replacement symlink in a path segment into an unrelated store.
    const parts = relative(home, root).split(sep);
    let current = home,
      symlink = false;
    for (const part of parts) {
      current = join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        symlink = true;
        break;
      }
    }
    if (!symlink) visit(root, root, 0);
  }
  return { files, truncated };
}
export function readLocalMemories(provider: string, ids: unknown, home = homedir()) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Select between 1 and 100 memory files.");
  const available = localMemoryFiles(provider, home).files;
  return [...new Set(ids as string[])].map((id) => {
    const file = available.find((f) => f.id === id);
    if (!file) throw new Error("A selected memory file is no longer available. Scan again.");
    return { ...file, text: readFileSync(file.absolute, "utf8").slice(0, 600000) };
  });
}
const compiling = new Map<string, Promise<string>>();
export async function readImageOnCPU(root: string, file: string) {
  if (!imageOCRAvailable())
    throw new Error("Local image text recognition requires macOS and Apple Command Line Tools.");
  const source = join(root, "scripts/memory-ocr.m"),
    bin = join(
      root,
      ".operator-data/bin",
      "memory-ocr-" + fingerprint(readFileSync(source, "utf8")).slice(0, 12),
    );
  if (!existsSync(bin)) {
    if (!compiling.has(bin))
      compiling.set(
        bin,
        (async () => {
          mkdirSync(join(root, ".operator-data/bin"), { recursive: true, mode: 0o700 });
          const temp = bin + "." + randomUUID();
          await run(
            "/usr/bin/xcrun",
            [
              "clang",
              "-fobjc-arc",
              "-O2",
              "-framework",
              "Foundation",
              "-framework",
              "Vision",
              "-framework",
              "ImageIO",
              "-framework",
              "CoreGraphics",
              source,
              "-o",
              temp,
            ],
            { timeout: 45000, maxBuffer: 1024 * 1024 },
          );
          renameSync(temp, bin);
          return bin;
        })().finally(() => compiling.delete(bin)),
      );
    await compiling.get(bin);
  }
  try {
    return (await run(bin, [file], { timeout: 35000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  } catch {
    throw new Error(
      "This image could not be read locally. Try a clear PNG or JPEG containing text.",
    );
  }
}
export function notionPageId(input: string) {
  let candidate = input.trim();
  if (/^https?:/i.test(candidate)) {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !/(^|\.)(notion\.so|notion\.site)$/.test(url.hostname))
      throw new Error("Use a Notion page link or page ID.");
    candidate = url.pathname.split("/").filter(Boolean).pop() || "";
  }
  const match = candidate.match(
    /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i,
  );
  if (!match) throw new Error("That link does not contain a Notion page ID.");
  const s = match[1].replaceAll("-", "");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export async function fetchNotionPage(token: string, input: string, fetcher: typeof fetch = fetch) {
  const id = notionPageId(input);
  const get = async (path: string) => {
    const response = await fetcher("https://api.notion.com/v1" + path, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2026-03-11" },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Notion rejected this integration token. Reconnect Notion."
          : [403, 404].includes(response.status)
            ? "Share this Notion page with your integration, then try again."
            : response.status === 429
              ? "Notion is busy. Wait a moment and try again."
              : `Notion could not return the page (${response.status}).`,
      );
    const raw = await response.text();
    if (raw.length > 3 * 1024 * 1024)
      throw new Error(
        "This Notion page is too large. Import a smaller page or export selected content.",
      );
    return JSON.parse(raw);
  };
  const [page, content] = await Promise.all([get(`/pages/${id}`), get(`/pages/${id}/markdown`)]);
  if (content.truncated || content.unknown_block_ids?.length)
    throw new Error(
      "Notion returned incomplete page content. Export this page as Markdown or HTML and upload it instead.",
    );
  if (typeof content.markdown !== "string" || content.markdown.trim().length < 15)
    throw new Error("This Notion page has no readable text to import.");
  if (content.markdown.length > 600000)
    throw new Error("This Notion page is too large. Import a smaller page.");
  const property: any = Object.values(page.properties || {}).find((p: any) => p.type === "title");
  const title =
    (property?.title || []).map((p: any) => p.plain_text || p.text?.content || "").join("") ||
    "Notion page";
  return {
    id,
    title,
    text: content.markdown,
    url: `https://www.notion.so/${id.replaceAll("-", "")}`,
  };
}
/** Extract text from common .eml exports, without fetching remote resources or attachments. */
export function emailText(raw: string, htmlText: (s: string) => string) {
  const extract = (part: string, depth = 0): string => {
    if (depth > 8) return "";
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) return part;
    const header = part.slice(0, split).replace(/\r?\n[ \t]+/g, " "),
      body = part.slice(split).replace(/^\r?\n\r?\n/, "");
    if (/content-disposition:\s*attachment/i.test(header)) return "";
    const boundary = header.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (boundary)
      return body
        .split("--" + (boundary[1] || boundary[2]))
        .slice(1)
        .filter((s) => !s.startsWith("--"))
        .map((p) => extract(p.trim(), depth + 1))
        .filter(Boolean)
        .join("\n");
    const mime = header.match(/^content-type:\s*([^;\r\n]+)/im)?.[1].trim();
    if (mime && !/^text\/(plain|html)$/i.test(mime)) return "";
    let decoded = body;
    if (/content-transfer-encoding:\s*base64/i.test(header))
      decoded = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
    else if (/content-transfer-encoding:\s*quoted-printable/i.test(header)) {
      const input = body.replace(/=\r?\n/g, "");
      const bytes: number[] = [];
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "=" && /^[\da-f]{2}$/i.test(input.slice(i + 1, i + 3))) {
          bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(...Buffer.from(input[i]));
      }
      decoded = Buffer.from(bytes).toString("utf8");
    }
    return /content-type:\s*text\/html/i.test(header) ? htmlText(decoded) : decoded;
  };
  const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  const metadata = ["From", "To", "Subject", "Date"]
    .map((k) => head.match(new RegExp(`^${k}: (.+)$`, "im"))?.[0])
    .filter(Boolean)
    .join("\n");
  return metadata + "\n\n" + extract(raw);
}
