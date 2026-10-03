import { useId } from "react";
import {
  Bot,
  BrainCircuit,
  FileText,
  Globe2,
  Image as ImageIcon,
  FolderCode,
  Mail,
  MessageSquare,
  UserRound,
} from "lucide-react";
import codexLogo from "@/assets/logos/codex.png";
import claudeLogo from "@/assets/claude-logo.png";
import hermesLogo from "@/assets/hermes-face.png";
import granolaLogo from "@/assets/logos/granola.png";
import gmailLogo from "@/assets/logos/gmail.svg";
import notionLogo from "@/assets/logos/notion.png";
import openaiLogo from "@/assets/logo-openai.svg";
import obsidianLogo from "@/assets/logos/obsidian.png";
import openclawLogo from "@/assets/openclaw.png";
import grokLogo from "@/assets/logo-grok.svg";
import cursorLogo from "@/assets/logos/cursor.svg";
import windsurfLogo from "@/assets/logos/windsurf.svg";
import vscodeLogo from "@/assets/logos/vscode.svg";
import zedLogo from "@/assets/logos/zed.svg";
import antigravityLogo from "@/assets/logos/antigravity.png";
import copilotLogo from "@/assets/logos/copilot.svg";
import jetbrainsLogo from "@/assets/logos/jetbrains.svg";
import aiderLogo from "@/assets/logos/aider.svg";
import continueLogo from "@/assets/logos/continue.svg";
import gooseLogo from "@/assets/logos/goose.svg";
import geminiLogo from "@/assets/logos/gemini-color.svg";
import calendarLogo from "@/assets/logos/googlecalendar.svg";
import driveMark from "@/assets/logos/googledrive.mono.svg?raw";
import traeMark from "@/assets/logos/trae.mono.svg?raw";
import opencodeMark from "@/assets/logos/opencode.mono.svg?raw";
import ollamaMark from "@/assets/logos/ollama.mono.svg?raw";
import xcodeMark from "@/assets/logos/xcode.mono.svg?raw";
import warpMark from "@/assets/logos/warp.mono.svg?raw";
import itermMark from "@/assets/logos/iterm.mono.svg?raw";
import githubMark from "@/assets/logos/github.mono.svg?raw";
import { Terminal, Cpu, Contact } from "lucide-react";
import higgsfieldLogo from "@/assets/logos/higgsfield.png";
import n8nLogo from "@/assets/logos/n8n.svg";
import stitchLogo from "@/assets/logos/stitch.png";
import zapierLogo from "@/assets/logos/zapier.png";
import supabaseLogo from "@/assets/logos/supabase.png";
import canvaLogo from "@/assets/logos/canva.png";
import gammaLogo from "@/assets/logos/gamma.png";
import pineconeLogo from "@/assets/logos/pinecone.svg";
import notebooklmLogo from "@/assets/logos/notebooklm.png";
import apifyLogo from "@/assets/logos/apify.png";
import firecrawlLogo from "@/assets/logos/firecrawl.png";
import openrouterLogo from "@/assets/logos/openrouter.svg";
import telegramLogo from "@/assets/logos/telegram.png";
import clayLogo from "@/assets/logos/clay.png";
import relumeLogo from "@/assets/logos/relume.png";
import "./memory-connections.css";

/** Inline marks keep brand colours where the brand has one and follow the text colour otherwise. */
const marks: Record<string, { label: string; svg: string }> = {
  trae: { label: "Trae", svg: traeMark },
  opencode: { label: "OpenCode", svg: opencodeMark },
  ollama: { label: "Ollama", svg: ollamaMark },
  xcode: { label: "Xcode", svg: xcodeMark },
  warp: { label: "Warp", svg: warpMark },
  iterm: { label: "iTerm", svg: itermMark },
  github: { label: "GitHub", svg: githubMark },
  googledrive: { label: "Google Drive", svg: driveMark },
};
const iconMarks: Record<string, { label: string; Icon: typeof Terminal }> = {
  terminal: { label: "Terminal", Icon: Terminal },
  kiro: { label: "Kiro", Icon: Cpu },
  lmstudio: { label: "LM Studio", Icon: Cpu },
  googlecontacts: { label: "Google Contacts", Icon: Contact },
};

function SkillsCrystal() {
  const id = useId();
  return (
    <svg className="mc-skills-crystal" viewBox="0 0 44 44" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f5f1ff" />
          <stop offset=".45" stopColor="#c4b4fa" />
          <stop offset="1" stopColor="#8362cf" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b49af0" />
          <stop offset="1" stopColor="#53338c" />
        </linearGradient>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#98e6ed" />
          <stop offset=".55" stopColor="#eee3ff" />
          <stop offset="1" stopColor="#c695ef" />
        </linearGradient>
      </defs>
      {[16, 9, 2].map((y, index) => (
        <g key={y} className={`mc-skill-layer mc-skill-layer-${index}`}>
          <g transform={`translate(0 ${y})`}>
            <path
              d="M5 11 22 20 39 11v5L22 25 5 16Z"
              fill={`url(#${id}-edge)`}
              stroke="#69508f"
              strokeWidth=".6"
              strokeLinejoin="round"
            />
            <path
              d="m5 11 17-9 17 9-17 9Z"
              fill={`url(#${id}-face)`}
              stroke={`url(#${id}-light)`}
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="m9 11 13 7 13-7"
              fill="none"
              stroke={`url(#${id}-light)`}
              strokeWidth=".65"
              opacity=".8"
            />
          </g>
        </g>
      ))}
      <path
        className="mc-skill-spark"
        d="m22 8 1.3 3.7L27 13l-3.7 1.3L22 18l-1.3-3.7L17 13l3.7-1.3Z"
        fill="#fffafc"
      />
    </svg>
  );
}

const brands: Record<string, { label: string; image: string }> = {
  cursor: { label: "Cursor", image: cursorLogo },
  windsurf: { label: "Windsurf", image: windsurfLogo },
  vscode: { label: "VS Code", image: vscodeLogo },
  zed: { label: "Zed", image: zedLogo },
  antigravity: { label: "Antigravity", image: antigravityLogo },
  copilot: { label: "GitHub Copilot", image: copilotLogo },
  jetbrains: { label: "JetBrains", image: jetbrainsLogo },
  aider: { label: "Aider", image: aiderLogo },
  continue: { label: "Continue", image: continueLogo },
  goose: { label: "Goose", image: gooseLogo },
  email: { label: "Email", image: gmailLogo },
  meetings: { label: "Meetings", image: granolaLogo },
  codex: { label: "Codex", image: codexLogo },
  claude: { label: "Claude", image: claudeLogo },
  hermes: { label: "Hermes", image: hermesLogo },
  granola: { label: "Granola", image: granolaLogo },
  gmail: { label: "Gmail", image: gmailLogo },
  google: { label: "Gmail", image: gmailLogo },
  notion: { label: "Notion", image: notionLogo },
  chatgpt: { label: "ChatGPT", image: openaiLogo },
  openai: { label: "OpenAI", image: openaiLogo },
  obsidian: { label: "Obsidian", image: obsidianLogo },
  openclaw: { label: "OpenClaw", image: openclawLogo },
  grokbot: { label: "Grok", image: grokLogo },
  gemini: { label: "Gemini CLI", image: geminiLogo },
  googlecalendar: { label: "Google Calendar", image: calendarLogo },
  calendar: { label: "Google Calendar", image: calendarLogo },
  higgsfield: { label: "Higgsfield", image: higgsfieldLogo },
  n8n: { label: "n8n", image: n8nLogo },
  stitch: { label: "Stitch", image: stitchLogo },
  zapier: { label: "Zapier", image: zapierLogo },
  supabase: { label: "Supabase", image: supabaseLogo },
  canva: { label: "Canva", image: canvaLogo },
  gamma: { label: "Gamma", image: gammaLogo },
  pinecone: { label: "Pinecone", image: pineconeLogo },
  notebooklm: { label: "NotebookLM", image: notebooklmLogo },
  apify: { label: "Apify", image: apifyLogo },
  firecrawl: { label: "Firecrawl", image: firecrawlLogo },
  openrouter: { label: "OpenRouter", image: openrouterLogo },
  telegram: { label: "Telegram", image: telegramLogo },
  clay: { label: "Clay", image: clayLogo },
  relume: { label: "Relume", image: relumeLogo },
};
export function SourceBrand({
  id,
  size = 28,
  circle = false,
}: {
  id: string;
  size?: number;
  circle?: boolean;
}) {
  const brand = brands[id];
  const mark = marks[id], iconMark = iconMarks[id];
  if (mark) return <span className={`mc-brand mc-brand-mark${circle ? " is-circle" : ""}`} style={{ width: size, height: size }} role="img" aria-label={mark.label} dangerouslySetInnerHTML={{ __html: mark.svg }} />;
  if (iconMark) return <span className={`mc-brand mc-brand-mark${circle ? " is-circle" : ""}`} style={{ width: size, height: size }} role="img" aria-label={iconMark.label}><iconMark.Icon size={Math.round(size * 0.72)} strokeWidth={1.7} /></span>;
  const fallback: Record<string, { label: string; Icon: typeof BrainCircuit }> = {
    email: { label: "Email", Icon: Mail },
    personal: { label: "Personal", Icon: UserRound },
    images: { label: "Photos", Icon: ImageIcon },
    codebases: { label: "Codebases", Icon: FolderCode },
    meetings: { label: "Meetings", Icon: MessageSquare },
    manual: { label: "Added by you", Icon: UserRound },
    web: { label: "Web", Icon: Globe2 },
    skills: { label: "Skills", Icon: BrainCircuit },
    agents: { label: "Agents", Icon: Bot },
    files: { label: "Files", Icon: FileText },
  };
  const entry = fallback[id] || { label: id, Icon: BrainCircuit };
  return (
    <span
      className={`mc-source-brand${circle ? " is-circle" : ""}`}
      data-brand={id}
      role="img"
      aria-label={
        brand?.label || (id === "business" ? "Info" : id === "outlook" ? "Outlook" : entry.label)
      }
      style={{ width: size, height: size }}
    >
      {id === "business" ? (
        <span className="mc-info-orb" aria-hidden="true">
          <span className="mc-info-current" />
        </span>
      ) : id === "skills" ? (
        <SkillsCrystal />
      ) : id === "images" ? (
        <svg viewBox="0 0 42 42" aria-hidden="true">
          {[
            "#ed697d",
            "#f5a456",
            "#f8d55c",
            "#a5cf62",
            "#66c6b3",
            "#59b9e5",
            "#8184cf",
            "#bc80ba",
          ].map((color, i) => (
            <ellipse
              key={color}
              cx="21"
              cy="12"
              rx="5.9"
              ry="10.2"
              fill={color}
              fillOpacity=".88"
              transform={`rotate(${i * 45} 21 21)`}
            />
          ))}
        </svg>
      ) : id === "cal" ? (
        <span className="mc-cal-wordmark">Cal.</span>
      ) : brand ? (
        <img src={brand.image} alt="" />
      ) : id === "outlook" ? (
        <svg aria-hidden="true" viewBox="0 0 32 32">
          <rect x="11" y="3" width="19" height="25" rx="3" fill="#1490df" />
          <path d="M11 13h19v15H11z" fill="#0078d4" />
          <path d="m11 13 10 8 9-8" fill="#50b6ed" />
          <rect x="1" y="8" width="17" height="18" rx="2" fill="#0364b8" />
          <text
            x="9.5"
            y="21"
            textAnchor="middle"
            fill="white"
            fontSize="13"
            fontFamily="Arial"
            fontWeight="bold"
          >
            O
          </text>
        </svg>
      ) : (
        <entry.Icon size={size * 0.74} aria-hidden="true" />
      )}
    </span>
  );
}
