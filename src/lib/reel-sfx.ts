// Sound effect suggestions for a reel section: three or four options from the
// example library, each with a short reason, the top one on by default.
// Sample odds from plain rules until a live Jev call is made. Shared by the
// Reels page (instant suggestions) and the server (the mix step).
import { reelEffects } from "./jev-reels";

export type SfxName = Exclude<(typeof reelEffects)[number], "none">;
export const SFX_NAMES = reelEffects.filter((e): e is SfxName => e !== "none");
export const SFX_LABELS: Record<SfxName, string> = {
  whoosh: "Whoosh",
  pop: "Pop",
  impact: "Impact",
  riser: "Riser",
  "cash-register": "Cash register",
  "clock-tick": "Clock tick",
  "notification-ding": "Ding",
  typing: "Typing",
  "crowd-gasp": "Crowd gasp",
};

export type SfxOption = { effect: SfxName; p: number; reason: string; on: boolean };
export type SectionSfx = { sectionId: string; at: number; options: SfxOption[]; sample: true };

type Section = { id: string; name: string; words: string; t0: number };

// What each effect is for, used when it is a runner-up.
const GENERIC: Record<SfxName, string> = {
  whoosh: "A quick move into the next idea.",
  pop: "A light reveal as the picture lands.",
  impact: "A hard hit on the key word.",
  riser: "Builds tension into the next line.",
  "cash-register": "Rings when money is on screen.",
  "clock-tick": "Time pressure under the words.",
  "notification-ding": "A soft alert, like a message arriving.",
  typing: "Keys typing, for work being done.",
  "crowd-gasp": "A surprised reaction to a reveal.",
};

/** The beat's best effect, a runner-up list, and why. */
function rules(text: string, index: number, total: number): Array<[SfxName, string]> {
  if (index === 0) return [["impact", "The hook lands on the $250, so it gets a hit."], ["riser", "Builds into the number."], ["pop", "Pops the gift card in."], ["whoosh", GENERIC.whoosh]];
  if (/\b(claim by|october|deadline|until|before)\b/.test(text)) return [["clock-tick", "A deadline, so a clock ticks."], ["riser", "Tension before the date."], ["impact", "Hits the date."], ["notification-ding", GENERIC["notification-ding"]]];
  if (/(\$\d|\bpro\b|\bmax\b|\bpay\b|\bprice)/.test(text)) return [["cash-register", "Money on screen, so a till rings."], ["pop", "Each price pops in."], ["notification-ding", "A light ding per number."], ["impact", GENERIC.impact]];
  if (/\b(miss|lose|losing)\b/.test(text)) return [["whoosh", "Something slips away, so it whooshes past."], ["crowd-gasp", "A gasp at missing out."], ["pop", GENERIC.pop], ["riser", GENERIC.riser]];
  if (/\b(cloud|computers?|server)\b/.test(text)) return [["typing", "Machines doing the work, so keys type."], ["whoosh", "Work flies up to the cloud."], ["notification-ding", GENERIC["notification-ding"]], ["pop", GENERIC.pop]];
  if (/\b(laptop|sleep|wake)\b/.test(text)) return [["notification-ding", "Waking up to a finished product: a soft ding."], ["whoosh", "The laptop closes."], ["pop", GENERIC.pop], ["riser", GENERIC.riser]];
  if (index === total - 1 || /\b(comment|link|follow)\b/.test(text)) return [["pop", "The call to action pops."], ["notification-ding", "Like a comment arriving."], ["impact", GENERIC.impact], ["whoosh", GENERIC.whoosh]];
  return [["whoosh", GENERIC.whoosh], ["pop", GENERIC.pop], ["riser", GENERIC.riser]];
}

export function suggestSectionSfx(section: Section, index: number, total: number): SectionSfx {
  const text = `${section.name} ${section.words}`.toLowerCase();
  const picks = rules(text, index, total).slice(0, 4);
  let seed = 0;
  for (const c of text) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const weights = picks.map((_, i) => (i === 0 ? 6 : 1.6 - i * 0.35 + ((seed >> (i * 3)) & 3) * 0.1));
  const sum = weights.reduce((a, b) => a + b, 0);
  return {
    sectionId: section.id,
    at: section.t0,
    options: picks.map(([effect, reason], i) => ({ effect, reason, p: weights[i] / sum, on: i === 0 })),
    sample: true,
  };
}

/** Only effects that are switched on, at their section times. */
export function enabledEffects(sections: SectionSfx[], toggles: Record<string, boolean> = {}): Array<{ sectionId: string; effect: SfxName; at: number }> {
  return sections.flatMap((s) =>
    s.options.filter((o) => toggles[`${s.sectionId}:${o.effect}`] ?? o.on).map((o) => ({ sectionId: s.sectionId, effect: o.effect, at: s.at })),
  );
}
