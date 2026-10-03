import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { providerKey } from "./provider-config";
import type { VoiceLesson } from "./voice-lessons";

/**
 * The rule book: one plain-English rule per correction the owner made.
 *
 *   draft said A · the owner sent B · therefore: <rule>
 *
 * A rule is written the moment an edited draft is sent (a small model reads the
 * pair and states what changed). Every few corrections the whole book is
 * refined: duplicates merge, one-offs generalise, and rules a newer edit
 * contradicts are dropped. The reply queue reads the book on every run, so
 * one edit improves every draft after it. The book lives in the repo (data/voice/rules.json) and is derived from
 * the lessons, so the two machines can never disagree for long: on a clash the
 * union of both books wins, and the next refinement tidies it.
 */
export type RuleScope = "all" | "youtube";
export type VoiceRule = {
  id: string;
  scope: RuleScope;
  rule: string;
  /** The correction the rule came from, so a person can check the reasoning. */
  evidence: { source: VoiceLesson["source"]; who: string; said: string; draft: string; sent: string };
  at: string;
  /** Set on rules produced by a refinement pass: the ids they replaced. */
  refinedFrom?: string[];
};
export type RuleBook = { version: 1; updatedAt: string; rules: VoiceRule[]; retired: string[]; lessonsRefined: number };

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_RULE_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_REFINE_MODEL = "anthropic/claude-sonnet-5";
export const REFINE_EVERY = 5;
const MAX_RULES = 40;
const RULE_WORDS = 30;
const SCOPES: RuleScope[] = ["all", "youtube"];
const SCOPE_LABEL: Record<RuleScope, string> = { all: "everywhere", youtube: "YouTube comments" };
/** Where a correction came from; a lesson saved by an older version with an unknown source reads as a reply. */
const where = (source: string) => SCOPE_LABEL[source as RuleScope] || "replies";
export const RULE_SYSTEM_MARK = "Voice rule";

const one = (text: string) => text.replace(/\s+/g, " ").trim();
/** One line, no em dashes: the rules are read back into prompts that forbid them. */
const plain = (text: string) => one(text.replace(/\s*\u2014\s*/g, ", "));
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function rulesFile(root: string) { return join(root, "data", "voice", "rules.json"); }
export function emptyBook(): RuleBook { return { version: 1, updatedAt: "", rules: [], retired: [], lessonsRefined: 0 }; }
/** The id of the rule a given correction produces: the same edit on both machines gets the same id. */
export function lessonRuleId(lesson: Pick<VoiceLesson, "generated" | "final">) {
  return createHash("sha256").update(`${lesson.generated.trim()}\u0000${lesson.final.trim()}`).digest("hex").slice(0, 16);
}
export function parseBook(text: string): RuleBook {
  try {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.rules)) return emptyBook();
    const rules: VoiceRule[] = value.rules.filter((r: any) => r && typeof r.id === "string" && typeof r.rule === "string" && SCOPES.includes(r.scope));
    const retired: string[] = Array.isArray(value.retired) ? value.retired.filter((id: unknown) => typeof id === "string") : [];
    return { version: 1, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "", rules, retired, lessonsRefined: Number(value.lessonsRefined) || 0 };
  } catch { return emptyBook(); }
}
export function readBook(file: string): RuleBook {
  if (!existsSync(file)) return emptyBook();
  try { return parseBook(readFileSync(file, "utf8")); } catch { return emptyBook(); }
}
/** Two copies of the book (one per machine): keep every live rule from both, drop what either side retired. */
export function mergeBooks(a: RuleBook, b: RuleBook): RuleBook {
  const retired = new Set([...a.retired, ...b.retired]);
  const rules = new Map<string, VoiceRule>();
  for (const rule of [...a.rules, ...b.rules]) if (!retired.has(rule.id) && !rules.has(rule.id)) rules.set(rule.id, rule);
  return {
    version: 1,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    rules: [...rules.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-MAX_RULES * 2),
    retired: [...retired].slice(-1000),
    lessonsRefined: Math.max(a.lessonsRefined, b.lessonsRefined),
  };
}
/** Writes the JSON and a readable Markdown twin (draft, sent, therefore) next to it. */
export function writeBook(file: string, book: RuleBook) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(book, null, 2), { mode: 0o644 });
  renameSync(tmp, file);
  const groups = SCOPES.map(scope => ({ scope, rules: book.rules.filter(r => r.scope === scope) })).filter(g => g.rules.length);
  const md = [
    "# Rules learned from Jack's edits",
    "",
    `${book.rules.length} rules${book.updatedAt ? `, last changed ${book.updatedAt.slice(0, 10)}` : ""}. Each one came from a draft Jack rewrote before sending: what the draft said, what Jack sent, therefore the rule.`,
    "Every queue reads every rule marked *everywhere* plus the rules for its own place. This file mirrors `rules.json`; the JSON is what the OS reads.",
    "",
    ...groups.flatMap(g => [
      `## ${SCOPE_LABEL[g.scope][0].toUpperCase()}${SCOPE_LABEL[g.scope].slice(1)}`,
      "",
      ...g.rules.flatMap(r => [
        `- **${one(r.rule)}**`,
        `  - draft said: "${clip(one(r.evidence.draft), 160)}"`,
        `  - Jack sent: "${clip(one(r.evidence.sent), 160)}"`,
        ...(r.refinedFrom?.length ? [`  - refined from ${r.refinedFrom.length} earlier rule${r.refinedFrom.length === 1 ? "" : "s"}`] : []),
      ]),
      "",
    ]),
  ].join("\n");
  writeFileSync(file.replace(/\.json$/, ".md"), md, { mode: 0o644 });
}
/** The rules one queue should follow, as a prompt block; empty when there are none. */
export function rulesBlock(book: RuleBook, source: VoiceLesson["source"], max = 25): string {
  const mine = book.rules.filter(r => r.scope === "all" || r.scope === source).slice(-max);
  if (!mine.length) return "";
  return [
    "RULES LEARNED FROM THE OWNER'S OWN EDITS (each came from a draft they rewrote before sending; these override the guide where they differ):",
    ...mine.map((r, i) => `${i + 1}. ${one(r.rule)}`),
  ].join("\n");
}

/** Prompt that turns one correction into one rule. */
export function rulePrompt(lesson: VoiceLesson) {
  const system = `${RULE_SYSTEM_MARK}: you study how one person writes. Given a draft written in their name and what they actually sent instead, state the single rule a writer should follow next time so the draft would have matched. Output JSON only.`;
  const user = [
    `Where: ${where(lesson.source)}.`,
    `${one(lesson.who) || "Someone"} wrote: "${clip(one(lesson.theirMessage), 400)}"`,
    `The draft said: "${one(lesson.generated)}"`,
    `They sent instead: "${one(lesson.final)}"`,
    "",
    `Return {"rule":"...","scope":"..."}. The rule is one plain imperative sentence, at most ${RULE_WORDS} words, about wording, length, tone, structure, greeting, sign-off, emoji, facts or links: whatever actually changed. Name the pattern, not this one message.`,
    `"scope" is "all" when the rule is about how they write anywhere, or "${lesson.source}" when it only makes sense for ${where(lesson.source)}.`,
    'If the change is too small or too specific to teach anything, return {"rule":"","scope":"all"}.',
  ].join("\n");
  return { system, user };
}
export function parseRule(text: string, source: VoiceLesson["source"]): { rule: string; scope: RuleScope } | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  let value: any;
  try { value = JSON.parse(match[0]); } catch { return undefined; }
  const rule = typeof value?.rule === "string" ? plain(value.rule) : "";
  if (!rule || rule.split(" ").length > RULE_WORDS + 8) return undefined;
  const scope: RuleScope = value.scope === "all" ? "all" : source;
  return { rule, scope };
}
/** Prompt that tidies the whole book: merge, generalise, drop what newer edits contradict. */
export function refinePrompt(book: RuleBook, lessons: VoiceLesson[]) {
  const system = `${RULE_SYSTEM_MARK} book: you maintain a short list of rules that describe how one person writes replies, learned from drafts they rewrote. Output JSON only.`;
  const recent = lessons.slice(-20);
  const user = [
    "Here are the current rules, each with its id and where it applies, then the most recent corrections they were learned from.",
    "Rewrite the list so it is as short as it can be while still teaching everything the corrections show: merge rules that say the same thing, turn repeated one-offs into the general pattern, drop a rule that a newer correction contradicts, keep a rule that still stands as it is.",
    `Keep at most ${MAX_RULES} rules, each one plain imperative sentence of at most ${RULE_WORDS} words. Scope is "all" for how they write anywhere, or "youtube" for comment replies only.`,
    'Return {"rules":[{"rule":"...","scope":"...","from":["id","id"]}]} where "from" lists the ids of the current rules each new rule replaces (empty for a rule that is genuinely new).',
    "",
    "CURRENT RULES:",
    ...book.rules.map(r => `- [${r.id}] (${r.scope}) ${one(r.rule)}`),
    "",
    "RECENT CORRECTIONS (draft versus what they sent):",
    ...recent.map(l => `- ${where(l.source)} · ${one(l.who)} wrote: "${clip(one(l.theirMessage), 160)}"\n  draft: "${clip(one(l.generated), 300)}"\n  sent: "${clip(one(l.final), 300)}"`),
  ].join("\n");
  return { system, user };
}
export function parseRefined(text: string, existing: Set<string>): { rule: string; scope: RuleScope; from: string[] }[] | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  let value: any;
  try { value = JSON.parse(match[0]); } catch { return undefined; }
  if (!Array.isArray(value?.rules)) return undefined;
  const out: { rule: string; scope: RuleScope; from: string[] }[] = [];
  for (const item of value.rules) {
    const rule = typeof item?.rule === "string" ? plain(item.rule) : "";
    if (!rule || rule.split(" ").length > RULE_WORDS + 8) continue;
    const scope: RuleScope = SCOPES.includes(item.scope) ? item.scope : "all";
    const from = Array.isArray(item.from) ? item.from.filter((id: unknown) => typeof id === "string" && existing.has(id)) : [];
    out.push({ rule, scope, from });
  }
  return out.length ? out.slice(0, MAX_RULES) : undefined;
}

type Options = { homeDir?: string; request?: typeof fetch; now?: () => number; ruleModel?: string; refineModel?: string };

export function voiceRules(root: string, options: Options = {}) {
  const file = rulesFile(root);
  const home = options.homeDir || homedir();
  const fetcher = options.request || fetch;
  const now = options.now || Date.now;
  const key = () => providerKey(root, "OPENROUTER_API_KEY", { home });
  const ruleModel = () => options.ruleModel || providerKey(root, "AGENTIC_RULE_MODEL", { home }) || DEFAULT_RULE_MODEL;
  const refineModel = () => options.refineModel || providerKey(root, "AGENTIC_REFINE_MODEL", { home }) || DEFAULT_REFINE_MODEL;
  let chain: Promise<unknown> = Promise.resolve();

  async function complete(system: string, user: string, maxTokens: number, model: string) {
    const apiKey = key();
    if (!apiKey) throw new Error("No OPENROUTER_API_KEY.");
    const response = await fetcher(OPENROUTER, { method: "POST", signal: AbortSignal.timeout(90000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/ItsssssJack/claude-operating-system", "X-Title": "Agentic OS voice rules" }, body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}`); }
    const data: any = await response.json();
    const value = data?.choices?.[0]?.message?.content;
    if (typeof value !== "string" || !value.trim()) throw new Error("No text.");
    return value;
  }
  /** Writes happen one after another, so two queues learning at the same moment cannot lose a rule. */
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  }
  const read = () => readBook(file);
  const has = (book: RuleBook, id: string) => book.retired.includes(id) || book.rules.some(r => r.id === id || r.refinedFrom?.includes(id));

  /** One correction in, one rule out (or none, when the edit teaches nothing). Safe to call twice for the same edit. */
  async function learn(lesson: VoiceLesson): Promise<VoiceRule | undefined> {
    const id = lessonRuleId(lesson);
    if (has(read(), id)) return read().rules.find(r => r.id === id);
    const prompt = rulePrompt(lesson);
    const text = await complete(prompt.system, prompt.user, 200, ruleModel());
    const parsed = parseRule(text, lesson.source);
    return serial(async () => {
      const book = read();
      if (has(book, id)) return book.rules.find(r => r.id === id);
      const at = new Date(now()).toISOString();
      if (!parsed) { book.retired.push(id); book.updatedAt = at; writeBook(file, book); return undefined; }
      const rule: VoiceRule = { id, scope: parsed.scope, rule: parsed.rule, evidence: { source: lesson.source, who: one(lesson.who).slice(0, 80), said: clip(one(lesson.theirMessage), 240), draft: clip(one(lesson.generated), 400), sent: clip(one(lesson.final), 400) }, at };
      book.rules = [...book.rules, rule].slice(-MAX_RULES * 2);
      book.updatedAt = at;
      writeBook(file, book);
      return rule;
    });
  }
  /** Rules for every lesson that has none yet (an edit made while the model was unreachable, or on the other machine before rules existed). */
  async function catchUp(lessons: VoiceLesson[], limit = 6) {
    const book = read();
    const missing = lessons.filter(l => !has(book, lessonRuleId(l))).slice(-limit);
    let made = 0;
    for (const lesson of missing) { try { if (await learn(lesson)) made += 1; } catch { break; } }
    return made;
  }
  /** Every REFINE_EVERY new lessons, tidy the whole book. Returns true when the book changed. */
  async function refine(lessons: VoiceLesson[]) {
    const before = read();
    if (lessons.length < REFINE_EVERY || lessons.length - before.lessonsRefined < REFINE_EVERY || !before.rules.length) return false;
    const prompt = refinePrompt(before, lessons);
    const text = await complete(prompt.system, prompt.user, 2500, refineModel());
    const refined = parseRefined(text, new Set(before.rules.map(r => r.id)));
    if (!refined) return false;
    return serial(async () => {
      const book = read();
      const at = new Date(now()).toISOString();
      const byId = new Map(book.rules.map(r => [r.id, r]));
      const replaced = new Set(refined.flatMap(r => r.from));
      const kept = book.rules.filter(r => !replaced.has(r.id) && !refined.some(n => one(n.rule).toLowerCase() === one(r.rule).toLowerCase()));
      const fresh: VoiceRule[] = refined.map(n => {
        const parents = n.from.map(id => byId.get(id)).filter((r): r is VoiceRule => Boolean(r));
        const same = parents.length === 1 && one(parents[0].rule).toLowerCase() === one(n.rule).toLowerCase() && parents[0].scope === n.scope;
        if (same) return parents[0];
        const evidence = parents[parents.length - 1]?.evidence || { source: lessons[lessons.length - 1]?.source || "youtube", who: "", said: "", draft: "", sent: "" };
        return { id: createHash("sha256").update(`${n.rule} ${at}`).digest("hex").slice(0, 16), scope: n.scope, rule: n.rule, evidence, at, ...(n.from.length ? { refinedFrom: n.from } : {}) };
      });
      const freshIds = new Set(fresh.map(r => r.id));
      const retired = new Set([...book.retired, ...book.rules.filter(r => !freshIds.has(r.id) && !kept.some(k => k.id === r.id)).map(r => r.id)]);
      const next: RuleBook = { version: 1, updatedAt: at, rules: [...kept, ...fresh.filter(r => !kept.some(k => k.id === r.id))].slice(-MAX_RULES), retired: [...retired].slice(-1000), lessonsRefined: lessons.length };
      writeBook(file, next);
      return true;
    });
  }
  return { file, read, learn, catchUp, refine, block: (source: VoiceLesson["source"]) => rulesBlock(read(), source), count: () => read().rules.length };
}
export type VoiceRules = ReturnType<typeof voiceRules>;
