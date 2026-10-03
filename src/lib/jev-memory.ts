// "When did I chat to Claude about pricing?" → Memory, focused on the records.
// Jev decides this is a Memory question and which source; these helpers pull
// the search words and the time range out of the sentence. Import-free so the
// server and the UI share them.

export const MEMORY_SOURCES: Record<string, { label: string; criteria: string; match: RegExp }> = {
  claude: { label: "Claude", criteria: "Past Claude or Claude Code chats and sessions", match: /\bclaude\b/i },
  codex: { label: "Codex", criteria: "Past Codex sessions", match: /\bcodex\b/i },
  chatgpt: { label: "ChatGPT", criteria: "Past ChatGPT conversations", match: /\b(chat ?gpt|gpt)\b/i },
  email: { label: "Email", criteria: "Emails", match: /\b(e-?mails?|inbox|gmail|outlook)\b/i },
  meetings: { label: "Meetings", criteria: "Meetings, calls and Granola notes", match: /\b(meetings?|calls?|granola)\b/i },
  notion: { label: "Notion", criteria: "Notion pages", match: /\bnotion\b/i },
  hermes: { label: "Hermes", criteria: "Hermes agent sessions", match: /\bhermes\b/i },
  obsidian: { label: "Obsidian", criteria: "Obsidian notes and the wiki", match: /\b(obsidian|wiki)\b/i },
  skills: { label: "Skills", criteria: "Saved skills", match: /\bskills?\b/i },
  any: { label: "all sources", criteria: "Any source, or the source is not named", match: /$^/ },
};

export type MemoryRange = "24h" | "7d" | "30d" | "90d" | "1y" | "all";

/** The time range named in a sentence, if any. */
export function memoryRange(text: string): MemoryRange {
  const t = text.toLowerCase();
  if (/\b(today|yesterday|last 24 hours|this morning|last night)\b/.test(t)) return "24h";
  if (/\b(this week|last week|past week|last 7 days|few days)\b/.test(t)) return "7d";
  if (/\b(this month|last month|past month|last 30 days|few weeks)\b/.test(t)) return "30d";
  if (/\b(last quarter|last 3 months|past 3 months|few months)\b/.test(t)) return "90d";
  if (/\b(this year|last year|past year)\b/.test(t)) return "1y";
  return "all";
}

const FILLER = new Set(
  "hey jev when what where which who did do does i me my we our was were is are the a an to with in on of for and or about talk talked talking chat chatted chatting discuss discussed discussing mention mentioned say said write wrote find show search look up pull bring that this those these ever last time times first remind can you could please any anything something stuff thing things conversation conversations chats notes note emails email session sessions it from".split(" "),
);

/** The words to search for. Prefers what follows "about", then drops filler, sources and dates. */
export function memoryQuery(text: string): string {
  const clean = text.replace(/[?!.,"“”]/g, " ").replace(/\s+/g, " ").trim();
  const range = /\b(today|yesterday|this|last|past|few)\s+(week|month|year|quarter|morning|night|days?|weeks|months|24 hours|7 days|30 days|3 months)\b/gi;
  const about = clean.match(/\b(?:about|regarding|re|mentioning|on the topic of|to do with)\s+(.+)$/i);
  const part = (about ? about[1] : clean).replace(range, " ");
  const sourceWords = new Set(Object.keys(MEMORY_SOURCES).concat(["chat gpt", "gpt", "granola", "gmail", "outlook", "wiki", "claude", "code"]));
  const words = part
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w && !FILLER.has(w.toLowerCase()) && !sourceWords.has(w.toLowerCase()));
  return words.slice(0, 6).join(" ");
}

/** The source named in a sentence, when Jev is not asked. */
export function memorySourceOf(text: string): string | undefined {
  return Object.entries(MEMORY_SOURCES).find(([id, s]) => id !== "any" && s.match.test(text))?.[0];
}
