import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readImageOnCPU } from "./memory-imports";
import {
  CHAT_ATTACHMENT_BYTES,
  CHAT_ATTACHMENT_TEXT,
  type ChatAttachment,
} from "../src/lib/chat-attachments";
const run = promisify(execFile);
export async function extractChatAttachment(root: string, body: unknown): Promise<ChatAttachment> {
  const input = body as { filename?: unknown; base64?: unknown };
  if (!input || typeof input.filename !== "string" || typeof input.base64 !== "string")
    throw new Error("Choose a file to attach.");
  const name = basename(input.filename.replaceAll("\\", "/"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 240);
  const ext = extname(name).toLowerCase();
  const image = [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  if (!image && ![".pdf", ".txt", ".md", ".markdown", ".csv", ".json"].includes(ext))
    throw new Error("Attach a PDF, text, Markdown, CSV, JSON, PNG, JPEG or WebP file.");
  if (
    input.base64.length > Math.ceil(CHAT_ATTACHMENT_BYTES / 3) * 4 ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw new Error("The file is invalid or exceeds 5 MB.");
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > CHAT_ATTACHMENT_BYTES)
    throw new Error("Attach a non-empty file up to 5 MB.");
  let text = "";
  if (ext === ".pdf" || image) {
    const validImage =
      ext === ".png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : [".jpg", ".jpeg"].includes(ext)
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (ext === ".pdf" ? bytes.toString("ascii", 0, 5) !== "%PDF-" : !validImage)
      throw new Error("The file contents do not match its format.");
    const dir = await mkdtemp(join(tmpdir(), "agentic-chat-"));
    try {
      const path = join(dir, "attachment" + ext);
      await writeFile(path, bytes, { mode: 0o600 });
      if (image) text = await readImageOnCPU(root, path);
      else {
        try {
          text = (
            await run("pdftotext", ["-layout", path, "-"], {
              timeout: 25000,
              maxBuffer: 4 * 1024 * 1024,
            })
          ).stdout;
        } catch {
          throw new Error(
            "This PDF could not be read locally. Use a text PDF or export it as text. Local PDF reading requires pdftotext.",
          );
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("This document is not UTF-8 text. Export it as UTF-8 and try again.");
    }
    if (text.includes("\0"))
      throw new Error("This file contains binary data. Export it as text first.");
  }
  text = text.trim();
  if (!text)
    throw new Error(
      image
        ? "No text was found in this image. Image attachments currently read text only."
        : "No readable text was found. Try a text document.",
    );
  return {
    id: randomUUID(),
    name,
    text: text.slice(0, CHAT_ATTACHMENT_TEXT),
    bytes: bytes.length,
    kind: image ? "image" : "document",
    origin: image ? "images" : "files",
    truncated: text.length > CHAT_ATTACHMENT_TEXT,
  };
}
export function validateChatAttachments(input: unknown): ChatAttachment[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 6)
    throw new Error("A message can contain up to six attachments.");
  return input.map((a) => {
    if (
      !a ||
      typeof a.id !== "string" ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(a.id) ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      a.name.length > 240 ||
      typeof a.text !== "string" ||
      !a.text.trim() ||
      a.text.length > CHAT_ATTACHMENT_TEXT ||
      !Number.isInteger(a.bytes) ||
      a.bytes < 1 ||
      a.bytes > CHAT_ATTACHMENT_BYTES ||
      !["document", "image"].includes(a.kind) ||
      a.origin !== (a.kind === "image" ? "images" : "files") ||
      typeof a.truncated !== "boolean"
    )
      throw new Error("A chat attachment has invalid or oversized content.");
    return {
      id: a.id,
      name: a.name,
      text: a.text,
      bytes: a.bytes,
      kind: a.kind,
      origin: a.origin,
      truncated: a.truncated,
    };
  });
}
