import openaiLogo from "@/assets/logo-openai.svg";
import claudeLogo from "@/assets/logo-claude.svg";
import hermesLogo from "@/assets/hermes-face.png";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Banknote,
  BrainCircuit,
  CalendarDays,
  Cpu,
  Landmark,
  ListChecks,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Video,
} from "lucide-react";
import { askOperator, localDay, operatorRequest, useOperator } from "@/lib/operator";
import { useBusinessWorkspace, type BusinessWorkspace } from "@/lib/business-workspace";
import { useWorkspaceProfile } from "@/lib/workspace-profile";
import { BUSINESS_SAMPLE, monthTotal } from "@/lib/business-intel";
import { useBusinessDemo } from "@/lib/business-demo";
import { SourceBrand } from "@/components/operator/source-brand";
import { openBusinessAccounts } from "./connections-panel";
import { DreamReviewActions } from "./dream-review-actions";
import { AmbientVideo } from "./ambient-video";
import {
  BriefNews,
  BriefWeatherPill,
  type BriefEvent,
  type BriefMemoryItem,
  type BriefToday,
} from "./brief-today";
import "./daily-brief.css";

type Source = { label: string; ref?: string; recordedAt?: string };
type PriorityAction = { id: string; text: string; completed: boolean; completedAt?: string };
type SourceCategory = "business" | "inbox" | "calendar" | "content" | "goals" | "dream" | "memory";
type Recommendation = {
  id: string;
  title: string;
  summary: string;
  sourceCategory: SourceCategory;
  sources: Source[];
};
/** The assistant lane that wrote a brief. Older briefs only know codex or claude. */
type Generator = "codex" | "claude" | "hermes" | "local" | "deepseek";
type GeneratedBy = { provider: Generator; model: string; label?: string; key?: string };
type Report = {
  generatedBy?: GeneratedBy;
  mode?: "demo";
  id: string;
  date: string;
  timezone: string;
  headline: string;
  summary: string;
  priorities?: string[];
  prioritySources?: Source[][];
  priorityActions?: PriorityAction[];
  recommendations?: Recommendation[];
  sections: Array<{
    id: string;
    title: string;
    body: string;
    bullets?: string[];
    sources: Source[];
  }>;
  createdAt: string;
  updatedAt: string;
};
type Envelope = {
  latest: Report | null;
  archive: Array<Pick<Report, "id" | "date" | "headline">>;
  schedule: {
    enabled: boolean;
    hour: number;
    minute: number;
    timezone: string;
    automationId?: string;
  };
};
type CatalogModel = { key: string; backend: string; provider?: string; name: string; label?: string };
type ModelCatalog = {
  models?: CatalogModel[];
  statuses?: Array<{ id: string; ready?: boolean; installed?: boolean }>;
};
/** The remembered generator, as GET /business/brief/status reports it. */
type ModelChoice = { key: string; backend: string; provider: string; name: string; label: string };
type BriefStatus = { generating: boolean; since?: string; demo?: boolean; model?: ModelChoice | null };
const CATEGORY_LABEL: Record<SourceCategory, string> = {
  business: "Business",
  inbox: "Inbox",
  calendar: "Calendar",
  content: "Content",
  goals: "Goals",
  dream: "Dream",
  memory: "Memory",
};
/** One line icon per evidence category, so a card says where its priority came from. */
const CATEGORY_ICON: Record<SourceCategory, typeof ListChecks> = {
  business: Landmark,
  goals: Target,
  inbox: Mail,
  calendar: CalendarDays,
  memory: BrainCircuit,
  dream: Sparkles,
  content: Video,
};
const TINTS = ["sky", "mint", "peach"] as const;

function categoryForRef(ref?: string): SourceCategory | undefined {
  if (!ref) return undefined;
  if (/^(inbox|email)/.test(ref)) return "inbox";
  if (/^(calendar|event)/.test(ref)) return "calendar";
  if (/^(content|video)/.test(ref)) return "content";
  if (/^(progress|goal)/.test(ref)) return "goals";
  if (/^dream/.test(ref)) return "dream";
  if (/^(business|finance|usage)/.test(ref)) return "business";
  if (/^(memory|meeting)/.test(ref)) return "memory";
  return undefined;
}
function categoryForSection(section: Report["sections"][number]): SourceCategory {
  const heading = `${section.id} ${section.title}`.toLowerCase();
  if (/\b(calendar|meetings?)\b/.test(heading)) return "calendar";
  if (/\b(goals?|progress)\b/.test(heading)) return "goals";
  if (/\bdream\b/.test(heading)) return "dream";
  if (/\b(inbox|emails?)\b/.test(heading)) return "inbox";
  if (/\b(content|videos?)\b/.test(heading)) return "content";
  if (/\b(business|finance|audience)\b/.test(heading)) return "business";
  return categoryForRef(section.sources?.[0]?.ref || section.id) || "memory";
}
/** The dominant evidence category behind a priority, for its small source label. */
function categoryForSources(sources: Source[]): SourceCategory {
  const counts = new Map<SourceCategory, number>();
  for (const source of sources) {
    const category = categoryForRef(source.ref);
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "goals";
}
function compactText(text: string, limit = 235) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}
/** Bold the figures and named platforms inside a model-written sentence. Nothing is added or reworded. */
const EMPHASIS =
  /(\$\s?\d[\d,.]*\s?(?:k|m|bn|million|thousand)?\b|\d[\d,.]*\s?(?:%|percent|hours?|days?|weeks?|months?|members?|subscribers?|followers?|payments?|videos?|posts?|emails?|meetings?|tasks?|priorities|people|clients?)?|\b(?:YouTube|Instagram|TikTok|LinkedIn|Mercury|Stripe|Codex|Claude|Hermes)\b)/gi;
function emphasise(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    const start = match.index ?? 0;
    let phrase = match[0];
    let trailing = "";
    while (/[.,]$/.test(phrase)) {
      trailing = phrase.slice(-1) + trailing;
      phrase = phrase.slice(0, -1);
    }
    if (!phrase || !/\d|[A-Z]/.test(phrase)) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<b key={start}>{phrase}</b>);
    if (trailing) parts.push(trailing);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
function formatMoney(amount: number, currency: string | null) {
  const compact = Math.abs(amount) >= 1_000_000;
  return currency
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: compact ? 1 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(amount)
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: compact ? 1 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(amount);
}
/** The largest currency group across connected accounts; other currencies are not mixed in. */
function cashOnHand(finances: NonNullable<BusinessWorkspace["finances"]>) {
  const groups = new Map<string, number>();
  for (const account of finances.accounts)
    groups.set(account.currency || "", (groups.get(account.currency || "") || 0) + account.balance);
  const [currency, total] = [...groups.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return { total, currency: currency || null, others: groups.size - 1 };
}
async function celebratePriority(origin: { x: number; y: number }) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    void confetti({
      particleCount: 36,
      spread: 55,
      startVelocity: 21,
      ticks: 130,
      gravity: 0.9,
      scalar: 0.75,
      origin,
      colors: ["#c9d9f7", "#c8ecd6", "#f9d6c2", "#efe3bd"],
      disableForReducedMotion: true,
      zIndex: 120,
    });
  } catch {
    /* A decorative effect must never interrupt saving a priority. */
  }
}
function sourceLink(ref?: string) {
  if (ref?.startsWith("/") && !ref.startsWith("//")) return ref;
  if (ref?.startsWith("inbox")) return "/inbox";
  if (ref?.startsWith("calendar") || ref?.startsWith("event:")) return "/calendar";
  if (ref?.startsWith("memory") || ref?.startsWith("meeting")) return "/memory";
  if (ref?.startsWith("dream")) return "/dashboard";
  if (ref?.startsWith("finance") || ref?.startsWith("usage")) return "/business?view=finance";
  if (ref?.startsWith("content")) return "/business?view=audience&platform=youtube";
  if (ref?.startsWith("progress:") || ref?.startsWith("progress-update:"))
    return "/business?view=progress";
  if (ref && /^video:[A-Za-z0-9_-]{11}$/.test(ref))
    return `https://www.youtube.com/watch?v=${ref.slice(6)}`;
  if (ref === "business:workspace") return "/business";
  if (ref?.startsWith("business")) return "/business?view=audience";
  if (ref && /^https?:\/\//.test(ref)) {
    try {
      const url = new URL(ref);
      if (!url.username && !url.password) return url.href;
    } catch {
      /* Invalid source URLs remain labels. */
    }
  }
  return undefined;
}

/* ── Generator (which assistant writes the brief) ─────────────────────────── */
function generatorFor(model: { backend: string; provider?: string }): Generator {
  if (model.backend === "hermes") return "hermes";
  if (model.backend === "local") return "local";
  if (model.backend === "deepseek") return "deepseek";
  return /codex/i.test(model.provider || "") ? "codex" : "claude";
}
function generatorName(generator: Generator, provider?: string) {
  if (generator === "codex") return "Codex";
  if (generator === "claude") return "Claude";
  if (generator === "hermes") return "Hermes";
  if (generator === "deepseek") return "DeepSeek";
  return provider === "lmstudio" ? "LM Studio" : "Ollama";
}
function GeneratorMark({ generator, size = 14 }: { generator: Generator; size?: number }) {
  const logo = generator === "codex" ? openaiLogo : generator === "claude" ? claudeLogo : generator === "hermes" ? hermesLogo : undefined;
  return logo ? (
    <img src={logo} alt="" className={`morning-generator-logo is-${generator}`} width={size} height={size} />
  ) : (
    <Cpu size={size} aria-hidden="true" className="morning-generator-logo is-chip" />
  );
}
type ModelGroup = { id: "codex" | "claude" | "hermes" | "other"; title: string; generator: Generator; models: CatalogModel[]; ready: boolean; connect?: string };
/** The catalog grouped the way the brief can run it. Codex and Claude always appear, even when signed out, so the switch is discoverable. */
function groupModels(catalog: ModelCatalog | undefined): ModelGroup[] {
  const models = catalog?.models || [];
  const status = (id: string) => catalog?.statuses?.find((item) => item.id === id);
  const groups: ModelGroup[] = [
    { id: "codex", title: "Codex", generator: "codex", models: [], ready: status("codex")?.ready !== false, connect: "/settings#ai-tools" },
    { id: "claude", title: "Claude Code", generator: "claude", models: [], ready: status("claude")?.ready !== false, connect: "/settings#ai-tools" },
    { id: "hermes", title: "Hermes", generator: "hermes", models: [], ready: status("hermes")?.ready !== false },
    { id: "other", title: "Local & other", generator: "local", models: [], ready: true },
  ];
  for (const model of models) {
    if (!model || typeof model.key !== "string" || typeof model.name !== "string") continue;
    const generator = generatorFor(model);
    const group = groups.find((item) => (generator === "local" || generator === "deepseek" ? item.id === "other" : item.id === generator));
    group?.models.push(model);
  }
  return groups.filter((group) => group.models.length || group.id === "codex" || group.id === "claude");
}
/** "Codex · GPT-5.6-Sol" reads as "GPT-5.6-Sol" under the Codex heading. */
function modelTitle(model: CatalogModel) {
  const label = model.label || "";
  const parts = label.split(" · ");
  return (parts.length > 1 ? parts.slice(1).join(" · ") : label) || model.name;
}
/**
 * The "Generated by" chip. Click it to pick which assistant writes the next brief;
 * the choice is remembered on the server for later briefs and the morning run.
 */
function GeneratorChip({
  generated,
  chosen,
  schedule,
  demo,
  preparing,
  disabled,
  onChoose,
}: {
  generated?: GeneratedBy;
  chosen?: ModelChoice | null;
  schedule?: Envelope["schedule"];
  demo: boolean;
  preparing: boolean;
  disabled: boolean;
  onChoose: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const catalog = useQuery<ModelCatalog>({
    queryKey: ["setup-model-status"],
    queryFn: () => operatorRequest("/models"),
    enabled: open,
    staleTime: 60000,
    retry: 1,
  });
  useEffect(() => {
    if (!open) return;
    const down = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);
  // The next brief runs with the remembered choice; the label describes what wrote this one.
  const nextGenerator: Generator | undefined = chosen ? generatorFor(chosen) : generated?.provider;
  const nextName = chosen ? generatorName(generatorFor(chosen), chosen.provider) : generated ? generatorName(generated.provider) : undefined;
  const selectedKey = chosen?.key || generated?.key;
  const groups = useMemo(() => groupModels(catalog.data), [catalog.data]);
  const needle = filter.trim().toLowerCase();
  const label = preparing ? (
    <>
      Writing with <strong>{nextName || "your assistant"}</strong>…
    </>
  ) : generated ? (
    <>
      Generated by <strong>{generatorName(generated.provider)}</strong>
    </>
  ) : chosen ? (
    <>
      Next brief by <strong>{nextName}</strong>
    </>
  ) : schedule?.enabled && !demo ? (
    <>
      Every morning at {String(schedule.hour).padStart(2, "0")}:{String(schedule.minute).padStart(2, "0")}
    </>
  ) : (
    <>Codex or Claude</>
  );
  const shown: Generator | undefined = preparing ? nextGenerator : generated?.provider || nextGenerator;
  return (
    <div className={`morning-generator${open ? " is-open" : ""}`} ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className="morning-chip morning-generator-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={
          generated
            ? `Written by ${generated.label || generated.model}${chosen && chosen.key !== generated.key ? ` · next brief: ${chosen.label}` : ""} · click to change the assistant`
            : "Choose which assistant writes your brief"
        }
        onClick={() => setOpen((value) => !value)}
      >
        {shown && <GeneratorMark generator={shown} />}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" className="morning-generator-caret" />
      </button>
      {open && (
        <div className="morning-menu" role="menu" aria-label="Choose the assistant that writes your brief">
          <div className="morning-menu-lead">
            <strong>Who writes your brief</strong>
            <span>Choosing one prepares a fresh brief now and is remembered for every morning.</span>
          </div>
          {catalog.isLoading && <p className="morning-menu-note">Finding your assistants…</p>}
          {catalog.isError && (
            <p className="morning-menu-note">
              The list could not be loaded.{" "}
              <button type="button" onClick={() => void catalog.refetch()}>
                Try again
              </button>
            </p>
          )}
          {catalog.data &&
            groups.map((group) => {
              const large = group.models.length > 8;
              const visible = (needle
                ? group.models.filter((model) => `${model.label || ""} ${model.name}`.toLowerCase().includes(needle))
                : group.models
              ).slice(0, large ? 8 : 40);
              const hidden = group.models.length - visible.length;
              return (
                <section className="morning-menu-group" key={group.id} aria-label={group.title}>
                  <header>
                    <GeneratorMark generator={group.generator} size={13} />
                    <span>{group.title}</span>
                    {!group.ready && <em>Not signed in</em>}
                  </header>
                  {group.models.length === 0 ? (
                    <a className="morning-menu-connect" href={group.connect || "/settings#ai-tools"} role="menuitem">
                      Connect {group.title} <ArrowUpRight size={11} />
                    </a>
                  ) : (
                    <>
                      {large && (
                        <label className="morning-menu-filter">
                          <Search size={12} aria-hidden="true" />
                          <input
                            type="search"
                            value={filter}
                            placeholder={`Search ${group.models.length} models`}
                            onChange={(event) => setFilter(event.target.value)}
                            aria-label={`Search ${group.title} models`}
                          />
                        </label>
                      )}
                      {visible.map((model) => {
                        const selected = model.key === selectedKey;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`morning-menu-item${selected ? " is-selected" : ""}`}
                            key={model.key}
                            disabled={!group.ready}
                            title={group.ready ? model.label || model.name : `Sign in to ${group.title} to use this model`}
                            onClick={() => {
                              setOpen(false);
                              onChoose(model.key);
                            }}
                          >
                            <span>{modelTitle(model)}</span>
                            {selected && <Check size={13} aria-hidden="true" />}
                          </button>
                        );
                      })}
                      {hidden > 0 && (
                        <p className="morning-menu-note">
                          {needle ? `${hidden} more match${hidden === 1 ? "es" : ""} hidden` : `${hidden} more · type to search`}
                        </p>
                      )}
                      {needle && !visible.length && <p className="morning-menu-note">No match in {group.title}.</p>}
                    </>
                  )}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ── Sources that fed the brief ───────────────────────────────────────────── */
type BuiltBrand = { id: string; label: string; count: number };
const BRAND_LABEL: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  email: "Email",
  googlecalendar: "Calendar",
  mercury: "Mercury",
  youtube: "YouTube",
  notion: "Notion",
  granola: "Granola",
  obsidian: "Obsidian",
  slack: "Slack",
  business: "Business workspace",
  memory: "Memory",
  dream: "Dream review",
  web: "Web",
};
function brandForSource(source: Source, inboxProviders: Set<string>): string | undefined {
  const ref = source.ref || "",
    label = source.label.toLowerCase();
  if (/^inbox:google/.test(ref)) return "gmail";
  if (/^inbox:outlook/.test(ref)) return "outlook";
  if (/^inbox-thread:|^inbox:|^email/.test(ref))
    return inboxProviders.size === 1 ? [...inboxProviders][0] : /outlook/.test(label) ? "outlook" : /gmail|google/.test(label) ? "gmail" : "email";
  if (/^(event|calendar)/.test(ref)) return /outlook/.test(label) ? "outlook" : "googlecalendar";
  if (/^(memory|meeting)/.test(ref)) {
    if (/mercury/.test(label)) return "mercury";
    if (/youtube/.test(label)) return "youtube";
    if (/notion/.test(label)) return "notion";
    if (/obsidian/.test(label)) return "obsidian";
    if (/slack/.test(label)) return "slack";
    if (/granola|meeting/.test(label)) return "granola";
    return "memory";
  }
  if (/^(business|finance|progress|goal)/.test(ref)) {
    if (/youtube/.test(label)) return "youtube";
    if (/mercury|bank|balance|cash|account/.test(label) || /^finance/.test(ref)) return "mercury";
    return "business";
  }
  if (/^(content|video)/.test(ref)) return "youtube";
  if (/^dream/.test(ref)) return "dream";
  if (/^https?:\/\//.test(ref)) return "web";
  return undefined;
}
/** Every logo that fed a brief, most-cited first. Sections mirror recommendations, so each receipt counts once. */
function builtFrom(report: Report): BuiltBrand[] {
  const receipts = new Map<string, Source>();
  const add = (source: Source) => receipts.set(`${source.ref || ""}|${source.label}`, source);
  for (const section of report.sections || []) for (const source of section.sources || []) add(source);
  for (const item of report.recommendations || []) for (const source of item.sources || []) add(source);
  for (const sources of report.prioritySources || []) for (const source of sources) add(source);
  const inboxProviders = new Set<string>();
  for (const source of receipts.values()) {
    if (/^inbox:google/.test(source.ref || "")) inboxProviders.add("gmail");
    if (/^inbox:outlook/.test(source.ref || "")) inboxProviders.add("outlook");
  }
  const counts = new Map<string, number>();
  for (const source of receipts.values()) {
    const id = brandForSource(source, inboxProviders);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, label: BRAND_LABEL[id] || id, count }));
}
function BuiltMark({ id }: { id: string }) {
  if (id === "mercury") return <img src="/business-sources/mercury.svg" alt="" />;
  if (id === "youtube") return <img src="/business-sources/youtube-symbol.svg" alt="" />;
  if (id === "dream") return <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />;
  if (id === "memory") return <BrainCircuit size={13} strokeWidth={1.8} aria-hidden="true" />;
  return <SourceBrand id={id} size={16} />;
}
function BuiltFrom({ report }: { report: Report }) {
  const brands = useMemo(() => builtFrom(report), [report]);
  const generated = report.generatedBy;
  if (!brands.length && !generated) return null;
  return (
    <div className="morning-built" aria-label="Sources that fed this brief">
      {brands.length > 0 && (
        <>
          <span className="morning-built-label">Built from</span>
          <ul className="morning-built-list">
            {brands.map((brand) => (
              <li
                key={brand.id}
                className="morning-built-mark"
                title={`${brand.label} · ${brand.count} ${brand.count === 1 ? "source" : "sources"}`}
                aria-label={`${brand.label}, ${brand.count} ${brand.count === 1 ? "source" : "sources"}`}
              >
                <BuiltMark id={brand.id} />
              </li>
            ))}
          </ul>
        </>
      )}
      {generated && (
        <span className="morning-built-writer" title={generated.label || generated.model}>
          <span className="morning-built-label">{brands.length ? "· written by" : "Written by"}</span>
          <span className="morning-built-mark is-writer" aria-label={`Written by ${generatorName(generated.provider)}`}>
            <GeneratorMark generator={generated.provider} size={14} />
          </span>
        </span>
      )}
    </div>
  );
}

/** The events that touch a local calendar day (YYYY-MM-DD). Mirrors the Calendar page's own rule. */
function eventsOnDay<T extends Pick<BriefEvent, "start" | "end" | "allDay">>(
  events: T[],
  day: string,
): T[] {
  if (!day) return [];
  const dayStart = new Date(`${day}T00:00:00`),
    dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return events
    .filter((event) => {
      if (event.allDay) return event.start.slice(0, 10) <= day && event.end.slice(0, 10) > day;
      const start = Date.parse(event.start),
        end = Date.parse(event.end);
      if (!Number.isFinite(start)) return false;
      if (!Number.isFinite(end) || start === end)
        return start >= dayStart.getTime() && start < dayEnd.getTime();
      return start < dayEnd.getTime() && end > dayStart.getTime();
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start));
}
const PREPARING_STEPS = [
  "Reading your goals and progress",
  "Checking your inbox and calendar",
  "Totalling audience and cash",
  "Weighing what needs attention today",
  "Writing your priorities",
];
/** A soft progress bar with the elapsed time. Sits inside the focus card while a brief is prepared. */
function BriefProgress({ since, label }: { since: number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const step = PREPARING_STEPS[Math.min(PREPARING_STEPS.length - 1, Math.floor(seconds / 12))];
  const progress = Math.min(94, 8 + (seconds / 150) * 86);
  const elapsed =
    seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
      : `${seconds}s`;
  return (
    <div className="morning-progress" role="status" aria-live="polite" aria-busy="true">
      <div className="morning-progress-copy">
        <strong>{label}</strong>
        <span>
          {step}… <time dateTime={`PT${seconds}S`}>{elapsed}</time>
        </span>
      </div>
      <div className="morning-progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>Usually under two minutes. You can keep working; this card updates on its own.</p>
    </div>
  );
}
function SourceReceipts({ sources, timezone }: { sources: Source[]; timezone: string }) {
  if (!sources.length)
    return <p className="morning-source-empty">No source receipt was attached to this saved item.</p>;
  return (
    <ul className="morning-sources">
      {sources.map((source, index) => {
        const href = sourceLink(source.ref);
        const date = source.recordedAt ? new Date(source.recordedAt) : null;
        const stamp =
          date && Number.isFinite(date.getTime())
            ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: timezone })
            : null;
        return (
          <li key={index}>
            {href ? (
              <a href={href}>
                {source.label} <ArrowUpRight size={11} />
              </a>
            ) : (
              <span>{source.label}</span>
            )}
            {stamp && <time dateTime={source.recordedAt}>{stamp}</time>}
          </li>
        );
      })}
    </ul>
  );
}
function NumberCard({
  tint,
  value,
  label,
  caption,
  action,
  arrow,
  icon: Icon,
}: {
  tint: (typeof TINTS)[number] | "cream" | "plain";
  value: ReactNode;
  label: string;
  caption?: ReactNode;
  action?: ReactNode;
  arrow?: { href: string; label: string };
  icon: typeof ListChecks;
}) {
  return (
    <article className={`morning-card morning-number tint-${tint}`}>
      <span className="morning-number-art" aria-hidden="true">
        <Icon size={20} strokeWidth={1.5} />
      </span>
      <div className="morning-number-value">{value}</div>
      <div className="morning-number-label">{label}</div>
      {caption && <div className="morning-number-caption">{caption}</div>}
      <div className="morning-number-foot">
        {action || <span />}
        {arrow && (
          <a className="morning-round is-quiet" href={arrow.href} aria-label={arrow.label}>
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
    </article>
  );
}

export function DailyBrief() {
  const demo = useBusinessDemo();
  const qc = useQueryClient();
  const profile = useWorkspaceProfile();
  const workspace = useBusinessWorkspace();
  const operator = useOperator();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState(0);
  const [error, setError] = useState("");
  // Another request (a schedule, a second tab, an earlier click) may already be
  // preparing the brief. Poll until it lands instead of showing an error line.
  const [preparingSince, setPreparingSince] = useState<number | null>(null);
  const [savingAction, setSavingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [openPriority, setOpenPriority] = useState("");
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [incomeError, setIncomeError] = useState("");
  const feed = useQuery<Envelope>({
    queryKey: ["business-brief", demo.enabled],
    queryFn: () => operatorRequest("/business/brief"),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
  const today = useQuery<BriefToday>({
    queryKey: ["business-today"],
    queryFn: () => operatorRequest("/business/today"),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const status = useQuery<BriefStatus>({
    queryKey: ["business-brief-status"],
    queryFn: () => operatorRequest("/business/brief/status"),
    refetchInterval: preparingSince !== null ? 2500 : false,
    staleTime: 2000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  // The rail's quiet tail: the newest saved memories.
  const recentMemory = useQuery<{ results: BriefMemoryItem[] }>({
    queryKey: ["memory-recent"],
    queryFn: () => operatorRequest("/search?recent=1"),
    staleTime: 60000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  useEffect(() => {
    if (!status.data) return;
    if (status.data.generating && preparingSince === null && !busy) {
      const started = status.data.since ? Date.parse(status.data.since) : NaN;
      setPreparingSince(Number.isFinite(started) ? started : Date.now());
    }
    if (!status.data.generating && preparingSince !== null) {
      setPreparingSince(null);
      void qc.invalidateQueries({ queryKey: ["business-brief"] });
    }
  }, [status.data, preparingSince, busy, qc]);
  const historical = useQuery<Report>({
    queryKey: ["business-brief", selected],
    queryFn: () => operatorRequest(`/business/brief/archive?id=${encodeURIComponent(selected)}`),
    enabled: !!selected && selected !== feed.data?.latest?.id,
  });
  const report = selected && selected !== feed.data?.latest?.id ? historical.data : feed.data?.latest;
  // Only asked when there is nothing to show yet, so the empty card can say what to connect.
  const models = useQuery<ModelCatalog>({
    queryKey: ["setup-model-status"],
    queryFn: () => operatorRequest("/models"),
    enabled: !report && !feed.isLoading && !demo.enabled,
    staleTime: 60000,
    retry: 1,
  });
  const assistantReady = models.data
    ? (models.data.statuses || []).some((item) => item.ready) || (models.data.models || []).length > 0
    : undefined;
  const schedule = feed.data?.schedule;
  const timezone = demo.enabled
    ? "Asia/Dubai"
    : schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = report?.date
    ? new Date(report.date + "T12:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        weekday: "long",
        timeZone: "UTC",
      })
    : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", weekday: "long" });
  async function refresh(model?: string) {
    setBusy(true);
    setBusySince(Date.now());
    setError("");
    try {
      const result = await operatorRequest<Envelope>("/business/brief/refresh", {
        timezone,
        ...(model ? { model } : {}),
      });
      qc.setQueryData(["business-brief", demo.enabled], result);
      setSelected("");
      void qc.invalidateQueries({ queryKey: ["business-brief-status"] });
    } catch (e) {
      const message = (e as Error).message;
      if (/already being prepared/i.test(message)) {
        setPreparingSince(Date.now());
        void status.refetch();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const preparing = busy ? busySince : preparingSince;
  async function togglePriority(priority: PriorityAction, button: HTMLInputElement) {
    if (!report || savingAction) return;
    const reportId = report.id,
      completed = !priority.completed;
    const bounds = button.getBoundingClientRect();
    const origin = {
      x: (bounds.x + bounds.width / 2) / window.innerWidth,
      y: (bounds.y + bounds.height / 2) / window.innerHeight,
    };
    setSavingAction(priority.id);
    setActionError("");
    setActionStatus("");
    try {
      const result = await operatorRequest<Envelope & { report?: Report }>(
        "/business/brief/actions",
        { reportId, priorityKey: priority.id, completed },
      );
      qc.setQueryData(["business-brief", demo.enabled], result);
      const updated = result.report ?? (result.latest?.id === reportId ? result.latest : undefined);
      if (updated) qc.setQueryData(["business-brief", reportId], updated);
      else await qc.refetchQueries({ queryKey: ["business-brief", reportId], exact: true });
      setActionStatus(completed ? "Priority completed. You can untick it to undo." : "Priority reopened.");
      if (completed) void celebratePriority(origin);
    } catch (e) {
      setActionError(`That change could not be saved. ${(e as Error).message}`);
    } finally {
      setSavingAction("");
    }
  }
  async function readIncome() {
    if (incomeBusy) return;
    setIncomeBusy(true);
    setIncomeError("");
    try {
      const result = await operatorRequest<{ monthlyIncomeError?: string }>("/business/mercury/sync", {});
      await workspace.refresh();
      if (result.monthlyIncomeError) setIncomeError(result.monthlyIncomeError);
    } catch (e) {
      setIncomeError((e as Error).message);
    } finally {
      setIncomeBusy(false);
    }
  }
  async function changeCity(city: string) {
    await profile.save({ city });
    await qc.invalidateQueries({ queryKey: ["business-today"] });
  }
  const archive = feed.data?.archive || [];
  const index = archive.findIndex((item) => item.id === (selected || feed.data?.latest?.id));
  const choose = (id: string) => {
    setSelected(id);
    setError("");
    setActionError("");
    setActionStatus("");
    setOpenPriority("");
  };
  const priorities = report?.priorityActions?.length
    ? report.priorityActions.slice(0, 3)
    : (report?.priorities || []).slice(0, 3).map((text) => ({ id: "", text, completed: false }));
  const done = priorities.filter((priority) => priority.completed).length;
  const recommendations: Recommendation[] = [
    ...(report?.recommendations || []),
    ...(report?.sections || [])
      .filter((section) => !report?.recommendations?.some((item) => item.id === section.id))
      .map((section) => ({
        id: section.id,
        title: section.title,
        summary: section.body,
        sourceCategory: categoryForSection(section),
        sources: section.sources || [],
      })),
  ];
  // Today's calendar for the rail, in the browser's local day like the Calendar page.
  const todayKey = localDay(new Date());
  const dayEvents = useMemo(
    () => eventsOnDay(operator.state.events, todayKey),
    [operator.state.events, todayKey],
  );

  // Live money for the top row. Demo numbers only while the demo scenario is on; otherwise a
  // missing figure shows a Connect pill and never a placeholder amount.
  const finances = !demo.enabled && workspace.data?.finances?.accounts?.length ? workspace.data.finances : undefined;
  const cash = finances ? cashOnHand(finances) : undefined;
  const income = finances?.monthlyIncome;
  const bankName = finances?.sourceLabel.split("·")[0].trim() || "Connected bank";
  const demoCash = BUSINESS_SAMPLE.accounts.reduce((sum, account) => sum + account.balance, 0);
  const demoIncome = monthTotal(BUSINESS_SAMPLE.months.at(-1)!);
  const connectPill = (
    <button type="button" className="morning-pill" onClick={openBusinessAccounts}>
      Connect
    </button>
  );
  const generated = report?.generatedBy;
  const discuss = () =>
    report &&
    askOperator(
      "Help me plan around these priorities. What should I focus on first?",
      JSON.stringify({
        dailyBrief: {
          date: report.date,
          headline: report.headline,
          summary: report.summary,
          priorities,
          prioritySources: report.prioritySources,
          recommendations,
        },
      }),
      false,
      undefined,
      "business",
      "advisor",
    );

  return (
    <div className="morning-layout">
      <section
        className={`morning-brief${preparing !== null ? " is-preparing" : ""}`}
        aria-labelledby="morning-brief-title"
      >
        <div className="morning-sky" aria-hidden="true">
          <AmbientVideo
            src="/business-art/morning-horizon-loop.mp4"
            poster="/business-art/morning-horizon.png"
            className="morning-sky-media"
            label="Morning horizon"
            controls={false}
          />
        </div>
        <header className="morning-head">
          <div className="morning-head-copy">
            <span className="morning-date">{day}</span>
            <h2 id="morning-brief-title">Your daily brief</h2>
          </div>
          <div className="morning-head-tools">
            <BriefWeatherPill
              weather={today.data?.weather ?? null}
              city={today.data?.weatherCity}
              profileCity={profile.profile.city}
              timeZone={profile.profile.timeZone}
              loading={today.isLoading || profile.isLoading}
              error={today.data?.weatherError}
              onChangeCity={changeCity}
            />
            <GeneratorChip
              generated={generated}
              chosen={status.data?.model ?? null}
              schedule={schedule}
              demo={demo.enabled}
              preparing={preparing !== null}
              disabled={preparing !== null || !!savingAction}
              onChoose={(key) => void refresh(key)}
            />
            {report?.mode === "demo" && <em className="morning-demo-badge">Demo</em>}
          </div>
        </header>

        <div className="morning-numbers">
          <NumberCard
            tint="plain"
            icon={ListChecks}
            value={report ? priorities.length : "—"}
            label="Priorities today"
            caption={report ? (priorities.length ? `${done} of ${priorities.length} done` : "None attached") : "No brief yet"}
            arrow={report ? { href: "#morning-priorities", label: "Jump to today’s priorities" } : undefined}
          />
          <NumberCard
            tint="mint"
            icon={Banknote}
            value={demo.enabled ? formatMoney(Math.round(demoIncome / 22), "USD") : income?.today ? formatMoney(income.today.amount, income.currency) : "—"}
            label="Income today"
            caption={
              demo.enabled
                ? "Demo · example day"
                : income
                  ? `${income.today ? `${income.today.transactions} ${income.today.transactions === 1 ? "payment" : "payments"} in` : "Refresh to include today's payments"}${income.week ? ` · 7 days ${formatMoney(income.week.amount, income.currency)}` : ""}`
                  : finances
                    ? incomeError || "Not read yet"
                    : "No bank connected"
            }
            action={
              demo.enabled || income?.today ? (
                <a className="morning-pill" href="/business?view=finance">
                  View finances
                </a>
              ) : finances ? (
                <button type="button" className="morning-pill" disabled={incomeBusy} onClick={() => void readIncome()}>
                  <RefreshCw size={12} className={incomeBusy ? "animate-spin" : ""} />
                  {incomeBusy ? "Reading…" : `Read from ${bankName}`}
                </button>
              ) : (
                connectPill
              )
            }
          />
          <NumberCard
            tint="sky"
            icon={CalendarDays}
            value={dayEvents.length}
            label="Events today"
            caption={(() => {
              const now = Date.now();
              const next = dayEvents.find((event) => !event.allDay && Date.parse(event.start) >= now);
              if (next) return `Next · ${new Date(next.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${next.title}`;
              const timed = dayEvents.filter((event) => !event.allDay).length;
              return dayEvents.length ? (timed ? "All timed events are done" : "All-day items only") : "Nothing scheduled";
            })()}
            arrow={{ href: "/calendar", label: "Open the calendar" }}
          />
        </div>

        {error && (
          <p className="morning-note" role="alert">
            {error} {report ? "Your saved brief is still here." : "Try again when your assistant connection is ready."}
          </p>
        )}
        {!demo.enabled && feed.isError && !report && (
          <p className="morning-note" role="alert">
            Your brief could not be loaded.{" "}
            <button type="button" onClick={() => void feed.refetch()}>
              Try again
            </button>
          </p>
        )}
        {!demo.enabled && historical.isError && (
          <p className="morning-note" role="alert">
            That saved report could not be opened.{" "}
            <button type="button" onClick={() => choose("")}>
              Back to latest
            </button>
          </p>
        )}

        {report ? (
          <>
            <article className="morning-card morning-focus has-art">
              <div className="morning-focus-copy">
                <span className="morning-kicker">The focus</span>
                <h3>{emphasise(report.headline)}</h3>
                {report.summary && <p>{report.summary}</p>}
                {preparing !== null && (
                  <BriefProgress
                    since={preparing}
                    label={busy ? "Refreshing your brief" : "A brief is already being prepared"}
                  />
                )}
              </div>
            </article>

            <div className="morning-priorities" id="morning-priorities" aria-label="Priorities today">
              {priorities.map((priority, i) => {
                const sources = report.prioritySources?.[i] || [];
                const category = categoryForSources(sources);
                const key = `${report.id}-${priority.id || i}`;
                const open = openPriority === key;
                const lead = sources[0]?.label ? compactText(sources[0].label, 42) : undefined;
                return (
                  <article
                    className={`morning-card morning-priority tint-${TINTS[i % TINTS.length]}${priority.completed ? " is-complete" : ""}`}
                    key={key}
                  >
                    <div className="morning-priority-top">
                      <span className="morning-priority-index" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="morning-priority-marks">
                        <span className="morning-priority-tile" title={CATEGORY_LABEL[category]} aria-hidden="true">
                          {(() => { const Icon = CATEGORY_ICON[category]; return <Icon size={17} strokeWidth={1.6} />; })()}
                        </span>
                        {priority.id ? (
                          <label className="morning-check">
                            <input
                              type="checkbox"
                              aria-label={`Complete priority ${i + 1}: ${priority.text}`}
                              checked={priority.completed}
                              disabled={!!savingAction || busy}
                              onChange={(event) => void togglePriority(priority, event.currentTarget)}
                            />
                            <span aria-hidden="true">
                              {savingAction === priority.id ? (
                                <RefreshCw size={13} className="animate-spin" />
                              ) : priority.completed ? (
                                <Check size={15} />
                              ) : null}
                            </span>
                          </label>
                        ) : (
                          <span className="morning-check is-static" title="Saved brief" aria-hidden="true">
                            <span />
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="morning-priority-title">{compactText(priority.text, 140)}</p>
                    <span className="morning-priority-source">
                      {CATEGORY_LABEL[category]}
                      {lead ? ` · ${lead}` : ""}
                    </span>
                    <div className="morning-priority-foot">
                      <span className="morning-priority-state">
                        {savingAction === priority.id ? "Saving…" : priority.completed ? "Done" : ""}
                      </span>
                      <button
                        type="button"
                        className={`morning-round${open ? " is-open" : ""}`}
                        aria-expanded={open}
                        aria-controls={`morning-priority-detail-${i}`}
                        aria-label={open ? "Hide full priority and sources" : "Read full priority and sources"}
                        onClick={() => setOpenPriority(open ? "" : key)}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    {open && (
                      <div className="morning-priority-detail" id={`morning-priority-detail-${i}`}>
                        <p>{priority.text}</p>
                        <SourceReceipts sources={sources} timezone={report.timezone} />
                      </div>
                    )}
                  </article>
                );
              })}
              {!priorities.length && (
                <p className="morning-quiet">No priorities were attached to this saved brief.</p>
              )}
            </div>
            <p className="morning-action-status" role="status">
              {actionStatus}
            </p>
            {actionError && (
              <p className="morning-note" role="alert">
                {actionError}
              </p>
            )}

            <footer className="morning-foot">
              <button type="button" className="morning-pill is-dark" onClick={discuss}>
                <MessageCircle size={15} /> Discuss in chat
              </button>
              <div className="morning-foot-tools">
                <button
                  type="button"
                  className="morning-text-button"
                  onClick={() => void refresh()}
                  disabled={preparing !== null || !!savingAction}
                >
                  <RefreshCw size={13} className={preparing !== null ? "animate-spin" : ""} />
                  {busy ? "Generating…" : preparing !== null ? "Preparing…" : "Refresh brief"}
                </button>
                {!!archive.length && (
                  <div className="morning-history">
                    <button
                      type="button"
                      aria-label="Previous daily brief"
                      disabled={!!savingAction || index < 0 || index >= archive.length - 1}
                      onClick={() => choose(archive[index + 1].id)}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <select
                      aria-label="Choose daily brief"
                      disabled={!!savingAction}
                      value={selected || feed.data?.latest?.id || ""}
                      onChange={(e) => choose(e.target.value)}
                    >
                      {archive.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.id === feed.data?.latest?.id ? "Latest brief" : item.date}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Next daily brief"
                      disabled={!!savingAction || index <= 0}
                      onClick={() => choose(archive[index - 1].id)}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </footer>
            <BuiltFrom report={report} />

            <details className="morning-more" key={report.id}>
              <summary>
                Full context &amp; sources <ChevronDown size={13} />
              </summary>
              <div className="morning-more-body">
                {recommendations.map((item) => {
                  const section = report.sections.find((section) => section.id === item.id);
                  return (
                    <section className="morning-recommendation" key={`${report.id}-${item.id}`}>
                      <span className="morning-recommendation-category">{CATEGORY_LABEL[item.sourceCategory] || "Memory"}</span>
                      <h4>{item.title}</h4>
                      <p>{item.summary}</p>
                      {section?.body && section.body !== item.summary && <p>{section.body}</p>}
                      {section?.bullets?.map((bullet, i) => <p key={i}>{bullet}</p>)}
                      <SourceReceipts sources={item.sources} timezone={report.timezone} />
                    </section>
                  );
                })}
                <div className="morning-more-foot">
                  <span>
                    Saved{" "}
                    {new Date(report.updatedAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: report.timezone,
                    })}
                    . Based on the sources enabled when this brief was prepared.{" "}
                    <a href="/settings#connections">Choose sources</a>
                  </span>
                  {!demo.enabled && <DreamReviewActions />}
                </div>
              </div>
            </details>
          </>
        ) : !feed.isError && !historical.isError ? (
          <article className="morning-card morning-focus morning-empty has-art">
            <div className="morning-focus-copy">
              {preparing !== null ? (
                <>
                  <span className="morning-kicker">The focus</span>
                  <h3>Your brief is on its way.</h3>
                  <BriefProgress since={preparing} label={busy ? "Preparing your brief" : "A brief is already being prepared"} />
                </>
              ) : feed.isLoading || historical.isFetching ? (
                <p className="morning-quiet" role="status">
                  Opening your brief…
                </p>
              ) : (
                <>
                  <span className="morning-kicker">First brief</span>
                  <h3>
                    {assistantReady === false
                      ? "Connect an assistant and your brief is one tap away."
                      : "Your first brief is ready to prepare."}
                  </h3>
                  <p>
                    {demo.enabled
                      ? "Your demo numbers are ready. Codex or Claude will turn them into three clear priorities for the day."
                      : assistantReady === false
                        ? "Codex or Claude reads your goals, inbox and calendar and writes three priorities. Connect one in Settings, then come back here."
                        : "Turn your goals, messages and calendar into three clear priorities for the day."}
                  </p>
                  <div className="morning-empty-actions">
                    {assistantReady === false ? (
                      <a className="morning-pill is-dark" href="/settings#ai-tools">
                        Connect now <ArrowUpRight size={14} />
                      </a>
                    ) : (
                      <button type="button" className="morning-pill is-dark" onClick={() => void refresh()}>
                        Prepare my brief <ArrowUpRight size={14} />
                      </button>
                    )}
                    <a className="morning-text-button" href="/settings#connections">
                      Choose sources
                    </a>
                  </div>
                </>
              )}
            </div>
          </article>
        ) : null}
      </section>
      <BriefNews
        news={today.data?.news ?? []}
        loading={today.isLoading}
        events={dayEvents}
        eventsLoading={operator.isLoading}
        memory={recentMemory.data?.results}
        memoryLoading={recentMemory.isLoading}
      />
    </div>
  );
}
