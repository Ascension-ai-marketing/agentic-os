import type { InboxItem, OperatorState } from "../src/lib/operator";

export type InboxQuestionResult = {
  id: string;
  source: InboxItem["source"];
  title: string;
  from: string;
  excerpt: string;
  threadId?: string;
  url?: string;
  receivedAt: string;
  direction?: "inbound" | "outbound";
  reason: string;
};
type Segment = { id: string; body: string; from: string; date: string; direction?: "inbound" | "outbound"; unread: boolean; item?: InboxItem };
type Conversation = {
  id: string; source: InboxItem["source"]; title: string; from: string;
  threadId?: string; url?: string; segments: Segment[];
};
const STOP = new Set("a an the i me my mine we us our ours you your yours what who whom whose which when where why how is are was were be been being do does did can could would should will shall may might must have has had having of to for from about with at in on into and or but as that this these those it its am there here please hey bro find search show tell give get got look looking see want wants need needs know information people person persons someone somebody anyone anybody everyone everybody regarding related relevant concerning anything something stuff all any across through over under ask asks asked asking discuss discussed say says said mentioned mention mentions talking talk spoke talking message messages email emails mail inbox chat chats conversation conversations latest recent newest new come comes coming came received receive today yesterday week weeks days day past last seven 7 since only unread read reply replies respond response responses awaiting waiting sent outbound incoming inbound action actions required require needing attention require follow followup followups up sponsorship sponsorships sponsor sponsors partnership partnerships gmail outlook slack".split(/\s+/));
const clean = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function archiveQuestionTerms(question: string) {
  const meaningful = (clean(question).match(/[\p{L}\p{N}@._-]+/gu) || []).filter(word => word.length > 1 && !STOP.has(word));
  if (/\bsponsor\w*\b|\bpartnership\w*\b/.test(question.toLowerCase())) meaningful.push("sponsor", "partnership");
  return meaningful.join(" ");
}
function stem(word: string) {
  if (/^(sponsor|sponsorship|sponsoring|sponsored|partnership)/.test(word)) return "sponsor";
  if (["price", "prices", "pricing", "cost", "costs", "costing"].includes(word)) return "price";
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("ing") && word.length > 6) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}
const words = (text: string) => clean(text).match(/[\p{L}\p{N}]+/gu) || [];
const tokens = (text: string) => new Set(words(text).map(stem));
const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const newest = (segments: Segment[]) => [...segments].sort((a, b) => time(b.date) - time(a.date))[0];
function direction(item: InboxItem): Segment["direction"] {
  if (item.direction) return item.direction;
  if (item.labelIds?.includes("SENT")) return "outbound";
  // INBOX is provider evidence of an incoming message. Legacy captures with
  // no direction remain unknown rather than being labeled as an obligation.
  if (item.labelIds?.includes("INBOX")) return "inbound";
  return undefined;
}
function safeUrl(value?: string) {
  try { const url = new URL(value || ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined; } catch { return undefined; }
}
function requestCue(body: string) {
  return /\?|\b(?:can|could|would|will) you\b|\b(?:please|let me know|need your|awaiting your|your approval|confirm whether|confirm if)\b/i.test(body);
}
function dateRange(question: string, now: Date): [number, number] | undefined {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  if (/\btoday\b/.test(question)) return [start.getTime(), end.getTime()];
  if (/\byesterday\b/.test(question)) { const previous = new Date(start); previous.setDate(previous.getDate() - 1); return [previous.getTime(), start.getTime()]; }
  if (/\b(?:last|past) (?:7|seven) days\b|\bpast week\b/.test(question)) return [now.getTime() - 7 * 86400000, now.getTime() + 1];
  if (/\b(?:this|last) week\b/.test(question)) {
    const monday = new Date(start); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    if (/\blast week\b/.test(question)) { const previous = new Date(monday); previous.setDate(previous.getDate() - 7); return [previous.getTime(), monday.getTime()]; }
    return [monday.getTime(), now.getTime() + 1];
  }
  return undefined;
}
function excerpt(body: string, terms: string[]) {
  if (body.length <= 320) return body;
  const termsSet = new Set(terms);
  let index = 0;
  for (const match of body.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (termsSet.has(stem(clean(match[0])))) { index = match.index || 0; break; }
  }
  const start = Math.max(0, index - 90);
  return body.slice(start, Math.min(body.length, start + 320));
}

/** Deterministic retrieval over loaded local records; no provider or model calls. */
export function retrieveInboxQuestion({ question, state, now = new Date() }: {
  question: string;
  state: OperatorState;
  now?: Date | string | number;
}) {
  if (typeof question !== "string" || !question.trim() || question.length > 600) throw new Error("Ask a question between 1 and 600 characters.");
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error("The search date is invalid.");
  const q = clean(question.trim());
  const queryWords = words(q);
  const intent = {
    unread: /\bunread\b/.test(q),
    reply: /\b(?:needs?|awaits?|awaiting|requires?) (?:a |my |your )?(?:reply|response)\b|\b(?:reply|respond) to\b|\b(?:action|attention)(?: required| needed)?\b/.test(q),
    waiting: /\bwaiting\b|\bawaiting\b|\bfollow[ -]?ups?\b/.test(q),
    outbound: /\bsent\b|\boutbound\b/.test(q),
    inbound: /\bincoming\b|\binbound\b/.test(q),
    sponsors: /\bsponsor\w*\b|\bpartnership\w*\b|\bbrand deals?\b/.test(q),
  };
  if (intent.reply) intent.waiting = false;
  const terms = [...new Set(queryWords.filter(word => word.length > 1 && !STOP.has(word) && !(intent.sponsors && ["brand", "deal", "deals"].includes(word))).map(stem))];
  if (intent.sponsors && !terms.includes("sponsor")) terms.push("sponsor");
  const providers = new Set(queryWords.filter(word => ["gmail", "outlook", "slack"].includes(word)));
  const range = dateRange(q, at);
  const visible = (source: InboxItem["source"]) => state.settings.inboxAccounts?.[source] !== false && (!providers.size || providers.has(source));
  const inbox = state.inbox.filter(item => visible(item.source));
  const conversations = new Map<string, Conversation>();
  for (const item of inbox) {
    const key = item.threadId ? `${item.source}:${(item.account || "").toLowerCase()}:${item.threadId}` : `${item.source}:${item.id}`;
    let record = conversations.get(key);
    if (!record) {
      record = { id: item.id, source: item.source, title: item.subject, from: item.from, threadId: item.threadId, url: safeUrl(item.url), segments: [] };
      conversations.set(key, record);
    }
    record.segments.push({ id: item.id, body: item.body || "", from: item.from, date: item.receivedAt, direction: direction(item), unread: item.read === false, item });
  }
  const hits: Array<{ result: InboxQuestionResult; score: number }> = [];
  const hasIntent = Object.values(intent).some(Boolean);
  for (const record of conversations.values()) {
    const latest = newest(record.segments);
    if (!latest) continue;
    const isUnread = record.segments.some(segment => segment.unread);
    if (intent.unread && !isUnread) continue;
    if (intent.outbound && latest.direction !== "outbound") continue;
    if (intent.inbound && latest.direction !== "inbound") continue;
    if (intent.reply && !(latest.direction === "inbound" && requestCue(latest.body) && latest.item?.status !== "done" && latest.item?.category !== "updates")) continue;
    if (intent.waiting && latest.direction !== "outbound" && latest.item?.category !== "waiting") continue;
    if (!terms.length && !hasIntent && !range) continue;
    // Direction/response intents describe the current conversation, so older
    // questions that have since received a reply do not become action items.
    const candidates = intent.reply || intent.waiting || intent.outbound || intent.inbound ? [latest] : record.segments;
    let best: { segment: Segment; score: number; terms: string[] } | undefined;
    for (const segment of candidates) {
      if (range && (time(segment.date) < range[0] || time(segment.date) >= range[1])) continue;
      if (intent.unread && !segment.unread) continue;
      const bodyTokens = tokens(segment.body), titleTokens = tokens(segment.item?.subject || record.title), nameTokens = tokens(segment.from + " " + record.from);
      if (segment.item?.category === "sponsors") titleTokens.add("sponsor");
      if (/\bbrand deals?\b/i.test(segment.body)) bodyTokens.add("sponsor");
      const matched = terms.filter(term => bodyTokens.has(term) || titleTokens.has(term) || nameTokens.has(term));
      if (terms.length && matched.length < Math.max(1, Math.ceil(terms.length * 0.65))) continue;
      let score = matched.reduce((sum, term) => sum + (nameTokens.has(term) ? 7 : 0) + (titleTokens.has(term) ? 5 : 0) + (bodyTokens.has(term) ? 3 : 0), 0);
      if (terms.length > 1 && clean(segment.body).includes(terms.join(" "))) score += 5;
      if (intent.reply) score += 8;
      if (intent.waiting && requestCue(latest.body)) score += 3;
      if (intent.unread) score += 2;
      if (!best || score > best.score || (score === best.score && time(segment.date) > time(best.segment.date))) best = { segment, score, terms: matched };
    }
    if (!best) continue;
    const segment = best.segment;
    let reason: string;
    if (intent.reply) reason = /\?/.test(latest.body) ? "Latest incoming message asks a question." : "Latest incoming message contains a request.";
    else if (intent.waiting && latest.direction === "outbound") reason = "The latest loaded message is yours; no newer incoming message is loaded.";
    else if (intent.waiting) reason = "This conversation is marked Waiting.";
    else if (intent.unread) reason = latest.direction === "inbound" && segment === latest ? "Unread incoming message." : "This conversation contains unread messages.";
    else if (intent.outbound) reason = "The latest loaded message was sent by you.";
    else if (intent.inbound) reason = "The latest loaded message is incoming.";
    else if (segment.item?.bodyStatus === "metadata") reason = "Matching text found in an indexed snippet. The full email body was not loaded.";
    else if (segment !== latest) reason = "Matching text found in loaded conversation history.";
    else if (best.terms.some(term => tokens(segment.body).has(term))) reason = "Matching text found in this message.";
    else reason = "Matches the sender, conversation title or saved category.";
    hits.push({ score: best.score, result: {
      id: segment.id,
      source: record.source, title: segment.item?.subject || record.title,
      from: segment.from, excerpt: excerpt(segment.body, best.terms),
      threadId: record.threadId, url: safeUrl(segment.item?.url) || record.url,
      receivedAt: segment.date, direction: segment.direction, reason,
    } });
  }
  hits.sort((a, b) => b.score - a.score || time(b.result.receivedAt) - time(a.result.receivedAt) || a.result.id.localeCompare(b.result.id));
  return {
    results: hits.slice(0, 8).map(hit => hit.result),
    totalSearched: conversations.size,
    matchedCount: hits.length,
    coverage: `Searched ${conversations.size} loaded conversations. Results cover visible local data only; provider archives were not searched.`,
  };
}
