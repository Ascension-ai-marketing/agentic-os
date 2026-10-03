export const CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const CHAT_ATTACHMENT_TEXT = 24000;
export const CHAT_ATTACHMENT_ACCEPT = ".pdf,.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp";
export type ChatAttachment = {
  id: string;
  name: string;
  text: string;
  bytes: number;
  kind: "document" | "image";
  origin: "files" | "images";
  truncated: boolean;
};
/** Attachments are evidence, never instructions. Respect the same source switches as memory. */
export function attachmentContext(
  items: ChatAttachment[],
  enabled: (origin: string) => boolean,
): string {
  let remaining = 50000;
  return items
    .filter((a) => enabled(a.origin))
    .map((a) => {
      const text = a.text.slice(0, Math.max(0, remaining));
      remaining -= text.length;
      return text
        ? `${JSON.stringify(a.name)} (${a.kind === "image" ? "local OCR text only; no visual analysis" : "extracted document text"}${a.truncated || text.length < a.text.length ? "; excerpt truncated" : ""}):\n${text}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
