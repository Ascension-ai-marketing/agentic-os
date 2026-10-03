// Orb lab: pick the orb's world (backdrop) and the orb itself, at real
// sidebar size, cycling through the voice states. Temporary page: the
// winners move into the sidebar dock and this page is removed.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OrbBackdrop } from "./orb-backdrop";
import { ORB_PALETTES, VoiceOrbCanvas, type OrbMood } from "./voice-orb-canvas";
import { usePointerAura } from "./voice-orb";
import SoftAurora from "./rb/SoftAurora";
import Iridescence from "./rb/Iridescence";
import LiquidEther from "./rb/LiquidEther";
import Galaxy from "./rb/Galaxy";
import GhostFibers from "./rb/GhostFibers";
import MoltenMetal from "./rb/MoltenMetal";
import RbOrb from "./rb/Orb";
import SiriOrb from "./smoothui/siri-orb";
import { useMotionValue, type MotionValue } from "motion/react";
import "./voice-dock.css";
import "./orb-lab.css";

const SEQUENCE: { mood: OrbMood; ms: number; label: string }[] = [
  { mood: "idle", ms: 5000, label: "Resting" },
  { mood: "listening", ms: 3500, label: "Listening" },
  { mood: "thinking", ms: 2400, label: "Jev deciding" },
  { mood: "speaking", ms: 3800, label: "Speaking" },
  { mood: "working", ms: 3000, label: "Agent working" },
];
const STATUS: Record<OrbMood, string> = { idle: "", listening: "Listening", thinking: "Thinking", speaking: "Speaking", working: "An agent is working", error: "" };

const hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
// Rich resting colours; each state then tints toward its own.
const REST = [[0.16, 0.08, 0.36], [0.52, 0.32, 0.95], [0.96, 0.53, 0.72]];
const pal = (m: OrbMood) => (m === "idle" ? REST : ORB_PALETTES[m].c);
const HUE: Record<OrbMood, number> = { idle: 0, listening: -110, thinking: 60, speaking: -20, working: 160, error: 120 };

function useDemoMood(locked: OrbMood | "auto") {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (locked !== "auto") return;
    const t = window.setTimeout(() => setI((n) => (n + 1) % SEQUENCE.length), SEQUENCE[i].ms);
    return () => window.clearTimeout(t);
  }, [i, locked]);
  return locked === "auto" ? SEQUENCE[i].mood : locked;
}

type Card = { key: string; name: string; note: string; world: (m: OrbMood) => ReactNode; orb?: (m: OrbMood, amp?: MotionValue<number>) => ReactNode };

const WORLDS: Card[] = [
  { key: "nebula", name: "Deep nebula", note: "Your pick, richer: deep gas clouds and dust lanes.", world: () => null },
  {
    key: "aurora",
    name: "Soft aurora",
    note: "React Bits. Silky northern-lights bands.",
    world: (m) => <SoftAurora color1={hex(pal(m)[1])} color2={hex(pal(m)[2])} speed={0.6} brightness={1.1} />,
  },
  {
    key: "iridescence",
    name: "Iridescence",
    note: "React Bits. Flowing pearl sheen.",
    world: (m) => <Iridescence color={pal(m)[1].map((v) => v * 0.9) as [number, number, number]} speed={0.6} amplitude={0.08} mouseReact />,
  },
  {
    key: "ether",
    name: "Liquid ether",
    note: "React Bits. Real fluid you stir with the mouse.",
    world: (m) => <LiquidEther colors={pal(m).map(hex)} autoDemo autoSpeed={0.4} autoIntensity={1.8} resolution={0.45} mouseForce={18} cursorSize={70} />,
  },
  {
    key: "galaxy",
    name: "Galaxy",
    note: "React Bits. Deep star field with twinkle and drift.",
    world: (m) => <Galaxy hueShift={200 + HUE[m]} density={1.2} glowIntensity={0.45} saturation={0.6} twinkleIntensity={0.5} rotationSpeed={0.06} mouseRepulsion />,
  },
  {
    key: "fibers",
    name: "Ghost fibres",
    note: "React Bits. Glowing silk threads that twist.",
    world: (m) => <GhostFibers lineColor={hex(pal(m)[1])} glowColor={hex(pal(m)[2])} speed={0.6} />,
  },
];

// Glass sphere shell for texture-based orbs.
function Shell({ children, mood }: { children: ReactNode; mood: OrbMood }) {
  return (
    <span className="lab-shell" style={{ "--shell": hex(pal(mood)[1]) } as CSSProperties}>
      <span className="lab-shell-fill">{children}</span>
      <span className="lab-shell-glass" />
    </span>
  );
}

const ORBS: Card[] = [
  { key: "marble", name: "Plasma marble", note: "The current orb. Swirling plasma inside a glass sphere.", world: () => null },
  {
    key: "ring",
    name: "Halo ring",
    note: "React Bits Orb. A glowing ring that warps when you hover.",
    world: () => null,
    orb: (m) => (
      <span className="lab-ring">
        <RbOrb hue={HUE[m]} hoverIntensity={0.35} rotateOnHover forceHoverState={m === "listening" || m === "speaking"} backgroundColor="#07060c" />
      </span>
    ),
  },
  {
    key: "molten",
    name: "Molten core",
    note: "React Bits Molten Metal inside glass. A tiny sun.",
    world: () => null,
    orb: (m) => (
      <Shell mood={m}>
        <MoltenMetal color1={hex(pal(m)[1])} color2={hex(pal(m)[2])} color3="#fff4e0" speed={0.8} coreSize={0.75} glow={1.8} brightness={1.6} blackPoint={0} />
      </Shell>
    ),
  },
  {
    key: "pearl",
    name: "Pearl",
    note: "React Bits Iridescence inside glass. Soft, calm, premium.",
    world: () => null,
    orb: (m) => (
      <Shell mood={m}>
        <Iridescence color={pal(m)[2] as [number, number, number]} speed={0.8} amplitude={0.15} />
      </Shell>
    ),
  },
  {
    key: "fibre-heart",
    name: "Fibre heart",
    note: "React Bits Ghost Fibres inside glass. Threads of light.",
    world: () => null,
    orb: (m) => (
      <Shell mood={m}>
        <GhostFibers lineColor={hex(pal(m)[1])} glowColor={hex(pal(m)[2])} speed={0.9} scale={0.7} />
      </Shell>
    ),
  },
  {
    key: "siri",
    name: "Siri glass",
    note: "SmoothUI Siri Orb. Apple-style liquid glass that breathes with your voice.",
    world: () => null,
    orb: (m, amp) => (
      <SiriOrb
        size="104px"
        state={m === "listening" ? "listening" : m === "thinking" || m === "working" ? "thinking" : m === "speaking" ? "streaming" : m === "error" ? "error" : "idle"}
        amplitude={amp}
        colors={{ bg: "#07060c", c1: hex(pal(m)[1]), c2: hex(pal(m)[2]), c3: "#8f7cff", c4: "#d45bb6" }}
      />
    ),
  },
];

export function OrbLab() {
  const [tab, setTab] = useState<"worlds" | "orbs">("worlds");
  const [locked, setLocked] = useState<OrbMood | "auto">("auto");
  const mood = useDemoMood(locked);
  const level = useRef(0);
  const amp = useMotionValue(0);
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const talking = mood === "listening" || mood === "speaking";
      level.current = talking ? Math.max(0, 0.35 + 0.35 * Math.sin(t / 110) * Math.sin(t / 370) + 0.25 * Math.sin(t / 53)) : 0;
      amp.set(level.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mood, amp]);

  const cards = tab === "worlds" ? WORLDS : ORBS;
  return (
    <div className="orb-lab">
      <header className="orb-lab-head">
        <div>
          <h1>Pick the orb&rsquo;s look</h1>
          <p>
            Real sidebar size, cycling through every state. Hover a card: things react to your mouse. Pick one world and
            one orb.
          </p>
        </div>
        <div className="orb-lab-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "worlds"} onClick={() => setTab("worlds")}>
            1 · Worlds
          </button>
          <button type="button" role="tab" aria-selected={tab === "orbs"} onClick={() => setTab("orbs")}>
            2 · Orbs
          </button>
        </div>
      </header>
      <div className="orb-lab-moods" role="group" aria-label="State">
        <button type="button" aria-pressed={locked === "auto"} onClick={() => setLocked("auto")}>
          Auto
        </button>
        {SEQUENCE.map((s) => (
          <button key={s.mood} type="button" aria-pressed={locked === s.mood} onClick={() => setLocked(s.mood)}>
            {s.label}
          </button>
        ))}
        <span className="orb-lab-now">
          Now: <b>{SEQUENCE.find((s) => s.mood === mood)?.label}</b>
        </span>
      </div>
      <div className="orb-lab-grid" key={tab}>
        {cards.map((c, i) => (
          <LabCard key={c.key} n={i + 1} card={c} tab={tab} mood={mood} level={level} amp={amp} />
        ))}
      </div>
    </div>
  );
}

function LabCard({ n, card, tab, mood, level, amp }: { n: number; card: Card; tab: "worlds" | "orbs"; mood: OrbMood; level: React.MutableRefObject<number>; amp: MotionValue<number> }) {
  const orbRef = useRef<HTMLButtonElement>(null);
  const { pointer, onPointerMove, onPointerLeave } = usePointerAura();
  const custom = card.world(mood);
  const nebula = tab === "orbs" || card.key === "nebula";
  return (
    <figure className="orb-lab-card">
      <div className="vd orb-lab-dock" data-mood={mood} onPointerMove={(e) => onPointerMove(e, orbRef.current)} onPointerLeave={() => onPointerLeave(orbRef.current)}>
        {nebula ? (
          <OrbBackdrop variant="nebula" mood={mood} levelRef={level} pointerRef={pointer} orbSize={128} centerY={0.42} />
        ) : (
          <span className="lab-world">{custom}</span>
        )}
        <button ref={orbRef} type="button" className="vd-orb" aria-label={`${card.name} preview`}>
          <span className="vd-ripples" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {card.orb ? <span className="lab-orb-slot">{card.orb(mood, amp)}</span> : <VoiceOrbCanvas mood={mood} levelRef={level} pointerRef={pointer} size={128} />}
        </button>
        <div className="vd-text lab-status">{STATUS[mood] && <b>{STATUS[mood]}</b>}</div>
      </div>
      <figcaption>
        <span className="orb-lab-n">{n}</span>
        <span>
          <b>{card.name}</b>
          <small>{card.note}</small>
        </span>
      </figcaption>
    </figure>
  );
}
