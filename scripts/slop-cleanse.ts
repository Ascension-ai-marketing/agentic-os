import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { providerKey } from "./provider-config";
import { executableCandidates } from "./assistant-runtime";

/**
 * SlopMonster pass for drafted replies. Every draft is linted for AI tells
 * with the vendored regex linter (honest, no opinions), cleansed by a model
 * from a DIFFERENT family than the one that wrote it, then linted again. A
 * cleanse is kept only when it reads cleaner and says the same thing.
 */

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_CLEANSE_MODEL = "openai/gpt-5.4-mini";
/** The cleanse must come from a different family than the draft, or it cannot hear the accent. */
export function rivalOf(draftModel: string | undefined) {
  return (draftModel || "").startsWith("openai/") ? "anthropic/claude-haiku-4.5" : DEFAULT_CLEANSE_MODEL;
}
const SENTINEL = "<<<SLOPMONSTER-NOTES>>>";
const CONCURRENCY = 3;
export type SlopReport = { before: number; after: number; tells: string[]; changed: boolean; notes?: string };

export function vendorDirectory(root: string) {
  return resolve(root, "skills", "website-os", "vendor", "slopmonster");
}
/** Score 0..5 and the named tells, parsed from the linter's own output. */
export function parseLint(output: string) {
  const score = Number(output.match(/score\s+(\d)\/5/)?.[1]);
  const tells: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s+·\s+(.+?)\s+\(\d+\)\s*$/);
    if (match) tells.push(match[1].trim());
  }
  return { score: Number.isFinite(score) ? score : 5, tells };
}
/** The cleanse reply is copy, a sentinel line, then notes. No sentinel means the whole reply is copy. */
export function splitCleanse(reply: string) {
  const index = reply.indexOf(SENTINEL);
  if (index < 0) return { copy: reply.trim(), notes: "" };
  return { copy: reply.slice(0, index).trim(), notes: reply.slice(index + SENTINEL.length).trim() };
}
/** A cleanse is accepted only when it kept the meaning: similar length, same links, same placeholders. */
export function acceptable(original: string, cleansed: string) {
  if (!cleansed || cleansed.length < 2) return false;
  const ratio = cleansed.length / Math.max(1, original.length);
  if (ratio < 0.5 || ratio > 1.7) return false;
  const links = (text: string) => (text.match(/https?:\/\/\S+/g) || []).sort().join(" ");
  if (links(original) !== links(cleansed)) return false;
  const placeholders = (text: string) => (text.match(/\[[^\]]{1,40}\]/g) || []).length;
  if (placeholders(cleansed) > placeholders(original) + 1) return false;
  if (/—/.test(cleansed) || /<<<|SLOPMONSTER|PASS \d/i.test(cleansed)) return false;
  return true;
}

export function slopCleanse(root: string, options: { homeDir?: string; request?: typeof fetch; model?: string; rival?: () => string; lint?: (text: string) => Promise<{ score: number; tells: string[] }> } = {}) {
  const home = options.homeDir;
  const fetcher = options.request || fetch;
  const modelKey = () => providerKey(root, "OPENROUTER_API_KEY", { home });
  const model = () => options.model || providerKey(root, "AGENTIC_CLEANSE_MODEL", { home }) || rivalOf(options.rival?.());
  const vendor = vendorDirectory(root);
  let python: string | undefined;
  let promptText: string | undefined;

  function findPython() {
    if (python) return python;
    python = [...executableCandidates("python3"), ...executableCandidates("python"), "/opt/homebrew/bin/python3", "/usr/bin/python3"].find(file => existsSync(file));
    return python;
  }
  /** Lint one text with the vendored linter; missing tools count as clean so drafting never stalls on them. */
  async function lint(text: string): Promise<{ score: number; tells: string[] }> {
    if (options.lint) return options.lint(text);
    const bin = findPython();
    if (!bin || !text.trim()) return { score: 5, tells: [] };
    return new Promise(done => {
      const child = spawn(bin, [resolve(vendor, "tools", "deslop.py"), "--text", text.slice(0, 20000)], { stdio: ["ignore", "pipe", "ignore"], cwd: vendor });
      let out = "";
      const timer = setTimeout(() => { child.kill(); done({ score: 5, tells: [] }); }, 20000);
      child.stdout.on("data", chunk => { if (out.length < 200000) out += chunk; });
      child.on("error", () => { clearTimeout(timer); done({ score: 5, tells: [] }); });
      child.on("close", () => { clearTimeout(timer); done(parseLint(out)); });
    });
  }
  function prompt() {
    if (promptText) return promptText;
    try { promptText = readFileSync(resolve(vendor, "prompts", "cleanse.txt"), "utf8"); } catch { promptText = `Rewrite the text so a reader cannot tell it was machine-assisted. Remove AI vocabulary and constructions, vary sentence length, keep the meaning and every fact exactly, plain text. Return the rewritten copy, then a line containing exactly ${SENTINEL}, then at most five bullets on what changed.\n\nTEXT TO EDIT:`; }
    return promptText;
  }
  async function cleanse(text: string, context: string) {
    const key = modelKey();
    if (!key) throw new Error("Add OPENROUTER_API_KEY to ~/.config/agentic-os.env so drafts can be cleansed.");
    const system = "You are the SlopMonster cleanse: a rival editor who hears another model's accent instantly and strips it.";
    const user = `${prompt()}\n\n${text}\n\nCONTEXT FOR THIS EDIT: ${context} Keep it about the same length, keep the writer's first-person casual voice, names, emoji and any [placeholders], and return plain text with no markdown formatting.`;
    let response: Response;
    try { response = await fetcher(OPENROUTER, { method: "POST", signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/ItsssssJack/claude-operating-system", "X-Title": "Agentic OS SlopMonster cleanse" }, body: JSON.stringify({ model: model(), temperature: 0.4, max_tokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) }); } catch { throw new Error("The cleanse model could not be reached."); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 402) throw new Error("OpenRouter has no credit left for the cleanse model.");
      if (response.status === 429) throw new Error("The cleanse model is rate limited. Try again in a minute.");
      throw new Error(`The cleanse model returned HTTP ${response.status}.`);
    }
    const data: any = await response.json().catch(() => ({}));
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("The cleanse model returned no text.");
    return splitCleanse(reply);
  }
  /** Lint, cleanse with the rival model, lint again; returns the text to keep and the report. */
  async function polishOne(text: string, context: string): Promise<{ text: string; report: SlopReport }> {
    const before = await lint(text);
    let candidate: { copy: string; notes: string } | undefined;
    try { candidate = await cleanse(text, context); } catch (error) {
      if (/credit|rate limited|OPENROUTER_API_KEY/.test((error as Error).message)) throw error;
      candidate = undefined;
    }
    if (!candidate || !acceptable(text, candidate.copy) || candidate.copy === text) return { text, report: { before: before.score, after: before.score, tells: before.tells, changed: false } };
    const after = await lint(candidate.copy);
    if (after.score < before.score) return { text, report: { before: before.score, after: before.score, tells: before.tells, changed: false } };
    return { text: candidate.copy, report: { before: before.score, after: after.score, tells: before.tells, changed: true, notes: candidate.notes.slice(0, 600) || undefined } };
  }
  /** Polishes many drafts a few at a time; a failed item keeps its original text. */
  async function polish<T extends { id: string; text: string }>(items: T[], context: string, onEach?: (id: string, result: { text: string; report: SlopReport }) => void) {
    const out = new Map<string, { text: string; report: SlopReport }>();
    let next = 0, fatal: Error | undefined;
    const worker = async () => {
      while (next < items.length && !fatal) {
        const item = items[next++];
        if (!item.text.trim()) continue;
        try { const result = await polishOne(item.text, context); out.set(item.id, result); onEach?.(item.id, result); }
        catch (error) { if (/credit|rate limited|OPENROUTER_API_KEY/.test((error as Error).message)) fatal = error as Error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    if (fatal) throw fatal;
    return out;
  }
  return { lint, cleanse, polishOne, polish, model, configured: () => !!modelKey() };
}
