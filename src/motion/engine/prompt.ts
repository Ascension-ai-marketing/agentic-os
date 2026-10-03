/**
 * RISE prompts: fill a style's prompt from the active theme and assets, split
 * a prompt into its four sections, re-time it to any length, and a built-in
 * "template improver" that turns a rough idea into a full RISE prompt with no
 * model and no keys.
 *
 *   R  References   what to look at
 *   I  Idea         one image with a beginning, middle and end
 *   S  Style        how it looks + how it moves
 *   E  Examine      render 5 frames, fix, repeat
 */
import type { MotionStyle, Theme } from "./types";
import { LOOP } from "./types";

export interface PromptAsset {
  /** File name, e.g. "logo.svg". */
  name: string;
  /** Absolute path on disk (~/motion-studio-projects/assets/...). */
  path: string;
  kind: "logo" | "image" | "video";
  /** For a video: key frames pulled from it, so a model can look at it. */
  frames?: string[];
}

export type RiseKey = "R" | "I" | "S" | "E";
export const RISE_LABELS: Record<RiseKey, string> = {
  R: "References",
  I: "Idea",
  S: "Style",
  E: "Examine",
};

/** The line every on-camera prompt ends with (motion-video/PROMPTS.md). */
export const HOUSE_LINE =
  "Draw every frame in code from one render(t) function. Add real texture so it feels hand-made. Before you stop, check the frames at 0%, 25%, 50%, 75% and 100%, and fix anything that looks off.";

/** Fill {{placeholders}} from the theme, add any dropped assets, re-time to `seconds`. */
export function fillPrompt(
  style: MotionStyle,
  theme: Theme,
  assets: PromptAsset[] = [],
  seconds?: number,
): string {
  const name = theme.name || style.word || style.name;
  const filled = style.prompt
    .replace(/\{\{bg\}\}/g, theme.bg)
    .replace(/\{\{ink\}\}/g, theme.ink)
    .replace(/\{\{accent\}\}/g, theme.accent)
    .replace(/\{\{accent2\}\}/g, theme.accent2)
    .replace(/\{\{font\}\}/g, theme.font)
    .replace(/\{\{name\}\}/g, name);
  const timed = seconds ? retime(filled, seconds, style.duration ?? LOOP) : filled;
  return withAssets(timed, assets);
}

function assetLine(a: PromptAsset): string {
  if (a.kind === "logo")
    return `• Brand logo: ${a.path} (use this exact file as the logo; keep its proportions and colours, never redraw it).`;
  if (a.kind === "video")
    return `• Reference video: ${a.path} (match its motion, pacing and palette${
      a.frames?.length ? `; key frames to look at: ${a.frames.join(", ")}` : ""
    }).`;
  return `• Reference image: ${a.path} (match its palette and texture).`;
}

/** Insert asset references at the top of the R section (or prepend them). */
export function withAssets(prompt: string, assets: PromptAsset[]): string {
  if (!assets.length) return prompt;
  const lines = assets.map(assetLine);
  const head = prompt.match(/^R\s*[—–-][^\n]*\n/m);
  if (!head || head.index === undefined) return `R — References\n${lines.join("\n")}\n\n${prompt}`;
  const at = head.index + head[0].length;
  return prompt.slice(0, at) + lines.join("\n") + "\n" + prompt.slice(at);
}

/** Insert plain reference lines (e.g. URLs) at the top of R. */
export function withReferences(prompt: string, lines: string[]): string {
  if (!lines.length) return prompt;
  const head = prompt.match(/^R\s*[—–-][^\n]*\n/m);
  if (!head || head.index === undefined) return `R — References\n${lines.join("\n")}\n\n${prompt}`;
  const at = head.index + head[0].length;
  return prompt.slice(0, at) + lines.join("\n") + "\n" + prompt.slice(at);
}

const HEADER =
  /^[ \t]*\**[ \t]*(R|I|S|E)[ \t]*(?:[—–:-]|\.)[ \t]*(References?|Idea|Style|Examine)?[ \t]*(?:[—–:-][ \t]*)?(.*)$/gim;

/** Split a RISE prompt into its sections ("R — References" or "R: text" headers). */
export function parseRise(text: string): Record<RiseKey, string> {
  const out: Record<RiseKey, string> = { R: "", I: "", S: "", E: "" };
  const marks: { key: RiseKey; start: number; end: number; inline: string }[] = [];
  let m: RegExpExecArray | null;
  HEADER.lastIndex = 0;
  while ((m = HEADER.exec(text)))
    marks.push({
      key: m[1].toUpperCase() as RiseKey,
      start: m.index,
      end: m.index + m[0].length,
      inline: (m[3] || "").trim(),
    });
  if (!marks.length) {
    out.I = text.trim();
    return out;
  }
  marks.forEach((mk, i) => {
    const rest = text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
    const body = [mk.inline, rest].filter(Boolean).join("\n");
    if (!out[mk.key]) out[mk.key] = body;
  });
  return out;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Re-time a prompt written for `from` seconds to `to` seconds: beat ranges in
 * the Idea and Examine sections scale, "N seconds" becomes the new length, and
 * the Examine frame list becomes quarters of it. Move durations in Style stay.
 */
export function retime(prompt: string, to: number, from = LOOP): string {
  if (!to || Math.abs(to - from) < 1e-6) return prompt;
  const k = to / from;
  const F = num(from);
  const fixSection = (body: string) =>
    body
      .replace(
        /(\d+(?:\.\d+)?)\s*([–-])\s*(\d+(?:\.\d+)?)\s*s\b/g,
        (_, a: string, dash: string, b: string) => `${num(+a * k)}${dash}${num(+b * k)} s`,
      )
      .replace(new RegExp(`\\b${F}(-| )second(s?)\\b`, "g"), (_, sep: string, s: string) =>
        sep === "-" ? `${num(to)}-second${s}` : `${num(to)} second${s}`,
      )
      .replace(new RegExp(`\\b${F} s\\b`, "g"), `${num(to)} s`)
      .replace(
        /t = 0, [\d.]+, [\d.]+, [\d.]+, [\d.]+/g,
        `t = 0, ${num(to / 4)}, ${num(to / 2)}, ${num((3 * to) / 4)}, ${num(to)}`,
      )
      .replace(new RegExp(`frame 0 equals frame ${F}\\b`, "g"), `frame 0 equals frame ${num(to)}`);
  // Only touch the I and E sections (their bodies run to the next header).
  const marks: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  HEADER.lastIndex = 0;
  while ((m = HEADER.exec(prompt)))
    marks.push({ key: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });
  if (!marks.length) return fixSection(prompt);
  let out = prompt.slice(0, marks[0].start);
  marks.forEach((mk, i) => {
    const chunk = prompt.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : prompt.length);
    out += mk.key === "I" || mk.key === "E" ? fixSection(chunk) : chunk;
  });
  return out;
}

const STOP = new Set(
  "a an the and or of to in on at for with from into over under by as is are be it its this that my our your their some very really just like make made want need please".split(
    " ",
  ),
);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The style whose tags and description best match an idea (or null). */
export function matchStyle(idea: string, styles: MotionStyle[]): MotionStyle | null {
  const ws = words(idea);
  let best: MotionStyle | null = null;
  let bestScore = 0;
  for (const s of styles) {
    const bag = new Set([...(s.tags ?? []), ...words(s.name), ...words(s.look)]);
    let score = 0;
    for (const w of ws) {
      if (s.tags?.includes(w)) score += 3;
      else if (bag.has(w)) score += 1;
      else if ([...bag].some((b) => b.length > 3 && (b.startsWith(w) || w.startsWith(b))))
        score += 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 1 ? best : null;
}

function sentence(text: string): string {
  const t = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Split an idea on sequencing words into up to three beats. */
export function beats(idea: string): string[] {
  const parts = idea
    .replace(/\s+/g, " ")
    .split(
      /\s*(?:->|→|;|\.\s+|,?\s+(?:and then|then|after that|before|until|finally|while)\s+)\s*/i,
    )
    .map((p) => p.trim().replace(/^(?:and|but)\s+/i, ""))
    .filter((p) => p.length > 2);
  if (parts.length <= 3) return parts;
  return [parts[0], parts.slice(1, -1).join(", "), parts[parts.length - 1]];
}

export interface ImproveInput {
  idea: string;
  theme: Theme;
  styles: MotionStyle[];
  referenceUrl?: string | null;
  referenceImage?: string | null;
  assets?: PromptAsset[];
  /** True when the theme is a brand's (then it wins over a matched style's palette). */
  branded?: boolean;
  /** Styles the person picked (chips). The first leads; the rest are references. */
  picked?: MotionStyle[];
  /** Loop length in seconds (default 5). */
  seconds?: number;
  /** Extra reference URLs. */
  urls?: string[];
}

/** Keyless improver: a full RISE prompt from a rough idea (and any picked styles). */
export function templateImprove(input: ImproveInput): {
  prompt: string;
  style: MotionStyle | null;
} {
  const N = input.seconds && input.seconds > 0 ? input.seconds : LOOP;
  const picked = input.picked ?? [];
  const style = picked[0] ?? matchStyle(input.idea, input.styles);
  const refsExtra = [
    ...(input.referenceUrl ? [input.referenceUrl] : []),
    ...(input.urls ?? []),
  ].map((u) => `• ${u} (match its mood, palette and pacing, not its layout).`);
  const pickedRefs = picked
    .slice(1)
    .map((s) => `• Also borrow from ${s.name}: ${s.look}${s.ref ? ` (${s.ref})` : ""}`);

  // A picked style and no idea: the style's own prompt, in this brand, at this length.
  if (!input.idea.trim() && style) {
    const theme = input.branded ? input.theme : style.theme;
    const base = fillPrompt(style, theme, [], N);
    return {
      prompt: withAssets(withReferences(base, [...refsExtra, ...pickedRefs]), input.assets ?? []),
      style,
    };
  }

  const idea = sentence(input.idea) || "A single object transforms into something new";
  // Unbranded, the chosen style's own palette reads truest; branded, the brand's.
  const t = !input.branded && style ? style.theme : input.theme;
  const b = beats(input.idea);
  const begin =
    b.length >= 2
      ? `${sentence(b[0])}.`
      : `Set up the subject in its opening pose: one focal point, generous empty space.`;
  const middle =
    b.length >= 2
      ? `${sentence(b[1])}; one clear action the eye can follow.`
      : `The main move: ${idea.charAt(0).toLowerCase() + idea.slice(1)}. One clear action the eye can follow.`;
  const end =
    b.length >= 3
      ? `${sentence(b[2])}, then ease back into the opening frame so the loop is seamless.`
      : `Resolve into a clean final frame, hold it at least 1.2 s, then ease back into the opening frame so the loop is seamless.`;

  const refs = [
    ...refsExtra,
    input.referenceImage
      ? `• Reference image: ${input.referenceImage} (match its palette and texture).`
      : null,
    style
      ? `• ${style.name}: ${style.look}${style.ref ? ` (${style.ref})` : ""}`
      : `• Two or three real motion pieces in this spirit; study their spacing and easing before you draw.`,
    ...pickedRefs,
    `• Search for real examples first; match their craft, not their composition.`,
  ].filter(Boolean);

  const looks = style
    ? `${style.look} Palette: ground ${t.bg}, ink ${t.ink}, accent ${t.accent}, second accent ${t.accent2}. Type: ${t.font}.`
    : `Dark editorial: ${t.bg} ground, ${t.ink} ink, one ${t.accent} accent (and ${t.accent2} used sparingly), ${t.font} type, real grain and light falloff.`;
  const moves = style
    ? style.move
    : "Ease in and out on every move; one thing moves at a time; nothing drifts after it lands.";
  const rules = [
    ...(style
      ? style.rules.slice(0, 5)
      : [
          "One focal point; the visual fills most of the frame.",
          "Few words on screen; hold any text at least 1.2 s.",
          "One accent colour, used for the thing that matters.",
        ]),
    "Grain, light falloff and generous empty space: never flat vector.",
    "Every frame comes from t alone, so it loops without a seam.",
  ];
  const b1 = num(N * 0.3);
  const b2 = num(N * 0.7);
  const L = num(N);

  const prompt = `R — References
${refs.join("\n")}

I — Idea
${idea}. One image with a beginning, middle and end, ${L} seconds, looping seamlessly:
• Beginning (0–${b1} s): ${begin}
• Middle (${b1}–${b2} s): ${middle}
• End (${b2}–${L} s): ${end}

S — Style
Looks: ${looks}
Moves: ${moves}
Rules:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

E — Examine
Build one HTML file: a <canvas> and one pure function render(ctx, t, theme, w, h) that draws frame t (0–${L} s) from theme {bg, ink, accent, accent2, font}. Same t, same frame, in any order; seeded hash, no Math.random. Must work at 16:9, 9:16 and 1:1.
Render 5 frames (t = 0, ${num(N / 4)}, ${num(N / 2)}, ${num((3 * N) / 4)}, ${L}). Check: frame 0 equals frame ${L}; nothing is clipped; no single word sits alone on a line; text holds at least 1.2 s; the frame never looks empty or flat. Fix what fails and render again until every check passes.`;
  return { prompt: withAssets(prompt, input.assets ?? []), style };
}

/**
 * Auto-enhance off: the person's own words, with the picked style's prompt,
 * references and length attached, nothing rewritten.
 */
export function composePlain(input: ImproveInput): string {
  const N = input.seconds && input.seconds > 0 ? input.seconds : LOOP;
  const picked = input.picked ?? [];
  const lines: string[] = [];
  if (input.idea.trim()) lines.push(input.idea.trim());
  lines.push(`Length: ${num(N)} seconds, a seamless loop.`);
  const refs = [...(input.referenceUrl ? [input.referenceUrl] : []), ...(input.urls ?? [])].map(
    (u) => `• ${u}`,
  );
  const files = (input.assets ?? []).map(assetLine);
  if (refs.length || files.length) lines.push(["References:", ...refs, ...files].join("\n"));
  for (const s of picked)
    lines.push(
      `Style to follow (${s.name}):\n${fillPrompt(s, input.branded ? input.theme : s.theme, [], N)}`,
    );
  if (!picked.length) lines.push(HOUSE_LINE);
  return lines.join("\n\n");
}

/** The system prompt the Claude Code improver runs with. */
export function improverSystem(styles: MotionStyle[], seconds = LOOP): string {
  const N = num(seconds);
  const b1 = num(seconds * 0.3);
  const b2 = num(seconds * 0.7);
  return [
    "You turn a rough motion-graphics idea into one production prompt in RISE format, for Claude to build in code.",
    "Output ONLY the prompt, plain text, exactly four sections with these headers on their own lines:",
    "R — References",
    "I — Idea",
    "S — Style",
    "E — Examine",
    "R: 2-4 bullet references (real, searchable things; include any URL or file path the user gave, verbatim).",
    `I: one sentence, then three bullets: Beginning (0–${b1} s), Middle (${b1}–${b2} s), End (${b2}–${N} s). One image with a beginning, middle and end; a ${N} second seamless loop.`,
    "S: 'Looks:' one or two lines (palette hex codes from the theme given), 'Moves:' one or two lines (easing, timing), then 'Rules:' 5-7 numbered craft rules.",
    `E: the build contract (one HTML file, a <canvas>, one pure function render(ctx, t, theme, w, h), seeded hash not Math.random, works at 16:9, 9:16 and 1:1) and: render 5 frames (t = 0, ${num(seconds / 4)}, ${num(seconds / 2)}, ${num((3 * seconds) / 4)}, ${N}), list 4-5 concrete checks for THIS idea, fix and repeat until all pass.`,
    "If the user picked a style, keep its look and motion vocabulary and adapt it to the idea.",
    "House style: dark editorial ground, one accent colour, real grain and light falloff, generous space, few words, text held at least 1.2 s, never clip descenders, never a single word alone on a line.",
    "Be specific and visual. No preamble, no markdown headings, no closing remarks. Under 380 words.",
    "Known styles you may borrow from: " + styles.map((s) => `${s.name} (${s.look})`).join("; "),
  ].join("\n");
}
