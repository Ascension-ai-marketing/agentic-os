/** AI with Jack's published response format. URLs remain untrusted model output. */
export function parseAdvisorResponse(raw: string) {
  const [answer, ...blocks] = raw.split("---SOURCES---");
  const references: Array<{ title: string; detail: string; url: string; kind: string }> = [];
  for (const line of blocks.join("\n").split("\n")) {
    const match = line.trim().match(/^\[(youtube|community|classroom|book)\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\S+)/i);
    if (!match) continue;
    try {
      const url = new URL(match[4]);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      references.push({ kind: match[1].toLowerCase(), title: match[2].slice(0, 200), detail: match[3].slice(0, 240), url: url.href });
    } catch { /* A partial or unsafe reference is not a link. */ }
    if (references.length >= 12) break;
  }
  return { text: answer.replace(/<<\s*nav\s*:[^>]+?>>/g, "").trim(), references };
}
