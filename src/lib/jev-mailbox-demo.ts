// Demo data for the "Sort all with Jev" mailbox and the invoice search.
// Every sender, company, address and amount here is fictional (.test
// domains). Real brands only appear as the service that sent a notice
// (Stripe, YouTube, GitHub...) so their logos can be shown. Nothing here is
// read from a mailbox or a bank, and nothing is sent to a model: the odds
// are simulated so the demo is free and replays the same way every time.
import type { JevDecision } from "./jev-types";
import { inboxCategories, type InboxCategory, type InboxLabel } from "./jev-inbox";

export type BrandKey =
  | "stripe" | "youtube" | "notion" | "figma" | "vercel" | "github" | "googlecalendar" | "openrouter" | "clay" | "gmail";

export type DemoMail = {
  id: string;
  category: InboxCategory;
  name: string;
  org?: string;
  email: string;
  brand?: BrandKey;
  subject: string;
  snippet: string;
  time: string;
  unread?: boolean;
  attachment?: string;
  // How sure Jev is about the pile, and the pile it nearly picked.
  sure: number;
  near: InboxCategory;
  why: string;
};

// Monday 28 Sep 2026, a normal morning for a creator with ~173K subscribers.
// Newest first, the way the inbox shows them.
const MAIL: Omit<DemoMail, "id">[] = [
  { category: "reply-today", name: "Maya Okoro", org: "Cutroom Studio", email: "maya@cutroom.test", subject: "Cut v3 of the Claude video is ready", snippet: "Tightened the intro to 28 seconds and added the b-roll you flagged. Need your OK by 4pm to publish Thursday.", time: "09:41", unread: true, attachment: "cut-v3.mp4", sure: 0.93, near: "fyi", why: "Asks for your OK by 4pm today." },
  { category: "sponsor", name: "Rory Fenn", org: "Quillstack", email: "rory@quillstack.test", subject: "November integration slot, what's your rate card?", snippet: "Quillstack writes docs from your codebase. We'd love a 60 second integration in a November video.", time: "09:30", unread: true, sure: 0.9, near: "lead", why: "A brand asking to pay for a spot in a video." },
  { category: "community", name: "Builders Forum", email: "notify@buildersforum.test", subject: "Dana asked a question in AI Automation Lab", snippet: "\"How do you stop the agent emailing the wrong client?\" 6 members liked this.", time: "09:22", unread: true, sure: 0.93, near: "fyi", why: "A member question in your community forum." },
  { category: "reply-today", name: "Priya Raman", org: "Builders Summit", email: "priya@builderssummit.test", subject: "Keynote invite: Builders Summit Lisbon, 14 Nov", snippet: "We'd love you to close day one. 30 minutes, travel covered. Could you confirm by end of day?", time: "09:12", unread: true, sure: 0.81, near: "lead", why: "A speaking invite that needs an answer today." },
  { category: "lead", name: "Marcus Webb", org: "Webb Dental Group", email: "marcus@webbdental.test", subject: "AI receptionist for our 6 clinics?", snippet: "Saw your voice agent video. We miss about 40 calls a week. Could your team build something like that?", time: "09:05", unread: true, sure: 0.76, near: "sponsor", why: "A business asking you to build something for them." },
  { category: "reply-today", name: "Sam Ito", org: "Lumora AI", email: "sam@lumora.test", subject: "Contract for the October video, signature needed", snippet: "Final version attached with Friday's edits. Legal needs it signed today to lock the publish date.", time: "08:55", attachment: "Lumora-contract-v4.pdf", sure: 0.88, near: "sponsor", why: "A contract waiting on your signature today." },
  { category: "fyi", name: "Google Calendar", email: "calendar@google.test", brand: "googlecalendar", subject: "Updated invitation: Team sync, Wed 3pm", snippet: "Maya Okoro updated the event. Wed 30 Sep, 15:00 to 15:30.", time: "08:45", sure: 0.86, near: "reply-today", why: "A calendar change. Good to know, nothing to do." },
  { category: "lead", name: "Aisha Okafor", org: "Okafor Legal", email: "aisha@okaforlegal.test", subject: "Pricing for an inbox triage setup", snippet: "We're a 12 person firm drowning in email. What would a setup like yours cost?", time: "08:40", sure: 0.72, near: "reply-today", why: "Asks for a price. A possible client." },
  { category: "reply-today", name: "Theo Marsh", org: "The Build Log", email: "theo@buildlog.test", subject: "Recording link for tomorrow, 10am", snippet: "Here's the studio link and three questions I'd like to cover. Does the time still work?", time: "08:20", sure: 0.84, near: "fyi", why: "A podcast host checking tomorrow's time." },
  { category: "community", name: "Builders Forum", email: "notify@buildersforum.test", subject: "14 new comments on your weekly call post", snippet: "Felipe, Grace and 12 others commented on \"Wednesday build call: agents that run overnight\".", time: "08:10", sure: 0.95, near: "fyi", why: "Activity in your community forum." },
  { category: "sponsor", name: "Lena Park", org: "Tessel", email: "lena@tessel.test", subject: "Draft brief for the Tessel video", snippet: "Brief attached with talking points and the tracking link. Happy to change anything before you film.", time: "07:48", attachment: "Tessel-brief.pdf", sure: 0.86, near: "reply-today", why: "A sponsor sending the brief for a paid video." },
  { category: "community", name: "YouTube", email: "noreply@youtube.test", brand: "youtube", subject: "New comments on your latest video", snippet: "\"This is the first time agents actually clicked for me.\" and 212 more comments.", time: "07:30", sure: 0.88, near: "fyi", why: "Your viewers talking under a video." },
  { category: "fyi", name: "GitHub", email: "noreply@github.test", brand: "github", subject: "[agentic-os] Release v3.6 published", snippet: "The release was published by jack-bot with 14 commits since v3.5.", time: "07:15", sure: 0.9, near: "newsletter", why: "An automatic notice. Nothing to do." },
  { category: "billing", name: "Stripe", email: "notifications@stripe.test", brand: "stripe", subject: "Your payout is on the way", snippet: "A payout was sent to your bank account ending 0000. It should arrive in 2 business days.", time: "07:02", sure: 0.97, near: "fyi", why: "Money moving. Belongs with billing." },
  { category: "billing", name: "Notion", email: "billing@notion.test", brand: "notion", subject: "Payment failed, update your card", snippet: "We couldn't charge your card for the Plus plan. Update it to keep your workspace active.", time: "06:15", unread: true, sure: 0.94, near: "spam", why: "A failed payment on a tool you use." },
  { category: "newsletter", name: "The Prompt Report", email: "hello@promptreport.test", subject: "Three model launches you missed this week", snippet: "Plus: the prompt pattern everyone copied, and a tool that reads your screen.", time: "06:00", sure: 0.97, near: "fyi", why: "A weekly newsletter." },
  { category: "newsletter", name: "Agent Weekly", email: "news@agentweekly.test", subject: "Issue 88: agents that work overnight", snippet: "This week: scheduling, retries, and why your agent keeps forgetting.", time: "05:30", sure: 0.96, near: "fyi", why: "A newsletter you signed up for." },
  { category: "spam", name: "Prize Desk", email: "winner@lucky-draw.test", subject: "You've been selected for a $5,000 gift card", snippet: "Claim within 24 hours. Just confirm your address and card details.", time: "04:12", sure: 0.98, near: "newsletter", why: "A prize you never entered for. Classic spam." },
  { category: "spam", name: "Account Security", email: "alert@secure-verify.test", subject: "Unusual sign-in. Verify your password now", snippet: "We noticed a sign-in from a new device. Verify now or your account will be locked.", time: "03:40", sure: 0.96, near: "billing", why: "A fake security alert from an odd address." },
  { category: "sponsor", name: "Nia Brooks", org: "Brightwave AI", email: "nia@brightwave.test", subject: "Following up: 2 dedicated videos in Q4?", snippet: "Just bumping this. Our team loved the agents video and would like to go bigger this quarter.", time: "Yesterday", sure: 0.83, near: "lead", why: "A sponsor following up on a deal." },
  { category: "billing", name: "Cutroom Studio", email: "accounts@cutroom.test", subject: "Invoice INV-0412 for September edits", snippet: "Thanks for another great month. Invoice attached, due in 14 days.", time: "Yesterday", attachment: "INV-0412.pdf", sure: 0.95, near: "reply-today", why: "An invoice with a PDF attached." },
  { category: "fyi", name: "Figma", email: "no-reply@figma.test", brand: "figma", subject: "Maya commented on Thumbnail v2", snippet: "\"Try the brighter face crop, the text is fighting the logo.\"", time: "Yesterday", sure: 0.82, near: "reply-today", why: "A design comment. Useful, not urgent." },
  { category: "lead", name: "Jordan Blake", org: "Northpeak Capital", email: "jordan@northpeak.test", subject: "Private AI workshop for 40 staff", snippet: "Our partners want a hands-on day in November. Do you run private sessions?", time: "Yesterday", sure: 0.74, near: "reply-today", why: "A company asking to book you for training." },
  { category: "billing", name: "Vercel", email: "billing@vercel.test", brand: "vercel", subject: "Your receipt from Vercel", snippet: "Receipt #2291-0931 for your Pro plan. Thanks for building with us.", time: "Yesterday", sure: 0.96, near: "fyi", why: "A receipt. Keep it for the books." },
  { category: "newsletter", name: "Model Watch", email: "team@modelwatch.test", subject: "Benchmarks are lying to you (again)", snippet: "Why the top of the leaderboard rarely matches what you feel in real work.", time: "Yesterday", sure: 0.95, near: "fyi", why: "A newsletter." },
  { category: "community", name: "Builders Forum", email: "notify@buildersforum.test", subject: "New member intro: Felipe from Lisbon", snippet: "Hi all, I run a small agency and want to automate our reporting. Glad to be here!", time: "Yesterday", sure: 0.91, near: "fyi", why: "A new member saying hello." },
  { category: "sponsor", name: "Omar Haddad", org: "Orbitype", email: "omar@orbitype.test", subject: "Paid collab for your Claude series?", snippet: "We build browser agents. Would a sponsored segment in your next Claude episode work?", time: "Yesterday", sure: 0.79, near: "lead", why: "A brand offering to pay for a segment." },
  { category: "newsletter", name: "Creator Stack", email: "hi@creatorstack.test", subject: "How 5 creators batch a month of videos", snippet: "Scripts on Monday, film on Tuesday, and the tools that hold it together.", time: "Yesterday", sure: 0.94, near: "fyi", why: "A newsletter." },
  { category: "reply-today", name: "Tom Hale", org: "Hale Media", email: "tom@halemedia.test", subject: "Three thumbnails for Thursday, pick one?", snippet: "A, B or C. I need your pick by tonight so we can test them before launch.", time: "Sat", attachment: "thumbs-ABC.png", sure: 0.85, near: "fyi", why: "Needs your pick by tonight." },
  { category: "billing", name: "OpenRouter", email: "billing@openrouter.test", brand: "openrouter", subject: "Your credits are running low", snippet: "Your balance is under $5. Top up to keep your API keys working.", time: "Sat", sure: 0.9, near: "fyi", why: "A low balance on a paid tool." },
  { category: "lead", name: "Felix Moreau", org: "Harbor Fitness", email: "felix@harborfit.test", subject: "Could you set up agents for our gyms?", snippet: "We run 9 gyms. Bookings, reminders and follow ups eat our front desk alive.", time: "Sat", sure: 0.7, near: "sponsor", why: "A business that wants a build. A lead." },
  { category: "spam", name: "Crypto Signals VIP", email: "vip@moonshot.test", subject: "Final call: 40x returns guaranteed", snippet: "Only 3 seats left in the private group. Don't miss the next pump.", time: "Sat", sure: 0.98, near: "newsletter", why: "Guaranteed returns. Always spam." },
  { category: "newsletter", name: "Tiny Founders", email: "mail@tinyfounders.test", subject: "The one-person company playbook", snippet: "How a solo founder runs support, sales and shipping with four agents.", time: "Sat", sure: 0.95, near: "fyi", why: "A newsletter." },
  { category: "billing", name: "Lumora AI Accounts", email: "ap@lumora.test", subject: "Remittance advice for INV-2026-031", snippet: "Payment has been scheduled for Friday. Remittance attached for your records.", time: "Fri", attachment: "remittance.pdf", sure: 0.92, near: "sponsor", why: "Payment news on an invoice you sent." },
  { category: "newsletter", name: "Signal and Noise", email: "hey@signalnoise.test", subject: "AI tools worth your time this month", snippet: "Six tools we kept using after the launch hype died down.", time: "Fri", sure: 0.93, near: "fyi", why: "A newsletter." },
];

export const DEMO_MAIL: DemoMail[] = MAIL.map((m, i) => ({ ...m, id: `demo-mail-${i}` }));

// About what one live Jev call costs (measured sample, 28 Sep 2026).
export const JEV_CALL_USD = 0.000017;

function wobble(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function demoMailLabel(mail: DemoMail, index: number): InboxLabel {
  const sure = mail.sure;
  const second = (1 - sure) * (0.62 + wobble(index, 2) * 0.28);
  const rest = (1 - sure - second) / (inboxCategories.length - 2);
  const probabilities = Object.fromEntries(
    inboxCategories.map((c) => [c, +(c === mail.category ? sure : c === mail.near ? second : rest).toFixed(3)]),
  );
  const replyish = ["reply-today", "lead", "sponsor"].includes(mail.category);
  const needsReply = replyish ? 0.82 + wobble(index, 3) * 0.16 : mail.category === "community" ? 0.3 + wobble(index, 3) * 0.3 : 0.02 + wobble(index, 3) * 0.08;
  const urgency = mail.category === "reply-today" || /failed/i.test(mail.subject) ? 2 : replyish ? 1 : 0;
  const urgencyProbs = Object.fromEntries([0, 1, 2, 3].map((k) => [String(k), k === urgency ? 0.72 : Math.abs(k - urgency) === 1 ? 0.12 : 0.02]));
  const decision: JevDecision = {
    id: `demo-mail-${index}`,
    at: "2026-09-28T09:45:00.000Z",
    surface: "inbox",
    purpose: "Which pile does this email go in?",
    input: `${mail.org ? `${mail.name}, ${mail.org}` : mail.name} · ${mail.subject}`,
    answers: {
      category: { type: "choice", choice: mail.category, probabilities, confidence: sure },
      needs_reply: { type: "noul", noul: needsReply },
      urgency: {
        type: "score",
        score: urgency,
        legend: { "0": "no rush", "1": "this week", "2": "today", "3": "within the hour" },
        probabilities: urgencyProbs,
        confidence: 0.72,
      },
    },
    picked: mail.category,
    escalated: false,
    ms: Math.round(380 + wobble(index, 5) * 260),
    costUsd: JEV_CALL_USD,
  };
  return { messageId: mail.id, fingerprint: "demo", category: mail.category, needsReply, urgency, decision, simulated: true };
}

// ---------------------------------------------------------------- invoices

export type InvoiceStatus = "paid" | "unpaid" | "overdue";
export type DemoInvoice = {
  id: string;
  number: string;
  client: string;
  brand?: BrandKey;
  // "sent": you billed them. "received": a bill you have to pay.
  direction: "sent" | "received";
  what: string;
  amount: number;
  issued: string; // YYYY-MM-DD
  due: string;
  paidOn?: string;
  status: InvoiceStatus;
  pdf: string;
};

export const DEMO_TODAY = "2026-09-28";

export const DEMO_INVOICES: DemoInvoice[] = [
  { id: "inv-1", number: "INV-2026-081", client: "Halden", direction: "sent", what: "August sponsored video", amount: 5600, issued: "2026-08-12", due: "2026-09-11", paidOn: "2026-09-04", status: "paid", pdf: "INV-2026-081.pdf" },
  { id: "inv-2", number: "INV-2026-064", client: "Halden", direction: "sent", what: "July sponsored video", amount: 5600, issued: "2026-07-09", due: "2026-08-08", paidOn: "2026-07-30", status: "paid", pdf: "INV-2026-064.pdf" },
  { id: "inv-3", number: "INV-2026-031", client: "Lumora AI", direction: "sent", what: "Dedicated video, part 1", amount: 5200, issued: "2026-08-14", due: "2026-08-28", status: "overdue", pdf: "INV-2026-031.pdf" },
  { id: "inv-4", number: "INV-2026-077", client: "Northpeak Capital", direction: "sent", what: "Private workshop deposit", amount: 9000, issued: "2026-08-03", due: "2026-08-17", status: "overdue", pdf: "INV-2026-077.pdf" },
  { id: "inv-5", number: "INV-2026-085", client: "Brightwave AI", direction: "sent", what: "60 second integration", amount: 4800, issued: "2026-08-26", due: "2026-09-25", status: "overdue", pdf: "INV-2026-085.pdf" },
  { id: "inv-6", number: "INV-2026-090", client: "Quillstack", direction: "sent", what: "Newsletter mention", amount: 3200, issued: "2026-09-15", due: "2026-10-15", status: "unpaid", pdf: "INV-2026-090.pdf" },
  { id: "inv-7", number: "INV-2026-088", client: "Tessel", direction: "sent", what: "Sponsored video", amount: 4200, issued: "2026-09-02", due: "2026-10-02", paidOn: "2026-09-20", status: "paid", pdf: "INV-2026-088.pdf" },
  { id: "inv-8", number: "INV-2026-072", client: "Webb Dental Group", direction: "sent", what: "Voice agent build, stage 1", amount: 2400, issued: "2026-07-21", due: "2026-08-04", paidOn: "2026-08-05", status: "paid", pdf: "INV-2026-072.pdf" },
  { id: "inv-9", number: "INV-2026-092", client: "Orbitype", direction: "sent", what: "Sponsored segment", amount: 3800, issued: "2026-09-22", due: "2026-10-22", status: "unpaid", pdf: "INV-2026-092.pdf" },
  { id: "inv-10", number: "INV-0412", client: "Cutroom Studio", direction: "received", what: "September video edits", amount: 1850, issued: "2026-09-27", due: "2026-10-11", status: "unpaid", pdf: "INV-0412.pdf" },
  { id: "inv-11", number: "INV-0398", client: "Cutroom Studio", direction: "received", what: "August video edits", amount: 1850, issued: "2026-08-30", due: "2026-09-13", paidOn: "2026-09-08", status: "paid", pdf: "INV-0398.pdf" },
  { id: "inv-12", number: "2291-0931", client: "Vercel", brand: "vercel", direction: "received", what: "Pro plan, September", amount: 20, issued: "2026-09-27", due: "2026-09-27", paidOn: "2026-09-27", status: "paid", pdf: "Vercel-2291-0931.pdf" },
  { id: "inv-13", number: "NTN-88213", client: "Notion", brand: "notion", direction: "received", what: "Plus plan, card declined", amount: 10, issued: "2026-09-28", due: "2026-09-28", status: "unpaid", pdf: "Notion-88213.pdf" },
  { id: "inv-14", number: "OR-55120", client: "OpenRouter", brand: "openrouter", direction: "received", what: "API credits", amount: 50, issued: "2026-08-18", due: "2026-08-18", paidOn: "2026-08-18", status: "paid", pdf: "OpenRouter-55120.pdf" },
  { id: "inv-15", number: "FIG-30017", client: "Figma", brand: "figma", direction: "received", what: "Professional seat", amount: 15, issued: "2026-09-01", due: "2026-09-01", paidOn: "2026-09-01", status: "paid", pdf: "Figma-30017.pdf" },
];

const DAY = 86_400_000;
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY);
}
export function daysOpen(inv: DemoInvoice, today = DEMO_TODAY) {
  return inv.status === "paid" ? 0 : daysBetween(inv.issued, today);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const FILLER = new Set(["ai", "group", "studio", "capital", "the", "labs", "inc"]);

type Clue = { label: string; weight: number; test: (inv: DemoInvoice) => number };

// Turn a plain-English request into clues. Each clue scores an invoice 0..1.
export function readInvoiceQuery(query: string, today = DEMO_TODAY): { clues: Clue[]; single: boolean } {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9$£€.,+ -]/g, " ").replace(/[.,](?=\s|$)/g, " ")} `;
  const clues: Clue[] = [];
  let single = false;

  const clients = [...new Set(DEMO_INVOICES.map((i) => i.client))];
  for (const client of clients) {
    const words = client.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !FILLER.has(w));
    if (words.some((w) => q.includes(` ${w} `) || q.includes(` ${w}s `) || q.includes(` ${w}'s `))) {
      clues.push({ label: client, weight: 3, test: (i) => (i.client === client ? 1 : 0) });
      single = true;
    }
  }

  const monthIndex = MONTHS.findIndex((m) => q.includes(` ${m} `) || q.includes(` ${m.slice(0, 3)} `));
  if (monthIndex >= 0) {
    const name = MONTHS[monthIndex];
    clues.push({
      label: name[0].toUpperCase() + name.slice(1),
      weight: 2,
      test: (i) => {
        const m = Number(i.issued.slice(5, 7)) - 1;
        return m === monthIndex ? 1 : Math.abs(m - monthIndex) === 1 ? 0.2 : 0;
      },
    });
    if (clues.length > 1) single = true;
  }

  const number = q.match(/\b(inv[- ]?\d[\d-]*|[a-z]{2,3}-\d{4,}|\d{4}-\d{3,})\b/);
  if (number) {
    const n = number[1].replace(/\s/g, "-");
    clues.push({ label: n.toUpperCase(), weight: 4, test: (i) => (i.number.toLowerCase().includes(n) ? 1 : 0) });
    single = true;
  }

  const overdue = /\b(overdue|late|chase|chasing)\b/.test(q);
  const unpaid = /\b(unpaid|outstanding|owed|owes|owe|open|not paid|waiting)\b/.test(q);
  const paid = !unpaid && /\bpaid\b/.test(q);
  if (overdue) clues.push({ label: "Overdue", weight: 2.5, test: (i) => (i.status === "overdue" ? 1 : i.status === "unpaid" ? 0.35 : 0) });
  else if (unpaid) clues.push({ label: "Unpaid", weight: 2.5, test: (i) => (i.status === "paid" ? 0 : 1) });
  else if (paid) clues.push({ label: "Paid", weight: 2, test: (i) => (i.status === "paid" ? 1 : 0) });

  const age = q.match(/\b(?:over|more than|older than|past|at least)\s+(\d+)\s*days?\b/) || q.match(/\b(\d+)\s*\+\s*days?\b/);
  if (age) {
    const n = Number(age[1]);
    clues.push({
      label: `Open over ${n} days`,
      weight: 3,
      test: (i) => {
        if (i.status === "paid") return 0;
        const d = daysOpen(i, today);
        return d > n ? 1 : d > n * 0.8 ? 0.3 : 0;
      },
    });
    if (!overdue && !unpaid) clues.push({ label: "Unpaid", weight: 1, test: (i) => (i.status === "paid" ? 0 : 1) });
    single = false;
  }

  if (/\b(bills?|receipts?|subscriptions?|i paid|i owe|to pay|vendors?)\b/.test(q)) {
    clues.push({ label: "Bills to you", weight: 1.5, test: (i) => (i.direction === "received" ? 1 : 0) });
  } else if (/\b(sponsors?|clients?|owes me|owed to me|i sent|billed)\b/.test(q)) {
    clues.push({ label: "Sent by you", weight: 1.5, test: (i) => (i.direction === "sent" ? 1 : 0) });
  }

  const over = q.match(/\b(?:over|above|more than|bigger than)\s+[$£€]?\s?(\d[\d,.]*)\s*(k)?\b(?!\s*days?)/);
  if (over && !age) {
    const n = Number(over[1].replace(/,/g, "")) * (over[2] ? 1000 : 1);
    if (n > 0) clues.push({ label: `Over $${n.toLocaleString("en-US")}`, weight: 2, test: (i) => (i.amount > n ? 1 : 0) });
  }

  if (/\b(biggest|largest|highest|top)\b/.test(q)) {
    const max = Math.max(...DEMO_INVOICES.map((i) => i.amount));
    clues.push({ label: "Biggest", weight: 2, test: (i) => (i.amount / max) ** 2 });
    single = true;
  }

  if (!clues.length) {
    const words = q.split(/\s+/).filter((w) => w.length > 2 && !["the", "invoice", "invoices", "from", "for", "show", "find", "all", "and", "with"].includes(w));
    if (words.length) {
      clues.push({
        label: "Words",
        weight: 1,
        test: (i) => {
          const hay = `${i.client} ${i.what} ${i.number}`.toLowerCase();
          return words.filter((w) => hay.includes(w)).length / words.length;
        },
      });
      single = true;
    }
  }
  return { clues, single };
}

export type InvoiceHit = { invoice: DemoInvoice; odds: number };
export type InvoiceSearch = {
  query: string;
  clues: string[];
  single: boolean;
  ranked: InvoiceHit[]; // every invoice, best first
  matches: InvoiceHit[]; // what the result cards show
  decision: JevDecision; // the one Jev call behind the search
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function searchInvoices(query: string, today = DEMO_TODAY): InvoiceSearch {
  const { clues, single } = readInvoiceQuery(query, today);
  const total = clues.reduce((s, c) => s + c.weight, 0) || 1;
  const scored = DEMO_INVOICES.map((invoice, i) => ({
    invoice,
    score: clues.length ? clues.reduce((s, c) => s + c.weight * c.test(invoice), 0) / total : 0,
    jitter: (wobble(i, 7 + hash(query) * 10) - 0.5) * 0.04,
  }));
  let ranked: InvoiceHit[];
  if (single) {
    // One invoice meant: odds are shared across all of them.
    const exp = scored.map((s) => Math.exp(s.score * 9 + s.jitter * 10));
    const sum = exp.reduce((a, b) => a + b, 0);
    ranked = scored.map((s, i) => ({ invoice: s.invoice, odds: exp[i] / sum }));
  } else {
    // A set asked for: each invoice gets its own yes or no.
    ranked = scored.map((s) => ({ invoice: s.invoice, odds: Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-(s.score - 0.8) * 16)) + s.jitter)) }));
  }
  ranked.sort((a, b) => b.odds - a.odds || b.invoice.issued.localeCompare(a.invoice.issued));
  const best = Math.max(0, ...scored.map((s) => s.score));
  const matches = best < 0.3
    ? []
    : single
      ? ranked.filter((h, i) => i === 0 || (i < 3 && h.odds >= 0.02))
      : ranked.filter((h) => h.odds >= 0.5);
  const top = ranked.slice(0, 5);
  const shown = top.reduce((s, h) => s + h.odds, 0) || 1;
  const probabilities = Object.fromEntries(
    top.map((h) => [h.invoice.id, +(single ? h.odds : h.odds / shown).toFixed(3)]),
  );
  const decision: JevDecision = {
    id: `demo-invoice-${Math.round(hash(query) * 1e9)}`,
    at: `${today}T09:50:00.000Z`,
    surface: "inbox",
    purpose: single ? "Which invoice do you mean?" : "Which invoices match?",
    input: `"${query.trim()}" · ${DEMO_INVOICES.length} invoices`,
    answers: {
      invoice: { type: "choice", choice: ranked[0].invoice.id, probabilities, confidence: ranked[0].odds },
    },
    picked: ranked[0].invoice.id,
    pickedLabel: `${ranked[0].invoice.client} ${ranked[0].invoice.number}`,
    escalated: false,
    ms: Math.round(430 + hash(query) * 140),
    costUsd: JEV_CALL_USD,
  };
  return { query, clues: clues.map((c) => c.label), single, ranked, matches, decision };
}

// The yes or no Jev gives for one invoice, for the "why" card.
export function invoiceMatchDecision(search: InvoiceSearch, hit: InvoiceHit): JevDecision {
  const inv = hit.invoice;
  return {
    ...search.decision,
    id: `${search.decision.id}-${inv.id}`,
    purpose: "Is this the invoice you asked for?",
    input: `"${search.query.trim()}" · ${inv.client} ${inv.number}, $${inv.amount.toLocaleString("en-US")}, ${inv.status}`,
    answers: { match: { type: "noul", noul: hit.odds } },
    picked: hit.odds >= 0.5 ? "yes" : "no",
    pickedLabel: hit.odds >= 0.5 ? "Yes, a match" : "Not this one",
  };
}
