import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesignChecker, DESIGN_CHECK_EXAMPLE, designFingerprint, readDesignCheckHtml } from "./jev-design-check";
import type { JevDecision } from "../src/lib/jev-types";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "jev-design-")); dirs.push(dir); return dir; };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const decision: JevDecision = { id: "synthetic", at: "2026-09-28T12:00:00Z", surface: "slop", purpose: "Check a design", input: "HTML fingerprint", picked: "copy", escalated: false, ms: 3, costUsd: 0.00002, answers: { is_slop: { type: "noul", noul: 0.9 }, is_fake: { type: "noul", noul: 0.2 }, taste: { type: "score", score: 3, probabilities: { "3": 1 }, confidence: 1 }, fix: { type: "choice", choice: "copy", probabilities: { copy: 1 }, confidence: 1 } } };

test("fingerprint removes executable and hidden content and captures concrete signals", () => {
  const raw = DESIGN_CHECK_EXAMPLE.replace("</body>", '<script>const secret="DO_NOT_SEND"</script><input value="SECRET_INPUT"><span hidden>HIDDEN_SECRET</span><a href="https://example.test/privacy">Privacy</a><a href="mailto:test@example.test">Contact</a></body>');
  const fp = designFingerprint(raw), serialized = JSON.stringify(fp);
  expect(serialized).not.toContain("DO_NOT_SEND"); expect(serialized).not.toContain("SECRET_INPUT"); expect(serialized).not.toContain("HIDDEN_SECRET");
  expect(fp.h1).toEqual(["Supercharge your workflow!"]); expect(fp.stats.stock_phrases_found).toContain("supercharge");
  expect(fp.stats.round_number_claims).toEqual(["10,000+ teams"]);
  expect(fp.stats.has_privacy_or_terms_link).toBe(true); expect(fp.stats.has_contact_email_or_phone).toBe(true); expect(fp.stats.gradients_in_css).toBe(1);
  expect(designFingerprint(`<html><body>${"word ".repeat(1000)}</body></html>`).visible_text_sample.split(" ")).toHaveLength(450);
});

test("checks are explicit, cached by content, deduplicated, and do not persist source HTML", async () => {
  const root = temp(); let html = DESIGN_CHECK_EXAMPLE, calls = 0;
  const checker = createDesignChecker(root, () => html, async req => {
    calls++; expect(req.surface).toBe("slop"); expect(req.questions.is_slop.type).toBe("noul"); expect(req.questions.is_fake.type).toBe("noul");
    expect(req.questions.taste.type === "score" && req.questions.taste.criteria).toHaveLength(10);
    expect(JSON.stringify(req.state)).not.toContain("<html>"); await new Promise(r => setTimeout(r, 5)); return decision;
  });
  expect(checker.cached("a")).toBeNull(); expect(calls).toBe(0);
  await Promise.all([checker.check("a"), checker.check("a")]); expect(calls).toBe(1);
  expect(checker.cached("a")?.picked).toBe("copy"); await checker.check("a"); expect(calls).toBe(1);
  const saved = readFileSync(join(root, ".operator-data/jev/design-checks.json"), "utf8"); expect(saved).not.toContain("Supercharge");
  html = html.replace("workflow", "specific invoices"); expect(checker.cached("a")).toBeNull(); await checker.check("a"); expect(calls).toBe(2);
  expect(createDesignChecker(root, () => html, async () => { throw Error("cache miss"); }).cached("a")?.id).toBe("synthetic");
});

test("an errored verdict is never reused as a successful check", async () => {
  let calls = 0; const checker = createDesignChecker(temp(), () => DESIGN_CHECK_EXAMPLE, async () => { calls++; return { ...decision, error: "Jev HTTP 503" }; });
  await checker.check("a"); expect(checker.cached("a")).toBeNull(); await checker.check("a"); expect(calls).toBe(2);
});

test("the wall reader rejects traversal and symlinks outside the wall", () => {
  const root = temp(), wall = join(root, "wall"), good = join(wall, "good"); mkdirSync(good, { recursive: true });
  writeFileSync(join(good, "index.html"), DESIGN_CHECK_EXAMPLE); writeFileSync(join(root, "secret"), "secret");
  const evil = join(wall, "evil"); mkdirSync(evil); symlinkSync(join(root, "secret"), join(evil, "index.html"));
  expect(readDesignCheckHtml(wall, "good")).toContain("Fictional demo");
  expect(() => readDesignCheckHtml(wall, "../secret")).toThrow(); expect(() => readDesignCheckHtml(wall, "evil")).toThrow();
});
