import { createHash } from "node:crypto";

const address = (value: unknown) => typeof value === "string" ? value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase() : undefined;
const text = (value: unknown) => typeof value === "string" ? value : "";
const labels = (item: any) => Array.isArray(item.labelIds) ? item.labelIds : [];
const draft = (item: any) => labels(item).includes("DRAFT") || Boolean(item.gmailDraftId);
const freeDomains = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com"]);

// The latest authored message drives urgency. Quoted replies and signatures may
// contain old offers or deadlines; retain them as evidence, never as new asks.
export function authoredMailText(value: unknown) {
  const body = text(value).replace(/\r\n/g, "\n").replace(/[\u034f\u200b-\u200f\ufeff]/g, "");
  const boundary = body.search(/\n(?:\s*>|\s*On [^\n]{4,180}(?:\n[^\n]{0,180})?wrote:|\s*_{5,}|\s*-{3,}\s*Original Message|\s*From: [^\n]+\n\s*(?:Sent|Date):)/i);
  const authored = boundary >= 0 ? body.slice(0, boundary) : body;
  const signature = authored.search(/\n\s*(?:\[image:|HEAD OF (?:BRAND )?PARTNERSHIPS|Sent from my|Powered by|Best regards,|Kind regards,)/i);
  return (signature >= 0 ? authored.slice(0, signature) : authored).trim();
}

function direction(item: any, ownAddresses: Set<string>, ownDomains: Set<string>) {
  if (draft(item)) return "draft";
  if (["inbound", "outbound"].includes(item.direction)) return item.direction as "inbound" | "outbound";
  if (labels(item).includes("SENT")) return "outbound";
  const from = address(item.from);
  if (from && ownAddresses.has(from)) return "outbound";
  if (from && ownDomains.has(from.split("@")[1])) return "same-organization";
  return from ? "inbound" : "unknown";
}

/** Scan the complete eligible corpus before selecting prompt evidence. The score
 * is a transparent retrieval heuristic, not a claim that a task is outstanding. */
export function rankBriefInbox(items: any[], imports: any[], asOf: Date, limit = 20) {
  const ownAddresses = new Set<string>(imports.map(row => address(row.account)).filter((value): value is string => Boolean(value)));
  const ownDomains = new Set([...ownAddresses].map(value => value.split("@")[1]).filter(value => !freeDomains.has(value)));
  const now = asOf.getTime(), threads = new Map<string, any[]>();
  for (const item of items) {
    const key = `${item.source}:${text(item.account).toLowerCase()}:${item.threadId || item.id}`;
    const rows = threads.get(key) || []; rows.push(item); threads.set(key, rows);
  }
  const ranked = [...threads.entries()].map(([key, rows]) => {
    rows.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const latest = rows.find(item => !draft(item)) || rows[0];
    const latestDraft = rows.find(draft), latestDirection = direction(latest, ownAddresses, ownDomains);
    const authored = authoredMailText(latest.body), subject = text(latest.subject), current = `${subject}\n${authored}`;
    const ageDays = Math.max(0, (now - Date.parse(latest.receivedAt)) / 86400000);
    const reasons: string[] = [];
    let score = Math.max(0, 12 - ageDays);
    const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
    const money = [...authored.matchAll(/(?:\$|USD\s*|GBP\s*|EUR\s*|£|€)\s*(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b/g)].map(match => Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1));
    const monetaryMention = Math.max(0, ...money);
    const hasCommercial = /\b(?:invoice|payment|contract|agreement|paid|sponsor(?:ship)?|client|campaign|deliverable|collaboration)\b/i.test(current);
    const request = /\b(?:please (?:send|confirm|review|update|approve|sign|share|check|ensure)|could you|can you|need (?:you|your)|awaiting (?:your|the)|requires? (?:your|action))\b/i.test(current);
    const obligation = /\b(?:goes? live|scheduled (?:a )?slot|deliverable|deliver(?:y|ing)|deadline|signed (?:contract|agreement)|contractual|final participant|revised proposal|invoice for payment)\b/i.test(current);
    const promise = /\b(?:we(?:'|’)ll|I(?:'|’)ll|we will|I will)\s+(?:send|deliver|record|publish|update|confirm|provide|finish|get back|come back|check)\b/i.test(authored);
    const timeSensitive = ageDays <= 3 && /\b(?:tomorrow|today|within (?:24|48) hours|deadline|due (?:on|by)|goes? live)\b/i.test(current);
    const waiting = /\b(?:I(?:'|’)ll|we(?:'|’)ll|I will|we will|let me)\s+(?:discuss|double check|check (?:with|on)|get back|reach out|confirm with)|\b(?:get back to you|waiting (?:on|for) (?:the brand|client|their)|once (?:the brand|they) (?:approve|confirm))\b/i.test(authored);
    const held = /\b(?:project|campaign|collaboration) (?:is |has (?:been |decided to (?:be |put (?:the project )?)?)?)?(?:on hold|cancelled|canceled)|\b(?:on hold for the time being|whenever the brand is ready|no longer (?:moving forward|needed)|refund (?:has been |was )?(?:processed|issued))\b/i.test(authored);
    const coldPitch = !obligation && /\b(?:review inquiry|collab(?:oration)? (?:inquiry|opportunity|invitation)|would (?:you|love to)|interested in (?:a |reviewing)|reaching out|reach out|free (?:sample|trial)|paid youtube cooperation)\b/i.test(current) && !/^(?:re|fw|fwd):/i.test(subject);
    const updateOnly = /\b(?:payment (?:initiated|received)|received (?:USD\s*|\$)[\d,.]+ from|invoice .{0,40}has been paid|your receipt|statement for|you(?:’|')ve just earned|you just referred)\b/i.test(subject);
    let state = "unverified";
    if (hasCommercial) add(15, "Commercial context in the latest message");
    if (request) add(22, "Explicit request in the latest message");
    if (obligation) add(38, "Delivery, agreement or invoice obligation mentioned");
    if (timeSensitive) add(42, "Time-sensitive language in a recent message; verify the stated date");
    if (monetaryMention > 0 && hasCommercial) add(Math.min(24, Math.log10(Math.max(1, monetaryMention)) * 5), "Amount mentioned in the authored message; not verified deal value");
    if (promise && ["outbound", "same-organization"].includes(latestDirection)) { add(20, "Latest account/team message contains a commitment; completion is unverified"); state = "commitment-mentioned"; }
    else if (["outbound", "same-organization"].includes(latestDirection)) { add(-42, "Latest account/team reply is already sent; do not request a duplicate reply"); state = "account-or-team-replied"; }
    if (waiting && !request && !obligation && latestDirection === "inbound") { add(-35, "Counterparty says they will respond/check; do not assume action is owed"); state = "counterparty-follow-up"; }
    if (held || ["archived", "resolved", "done", "closed"].includes(latest.status)) { add(-100, "Latest saved state indicates resolved, archived or paused"); state = "closed-or-paused"; }
    if (coldPitch) add(-25, "Unsolicited or introductory pitch");
    if (coldPitch && monetaryMention > 0 && monetaryMention < 500) add(-70, "Small unsolicited offer; lower business impact than existing obligations");
    if (/\b(?:unsubscribe|newsletter|daily digest|mozi minute)\b/i.test(current) && !request && !obligation) add(-45, "Newsletter or routine update");
    if (updateOnly) { add(-12, "Payment/receipt observation; not proof of a new task"); state = "notification"; }
    if (latestDirection === "draft") { add(-18, "Only a saved draft is available; it has not been sent"); state = "draft-only"; }
    if (authored.replace(/[^A-Za-z]/g, "").length < 70 && !request && !obligation) add(-22, "Short acknowledgement without an explicit action");
    if (ageDays > 30) add(-25, "Older than thirty days; current status must be verified");
    if (ageDays > 90) add(-30, "Older than ninety days; historical context only");
    return { latest, latestDraft: latestDraft && Date.parse(latestDraft.receivedAt) >= Date.parse(latest.receivedAt) ? latestDraft : undefined,
      threadRef: `inbox-thread:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`, authored, score: Math.round(score), reasons,
      state, direction: latestDirection, ageDays: Math.floor(ageDays), localMessageCount: rows.length,
      // Up to two earlier messages preserve an explicit ask when the newest
      // reply is terse. Selection still happens after every row was examined.
      previousMessages: rows.filter(item => item !== latest && !draft(item)).slice(0, 2) };
  }).sort((a, b) => b.score - a.score || Date.parse(b.latest.receivedAt) - Date.parse(a.latest.receivedAt));
  return { selected: ranked.slice(0, limit), scannedMessages: items.length, scannedThreads: ranked.length, ranked };
}
