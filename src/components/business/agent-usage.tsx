// Agent usage: Claude and Codex plan limits on one calm near-black panel.
// At a glance each agent shows only its big logo, one meter and the number
// that matters (its fullest limit window). Details (every window, reset times,
// plan and price, where the numbers came from) open on request. Two meter
// styles, remembered per browser: Orb (a glass sphere the liquid surges into)
// and Bar (a thick capsule filled left to right with a charged wave front).
//
// Numbers come only from the providers (see scripts/plan-limits.ts). When a
// source cannot be read the panel says "Not connected" and why. No estimates.
import { useEffect, useRef, useState } from "react";
import { useLiveData } from "@/lib/use-live-data";
import claudeLogoPng from "@/assets/claude-logo.png";
import codexLogoPng from "@/assets/logos/codex.png";
import "./agent-usage.css";

type Win = { id: string; label: string; pct: number; resetsAt: string | null; minutes: number | null };
type Source = "oauth-usage-api" | "claude-app" | "codex-logs" | "preview" | null;
type Agent = {
  id: "claude" | "codex";
  name: string;
  logo: string;
  plan: string | null;
  price: number | null;
  source: Source;
  asOf: string | null;
  windows: Win[];
  reason?: string;
  /** One colour per window, first window first. */
  colors: string[];
  glow: string;
};

const CLAUDE = { colors: ["#F4AE8C", "#D97757", "#F9DCCB", "#B85A3B"], glow: "#D97757" };
const CODEX = { colors: ["#9EC2FF", "#E4F0FF", "#7C98FF", "#C9DCFF"], glow: "#7FB2FF" };

function fromLimits(
  base: Pick<Agent, "id" | "name" | "logo" | "colors" | "glow">,
  limits: any,
  sub: any,
  stripPrefix: string,
  fallbackReason: string,
): Agent {
  const subPlan: string | null = typeof sub?.plan === "string" ? sub.plan : null;
  const plan = subPlan ? subPlan.replace(stripPrefix, "").trim() || subPlan : (limits?.plan ?? null);
  const price = typeof sub?.monthlyPrice === "number" && sub.monthlyPrice > 0 ? sub.monthlyPrice : null;
  if (!limits) return { ...base, plan, price, source: null, asOf: null, windows: [], reason: fallbackReason };
  return {
    ...base,
    plan,
    price,
    source: limits.source ?? null,
    asOf: limits.asOf ?? null,
    windows: Array.isArray(limits.windows) ? limits.windows : [],
    reason: limits.reason,
  };
}

function agents(live: any): Agent[] {
  const subs = live?.subscriptions;
  return [
    fromLimits(
      { id: "claude", name: "Claude", logo: claudeLogoPng, ...CLAUDE },
      live?.usage?.claudeWindow?.limits,
      subs?.claude,
      "Claude ",
      "Run the aggregator to read your Claude limits.",
    ),
    fromLimits(
      { id: "codex", name: "Codex", logo: codexLogoPng, ...CODEX },
      live?.usage?.chatgptWindow?.limits,
      subs?.chatgpt?.present === false ? null : subs?.chatgpt,
      "",
      "No Codex sign-in found on this computer.",
    ),
  ];
}

// Dev only. ?usage=62,24 sets Claude weekly and Codex weekly.
// ?usage=12,40,7|11,30 sets every window per agent; "off" shows not connected.
const PREVIEW_LABELS: Record<Agent["id"], [string, number][]> = {
  claude: [["5-hour", 300], ["Weekly", 10080], ["Weekly Opus", 10080], ["Weekly Sonnet", 10080]],
  codex: [["5-hour", 300], ["Weekly", 10080]],
};
function applyPreview(list: Agent[], raw: string) {
  const parts = raw.includes("|") ? raw.split("|") : null;
  list.forEach((a, i) => {
    if (!parts) {
      const v = Number(raw.split(",")[i]);
      if (!Number.isFinite(v)) return;
      const w = a.windows.find((x) => (x.minutes ?? 0) >= 10080) ?? a.windows[0];
      if (w) w.pct = v;
      else a.windows = [{ id: "preview", label: "Weekly", pct: v, resetsAt: null, minutes: 10080 }];
      return;
    }
    const spec = parts[i]?.trim();
    if (!spec) return;
    a.source = "preview";
    if (spec === "off") {
      a.windows = [];
      a.reason = "Preview of the not connected state.";
      return;
    }
    const nums = spec.split(",").map(Number).filter(Number.isFinite);
    const labels = nums.length === 1 && a.id === "codex" ? [PREVIEW_LABELS.codex[1]] : PREVIEW_LABELS[a.id];
    a.windows = nums.slice(0, 4).map((pct, k) => ({
      id: `p${k}`,
      label: labels[k]?.[0] ?? `Window ${k + 1}`,
      pct,
      minutes: labels[k]?.[1] ?? null,
      resetsAt: new Date(Date.now() + (labels[k]?.[1] === 300 ? 2.4 : 76) * 36e5).toISOString(),
    }));
  });
}

type View = "orb" | "bar";
const VIEW_KEY = "agentic-os:usage-style";

/** Client only: the meters depend on live data, the clock and a saved view,
 *  which the server cannot know. Rendering them on the server made React throw
 *  away and redraw the whole Dashboard (the flash). A same-size frame holds
 *  the space until the browser takes over. */
export function AgentUsage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="au-wrap au-placeholder" aria-hidden="true" />;
  return <AgentUsagePanel />;
}

function AgentUsagePanel() {
  const live = useLiveData();
  const list = agents(live);
  const [view, setView] = useState<View>("orb");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "orb" || saved === "bar") setView(saved);
    } catch {}
    // Dev only: ?usageView=bar and ?usageDetails=1 for screenshots.
    if (import.meta.env.DEV) {
      const q = new URLSearchParams(window.location.search);
      const v = q.get("usageView");
      if (v === "orb" || v === "bar") setView(v);
      if (q.get("usageDetails") === "1") setOpen(true);
    }
  }, []);
  const choose = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("usage");
    if (q) applyPreview(list, q);
  }
  useNow(30_000);
  return (
    <div className="au-wrap">
      <section className="au" data-view={view} data-open={open || undefined} aria-label="Claude and Codex plan limits">
        <div className="au-controls">
          <div className="au-switch" role="group" aria-label="Meter style">
            {(["orb", "bar"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => choose(v)}>
                {v === "orb" ? "Orb" : "Bar"}
              </button>
            ))}
          </div>
          <button type="button" className="au-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            Details
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="au-stage">
          {list.map((a, i) => (
            <Hero key={`${a.id}-${view}`} agent={a} view={view} delay={i * 260} />
          ))}
        </div>
        {open && (
          <div className="au-details">
            {list.map((a) => (
              <Details key={a.id} agent={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const FREEZE_AT: number | null = (() => {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const v = Number(new URLSearchParams(window.location.search).get("usageT"));
  return Number.isFinite(v) && v > 0 ? v : null;
})();

/** One agent at a glance: the big logo, the meter, the one number that matters. */
function Hero({ agent, view, delay }: { agent: Agent; view: View; delay: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const top = hotIndex(agent.windows);
  const hero = agent.windows[top];
  const target = hero ? clamp(hero.pct) : 0;
  // The meter wears the brand colour: Claude clay, Codex ice blue.
  const color = hero ? agent.glow : "#8a8f99";
  const numRef = useRef<HTMLSpanElement>(null);
  const seeds = useRef(Array.from({ length: 64 }, () => ({ a: Math.random(), b: Math.random(), c: Math.random() })));
  const sparks = useRef<Spark[]>([]);
  useCanvas(
    ref,
    (ctx, W, H, t0, reduce) => {
      // Dev only: ?usageT=0.5 holds the entrance at that second for screenshots.
      const t = FREEZE_AT !== null && t0 > FREEZE_AT ? FREEZE_AT : t0;
      const spawn = t === t0;
      const lvl = reduce ? target : springAt(t, target);
      // The number counts up with the fill but never shows more than the real value.
      if (numRef.current) numRef.current.textContent = String(Math.round(Math.max(0, t > 3.2 || reduce ? target : Math.min(target, lvl))));
      const args = { ctx, W, H, t, reduce, lvl, target, color, glow: agent.glow, seeds: seeds.current, sparks: sparks.current, on: !!hero, spawn };
      if (view === "orb") drawOrb(args);
      else drawBar(args);
    },
    [view, target, color, agent.id],
    delay,
  );
  return (
    <div className="au-hero" data-agent={agent.id} data-off={!hero || undefined} style={{ ["--c" as string]: color }}>
      {view === "orb" ? (
        <div className="au-orb">
          <canvas ref={ref} aria-hidden="true" />
          <img className="au-logo" src={agent.logo} alt={`${agent.name} logo`} />
        </div>
      ) : (
        <img className="au-logo" src={agent.logo} alt={`${agent.name} logo`} />
      )}
      <div className="au-read">
        {hero ? (
          <span className="au-num" aria-label={`${agent.name} ${hero.label} ${Math.round(target)} percent used`}>
            <span ref={numRef}>{Math.round(target)}</span>
            <small>%</small>
          </span>
        ) : (
          <span className="au-num au-num-off">Not connected</span>
        )}
        <span className="au-label">
          {agent.name}
          {hero ? `, ${hero.label.toLowerCase()} used` : ""}
          {hero && target >= 80 && <b className="au-warn">Near limit</b>}
        </span>
      </div>
      {view === "bar" && (
        <div className="au-barwrap">
          <canvas ref={ref} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** Everything else, only when asked for: plan and price, every window, source. */
function Details({ agent }: { agent: Agent }) {
  const status = statusOf(agent);
  return (
    <div className="au-det" data-agent={agent.id}>
      <p className="au-det-head">
        <b>{agent.name}</b>
        {agent.plan && <span>{agent.plan}</span>}
        {agent.price && <span className="au-det-price">${agent.price}/mo</span>}
      </p>
      {agent.windows.length ? (
        <ul>
          {agent.windows.map((w, i) => (
            <li key={w.id} style={{ ["--c" as string]: agent.colors[i % agent.colors.length] }}>
              <span className="au-det-name">{w.label}</span>
              <span className="au-det-pct">{Math.round(clamp(w.pct))}%</span>
              <span className="au-det-when">{resetText(w)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="au-det-off">
          {agent.reason}
          {agent.id === "claude" ? " Open a terminal, run claude and sign in." : ""}
        </p>
      )}
      <p className="au-det-src" data-tone={status.tone} title={status.title}>
        {status.text}
        {agent.source === "claude-app" ? ". Sign in to Claude Code for reset times and the per-model limit." : ""}
      </p>
    </div>
  );
}

// Motion: an underdamped spring, so the fill surges past the value and settles.
function springAt(t: number, target: number, w = 5.4, z = 0.22) {
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * t);
  return target * (1 - e * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t)));
}
/** Spring speed in value units per second, used for splash and edge energy. */
const springVel = (t: number, target: number) => (springAt(t + 0.01, target) - springAt(t, target)) / 0.01;

function mixHex(a: string, b: string, k: number) {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number };
type MeterArgs = {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  t: number;
  reduce: boolean;
  lvl: number;
  target: number;
  color: string;
  glow: string;
  seeds: { a: number; b: number; c: number }[];
  sparks: Spark[];
  on: boolean;
  /** False while a dev screenshot holds the frame, so nothing new spawns. */
  spawn: boolean;
};

const lastT = new WeakMap<Spark[], number>();
/** Steps the spark list and draws it. */
function stepSparks(ctx: CanvasRenderingContext2D, list: Spark[], t: number, color: string, gravity: number) {
  const prev = lastT.get(list) ?? t;
  const dt = Math.min(0.05, Math.max(0, t - prev));
  lastT.set(list, t);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.life += dt;
    if (s.life >= s.max) {
      list.splice(i, 1);
      continue;
    }
    s.vy += gravity * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const k = 1 - s.life / s.max;
    ctx.fillStyle = hexA("#ffffff", 0.9 * k);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (0.5 + k * 0.5), 0, TAU);
    ctx.fill();
    ctx.fillStyle = hexA(color, 0.16 * k);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ── Orb: a glass sphere. The liquid pours in, surges past the level, sloshes
// and settles into a lively idle. Everything is clipped inside the glass.
function drawOrb({ ctx, W, H, t, reduce, lvl, target, color, seeds, sparks, on, spawn }: MeterArgs) {
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 3;
  const Ri = R - 2.5;
  // Glass body.
  const glass = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.35, R * 0.1, cx, cy, R);
  glass.addColorStop(0, "#1b1c21");
  glass.addColorStop(0.75, "#0d0e11");
  glass.addColorStop(1, "#050506");
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Ri, 0, TAU);
  ctx.clip();
  if (on) {
    const settle = reduce ? 0 : Math.exp(-t * 1.1);
    const vel = reduce ? 0 : springVel(t, target);
    // Surface height from the bottom of the sphere.
    const h = Math.max(target > 0 ? 5 : 0, (2 * Ri * Math.max(0, lvl)) / 100);
    const surf = cy + Ri - h;
    const amp = reduce ? 0 : 3.2 + 16 * settle + Math.min(10, Math.abs(vel) * 0.25);
    const tilt = reduce ? 0 : Math.sin(t * 5.2) * 0.22 * settle;
    const wave = (x: number, ph: number, k: number, sp: number, a: number) =>
      surf + (x - cx) * tilt + Math.sin((x - cx) * k + t * sp + ph) * a + Math.sin((x - cx) * k * 2.3 - t * sp * 1.4 + ph) * a * 0.35;
    const body = (ph: number, k: number, sp: number, a: number, fill: string | CanvasGradient) => {
      ctx.beginPath();
      ctx.moveTo(cx - Ri, cy + Ri + 2);
      for (let x = cx - Ri; x <= cx + Ri + 3; x += 3) ctx.lineTo(x, wave(x, ph, k, sp, a));
      ctx.lineTo(cx + Ri, cy + Ri + 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    // Back wave, then the main liquid.
    body(2.4, 0.032, -2.1, amp * 0.9, hexA(mixHex(color, "#000000", 0.25), 0.55));
    const g = ctx.createLinearGradient(0, surf - amp, 0, cy + Ri);
    g.addColorStop(0, mixHex(color, "#ffffff", 0.12));
    g.addColorStop(0.3, color);
    g.addColorStop(1, mixHex(color, "#000000", 0.62));
    body(0, 0.036, 2.6, amp, g);
    // Energy inside the liquid: slow bright caustic streaks and rising bubbles.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - Ri, cy + Ri + 2);
    for (let x = cx - Ri; x <= cx + Ri + 3; x += 3) ctx.lineTo(x, wave(x, 0, 0.036, 2.6, amp));
    ctx.lineTo(cx + Ri, cy + Ri + 2);
    ctx.closePath();
    ctx.clip();
    if (!reduce) {
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 3; k++) {
        const x = cx - Ri + ((t * (22 + k * 9) + k * 70) % (2 * Ri + 80)) - 40;
        const cg = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
        cg.addColorStop(0, "rgba(255,255,255,0)");
        cg.addColorStop(0.5, "rgba(255,255,255,0.1)");
        cg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = cg;
        ctx.fillRect(x - 30, surf - amp, 60, cy + Ri - surf + amp);
      }
      for (let b = 0; b < 22; b++) {
        const s = seeds[b];
        const p = (s.a + t * (0.1 + s.b * 0.18)) % 1;
        const by = cy + Ri - p * (h + amp);
        const bx = cx + (s.c * 2 - 1) * Ri * 0.8 + Math.sin(t * 2.2 + s.b * 7) * 2.5;
        ctx.fillStyle = `rgba(255,255,255,${(0.45 * Math.sin(p * Math.PI)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(bx, by, 0.8 + s.b * 1.3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    // The bright surface line.
    ctx.beginPath();
    for (let x = cx - Ri; x <= cx + Ri + 3; x += 3) {
      const y = wave(x, 0, 0.036, 2.6, amp);
      if (x === cx - Ri) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Splash: droplets thrown up while the liquid surges in.
    if (spawn && !reduce && t > 0 && t < 1.8 && Math.abs(vel) > 3 && sparks.length < 110) {
      const n = Math.min(5, 1 + Math.floor(Math.abs(vel) / 20));
      for (let k = 0; k < n; k++) {
        const x = cx + (Math.random() * 2 - 1) * Ri * 0.85;
        sparks.push({ x, y: wave(x, 0, 0.036, 2.6, amp), vx: (Math.random() * 2 - 1) * 70, vy: -90 - Math.random() * 200, life: 0, max: 0.6 + Math.random() * 0.6, r: 1 + Math.random() * 2 });
      }
    }
    // Idle: an occasional droplet so it never goes still.
    if (spawn && !reduce && t > 1.8 && Math.random() < 0.05) {
      const x = cx + (Math.random() * 2 - 1) * Ri * 0.6;
      sparks.push({ x, y: wave(x, 0, 0.036, 2.6, amp), vx: (Math.random() * 2 - 1) * 12, vy: -30 - Math.random() * 40, life: 0, max: 0.7, r: 0.9 + Math.random() });
    }
    stepSparks(ctx, sparks, t, color, 320);
  }
  // Impact: the glass lights up from inside as the liquid hits.
  if (on && !reduce && t > 0 && t < 1.6) {
    const k = Math.exp(-Math.pow((t - 0.35) / 0.3, 2));
    ctx.save();
    ctx.strokeStyle = hexA(color, 0.7 * k);
    ctx.lineWidth = 10;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(cx, cy, Ri + 3, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  // Inner shadow at the glass edge, inside the clip.
  const edge = ctx.createRadialGradient(cx, cy, Ri * 0.7, cx, cy, Ri);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = edge;
  ctx.fillRect(cx - Ri, cy - Ri, Ri * 2, Ri * 2);
  ctx.restore();

  // Glass highlight: a soft crescent up and to the left.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Ri, 0, TAU);
  ctx.clip();
  const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.55, 0, cx - R * 0.35, cy - R * 0.55, R * 0.55);
  hl.addColorStop(0, "rgba(255,255,255,0.16)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.35, cy - R * 0.55, R * 0.5, R * 0.26, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Rim: crisp, with a light that travels round it.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 0.75, 0, TAU);
  ctx.stroke();
  const rimA = reduce ? -2.3 : -2.3 + t * 0.5;
  const rim = ctx.createConicGradient(rimA, cx, cy);
  rim.addColorStop(0, "rgba(255,255,255,0)");
  rim.addColorStop(0.08, "rgba(255,255,255,0.85)");
  rim.addColorStop(0.2, "rgba(255,255,255,0)");
  rim.addColorStop(0.55, "rgba(255,255,255,0)");
  rim.addColorStop(0.62, hexA(color, 0.9));
  rim.addColorStop(0.72, "rgba(255,255,255,0)");
  rim.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 0.8, 0, TAU);
  ctx.stroke();
}

// ── Bar: a thick capsule filled left to right. The fill surges in with
// momentum, the front is a charged wave with sparks, energy flows inside.
const RIPPLES = [
  { y: 0.28, freq: 0.055, amp: 0.09, speed: 4.2, phase: 0.0, alpha: 0.13, width: 1.1 },
  { y: 0.44, freq: 0.038, amp: 0.13, speed: 2.7, phase: 1.9, alpha: 0.08, width: 0.8 },
  { y: 0.6, freq: 0.072, amp: 0.06, speed: 5.6, phase: 3.4, alpha: 0.15, width: 1.3 },
  { y: 0.74, freq: 0.047, amp: 0.1, speed: 3.3, phase: 5.1, alpha: 0.07, width: 0.7 },
];

function drawBar({ ctx, W, H, t, reduce, lvl, target, color, seeds, sparks, on, spawn }: MeterArgs) {
  const R = H / 2;
  // Track.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, R);
  const well = ctx.createLinearGradient(0, 0, 0, H);
  well.addColorStop(0, "#050506");
  well.addColorStop(1, "#141519");
  ctx.fillStyle = well;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  if (!on) return;
  const pad = 4;
  const ih = H - pad * 2;
  const iw = W - pad * 2;
  const vel = reduce ? 0 : springVel(t, target);
  const fw = Math.max(target > 0 ? ih * 0.9 : 0, (iw * Math.max(0, Math.min(104, lvl))) / 100);
  const x0 = pad;
  const x1 = pad + fw;
  const surge = reduce ? 0 : Math.min(1, Math.abs(vel) / 60);
  const amp = reduce ? 0 : 2 + 7 * surge + 3 * Math.exp(-t * 1.2);
  const front = (y: number) => {
    const u = (y - pad) / ih;
    const bow = Math.pow(u * 2 - 1, 2) * ih * 0.28;
    return x1 - bow + Math.sin(u * Math.PI * 2 + t * 7) * amp * 0.5 + Math.sin(u * Math.PI * 5 - t * 11) * amp * 0.2;
  };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, pad, iw, ih, ih / 2);
  ctx.clip();
  // Fill body.
  ctx.beginPath();
  ctx.moveTo(x0, pad);
  for (let k = 0; k <= 24; k++) {
    const y = pad + (ih * k) / 24;
    ctx.lineTo(front(y), y);
  }
  ctx.lineTo(x0, pad + ih);
  ctx.closePath();
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, mixHex(color, "#000000", 0.55));
  g.addColorStop(0.65, color);
  g.addColorStop(1, mixHex(color, "#ffffff", 0.25));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Energy flowing toward the front: bright pulses and fine ripples.
  if (!reduce) {
    ctx.globalCompositeOperation = "lighter";
    const band = 90;
    const shift = (t * (70 + surge * 200)) % band;
    for (let bx = x0 - band + shift; bx < x1 + band; bx += band) {
      const gb = ctx.createLinearGradient(bx, 0, bx + band, 0);
      gb.addColorStop(0, "rgba(255,255,255,0)");
      gb.addColorStop(0.7, "rgba(255,255,255,0.16)");
      gb.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gb;
      ctx.fillRect(bx, pad, band, ih);
    }
    // Four ripple lines, each with its own height, wave length, speed,
    // strength and weight, so they read as flowing energy, not a pattern.
    for (const L of RIPPLES) {
      ctx.strokeStyle = `rgba(255,255,255,${L.alpha})`;
      ctx.lineWidth = L.width;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 3) {
        const y =
          pad +
          ih * L.y +
          Math.sin(x * L.freq - t * L.speed + L.phase) * ih * L.amp +
          Math.sin(x * L.freq * 2.7 + t * L.speed * 0.6 + L.phase * 3) * ih * L.amp * 0.3;
        if (x === x0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let b = 0; b < 18; b++) {
      const s = seeds[b];
      const p = (s.a + t * (0.12 + s.b * 0.2)) % 1;
      const bx = x0 + p * fw;
      const by = pad + ih * (0.2 + 0.6 * s.c) + Math.sin(t * 3 + s.b * 6) * 2;
      ctx.fillStyle = `rgba(255,255,255,${(0.5 * p).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(bx, by, 0.7 + s.b, 0, TAU);
      ctx.fill();
    }
    // Random filaments: short glowing strands that appear somewhere new each
    // cycle, bend, drift toward the front and fade. Each has its own timing.
    for (let f = 0; f < 8; f++) {
      const s = seeds[20 + f];
      const period = 1.4 + s.a * 2.4;
      const cyc = Math.floor((t + s.b * period) / period);
      const ph = ((t + s.b * period) % period) / period;
      const h = (k: number) => hash01((cyc + 1) * (f + 3) + k * 17.31 + s.c * 91);
      const len = 10 + h(3) * Math.min(46, fw * 0.25);
      const cx = x0 + ih * 0.4 + h(1) * Math.max(0, fw - len - ih * 0.9) + ph * 14;
      const cy = pad + ih * (0.18 + 0.64 * h(2));
      const bend = (h(4) - 0.5) * ih * 0.5;
      const alpha = Math.sin(ph * Math.PI) * (0.18 + 0.32 * h(5));
      if (cx + len > x1 - 6) continue;
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 0.6 + h(6) * 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + len / 2, cy + bend, cx + len, cy + (h(7) - 0.5) * ih * 0.25);
      ctx.stroke();
    }
    // Twinkles: brief points of light at random spots, a new set each beat.
    for (let k = 0; k < 10; k++) {
      const s = seeds[40 + k];
      const period = 0.7 + s.a * 1.3;
      const cyc = Math.floor((t + s.b * period) / period);
      const ph = ((t + s.b * period) % period) / period;
      const tx = x0 + ih * 0.3 + hash01(cyc * 7.1 + k * 3.3 + s.c) * Math.max(0, fw - ih);
      const ty = pad + ih * (0.15 + 0.7 * hash01(cyc * 3.7 + k * 9.1 + s.a));
      if (tx > x1 - 6) continue;
      const a = Math.pow(Math.sin(ph * Math.PI), 3) * (0.35 + 0.5 * s.c);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 0.6 + s.b * 1.2, 0, TAU);
      ctx.fill();
    }
  }
  // Speed streak behind the front while it surges.
  if (!reduce && surge > 0.03) {
    const len = Math.min(fw, 60 + 260 * surge);
    const sg = ctx.createLinearGradient(x1 - len, 0, x1, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(1, `rgba(255,255,255,${(0.55 * surge).toFixed(3)})`);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = sg;
    ctx.fillRect(x1 - len, pad + ih * 0.2, len, ih * 0.6);
  }
  // Depth: gloss on top, shade at the bottom.
  ctx.globalCompositeOperation = "source-over";
  const shade = ctx.createLinearGradient(0, pad, 0, pad + ih);
  shade.addColorStop(0, "rgba(255,255,255,0.28)");
  shade.addColorStop(0.35, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = shade;
  ctx.fillRect(x0, pad, fw, ih);
  ctx.restore();
  // The charged front: white core with a hot glow.
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const y = pad + (ih * k) / 24;
    if (k === 0) ctx.moveTo(front(y), y);
    else ctx.lineTo(front(y), y);
  }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.2;
  ctx.shadowColor = "rgba(255,255,255,0.6)";
  ctx.shadowBlur = 3 + surge * 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
  const pulse = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * 6);
  // Head glow sits inside the fill, so no colour hangs past the front.
  const hg = ctx.createRadialGradient(x1 - ih * 0.3, H / 2, 0, x1 - ih * 0.3, H / 2, ih * 0.9);
  hg.addColorStop(0, hexA(color, 0.45 * pulse));
  hg.addColorStop(1, hexA(color, 0));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, pad);
  for (let k = 0; k <= 24; k++) {
    const y = pad + (ih * k) / 24;
    ctx.lineTo(front(y), y);
  }
  ctx.lineTo(x0, pad + ih);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = hg;
  ctx.fillRect(x1 - ih * 1.3, 0, ih * 1.3, H);
  ctx.restore();
  // A power pulse runs from the start to the front every few seconds, and
  // the front flares when it lands.
  if (!reduce && t > 1.6) {
    const cyc = (t - 1.6) % 3.2;
    if (cyc < 0.55) {
      const px = x0 + (cyc / 0.55) * Math.max(0, fw - ih * 0.6);
      const pg = ctx.createRadialGradient(px, H / 2, 0, px, H / 2, ih * 1.4);
      pg.addColorStop(0, "rgba(255,255,255,0.55)");
      pg.addColorStop(0.3, hexA(color, 0.35));
      pg.addColorStop(1, hexA(color, 0));
      // Clip to the fill itself (not the whole track), so the pulse ends at
      // the front edge instead of shining past it.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0, pad);
      for (let k = 0; k <= 24; k++) {
        const y = pad + (ih * k) / 24;
        ctx.lineTo(front(y) - 1, y);
      }
      ctx.lineTo(x0, pad + ih);
      ctx.closePath();
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = pg;
      ctx.fillRect(Math.max(x0, px - ih * 1.4), pad, ih * 2.8, ih);
      ctx.restore();
    } else if (spawn && cyc < 0.6 && sparks.length < 90) {
      for (let k = 0; k < 14; k++) {
        const y = pad + Math.random() * ih;
        // The flare stays on the front edge: born just behind it, flung
        // back and out, never shooting past the end of the fill.
        sparks.push({ x: front(y) - 2 - Math.random() * 4, y, vx: -90 + Math.random() * 85, vy: (Math.random() * 2 - 1) * 90, life: 0, max: 0.25 + Math.random() * 0.3, r: 0.8 + Math.random() * 1.3 });
      }
    }
  }
  // Sparks off the front, more while it is moving.
  if (!reduce) {
    const rate = spawn ? 0.3 + surge * 3 : 0;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    while (n-- > 0 && sparks.length < 70) {
      const y = pad + Math.random() * ih;
      sparks.push({ x: front(y) - 2, y, vx: Math.min(-5, -40 - Math.random() * 120 + surge * 60), vy: (Math.random() * 2 - 1) * 50, life: 0, max: 0.35 + Math.random() * 0.45, r: 0.7 + Math.random() * 1.2 });
    }
    stepSparks(ctx, sparks, t, color, 60);
  }
  ctx.restore();
}

function useNow(every: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), every);
    return () => clearInterval(t);
  }, [every]);
}

function resetText(w: Win) {
  if (!w.resetsAt) return w.minutes && w.minutes >= 10080 ? "Rolling 7 days" : w.minutes === 300 ? "Rolling 5 hours" : "";
  const ms = Date.parse(w.resetsAt) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 60_000) return "Resets now";
  const m = Math.floor(ms / 6e4);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `Resets in ${d}d ${h}h`;
  if (h > 0) return `Resets in ${h}h ${m % 60}m`;
  return `Resets in ${m}m`;
}

function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function statusOf(a: Agent): { text: string; tone: "live" | "known" | "off" | "preview"; title?: string } {
  if (a.source === "preview") return { text: "Preview", tone: "preview" };
  if (!a.windows.length) return { text: "Not connected", tone: "off" };
  if (a.source === "oauth-usage-api") return { text: "Live", tone: "live" };
  if (a.source === "claude-app") return { text: `Claude app, ${ago(a.asOf)}`, tone: "known", title: "Read from the Claude app's own record of your limits." };
  return { text: `Last Codex run, ${ago(a.asOf)}`, tone: "known", title: "OpenAI's own numbers from your newest Codex session." };
}

const hotIndex = (wins: Win[]) => (wins.length ? wins.reduce((best, w, i) => (w.pct > wins[best].pct ? i : best), 0) : -1);

const clamp = (v: number) => Math.max(0, Math.min(100, v));


const TAU = Math.PI * 2;
/** Stable pseudo-random 0..1 from a number (for per-cycle randomness). */
function hash01(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Shared canvas loop: sizes for the device, redraws on resize (a resize
 * clears a canvas), runs only while on screen, and draws one still frame
 * when the viewer prefers reduced motion.
 */
function useCanvas(
  ref: React.RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, reduce: boolean) => void,
  deps: unknown[],
  delay: number,
) {
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const began = performance.now() + delay;
    let W = 0;
    let H = 0;
    const paint = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      draw(ctx, W, H, (now - began) / 1000, reduce);
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      if (r.width === W && r.height === H && cv.width) return;
      W = r.width;
      H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      paint(performance.now());
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    if (reduce) return () => ro.disconnect();
    let raf = 0;
    let running = false;
    const loop = (now: number) => {
      paint(now);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!e.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

