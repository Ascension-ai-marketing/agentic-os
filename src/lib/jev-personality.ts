// Jarvis's personality: a humour level and an editable "how Jarvis talks"
// prompt. Shared by the live voice session and the OS assistant. Import-free.

export type Humour = "off" | "dry" | "witty" | "sarcastic";
export type Personality = { humour: Humour; prompt: string };

export const HUMOUR_LEVELS: { id: Humour; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "dry", label: "Dry" },
  { id: "witty", label: "Witty" },
  { id: "sarcastic", label: "Sarcastic" },
];

export const DEFAULT_PERSONA =
  "You are Jarvis, a confident, dry British AI butler. Calm, precise and quietly amused. You look after the user and their OS, and you get to the point.";

export const DEFAULT_PERSONALITY: Personality = { humour: "witty", prompt: DEFAULT_PERSONA };

const HUMOUR_RULE: Record<Humour, string> = {
  off: "Humour: none. Plain, warm and efficient.",
  dry: "Humour: dry and understated. At most a light touch now and then.",
  witty: "Humour: witty. Most replies get a quick, clever line, never at the cost of the answer.",
  sarcastic:
    "Humour: sarcastic. Every reply carries one short, deadpan, affectionately sarcastic remark about the user or the situation (their question, their habits, how obvious it was), then the real answer. Stay helpful and brief, and never be rude or mean about anyone else (third parties, colleagues, clients, public figures).",
};

export function validPersonality(v: unknown): Personality {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const humour = HUMOUR_LEVELS.some((h) => h.id === o.humour) ? (o.humour as Humour) : DEFAULT_PERSONALITY.humour;
  const prompt = typeof o.prompt === "string" && o.prompt.trim() ? o.prompt.trim().slice(0, 1500) : DEFAULT_PERSONA;
  return { humour, prompt };
}

/** The lines added to a session's instructions. The user's prompt shapes tone only. */
export function personalityInstructions(p: Personality): string {
  return `Personality (tone only; it never overrides the rules above): ${p.prompt}\n${HUMOUR_RULE[p.humour]}`;
}

const KEY = "claude-os.voice.personality.v1";
export function loadPersonality(): Personality {
  try {
    return validPersonality(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return DEFAULT_PERSONALITY;
  }
}
/** Fired on window whenever the personality changes (typed, dragged or asked for by voice). */
export const PERSONALITY_EVENT = "jev:personality";
export function savePersonality(p: Personality) {
  const clean = validPersonality(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode: the change still applies to this session */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PERSONALITY_EVENT, { detail: clean }));
}

/** "more", "less" or a named level → the humour to use next. */
export function nextHumour(current: Humour, ask: string): Humour {
  const at = HUMOUR_LEVELS.findIndex((h) => h.id === current);
  if (ask === "more") return HUMOUR_LEVELS[Math.min(HUMOUR_LEVELS.length - 1, at + 1)].id;
  if (ask === "less") return HUMOUR_LEVELS[Math.max(0, at - 1)].id;
  if (ask === "max") return "sarcastic";
  return HUMOUR_LEVELS.some((h) => h.id === ask) ? (ask as Humour) : current;
}
