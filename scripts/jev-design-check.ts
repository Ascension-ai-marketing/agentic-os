import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { parseHTML } from "linkedom";
import type { JevDecideRequest, JevDecision, JevQuestion } from "../src/lib/jev-types";
import { jevEngine } from "./jev";

export const DESIGN_CHECK_EXAMPLE = `<!doctype html><html><head><title>Fictional demo</title>
<style>body{font-family:Arial;background:#fff}.card{border-radius:20px;background:linear-gradient(#fff,#eef)}</style></head>
<body><h1>Supercharge your workflow!</h1><p>Trusted by 10,000+ teams. Seamless, effortless, all-in-one.</p>
<div class="card"><h2>Unlock your potential</h2><p>John Doe says: the best product ever!</p></div>
<a href="#">Get started today</a><p>Fictional example for testing a design heuristic.</p></body></html>`;

/** Port of detect.py's fingerprint idea. No HTML, script, image or link is executed. */
export function designFingerprint(raw: string) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 2_000_000) throw new Error("Design HTML must be under 2 MB");
  const { document } = parseHTML(raw);
  const css = [...document.querySelectorAll("style")].map(e => e.textContent ?? "").join(" ") + " " +
    [...document.querySelectorAll("[style]")].map(e => e.getAttribute("style")).join(" ");
  const count = (re: RegExp, text = css) => [...text.matchAll(re)].length;
  const unique = (values: string[], n: number) => [...new Set(values)].slice(0, n);
  const texts = (selector: string, n: number) => unique([...document.querySelectorAll(selector)]
    .map(e => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean), n);
  const title = texts("title", 1)[0] ?? "";
  const images = document.querySelectorAll("img").length;
  const hrefs = [...document.querySelectorAll("a[href]")].map(e => e.getAttribute("href") ?? "");
  const linkedStyles = document.querySelectorAll('link[rel="stylesheet"]').length;
  document.querySelectorAll('script,style,noscript,svg,template,[hidden],[aria-hidden="true"]').forEach(e => e.remove());
  const visible = (document.body?.textContent || document.documentElement.textContent || "").replace(/\s+/g, " ").trim();
  const words = visible.split(/\s+/).filter(Boolean);
  const colors = [...css.matchAll(/#(?:[0-9a-f]{3}){1,2}\b/gi)].map(m => m[0].toLowerCase());
  const counts = new Map<string, number>(); colors.forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1));
  const stock = ["lorem ipsum", "trusted by", "join thousands", "get started today", "seamless", "supercharge", "unlock", "empower", "revolutioni", "game-chang", "all-in-one", "effortless", "loved by", "john doe", "jane doe", "acme"];
  return {
    title, h1: texts("h1", 3), h2_h3: texts("h2,h3", 16), buttons: texts("button,a", 14),
    visible_text_sample: words.slice(0, 450).join(" ").slice(0, 16_000),
    stats: {
      word_count: words.length, images,
      emoji_count: count(/[\u{1F300}-\u{1FAFF}⭐✅❌]/gu, visible),
      exclamation_marks: count(/!/g, visible), gradients_in_css: count(/(?:linear|radial)-gradient/gi),
      three_column_grids: count(/repeat\(\s*3\s*,|grid-template-columns\s*:\s*(?:1fr\s+){2}1fr/gi),
      card_class_uses: document.querySelectorAll(".card").length,
      testimonial_markers: count(/testimonial|review|what our (?:customers|users) say/gi, visible),
      stock_phrases_found: stock.filter(p => visible.toLowerCase().includes(p)),
      distinct_colours: counts.size, top_colours: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c),
      font_families: unique([...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map(m => m[1].trim().slice(0, 60)), 6),
      google_fonts: [...raw.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"']+)/g)].slice(0, 4).map(m => m[1].slice(0, 100)),
      backdrop_blur: /backdrop-filter/i.test(css), box_shadows: count(/box-shadow/gi),
      border_radius_values: unique([...css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)].map(m => m[1].slice(0, 60)), 6),
      has_pricing_section: /pricing/i.test(visible),
      placeholder_links: hrefs.filter(h => !h || h === "#" || /^javascript:/i.test(h)).length,
      external_links: hrefs.filter(h => /^https?:\/\//i.test(h)).length,
      external_domain_count: new Set(hrefs.flatMap(h => { try { return /^https?:\/\//i.test(h) ? [new URL(h).hostname] : []; } catch { return []; } })).size,
      has_privacy_or_terms_link: hrefs.some(h => /privacy|terms/i.test(h)),
      has_contact_email_or_phone: hrefs.some(h => /^(?:mailto:|tel:)/i.test(h)),
      round_number_claims: [...visible.matchAll(/\b\d{1,3}(?:,\d{3})?\+?\s*(?:teams|users|customers|companies|businesses|developers|people)\b/gi)].slice(0, 6).map(m => m[0]),
      single_file_inline_css_only: !linkedStyles && !!css.trim(),
      has_features_section: texts("h2,h3", 50).some(t => /^features$/i.test(t)),
    },
  };
}

export const designQuestions: Record<string, JevQuestion> = {
  is_slop: { type: "noul", instructions: "Does this HTML fingerprint suggest generic, interchangeable AI design? Look for stock marketing copy, placeholder names, repeated hero/features/testimonials/pricing patterns and vague promises. Specific content, a distinct voice, clear hierarchy and deliberate type/color choices count against genericness. A gradient or a three-column grid alone is not enough. Judge only the evidence supplied." },
  is_fake: { type: "noul", instructions: "Does the fingerprint contain signals of invented or unsupported claims, such as round customer counts, placeholder testimonials or unusable calls to action? This is a heuristic, not a fact check. Do not assume a company or person is fictional from its name. Inline CSS or missing legal links alone is not evidence of fabrication. A clearly labeled fictional demo is not deceptive." },
  taste: { type: "score", instructions: "Estimate design and copy taste from this text/CSS fingerprint, 0 to 9. You cannot see pixels, spacing or rendered layout. Specific copy and coherent design choices matter more than surface polish.", criteria: ["0: placeholders throughout", "1: product name swapped into a template", "2: mostly stock copy", "3: ordinary with a few specifics", "4: competent, default styling", "5: specific copy and consistent palette", "6: clear point of view and hierarchy", "7: distinctive choices and concrete proof", "8: memorable and purposeful", "9: exceptional editorial design and evidence"] },
  fix: { type: "choice", instructions: "Pick the single most useful next improvement supported by this fingerprint.", criteria: { copy: "Replace vague or stock phrases with specific useful copy", layout: "Give repeated template sections a clearer purpose and hierarchy", colour: "Simplify an incoherent palette or excessive effects", type: "Improve inconsistent font choices or hierarchy", proof: "Verify claims and add supporting evidence or working links", nothing: "No clear improvement is supported by this fingerprint" } },
};

export function readDesignCheckHtml(base: string, id: string) {
  if (!/^[a-zA-Z0-9 _.-]{1,160}$/.test(id) || id.includes("..")) throw new Error("Invalid design id");
  const root = realpathSync(base), file = realpathSync(join(root, id, "index.html"));
  if (!file.startsWith(root + sep) || statSync(file).size > 2_000_000) throw new Error("Design file is outside the wall or too large");
  return readFileSync(file, "utf8");
}

export function createDesignChecker(root: string, readHtml: (id: string) => string, decide: (req: JevDecideRequest) => Promise<JevDecision> = jevEngine(root).decide) {
  const dir = join(root, ".operator-data/jev"), file = join(dir, "design-checks.json");
  type Row = { hash: string; decision: JevDecision };
  let cache: Record<string, Row> = {};
  try { const parsed = JSON.parse(readFileSync(file, "utf8")); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cache = parsed; } catch { /* A missing cache is not a verdict. */ }
  const pending = new Map<string, Promise<JevDecision>>();
  const input = (id: string) => { const html = id === "__fictional_demo__" ? DESIGN_CHECK_EXAMPLE : readHtml(id); return { html, hash: createHash("sha256").update(html).digest("hex"), key: createHash("sha256").update(id).digest("hex") }; };
  function cached(id: string) { const { hash, key } = input(id); return cache[key]?.hash === hash ? cache[key].decision : null; }
  async function check(id: string) {
    const { html, hash, key } = input(id);
    if (cache[key]?.hash === hash) return cache[key].decision;
    const requestKey = `${key}:${hash}`;
    const existing = pending.get(requestKey); if (existing) return existing;
    const job = (async () => {
      const decision = await decide({ surface: "slop", purpose: "Check a Design creation", input: "HTML design fingerprint", state: { fingerprint: designFingerprint(html), evidenceLimit: "Static HTML and CSS only; no pixels, external stylesheets or factual verification" }, questions: designQuestions, headline: "fix" });
      if (!decision.error) {
        cache[key] = { hash, decision };
        cache = Object.fromEntries(Object.entries(cache).sort((a, b) => a[1].decision.at.localeCompare(b[1].decision.at)).slice(-500));
        mkdirSync(dir, { recursive: true, mode: 0o700 }); const temp = `${file}.${randomUUID()}.tmp`;
        writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 }); renameSync(temp, file);
      }
      return decision;
    })();
    pending.set(requestKey, job);
    try { return await job; } finally { pending.delete(requestKey); }
  }
  return { cached, check };
}
