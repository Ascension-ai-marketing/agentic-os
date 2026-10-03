import { ProviderLogo } from "./account-connections";
import { laneFor } from "@/lib/model-lane";
import type { AskModel } from "@/lib/business-ask";
import { BrainCircuit, FileText, Image, Mail, Calendar, User, Globe, Cpu, Monitor } from "lucide-react";
import openai from "@/assets/logo-openai.svg";
import claude from "@/assets/logo-claude.svg";
import deepseek from "@/assets/logo-deepseek.svg";
import gemini from "@/assets/logo-gemini.svg";
import grok from "@/assets/logo-grok.svg";
import qwen from "@/assets/logo-qwen.svg";
import zai from "@/assets/logo-zai.svg";
import moonshot from "@/assets/logo-moonshot.svg";
import minimax from "@/assets/logo-minimax.svg";
import meta from "@/assets/logo-meta.svg";
import mistral from "@/assets/logo-mistral.svg";
import codex from "@/assets/logos/codex.png";
import hermes from "@/assets/hermes-face.png";
import notion from "@/assets/logos/notion.png";
import obsidian from "@/assets/logos/obsidian.svg";
import gmail from "@/assets/logos/gmail.svg";
import granola from "@/assets/logos/granola.png";
import openclaw from "@/assets/logos/openclaw.svg";
import openrouter from "@/assets/logos/openrouter.svg";
function OpenRouterMark({ className = "" }: { className?: string }) {
  return <svg className={`agentic-openrouter-mark ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z" /></svg>;
}
export function AgenticMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`agentic-mark ${className}`} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M8 23 16 7l8 16M11 19h10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m24 5 1.1 3.4L28.5 9l-3.4 1.1L24 13.5l-.6-3.4L20 9l3.4-.6L24 5Z"
        fill="currentColor"
      />
    </svg>
  );
}
export function ChatModelLogo({
  model,
}: {
  model?: Pick<AskModel, "name" | "provider" | "backend">;
}) {
  // The model's maker and its harness differ (for example Gemini via Claude Code).
  const text = (model?.name || model?.provider || "").toLowerCase();
  const match = /deepseek/.test(text)
    ? deepseek
    : /claude|anthropic/.test(text)
      ? claude
      : /gemini|google/.test(text)
        ? gemini
        : /grok|x-ai/.test(text)
          ? grok
          : /qwen/.test(text)
            ? qwen
            : /glm|z-ai/.test(text)
              ? zai
              : /moonshot|kimi/.test(text)
                ? moonshot
                : /minimax/.test(text)
                  ? minimax
                  : /llama|meta/.test(text)
                    ? meta
                    : /mistral/.test(text)
                      ? mistral
                      : /gpt|openai|codex/.test(text)
                        ? openai
                        : model?.backend === "hermes"
                          ? hermes
                          : null;
  return match ? (
    <img src={match} alt="" className="agentic-model-logo" />
  ) : (
    <Cpu className="agentic-model-logo" />
  );
}
/** Runtime is distinct from the model maker and the account providing it. */
export function harnessName(model: AskModel) {
  if (model.backend === "hermes") return "Hermes";
  if (model.backend === "deepseek") return "DeepSeek Harness";
  if (model.backend === "local")
    return model.provider === "ollama"
      ? "Ollama"
      : model.provider === "lmstudio"
        ? "LM Studio"
        : "Local";
  const lane = laneFor(model.name, model.provider);
  return lane === "codex"
    ? "Codex"
    : lane === "ccr" || lane === "sub"
      ? "Claude Code"
      : "Unverified runtime";
}
export function modelRouteDescription(model: AskModel) {
  const runtime = harnessName(model);
  if (model.backend === "local") return `${runtime} · on this device`;
  if (/openrouter/i.test(model.provider || "")) return `${runtime} · OpenRouter`;
  if (model.backend === "hermes") return `Hermes · ${model.provider || "configured connection"}`;
  return runtime;
}
export function ContextLogo({ origin }: { origin: string }) {
  if (origin === "personal") return <span className="agentic-personal-orb" aria-hidden="true" />;
  if (origin === "openrouter") return <OpenRouterMark />;
  if (origin === "outlook") return <ProviderLogo provider="outlook" />;
  const logos: Record<string, string> = {
    chatgpt: openai,
    codex,
    claude,
    hermes,
    notion,
    obsidian,
    gmail,
    granola,
    openclaw,
    openrouter,
    deepseek,
    "deepseek harness": deepseek,
  };
  const Icon =
    origin === "images"
      ? Image
      : origin === "files"
        ? FileText
        : origin === "personal"
          ? User
          : origin === "email"
            ? Mail
            : origin === "meetings"
              ? Calendar
              : origin === "web"
                ? Globe
                : BrainCircuit;
  return logos[origin] ? <img src={logos[origin]} alt="" data-brand={origin} /> : <Icon size={15} />;
}

export function ChatRuntimeLogo({ name }: { name: string }) {
  if (name === "Local") return <Monitor className="agentic-runtime-logo agentic-local-logo" size={38} strokeWidth={1.4} />;
  const logos: Record<string, string> = { Codex: openai, Claude: claude, Hermes: hermes, OpenRouter: openrouter };
  if (name === "OpenRouter") return <OpenRouterMark className="agentic-runtime-logo" />;
  return logos[name] ? <img className="agentic-runtime-logo" data-brand={name.toLowerCase()} src={logos[name]} alt="" /> : <Cpu size={24} />;
}
