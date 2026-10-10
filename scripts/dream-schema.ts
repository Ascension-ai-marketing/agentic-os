/**
 * The Dream contract, enforced in code instead of only in SKILL.md prose.
 *
 * Every engine (Hermes, Claude Code, Codex, OpenRouter) hands its output to
 * `checkDream` before it can reach ~/.claude-os/dreams/. The check:
 *   1. repairs what is safe to repair (tone from cat, rounding, dollar figures
 *      with no stated basis, prescriptions the operator already dismissed),
 *   2. hides credentials anywhere in the text,
 *   3. rejects anything the dashboard would mis-render or that would be unsafe
 *      to copy-paste.
 * A rejected dream never overwrites the last good one.
 */
import { redactSecrets } from "./hermes-progress";

export const DREAM_TONES = {
  MEMORY: "pink",
  COST: "orange",
  SKILLS: "blue",
  WORKFLOW: "yellow",
} as const;
export type DreamCat = keyof typeof DREAM_TONES;

export interface Prescription {
  id: string;
  cat: DreamCat;
  tone: (typeof DREAM_TONES)[DreamCat];
  headline: string;
  prescription: string;
  evidence: string[];
  command?: string;
  dollarImpact: number | null;
  timeImpactMins: number | null;
  /** How the dollar or time figure was computed, e.g. "38 Opus turns × $0.21 avoided × 30 days". */
  impactBasis?: string;
}

export interface Dream {
  date: string;
  model: string;
  generatedAt: string;
  prescriptions: Prescription[];
  metadata?: Record<string, unknown>;
}

export interface DreamStateAction {
  status?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  timesSeen?: number;
  dismissedAt?: string;
  acceptedAt?: string;
  [k: string]: unknown;
}
export interface DreamState {
  actions?: Record<string, DreamStateAction>;
  currentTop4?: string[];
  [k: string]: unknown;
}

export interface DreamCheck {
  ok: boolean;
  dream: Dream | null;
  /** Problems that block publishing. */
  errors: string[];
  /** What was changed or looks weak; published anyway. */
  notes: string[];
  redactions: number;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_IN_ID = /(?:19|20)\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])/;
const RESURFACE_AFTER_DAYS = 30;

/** The operator's local calendar date (the cron runs at 7am local, not UTC). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Prefixes of the keys saved on this computer. A dream once quoted the first
// characters of a live ElevenLabs key — exact-value matching misses a prefix.
let secretPrefixes: RegExp[] = [];
export function setDreamSecrets(values: Iterable<string>) {
  secretPrefixes = [...new Set([...values].map((v) => v.trim()).filter((v) => v.length >= 16))].map(
    (v) => new RegExp(v.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[A-Za-z0-9_-]*", "g"),
  );
}

/** Patterns the shared redactor misses: underscore-style keys (ElevenLabs, Stripe), key prefixes, cloud key ids. */
export function redactDreamText(text: string): string {
  let out = redactSecrets(text);
  for (const re of secretPrefixes) out = out.replace(re, "••••");
  return out
    .replace(/\b(sk|rk|pk)_(?:live_|test_)?[A-Za-z0-9]{6,}/g, "$1_••••")
    .replace(/\bxai-[A-Za-z0-9]{20,}/g, "xai-••••")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA••••")
    .replace(/(\bxi-api-key\b["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]{8,}/gi, "$1••••");
}

/**
 * Returns why a command is unsafe to show as copy-paste, or null when it is fine.
 * Allowed: one invocation of an AI CLI or the repo's bun scripts, with no shell plumbing.
 */
export function unsafeCommandReason(cmd: string): string | null {
  const trimmed = cmd.trim();
  if (!trimmed) return "empty command";
  if (trimmed.length > 300) return "longer than 300 characters";
  const first = trimmed.split(/\s+/)[0];
  if (!["claude", "hermes", "codex", "bun", "open"].includes(first)) {
    return `starts with "${first}" (allowed: claude, hermes, codex, bun, open)`;
  }
  // Shell metacharacters outside quotes chain or redirect commands.
  const unquoted = trimmed.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  if (/[;&|<>`]|\$\(/.test(unquoted)) return "chains, pipes or redirects commands";
  if (/\$\(|`/.test(trimmed)) return "contains command substitution";
  if (/--dangerously-skip-permissions|--yolo|bypassPermissions/.test(trimmed))
    return "skips permission prompts";
  if (/\b(rm|sudo|chmod|chown|curl|wget|mv|dd|mkfs|kill)\b/.test(unquoted))
    return "runs a destructive or network command";
  return null;
}

function walkStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, fn)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walkStrings(v, fn);
    return out as T;
  }
  return value;
}

function impact(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return Math.round(v);
}

/** Days since an ISO timestamp, or Infinity when missing/unparseable. */
function daysSince(iso: string | undefined, now: number): number {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? (now - t) / 86_400_000 : Infinity;
}

/**
 * Repairs, redacts and validates a dream. `raw` is whatever the engine produced
 * (already JSON-parsed). `state` is ~/.claude-os/dreams/state.json, if any.
 */
export function checkDream(
  raw: unknown,
  opts: { today: string; state?: DreamState | null; now?: number } = { today: localDate() },
): DreamCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  const now = opts.now ?? Date.now();

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      dream: null,
      errors: ["output is not a JSON object"],
      notes,
      redactions: 0,
    };
  }

  let redactions = 0;
  const redacted = walkStrings(raw as Record<string, unknown>, (s) => {
    const r = redactDreamText(s);
    if (r !== s) redactions++;
    return r;
  });
  if (redactions) notes.push(`hid credentials in ${redactions} field(s)`);

  const d = redacted as Record<string, unknown>;
  if (d.date !== opts.today) {
    if (typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      notes.push(`date ${d.date} corrected to ${opts.today}`);
    else notes.push(`missing date set to ${opts.today}`);
  }
  const generatedAt =
    typeof d.generatedAt === "string" && Number.isFinite(Date.parse(d.generatedAt))
      ? d.generatedAt
      : new Date(now).toISOString();
  if (!Array.isArray(d.prescriptions)) {
    return { ok: false, dream: null, errors: ["prescriptions is not an array"], notes, redactions };
  }

  const actions = opts.state?.actions ?? {};
  const seen = new Set<string>();
  const kept: Prescription[] = [];

  d.prescriptions.forEach((p: any, i: number) => {
    const where = `prescription ${i + 1}${p && typeof p.id === "string" ? ` (${p.id})` : ""}`;
    if (!p || typeof p !== "object") return errors.push(`${where}: not an object`);

    const id = typeof p.id === "string" ? p.id.trim() : "";
    if (!ID.test(id) || id.length > 60)
      return errors.push(`${where}: id must be a lowercase-hyphen slug, max 60 chars`);
    if (DATE_IN_ID.test(id))
      return errors.push(`${where}: id contains a date, which breaks tracking across days`);
    if (seen.has(id)) return errors.push(`${where}: duplicate id`);
    seen.add(id);

    const prior = actions[id];
    if (
      prior?.status === "dismissed" &&
      daysSince(prior.dismissedAt ?? prior.lastSeenAt, now) < RESURFACE_AFTER_DAYS
    ) {
      return notes.push(
        `dropped ${id}: operator skipped it ${Math.floor(daysSince(prior.dismissedAt ?? prior.lastSeenAt, now))}d ago`,
      );
    }
    if (
      prior?.status === "accepted" &&
      daysSince(prior.acceptedAt ?? prior.lastSeenAt, now) < RESURFACE_AFTER_DAYS
    ) {
      return notes.push(
        `dropped ${id}: operator marked it done ${Math.floor(daysSince(prior.acceptedAt ?? prior.lastSeenAt, now))}d ago`,
      );
    }

    const cat = typeof p.cat === "string" ? p.cat.toUpperCase() : "";
    if (!(cat in DREAM_TONES))
      return errors.push(
        `${where}: cat "${p.cat}" is not one of ${Object.keys(DREAM_TONES).join(", ")}`,
      );
    const tone = DREAM_TONES[cat as DreamCat];
    if (p.tone !== tone) notes.push(`${id}: tone set to ${tone} to match ${cat}`);

    const headline = typeof p.headline === "string" ? p.headline.trim() : "";
    if (!headline) return errors.push(`${where}: missing headline`);
    if (headline.length > 120)
      return errors.push(`${where}: headline is ${headline.length} chars (max 120)`);
    const prescription = typeof p.prescription === "string" ? p.prescription.trim() : "";
    if (!prescription) return errors.push(`${where}: missing prescription`);

    const evidence = Array.isArray(p.evidence)
      ? p.evidence.filter((e: unknown) => typeof e === "string" && e.trim())
      : [];
    if (evidence.length !== 3)
      return errors.push(`${where}: needs exactly 3 evidence items, has ${evidence.length}`);

    let command: string | undefined;
    if (typeof p.command === "string" && p.command.trim()) {
      const why = unsafeCommandReason(p.command);
      if (why) notes.push(`${id}: removed command (${why})`);
      else command = p.command.trim();
    }

    let dollarImpact = impact(p.dollarImpact);
    let timeImpactMins = impact(p.timeImpactMins);
    if (dollarImpact === undefined)
      return errors.push(`${where}: dollarImpact must be a non-negative number or null`);
    if (timeImpactMins === undefined)
      return errors.push(`${where}: timeImpactMins must be a non-negative number or null`);
    const impactBasis =
      typeof p.impactBasis === "string" && p.impactBasis.trim() ? p.impactBasis.trim() : undefined;
    if (!impactBasis && (dollarImpact || timeImpactMins)) {
      notes.push(`${id}: cleared impact figures with no impactBasis`);
      dollarImpact = null;
      timeImpactMins = null;
    }

    kept.push({
      id,
      cat: cat as DreamCat,
      tone,
      headline,
      prescription,
      evidence: evidence.map((e: string) => e.trim()),
      ...(command ? { command } : {}),
      dollarImpact,
      timeImpactMins,
      ...(impactBasis ? { impactBasis } : {}),
    });
  });

  if (kept.length > 4) {
    notes.push(`kept the first 4 of ${kept.length} prescriptions`);
    kept.length = 4;
  }
  const cats = new Set(kept.map((p) => p.cat));
  if (kept.length === 4 && cats.size < 3)
    notes.push(`only ${cats.size} categor${cats.size === 1 ? "y" : "ies"} across 4 cards`);

  const dream: Dream = {
    date: opts.today,
    model: typeof d.model === "string" && d.model.trim() ? d.model.trim() : "unknown",
    generatedAt,
    prescriptions: kept,
    ...(d.metadata && typeof d.metadata === "object"
      ? { metadata: d.metadata as Record<string, unknown> }
      : {}),
  };
  return { ok: errors.length === 0, dream, errors, notes, redactions };
}

/**
 * Closes the loop: records which prescriptions were shown, so the next run can
 * age-track them and the dashboard's Skip / Mark done verdicts stick.
 * Verdicts the operator gave (dismissed / accepted) are never overwritten here.
 */
export function updateDreamState(
  state: DreamState | null,
  dream: Dream,
  nowIso: string,
): DreamState {
  const next: DreamState = { ...(state ?? {}) };
  const actions: Record<string, DreamStateAction> = { ...(next.actions ?? {}) };
  for (const p of dream.prescriptions) {
    const prior = actions[p.id];
    if (!prior) {
      actions[p.id] = { status: "new", firstSeenAt: nowIso, lastSeenAt: nowIso, timesSeen: 1 };
      continue;
    }
    const status =
      prior.status === "dismissed" || prior.status === "accepted" ? "resurfaced" : "recurring";
    actions[p.id] = {
      ...prior,
      status,
      firstSeenAt: prior.firstSeenAt ?? nowIso,
      lastSeenAt: nowIso,
      timesSeen: (prior.timesSeen ?? 1) + 1,
    };
  }
  next.actions = actions;
  next.currentTop4 = dream.prescriptions.map((p) => p.id);
  return next;
}

/** Compact history the engine sees so it stops repeating itself. */
export function stateDigest(state: DreamState | null, now = Date.now()): string {
  const rows = Object.entries(state?.actions ?? {})
    .filter(([, a]) => daysSince(a.lastSeenAt, now) <= 45)
    .sort((a, b) => Date.parse(b[1].lastSeenAt ?? "") - Date.parse(a[1].lastSeenAt ?? ""))
    .slice(0, 40)
    .map(
      ([id, a]) =>
        `- ${id}: ${a.status ?? "new"}, shown ${a.timesSeen ?? 1}x, last ${String(a.lastSeenAt ?? "?").slice(0, 10)}`,
    );
  return rows.length ? rows.join("\n") : "(no prior prescriptions)";
}
