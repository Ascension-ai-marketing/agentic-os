// Real Jev decisions captured on 28 Sep 2026 (typesafe/jev-1.13 via OpenRouter),
// used as clearly-labelled samples until the live /__jev/log has data.
// The Opus comparison on the voice sample is a real measured call.
import type { JevDecision } from "@/lib/jev-types";
import { MEMORY_SOURCES, memoryQuery, memoryRange, memorySourceOf } from "@/lib/jev-memory";
import { gate } from "@/lib/jev-gate";
import { instantAnswer } from "@/lib/os-instant";

export const OPUS_SAYS_SAMPLE = "Tier-2. It's a short factual question that can be answered by pulling from today's brief or existing notes, which a small fast model can handle without creating anything new.";

export const JEV_SAMPLES: JevDecision[] = [
  {
    "id": "sample-voice1",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "voice",
    "purpose": "Which tier handles this voice request?",
    "input": "\"Open my morning brief\"",
    "answers": {
      "tier": {
        "type": "choice",
        "choice": "tier-1",
        "probabilities": {
          "tier-2": 0,
          "tier-1": 1,
          "tier-3": 0
        },
        "confidence": 1
      }
    },
    "picked": "tier-1",
    "pickedLabel": "Instant, no AI",
    "escalated": false,
    "ms": 839,
    "costUsd": 1.7178e-05
  },
  {
    "id": "sample-voice2",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "voice",
    "purpose": "Which tier handles this voice request?",
    "input": "\"What was the biggest AI news today?\"",
    "answers": {
      "tier": {
        "type": "choice",
        "choice": "tier-2",
        "probabilities": {
          "tier-2": 0.82,
          "tier-3": 0.17,
          "tier-1": 0.01
        },
        "confidence": 0.73
      }
    },
    "picked": "tier-2",
    "pickedLabel": "Quick answer",
    "escalated": false,
    "ms": 633,
    "costUsd": 1.7346e-05,
    "compare": {
      "model": "Claude Opus 5.5",
      "ms": 7122,
      "costUsd": 0.002312,
      "kind": "measured"
    }
  },
  {
    "id": "sample-voice3",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "voice",
    "purpose": "Which tier handles this voice request?",
    "input": "\"Turn my last video into an Instagram reel with sound effects\"",
    "answers": {
      "tier": {
        "type": "choice",
        "choice": "tier-3",
        "probabilities": {
          "tier-3": 1,
          "tier-2": 0,
          "tier-1": 0
        },
        "confidence": 1
      }
    },
    "picked": "tier-3",
    "pickedLabel": "Real work",
    "escalated": false,
    "ms": 688,
    "costUsd": 1.7472e-05
  },
  {
    "id": "sample-inbox",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "inbox",
    "purpose": "Which pile does this email go in?",
    "input": "billing@notion.so \u00b7 Your payment failed",
    "answers": {
      "category": {
        "type": "choice",
        "choice": "billing",
        "probabilities": {
          "lead": 0,
          "billing": 1,
          "newsletter": 0,
          "reply-today": 0,
          "spam": 0,
          "sponsor": 0
        },
        "confidence": 1
      },
      "urgency": {
        "type": "score",
        "score": 1.99,
        "legend": {
          "0": "never",
          "1": "this week",
          "2": "today",
          "3": "within the hour"
        },
        "probabilities": {
          "0": 0,
          "1": 0.12,
          "2": 0.76,
          "3": 0.12
        },
        "confidence": 0.76
      }
    },
    "picked": "billing",
    "pickedLabel": "Billing",
    "escalated": false,
    "ms": 624,
    "costUsd": 2.0286e-05
  },
  {
    "id": "sample-reels",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "reels",
    "purpose": "Which sound effect fits this moment?",
    "input": "\"but only if you claim by October the 7th.\"",
    "answers": {
      "sfx": {
        "type": "choice",
        "choice": "clock-tick",
        "probabilities": {
          "notification-ding": 0,
          "whoosh": 0,
          "none": 0,
          "clock-tick": 1,
          "impact": 0,
          "riser": 0,
          "pop": 0,
          "cash-register": 0
        },
        "confidence": 1
      }
    },
    "picked": "clock-tick",
    "pickedLabel": "Clock tick",
    "escalated": false,
    "ms": 660,
    "costUsd": 1.869e-05
  },
  {
    "id": "sample-router",
    "at": "2026-09-28T09:10:00.000Z",
    "surface": "router",
    "purpose": "Which model should do this task?",
    "input": "Find the file path of the Jev router script in this repo",
    "answers": {
      "lane": {
        "type": "choice",
        "choice": "small-fast",
        "probabilities": {
          "small-fast": 1,
          "claude-sonnet": 0,
          "codex": 0,
          "claude-opus": 0
        },
        "confidence": 1
      }
    },
    "picked": "small-fast",
    "pickedLabel": "Small fast model",
    "escalated": false,
    "ms": 686,
    "costUsd": 1.6884e-05
  }
];

// Rehearsal only (?jevDemo=1 in dev): per-model router decisions and canned
// answers, so the "Jev is choosing" moment can be practised with no API call.
// These are hand-written, not captured calls; the UI marks them "Rehearsal".
type RouterDemo = { match: RegExp; decision: JevDecision; answer: string };
const demoLabels = { haiku: "Haiku 4.5", sonnet: "Sonnet 5", opus: "Opus 5.5", fable: "Fable 5.1", codex: "Codex", sol: "GPT-5.6 Sol", luna: "GPT-5.6 Luna" };
function routerDemo(id: string, input: string, picked: keyof typeof demoLabels, odds: Partial<Record<keyof typeof demoLabels, number>>, ms: number): JevDecision {
  const rest = 1 - Object.values(odds).reduce((s, p) => s + (p ?? 0), 0);
  const others = (Object.keys(demoLabels) as (keyof typeof demoLabels)[]).filter((k) => !(k in odds));
  const probabilities = Object.fromEntries((Object.keys(demoLabels) as (keyof typeof demoLabels)[]).map((k) => [k, odds[k] ?? Math.max(0, rest / others.length)]));
  return { id, at: "2026-09-28T12:00:00.000Z", surface: "router", purpose: "Which model should answer this chat?", input, answers: { model: { type: "choice", choice: picked, probabilities, confidence: probabilities[picked] } }, picked, pickedLabel: demoLabels[picked], optionLabels: demoLabels, escalated: false, ms, costUsd: 0.0000184 };
}
export const JEV_ROUTER_DEMOS: RouterDemo[] = [
  {
    match: /calendar|schedule|today|meeting|what time/i,
    decision: routerDemo("demo-haiku", "What's on my calendar today?", "haiku", { haiku: 0.91, luna: 0.05, sonnet: 0.03 }, 584),
    answer: "Here is your day.\n\n- **10:00** Team stand-up, 30 minutes\n- **13:30** Recording: Jev and Claude Code\n- **16:00** Gym\n\nYou are free after 17:00.",
  },
  {
    match: /design|website|landing|hero|brand|logo|layout/i,
    decision: routerDemo("demo-fable", "Design me a hero section for the new site", "fable", { fable: 0.89, opus: 0.06, sonnet: 0.03 }, 641),
    answer: "Here is a direction: a dark hero with one bright line of type, a soft pink glow behind the product shot, and a single button. I can draft three variations next.",
  },
  {
    match: /code|bug|script|function|test|deploy|repo|typescript|python/i,
    decision: routerDemo("demo-codex", "Why does this script fail on start?", "codex", { codex: 0.93, sonnet: 0.04, opus: 0.02 }, 603),
    answer: "The script reads the port before the env file loads, so it starts on `undefined`. Load the env first, then read `PORT`. Want me to make the change?",
  },
  {
    match: /strategy|should i|price|pricing|decide|plan for|hire|invest/i,
    decision: routerDemo("demo-opus", "Should I raise my prices next month?", "opus", { opus: 0.84, sonnet: 0.09, sol: 0.05 }, 667),
    answer: "Short answer: yes, but only for new customers first. Your churn is low and demand is steady, so a 15% rise for new sign-ups is safe. Keep current members on their price for 90 days.",
  },
  {
    match: /number|data|maths|math|calculate|percent|growth|forecast/i,
    decision: routerDemo("demo-sol", "Work out my growth rate from these numbers", "sol", { sol: 0.81, opus: 0.1, sonnet: 0.06 }, 622),
    answer: "Month over month you grew 12.4% on average, with the biggest jump in July. At that rate you pass 10,000 by December.",
  },
  {
    match: /convert|spell|how many .* in|translate/i,
    decision: routerDemo("demo-luna", "Convert 72 fahrenheit to celsius", "luna", { luna: 0.86, haiku: 0.11 }, 548),
    answer: "72°F is about 22°C.",
  },
];
export const JEV_ROUTER_DEFAULT_DEMO: RouterDemo = {
  match: /.*/,
  decision: routerDemo("demo-sonnet", "Write a reply to Sam about Friday", "sonnet", { sonnet: 0.88, haiku: 0.06, opus: 0.04 }, 612),
  answer: "Here is a draft:\n\nHi Sam, Friday works for me. Shall we say 14:00 at the studio? I will bring the new cut so we can review it together.",
};

// Rehearsal for the executor decision (?jevDemo=1): who handles a message.
// Hand-written odds in the same shape the live /__voice/task returns.
export type DemoTask = {
  decision: JevDecision;
  lane: "reply" | "open" | "memory" | "claude" | "codex" | "continue";
  memoryFocus?: { source?: string; query?: string; range?: "24h" | "7d" | "30d" | "90d" | "1y" | "all"; view?: "timeline"; open?: boolean };
  memoryLabel?: string;
  navigateTo?: string;
  pageLabel?: string;
  agent?: "claude" | "codex";
  agentModel?: { key: string; model: string; label: string; sure?: number };
  /** Terminal lines the fake agent prints, one every few hundred ms. */
  script?: string[];
};
const pick = (choice: string, probabilities: Record<string, number>) => ({ type: "choice" as const, choice, probabilities, confidence: probabilities[choice] });
const DEMO_PAGES: Record<string, [string, string, string]> = {
  dashboard: ["dashboard", "/business", "Dashboard"],
  inbox: ["inbox", "/inbox", "Inbox"],
  calendar: ["calendar", "/calendar", "Calendar"],
  memory: ["memory", "/memory", "Memory"],
  reels: ["reels", "/design?mode=reels", "Reels"],
  design: ["design", "/design", "Design"],
  website: ["website", "/websites", "Website"],
  hermes: ["hermes", "/agents/hermes", "Hermes"],
  settings: ["settings", "/settings", "Settings"],
};
function taskDecision(text: string, tier: Record<string, number>, extra: JevDecision["answers"], ms: number): JevDecision {
  const choice = Object.entries(tier).sort((a, b) => b[1] - a[1])[0][0];
  return { id: `demo-task-${Date.now()}`, at: new Date().toISOString(), surface: "voice", purpose: "Who should handle this request?", input: text.slice(0, 280), answers: { tier: pick(choice, tier), ...extra }, picked: choice, escalated: false, ms, costUsd: 0.0000212, optionLabels: { "tier-1": "Open a page", "tier-2": "Quick answer", "tier-3": "Agent", continue: "Continue the task", memory: "Show it in Memory", claude: "Claude Code", codex: "Codex", sonnet: "Sonnet 5", opus: "Opus 5.5", haiku: "Haiku 4.5", fable: "Fable 5.1", sol: "GPT-5.6 Sol", luna: "GPT-5.6 Luna", ...Object.fromEntries(Object.values(DEMO_PAGES).map(([id, , label]) => [`page:${id}`, label])) } };
}
export function demoTask(text: string, hasOpenTask: boolean): DemoTask {
  const t = text.toLowerCase();
  if (/\b(when did i|find where i|where did i|did i ever|last time i|show me my (old )?(chats|notes|emails|meetings))\b/.test(t)) {
    const source = memorySourceOf(text);
    const label = source ? MEMORY_SOURCES[source].label : "all sources";
    return {
      lane: "memory",
      navigateTo: "/memory",
      pageLabel: "Memory",
      memoryLabel: label,
      memoryFocus: { ...(source ? { source } : {}), query: memoryQuery(text), range: memoryRange(text), view: "timeline", open: true },
      decision: taskDecision(text, { memory: 0.92, "tier-2": 0.06, "tier-1": 0.02, "tier-3": 0 }, { memorySource: pick(source ?? "any", { [source ?? "any"]: 0.95 }) }, 566),
    };
  }
  const page = Object.keys(DEMO_PAGES).find((k) => t.includes(k === "website" ? "website" : k));
  if (/\b(open|go to|take me|check out|show me|pull up)\b/.test(t) && page) {
    const [id, path, label] = DEMO_PAGES[page];
    return { lane: "open", navigateTo: path, pageLabel: label, decision: taskDecision(text, { "tier-1": 0.94, "tier-2": 0.05, "tier-3": 0.01 }, { page: pick(id, { [id]: 0.97 }) }, 541) };
  }
  if (hasOpenTask && /^(also|now|and |make it|change|keep going|continue|then|add|can you also|actually)/.test(t)) {
    return { lane: "continue", decision: taskDecision(text, { continue: 0.91, "tier-3": 0.06, "tier-2": 0.03, "tier-1": 0 }, { worker: pick("codex", { codex: 0.9, claude: 0.1 }) }, 577) };
  }
  if (/\b(research|report|write up|draft a|plan out|brief on|document)\b/.test(t)) {
    return {
      lane: "claude",
      agent: "claude",
      agentModel: { key: "opus", model: "claude-opus-5-5", label: "Opus 5.5", sure: 0.82 },
      decision: taskDecision(text, { "tier-3": 0.93, "tier-2": 0.06, "tier-1": 0.01 }, { worker: pick("claude", { claude: 0.88, codex: 0.12 }), claudeModel: pick("opus", { opus: 0.82, sonnet: 0.14, fable: 0.03, haiku: 0.01 }) }, 612),
      script: ["Reading the request", "Searching three sources", "Drafting the outline", "Writing report.md", "Checking every claim against its source", "Done. Saved report.md (1,240 words)."],
    };
  }
  if (/\b(build|make me|create|fix|debug|code|script|deploy|landing page|app|bug)\b/.test(t)) {
    return {
      lane: "codex",
      agent: "codex",
      agentModel: { key: "codex", model: "gpt-6-astra", label: "GPT-6 Astra", sure: 0.86 },
      decision: taskDecision(text, { "tier-3": 0.95, "tier-2": 0.04, "tier-1": 0.01 }, { worker: pick("codex", { codex: 0.91, claude: 0.09 }), codexModel: pick("codex", { codex: 0.86, sol: 0.11, luna: 0.03 }) }, 598),
      script: ["$ mkdir gym-landing && cd gym-landing", "Planning: hero, classes, prices, sign-up", "Writing index.html", "Writing styles.css", "Adding the class timetable", "$ npx serve . (preview on :4173)", "Done. Page ready in gym-landing/index.html."],
    };
  }
  return { lane: "reply", decision: taskDecision(text, { "tier-2": 0.95, "tier-1": 0.03, "tier-3": 0.02 }, {}, 563) };
}
export const DEMO_CONTINUE_SCRIPT = ["› Follow-up received", "Updating styles.css: accent colour to blue", "Re-checking the page", "Done. The accent is blue now."];

/** Rehearsal voice turn: the same executor pick, as the voice route would return it. */
export function demoVoiceResult(text: string, openTask?: { jobId: string; agent: "claude" | "codex" }) {
  const answer = (JEV_ROUTER_DEMOS.find((d) => d.match.test(text)) ?? JEV_ROUTER_DEFAULT_DEMO).answer.replace(/[*#`-]/g, "").replace(/\n+/g, " ").trim();
  const name = (a?: string) => (a === "codex" ? "Codex" : "Claude Code");
  // Same local gate as the server: no Jev call for questions, pages, Memory or follow-ups.
  const g = gate(text, { hasOpenTask: !!openTask });
  if (g.kind === "chat") {
    const instant = instantAnswer(text);
    if (instant) return { tier: "tier-2" as const, intent: "answer", gated: true, replyText: instant, workerLabel: "Your OS", osTools: [] as string[] };
    const tools = /calendar|meeting|today|schedule/i.test(text) ? ["Checked calendar"] : /usage|limit|left/i.test(text) ? ["Checked usage"] : ["Searched memory"];
    return { tier: "tier-2" as const, intent: "answer", gated: true, replyText: answer, workerLabel: "Haiku 4.5", osTools: tools };
  }
  if (g.kind === "open") return { tier: "tier-1" as const, intent: "open", gated: true, replyText: `Opening ${g.label}.`, navigateTo: g.path, pageLabel: g.label };
  if (g.kind === "memory") {
    const label = g.focus.source ? MEMORY_SOURCES[g.focus.source].label : "all sources";
    return { tier: "tier-1" as const, intent: "memory", gated: true, replyText: `Here it is in Memory, from ${label}.`, navigateTo: "/memory", pageLabel: "Memory", memoryFocus: g.focus, memoryLabel: label };
  }
  if (g.kind === "continue" && openTask)
    return { tier: "tier-3" as const, intent: "work", gated: true, continued: true, agent: openTask.agent, jobId: openTask.jobId, replyText: `Continuing in ${name(openTask.agent)}.`, demoScript: DEMO_CONTINUE_SCRIPT };
  const t = demoTask(text, !!openTask);
  if (t.lane === "open") return { decision: t.decision, tier: "tier-1" as const, intent: "open", replyText: `Opening ${t.pageLabel}.`, navigateTo: t.navigateTo, pageLabel: t.pageLabel };
  if (t.lane === "memory") return { decision: t.decision, tier: "tier-1" as const, intent: "memory", replyText: `Here it is in Memory, from ${t.memoryLabel}.`, navigateTo: "/memory", pageLabel: "Memory", memoryFocus: t.memoryFocus, memoryLabel: t.memoryLabel };
  if (t.lane === "continue" && openTask)
    return { decision: t.decision, tier: "tier-3" as const, intent: "work", continued: true, agent: openTask.agent, jobId: openTask.jobId, replyText: `Continuing in ${name(openTask.agent)}.`, demoScript: DEMO_CONTINUE_SCRIPT };
  if (t.lane === "claude" || t.lane === "codex")
    return { decision: t.decision, tier: "tier-3" as const, intent: "work", agent: t.agent, agentModel: t.agentModel, jobId: `demo-${Date.now().toString(36)}`, replyText: `${name(t.agent)} has started the task on ${t.agentModel?.label}.`, demoScript: t.script };
  const d = { ...t.decision, answers: { ...t.decision.answers, model: pick("haiku", { haiku: 0.88, sonnet: 0.08, luna: 0.04 }) } };
  return { decision: d, tier: "tier-2" as const, intent: "answer", replyText: answer, workerLabel: "Haiku 4.5" };
}
