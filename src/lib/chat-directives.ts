/** Requests that ask to move somewhere. Only these let a model reply navigate. */
export const NAV_INTENT =
  /^(take me|go( to)?|open|show( me)?|bring up|navigate|jump)\b|where('s| is| are| can i (see|find))\b/i;

/** Strip a model's <<nav:/path>> directive and return the allowlisted target, if any. */
export function readNavDirective(raw: string, allowed: string[]): { text: string; target?: string } {
  const match = raw.match(/<<\s*nav\s*:\s*([^>]+?)\s*>>/);
  const text = raw.replace(/<<\s*nav\s*:\s*[^>]+?>>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!match) return { text };
  const target = match[1].trim();
  return allowed.includes(target.split("?")[0]) ? { text, target } : { text };
}

/** A reply may only move the user when the user asked to go somewhere; otherwise it becomes a link. */
export function shouldFollowNavDirective(request: string): boolean {
  return NAV_INTENT.test(request.trim());
}

export function pageNameFor(path: string): string {
  const segment = path.split("?")[0].split("/").filter(Boolean).at(-1) || "home";
  return segment.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
