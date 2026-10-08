// Voice lives in the sidebar, between Memory and Tools: an orb in a small
// galaxy. Tap it to talk. The corner button opens the Live page, where every
// agent the OS starts gets its own terminal tab.
import { activateVoice, stopLive, useLiveVoice } from "./live-voice";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Ear, EarOff, Maximize2, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { ORB_PALETTES, VoiceOrbCanvas, type OrbMood } from "./voice-orb-canvas";
import type { MutableRefObject } from "react";
import type { PointerState } from "./star-field";
import { OrbBackdrop } from "./orb-backdrop";
import RbOrb from "./rb/Orb";
import { setMuted, setVoiceNavigator, stopAll, tapOrb, togglePause, useVoice, voiceLevel } from "./voice-store";
import { stopCeoVoice, useCeoVoice } from "./ceo-voice";
import { setWakeEnabled, useWakeWord } from "./wake-word";
import { WAKE_LABEL } from "@/lib/wake-word";
import "./voice-dock.css";

export const VOICE_STATUS: Record<OrbMood, string> = {
  idle: "",
  listening: "Listening",
  thinking: "Thinking",
  working: "An agent is working",
  speaking: "Speaking",
  error: "Didn't catch that",
};
export const TIER_NAME: Record<string, string> = { "tier-1": "Instant", "tier-2": "Quick answer", "tier-3": "Real work" };

/** Tracks the pointer relative to an element's centre in -1..1 (y down). */
export function usePointerAura() {
  const pointer = useRef<PointerState>({ x: 0, y: 0, active: 0 });
  const onPointerMove = (e: PointerEvent<HTMLElement>, target: HTMLElement | null) => {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const x = Math.max(-1.4, Math.min(1.4, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    const y = Math.max(-1.4, Math.min(1.4, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    pointer.current = { x, y, active: 1 };
    target.style.setProperty("--px", x.toFixed(3));
    target.style.setProperty("--py", y.toFixed(3));
  };
  const onPointerLeave = (target: HTMLElement | null) => {
    pointer.current = { ...pointer.current, active: 0 };
    target?.style.setProperty("--px", "0");
    target?.style.setProperty("--py", "0");
  };
  return { pointer, onPointerMove, onPointerLeave };
}

/** Touch to talk: a tap on the surface starts listening, with a ripple from
 *  the touch point. Links, inputs and other buttons keep their own job. */
export function talkFrom(e: MouseEvent<HTMLElement>, host: HTMLElement | null, orb: HTMLElement | null, act: () => void = tapOrb) {
  const hit = e.target as Element;
  if (!host || hit.closest("a, input, textarea, select, [data-no-talk]")) return;
  const button = hit.closest("button");
  if (button && button !== orb) return;
  const r = host.getBoundingClientRect();
  let x = e.clientX - r.left;
  let y = e.clientY - r.top;
  // Keyboard presses have no pointer, so the ripple starts at the orb.
  if (e.detail === 0 && orb) {
    const o = orb.getBoundingClientRect();
    x = o.left + o.width / 2 - r.left;
    y = o.top + o.height / 2 - r.top;
  }
  const ripple = document.createElement("span");
  ripple.className = "vo-touch";
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.style.setProperty("--reach", `${Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2}px`);
  ripple.addEventListener("animationend", () => ripple.remove());
  host.appendChild(ripple);
  act();
}

export function VoiceDock() {
  const v = useVoice();
  const router = useRouter();
  const orbRef = useRef<HTMLButtonElement>(null);
  const { pointer, onPointerMove, onPointerLeave } = usePointerAura();
  useEffect(() => {
    setVoiceNavigator((to) => void router.navigate({ href: to }));
    // Mic buttons across the OS send "operator:voice": start the live conversation.
    const openVoice = () => activateVoice((href) => void router.navigate({ href }));
    window.addEventListener("operator:voice", openVoice);
    return () => {
      setVoiceNavigator(null);
      window.removeEventListener("operator:voice", openVoice);
    };
  }, [router]);
  const last = v.history[0];
  const live = useLiveVoice();
  const liveActive = live.phase !== "off";
  const listening = v.mood === "listening";
  // The Jarvis conversation the word "Jarvis" opens, and whether the page is listening for that word.
  const jarvis = useCeoVoice();
  const jarvisOn = jarvis.phase !== "off";
  const wake = useWakeWord();
  return (
    <div
      className="vd"
      data-mood={v.mood}
      data-wake={wake.status === "listening" ? "on" : undefined}
      onClick={(e) => talkFrom(e, e.currentTarget, orbRef.current, () => (jarvisOn ? stopCeoVoice() : activateVoice((href) => void router.navigate({ href }))))}
      onPointerMove={(e) => onPointerMove(e, orbRef.current)}
      onPointerLeave={() => onPointerLeave(orbRef.current)}
    >
      <OrbBackdrop variant="nebula" mood={v.mood} levelRef={voiceLevel} pointerRef={pointer} orbSize={108} centerY={0.5} />
      <Link
        to="/chat"
        search={{ talk: 1 } as never}
        className="vd-expand"
        aria-label="Open voice mode in Chat"
        title="Open voice mode"
      >
        <Maximize2 size={13} />
      </Link>
      <button ref={orbRef} type="button" className="vd-orb" aria-label={liveActive || jarvisOn ? "End the conversation" : listening ? "Stop listening" : "Talk to your OS"}>
        <span className="vd-ripples" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <HybridOrb mood={v.mood} pointerRef={pointer} size={108} />
      </button>
      <div className="vd-text" aria-live="polite">
        {jarvisOn ? (
          <>
            <b>Jarvis{jarvis.phase === "connecting" ? " · Connecting" : jarvis.phase === "listening" ? " · Listening" : " · Speaking"}</b>
            {jarvis.caption && <span className="vd-caption">{jarvis.caption}</span>}
          </>
        ) : liveActive ? (
          <>
            <b>Live{live.phase === "listening" ? " · Listening" : live.phase === "speaking" ? " · Speaking" : ""}</b>
            {live.phase === "listening" && live.heard ? <span>“{live.heard.trim()}”</span> : live.caption ? <span className="vd-caption">{live.caption}</span> : null}
          </>
        ) : (
          <>
            {v.mood !== "idle" && <b>{v.mood === "speaking" && v.speakingAs ? `${v.speakingAs.name}${v.speakingAs.tone ? ` · ${v.speakingAs.tone}` : ""}` : VOICE_STATUS[v.mood]}</b>}
            {listening && v.interim && <span>“{v.interim}”</span>}
            {v.mood === "error" && <span>Tap to try again</span>}
            {v.mood === "speaking" && last?.result?.replyText && <span className="vd-caption">{last.result.replyText}</span>}
            {v.mood === "idle" && (jarvis.error || wake.error) ? <span className="vd-wake" data-error>{jarvis.error || wake.error}</span> : v.mood === "idle" && WAKE_LABEL[wake.status] ? <span className="vd-wake">{WAKE_LABEL[wake.status]}</span> : null}
          </>
        )}
      </div>
      <div className="vd-controls" data-no-talk>
        <button type="button" onClick={() => setMuted(!v.muted)} aria-pressed={v.muted} aria-label={v.muted ? "Unmute replies" : "Mute replies"} title={v.muted ? "Muted: replies show as text" : "Mute replies"}>
          {v.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <button type="button" onClick={togglePause} disabled={v.mood !== "speaking"} aria-pressed={v.paused} aria-label={v.paused ? "Resume reply" : "Pause reply"} title={v.paused ? "Resume" : "Pause"}>
          {v.paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button type="button" onClick={() => (jarvisOn ? stopCeoVoice() : liveActive ? stopLive() : stopAll())} disabled={!jarvisOn && !liveActive && (v.mood === "idle" || v.mood === "error")} aria-label="Stop" title="Stop listening or speaking">
          <Square size={11} />
        </button>
        <button type="button" onClick={() => setWakeEnabled(!wake.enabled)} aria-pressed={wake.enabled} aria-label={wake.enabled ? "Stop listening for the word Jarvis" : "Listen for the word Jarvis"} title={wake.error ? `${wake.error}. Add PICOVOICE_ACCESS_KEY to ~/.config/agentic-os.env (free at console.picovoice.ai), then switch this on again.` : wake.enabled ? "Listening for “Jarvis” on this computer. Click to switch off." : "Wake Jarvis by saying “Jarvis”. Heard on this computer only."}>
          {wake.enabled ? <Ear size={13} /> : <EarOff size={13} />}
        </button>
      </div>
    </div>
  );
}

// The ring takes the marble's own colours for each state, so marble and ring
// read as one object: the ring's two light colours are the marble's mid and
// highlight, its deep colour is the marble's shadow.
function ringColors(mood: OrbMood): number[][] {
  const [dark, mid, light] = ORB_PALETTES[mood].c;
  return [mid, mid.map((v, i) => v + (light[i] - v) * 0.45), dark.map((v) => v * 1.6)];
}

/** Plasma marble at rest; when active the halo ring blooms around it and the
 *  marble becomes the core that fills the ring's hole. The ring's outer edge
 *  matches the resting marble, so it reads as one object of one size. */
export function HybridOrb({ mood, size, pointerRef }: { mood: OrbMood; size: number; pointerRef: MutableRefObject<PointerState> }) {
  const active = mood !== "idle" && mood !== "error";
  const halo = Math.round(size * 0.84);
  // The ring is its own WebGL canvas. Mount it only while it can be seen, so
  // idle orbs do not hold extra GPU contexts (too many freeze the others).
  const [ring, setRing] = useState(active || mood === "error");
  useEffect(() => {
    if (active || mood === "error") return setRing(true);
    const t = window.setTimeout(() => setRing(false), 1200);
    return () => window.clearTimeout(t);
  }, [active, mood]);
  return (
    <span className="hy-orb" data-active={active || undefined} data-mood={mood} style={{ width: size, height: size }}>
      <span className="hy-orbit" aria-hidden="true" />
      <span className="hy-halo" style={{ width: halo, height: halo }}>
        {ring && <RbOrb colors={ringColors(mood)} hoverIntensity={0.28} rotateOnHover forceHoverState={mood === "listening" || mood === "speaking"} backgroundColor="#07060c" levelRef={voiceLevel} />}
      </span>
      <span className="hy-marble">
        <VoiceOrbCanvas mood={mood} levelRef={voiceLevel} pointerRef={pointerRef} size={size} />
      </span>
    </span>
  );
}
