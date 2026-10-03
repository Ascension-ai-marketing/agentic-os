// The free, instant local gate in front of Jev. Runs before any network call:
//  - chat:     a question or conversation → the chat's own model, no Jev.
//  - open:     a clear "take me to X" → open the page now, no Jev.
//  - memory:   "when did I…", "find where I…" → Memory, focused, no Jev.
//  - work:     build, fix, write code, research, draft, send… → Jev picks
//              Claude Code or Codex and the model (the big decision card).
//  - continue: a follow-up to the task open in this chat → same agent.
//  - ask-jev:  it sounds like navigation but the page is unclear → one quiet
//              Jev call, shown as a one-line result.
// Import-free apart from sibling libs, so the server and UI share it.
import { JEV_PAGES } from "./jev-pages";
import { memoryQuery, memoryRange, memorySourceOf } from "./jev-memory";

export type GateResult =
  | { kind: "chat" }
  | { kind: "open"; page: string; path: string; label: string }
  | { kind: "memory"; focus: { source?: string; query: string; range: ReturnType<typeof memoryRange>; view: "timeline"; open: true; openOriginal?: true } }
  | { kind: "open-current" }
  | { kind: "work" }
  | { kind: "continue" }
  | { kind: "ask-jev" };

// Spoken names for each page. Longest match wins ("design library" before "design").
const PAGE_WORDS: [string, RegExp][] = [
  ["library", /\b(design )?library\b/],
  ["reels", /\breels?\b/],
  ["motion", /\bmotion( library)?\b/],
  ["build", /\b(design )?build room\b/],
  ["dashboard", /\b(dashboard|business( page)?|home( page)?|morning brief|brief)\b/],
  ["inbox", /\b(inbox|e-?mails?|mail)\b/],
  ["calendar", /\b(calendar|schedule|agenda)\b/],
  ["memory", /\b(memory|memories|brain|knowledge)\b/],
  ["design", /\b(design( studio)?|studio)\b/],
  ["website", /\b(websites?|site builder|sites)\b/],
  ["hermes", /\bhermes\b/],
  ["settings", /\b(settings|connections|preferences)\b/],
  ["chat", /\bchats?\b/],
];

const NAV = /^(?:(?:hey |ok |okay )?jev[,:]?\s+)?(?:(?:can|could|would) you\s+|please\s+|let'?s\s+|i want to\s+|i'?d like to\s+)?(?:go(?:\s+to)?|take me(?:\s+to)?|bring me(?:\s+to)?|open(?:\s+up)?|show me|pull up|bring up|jump to|navigate to|head to|switch to|check out|go check out|go and check|go look at)\b/i;
const MEMORY = /\b(when did i|when was the last time i|find where i|where did i|did i ever|have i ever|what did i (say|write|tell)|remind me what i|show me (my )?(old|past|previous) (chats?|notes?|emails?|conversations?|meetings?))\b/i;
// Verbs that mean "do this for me", at the start of the request (after polite words).
const WORK = /^(?:(?:hey |ok |okay )?jev[,:]?\s+)?(?:(?:can|could|would|will) you\s+|please\s+|i need you to\s+|i want you to\s+|go ahead and\s+|let'?s\s+)?(?:build|make me|make a|create|code|write (?:a |the |me )?(?:script|function|program|app|page|test|code|report|doc|draft|email|post|blog|brief)|implement|fix|debug|refactor|deploy|ship|research|investigate|draft|edit|rewrite|update|change|add|remove|delete|rename|send|email|post|publish|schedule|book|set up|install|generate|design me|redesign|scrape|automate|run|test|review (?:the |my )?(?:code|pr|repo))\b/i;
// Only clear follow-up words continue the open task ("now…", "then…" are too common).
const FOLLOW = /^(?:also\b|make it\b|change it\b|keep going\b|continue\b|carry on\b|can you also\b|and also\b)/i;

// Things the OS can press for you, spoken or typed. Each opens a page with a
// deep link that starts the action there (the walkthrough).
const LEAD = /^(?:(?:hey |ok |okay )?jev[,:]?\s+)?(?:(?:can|could|would|will) you\s+|please\s+|let'?s\s+|go ahead and\s+|i want to\s+)?/i;
function action(lower: string): GateResult | null {
  const t = lower.replace(LEAD, "").trim();
  if (/^(sort|organi[sz]e|triage|clean up|tidy)\b.*\b(inbox|e-?mails?|mail)\b/.test(t)) return { kind: "open", page: "inbox", path: "/inbox?jev=sort", label: "Inbox · Sort all with Jev" };
  const inv = t.match(/^(?:find|search|show me|pull up|look for|get)\s+(?:me\s+)?(.*\binvoices?\b.*)$/);
  if (inv) {
    const q = inv[1].replace(/\b(my|the|an?|please)\b/g, " ").replace(/\s+/g, " ").trim();
    return { kind: "open", page: "inbox", path: `/inbox?jev=invoices&q=${encodeURIComponent(q)}`, label: "Invoice search" };
  }
  if (/\b(run|start|play|show)\b.*\baudio pipeline\b/.test(t) || /^(the\s+)?audio pipeline\b/.test(t) || /\b(add|put)\b.*\bsound effects?\b.*\breels?\b/.test(t)) return { kind: "open", page: "reels", path: "/design?mode=reels&audio=run", label: "Reels · Audio pipeline" };
  if (/\b(let jev pick|jev,? pick|pick the best (styles?|takes?|looks?))\b/.test(t) || /^(pick|choose)\b.*\breels?\b/.test(t)) return { kind: "open", page: "reels", path: "/design?mode=reels&jev=pick", label: "Reels · Let Jev pick" };
  const img = t.match(/^(?:search|find|show me|look for)\s+(?:my\s+|for\s+)?(?:images?|pictures?|photos?|visuals?)\s+(?:of|for|with|about|showing)\s+(.+)$/) || t.match(/^(?:search|find)\s+(?:my\s+)?(?:images?|pictures?|photos?|visuals?|library)\s+for\s+(.+)$/);
  if (img) return { kind: "open", page: "library", path: `/design?mode=library&q=${encodeURIComponent(img[1].replace(/[?.!]+$/, ""))}&ask=1`, label: "Image search" };
  if (/^open\s+(it|that|this)(\s+(file|note|one|email|page|doc|document|record))?\b/.test(t) || /^open\s+(?:it\s+|this\s+|that\s+)?in\s+(?:a\s+)?new\s+(?:window|tab)\b/.test(t)) return { kind: "open-current" };
  // "show me my OpenAI fact sheet", "open the launch plan doc": a saved file, found in Memory.
  const named = t.replace(/^(?:hey\s+\w+,?\s+)?(?:can you|could you|please|would you)\s+/, "").match(/^(show me|pull up|bring up|find|open(?: up)?)\s+(?:the\s+|my\s+|that\s+)?(.+?)\s+(fact ?sheets?|facts|one-?pager|file|note|doc|document|pdf|report|deck|brief)(?:\s+(?:again|please|for me))?[?.!]*$/);
  if (named && !/\b(inbox|calendar|chat|dashboard|settings)\b/.test(named[2])) {
    const query = `${named[2]} ${named[3]}`.trim();
    const source = memorySourceOf(named[2]);
    return { kind: "memory", focus: { ...(source ? { source } : {}), query, range: memoryRange(query), view: "timeline", open: true, ...(named[1].startsWith("open") ? { openOriginal: true as const } : {}) } };
  }
  const file = t.replace(/^(?:hey\s+\w+,?\s+)?(?:can you|could you|please|would you)\s+/, "").match(/^(?:open(?: up)?|pull up|bring up|show me|find)\s+(?:the\s+|my\s+|that\s+)?(file|note|doc|document|email|notion page|page|fact ?sheet|sheet|one-?pager|report|brief)\s+(?:about|on|for|called|named|from)\s+(.+)$/);
  if (file) {
    const verb = t.replace(/^(?:hey\s+\w+,?\s+)?(?:can you|could you|please|would you)\s+/, "");
    const topic = file[2].replace(/[?.!]+$/, "");
    const source = memorySourceOf(topic);
    const query = /^(?:email|page|notion page)$/.test(file[1]) ? memoryQuery(`find where I talked about ${topic}`) : `${topic} ${file[1]}`;
    return { kind: "memory", focus: { ...(source ? { source } : {}), query, range: memoryRange(topic), view: "timeline", open: true, ...(/^open/.test(verb) ? { openOriginal: true as const } : {}) } };
  }

  return null;
}

/** Classify a message without any network call. */
export function gate(text: string, opts: { hasOpenTask?: boolean } = {}): GateResult {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return { kind: "chat" };
  const lower = t.toLowerCase();
  if (opts.hasOpenTask && FOLLOW.test(lower)) return { kind: "continue" };
  const act = action(lower);
  if (act) return act;
  if (MEMORY.test(lower)) {
    const source = memorySourceOf(t);
    return { kind: "memory", focus: { ...(source ? { source } : {}), query: memoryQuery(t), range: memoryRange(t), view: "timeline", open: true } };
  }
  if (NAV.test(lower)) {
    const rest = lower.replace(NAV, "").trim();
    // "show me how to…", "open a PR", "show me what's on…" are not pages.
    // "open the calendar and delete everything" is more than a page: let Jev judge it.
    if (/\b(and|then|but|after)\b/.test(rest)) return { kind: "ask-jev" };
    if (!/^(how|why|what|what's|whats|when|who|if|a|an)\b/.test(rest)) {
      const hit = PAGE_WORDS.find(([, re]) => re.test(rest));
      const spec = hit && JEV_PAGES[hit[0]];
      if (spec) return { kind: "open", page: hit![0], path: spec.path, label: spec.label };
      if (rest.split(" ").length <= 4 && !WORK.test(rest)) return { kind: "ask-jev" };
    }
  }
  if (WORK.test(lower)) return { kind: "work" };
  // "Kick something off in Codex", "get Claude Code to…": naming an agent to do something is work.
  if (/\b(codex|claude code|claude)\b/.test(lower) && /\b(kick|start|run|research|build|make|write|fix|do|draft|create|get|have|ask)\b/.test(lower) && !/^(what|how|why|is|are|does|do you know)\b/.test(lower)) return { kind: "work" };
  // Questions and everything else: the chat's own model answers.
  return { kind: "chat" };
}
