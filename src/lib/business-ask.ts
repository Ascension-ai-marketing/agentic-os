// business-ask — the Business page's composer, routed through the OS's own
// model lanes. Nothing new is wired: it reads the same catalogs the home chat
// reads (`/__hermes_models`, `/__claude_models`) and posts to the same two
// endpoints (`/__hermes_chat`, `/__claude_chat`), which already speak one SSE
// protocol (chunk / info / error / done) and already decide who pays for a
// turn (Hermes' configured default, ChatGPT/Codex OAuth, OpenRouter via ccr,
// or the Claude subscription). The page only adds the numbers as context.

import { fitChatPrompt, chatHttpError } from "./chat-prompt";
import { readChatStream } from "./chat-stream";
export type AskBackend = "hermes" | "claude" | "local" | "deepseek";

export interface AskModel {
  /** Stable key: "<backend>|<provider>|<name>". */
  key: string;
  /** What the picker shows, e.g. "Hermes · gpt-5.6" or "Codex · gpt-5.6". */
  label: string;
  backend: AskBackend;
  name: string;
  provider?: string;
  available?: boolean;
}

export const ASK_MODEL_KEY = "claude-os.business.ask-model.v1";

/** Jev picks the lane (small model, Sonnet, Opus or Codex) once per chat. */
export const JEV_AUTO_MODEL: AskModel = {
  key: "claude|jev|auto-jev",
  label: "Jev · Auto",
  backend: "claude",
  name: "auto-jev",
  provider: "jev",
  available: true,
};
export const isJevAuto = (model?: Pick<AskModel, "name"> | null) => model?.name === "auto-jev";

const ENDPOINT: Record<AskBackend, string> = {
  hermes: "/__hermes_chat",
  claude: "/__claude_chat",
  local: "/__operator/chat",
  deepseek: "/__operator/chat",
};

/** Human label for a catalog provider group. */
function laneLabel(backend: AskBackend, provider: string): string {
  const p = provider.toLowerCase();
  if (backend === "hermes") return "Hermes";
  if (p.includes("codex")) return "Codex";
  if (p.includes("openrouter")) return "OpenRouter";
  if (p.includes("claude")) return "Claude Code";
  return provider;
}

type Catalog = {
  configured?: string[];
  laneHealth?: Record<string, { ok: boolean; reason?: string }>;
  default?: { name?: string; provider?: string } | null;
  catalog?: Array<{ provider?: string; models?: Array<{ name?: string }> }>;
};

async function readCatalog(url: string): Promise<Catalog | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as Catalog;
  } catch {
    return null;
  }
}

function fromCatalog(backend: AskBackend, data: Catalog | null): AskModel[] {
  if (!data) return [];
  const out: AskModel[] = [];
  for (const group of Array.isArray(data.catalog) ? data.catalog : []) {
    if (!group) continue;
    const provider = String(group.provider ?? "");
    if (data.laneHealth?.[provider.toLowerCase()]?.ok === false) continue;
    if (backend === "hermes" && data.configured && !data.configured.includes(provider)) continue;
    for (const m of Array.isArray(group.models) ? group.models : []) {
      if (!m?.name) continue;
      const name = String(m.name);
      out.push({
        key: `${backend}|${provider}|${name}`,
        label: `${laneLabel(backend, provider)} · ${name}`,
        backend,
        name,
        provider: provider || undefined,
      });
    }
  }
  // The configured default leads, exactly as the home chat orders it.
  const dn = data.default?.name;
  const dp = data.default?.provider;
  const di = out.findIndex((o) => o.name === dn && (!dp || o.provider === dp));
  if (di > 0) out.unshift(...out.splice(di, 1));
  return out;
}

/**
 * Live runtime catalogs take precedence over older endpoint fallback lists.
 * Codex leads for a fresh choice. A remembered exact model remains selected,
 * including an unavailable choice, so refresh never silently changes providers.
 */
export type AskCatalog = {
  models: AskModel[];
  statuses: Array<{ id: string; ready: boolean; detail: string }>;
  discoveryFailed: boolean;
};
export async function loadAskCatalog(options: { refresh?: boolean } = {}): Promise<AskCatalog> {
  const [hermes, claude, other] = await Promise.all([
    readCatalog("/__hermes_models"),
    readCatalog("/__claude_models"),
    fetch("/__operator/models" + (options.refresh ? "?refresh=1" : ""), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  const statuses = Array.isArray(other?.statuses) ? other.statuses : [];
  const statusFor = (id: string) => statuses.find((status: any) => status?.id === id);
  const runtimeAvailable = (model: AskModel) => {
    if (model.available === false) return true;
    if (model.backend === "hermes" && statusFor("hermes")?.installed === false) return false;
    if (model.backend !== "claude") return true;
    if (model.provider?.includes("codex")) return statusFor("codex")?.ready !== false;
    if (statusFor("claude")?.installed === false) return false;
    return model.provider !== "claude-code" || statusFor("claude")?.ready !== false;
  };
  const fresh: AskModel[] = Array.isArray(other?.models)
    ? other.models.filter(
        (model: AskModel) =>
          model &&
          typeof model.key === "string" &&
          typeof model.name === "string" &&
          ["hermes", "claude", "local", "deepseek"].includes(model.backend) &&
          (model.provider === undefined || typeof model.provider === "string") &&
          !(
            model.backend === "claude" &&
            model.provider?.includes("codex") &&
            statusFor("codex")?.ready !== true &&
            claude?.laneHealth?.["openai · via codex"]?.ok === false
          ) &&
          !(
            model.backend === "hermes" &&
            hermes?.laneHealth?.[model.provider?.toLowerCase() || ""]?.ok === false
          ),
      ).map((model: AskModel) => model.backend === "claude" && model.provider === "claude-code" && statusFor("claude")?.ready === false
        ? { ...model, available: false, label: `${model.label} (sign in needed)` } : model)
    : [];
  const hasLiveRouter = !!statusFor("openrouter") || fresh.some((m) => m.backend === "hermes" && m.provider === "openrouter");
  const routerIds = new Set(fresh.filter(m => m.provider === "openrouter").map(m => m.name));
  const list = [
    ...fromCatalog("hermes", hermes).filter((m) => !(hasLiveRouter && m.provider === "openrouter")),
    ...fromCatalog("claude", claude).filter(
      // Native Claude and Codex IDs come only from their actual runtime catalog.
      // An unsuccessful discovery must never resurrect dated hardcoded IDs.
      (m) => m.provider !== "claude-code" && !m.provider?.includes("codex") && !m.provider?.includes("openrouter"),
    ).filter(m => !hasLiveRouter || !m.provider?.includes("openrouter") || routerIds.has(m.name)),
    ...fresh,
  ];
  // De-duplicate on key; keep first occurrence.
  const seen = new Set<string>();
  const unique = list
    .filter(runtimeAvailable)
    .filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)))
    .sort((a, b) => Number(a.available === false) - Number(b.available === false) || askModelOrder(a) - askModelOrder(b));
  // Jev routes between native Claude Code and Codex models, so it appears only
  // when at least one of them is connected and ready.
  if (unique.some((m) => m.backend === "claude" && m.available !== false && (m.provider === "claude-code" || m.provider?.includes("codex"))))
    unique.push(JEV_AUTO_MODEL);
  let remembered: string | null = null;
  try {
    remembered = window.localStorage.getItem(ASK_MODEL_KEY);
  } catch {
    /* storage unavailable — open on the default */
  }
  const ri = remembered ? unique.findIndex((m) => m.key === remembered) : -1;
  if (ri > 0) unique.unshift(...unique.splice(ri, 1));
  if (remembered && ri < 0) {
    const [backend, provider, ...rest] = remembered.split("|");
    const name = rest.join("|");
    if (["hermes", "claude", "local", "deepseek"].includes(backend) && name) {
      unique.unshift({
        key: remembered,
        available: false,
        backend: backend as AskBackend,
        provider,
        name,
        label: `${backend === "local" ? (provider === "ollama" ? "Ollama" : "LM Studio") : backend === "deepseek" ? "DeepSeek Harness" : laneLabel(backend as AskBackend, provider)} · ${name} (unavailable)`,
      });
    }
  }

  return {
    models: unique,
    statuses: Array.isArray(other?.statuses)
      ? other.statuses.filter(
          (status: any) =>
            status &&
            typeof status.id === "string" &&
            typeof status.ready === "boolean" &&
            typeof status.detail === "string",
        )
      : [],
    discoveryFailed: !hermes && !claude && !other,
  };
}
export function askModelOrder(model: AskModel): number {
  if (model.provider === "jev") return 60;
  if (model.backend === "local") return 50;
  if (model.backend === "claude" && model.provider?.includes("codex")) return 0;
  if (model.backend === "claude" && model.provider === "claude-code") return 10;
  if (model.provider?.includes("openrouter") && model.backend === "claude") return 20;
  if (model.backend === "deepseek") return 30;
  return 40;
}
export async function loadAskModels(): Promise<AskModel[]> {
  return (await loadAskCatalog()).models;
}
/** Keep OpenRouter routes distinct from native Claude subscription models. */
export function modelPickerGroup(model: AskModel): string {
  if (model.provider === "jev") return "Jev";
  if (model.backend === "local") return model.provider === "ollama" ? "Ollama" : model.provider === "lmstudio" ? "LM Studio" : "Local";
  if (model.backend === "hermes") return "Hermes";
  if (model.backend === "deepseek") return "OpenRouter";
  if (model.provider?.includes("codex")) return "Codex";
  if (model.provider?.includes("openrouter")) return "OpenRouter";
  return "Claude";
}

export function rememberAskModel(model: AskModel) {
  try {
    window.localStorage.setItem(ASK_MODEL_KEY, model.key);
  } catch {
    /* fine */
  }
}

/**
 * One turn on the chosen lane. Streams text through `onChunk` and resolves
 * with the full reply. Throws when the lane is unreachable so the caller can
 * fall back to the page's local answers.
 */
export async function askModel(
  model: AskModel,
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  options?: { effort?: string; chatId?: string; onJev?: (decision: unknown) => void; routeText?: string },
): Promise<string> {
  if (model.available === false)
    throw new Error("This model is unavailable. Reconnect it or explicitly choose another model.");
  signal?.throwIfAborted();
  const tokenResponse = await fetch("/__token", { signal });
  if (!tokenResponse.ok) throw await chatHttpError(tokenResponse);
  const token = (await tokenResponse.json()).token;
  if (typeof token !== "string" || !token)
    throw new Error("The local connection could not be verified. Reload the app and try again.");
  const body: Record<string, unknown> = {
    prompt: fitChatPrompt(prompt),
    model: model.name,
    backend: model.backend,
    streamFormat: "text-delta",
    contextMode: "provided",
  };
  if (model.backend === "hermes") body.toolsets = "";
  // Jev routes once per chat and pins the pick, so it needs a stable chat id.
  if (isJevAuto(model)) {
    body.chatId = options?.chatId || jevPageChatId;
    // Jev judges the words the user typed; the full prompt rides along as saved context.
    if (options?.routeText) body.routeText = options.routeText.slice(0, 4000);
  }
  if (model.provider) body.provider = model.provider;
  if (model.backend === "claude") {
    // The server applies per-turn restrictions: this composer has no tool approval UI.
    body.permissionMode = "plan";
    if (options?.effort && ["low", "medium", "high", "xhigh", "max"].includes(options.effort))
      body.effort = options.effort;
    body.origin = "business";
    body.title = `Business: ${prompt.slice(-60)}`;
  }
  const r = await fetch(ENDPOINT[model.backend], {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw await chatHttpError(r);
  return readChatStream(r.body, onChunk, signal, (name, data) => {
    if (name !== "jev" || !options?.onJev) return;
    try {
      options.onJev(JSON.parse(data));
    } catch {
      /* malformed event */
    }
  });
}
const jevPageChatId = typeof crypto !== "undefined" && "randomUUID" in crypto ? `page-${crypto.randomUUID()}` : `page-${Date.now()}`;
