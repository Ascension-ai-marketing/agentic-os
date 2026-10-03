// Voice mode inside Chat. One conversation, two ways in: type below, or tap
// the orb up here and talk. The strip shows the orb in its nebula, what it is
// doing now, Mute / Pause / Stop, and the few settings voice needs. Every
// spoken turn lands in the chat transcript underneath (see floating-oracle).
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mic, Play, Square, Volume2, VolumeX } from "lucide-react";
import { OrbBackdrop } from "./orb-backdrop";
import { HybridOrb, TIER_NAME, VOICE_STATUS, talkFrom, usePointerAura } from "./voice-orb";
import { loadVoices, previewVoice, setMuted, setSpeed, setVoice, stopAll, togglePause, useVoice, voiceLevel, type VoiceTurn } from "./voice-store";
import { fmtMs, fmtUsd, JevMark } from "./jev-card";
import "./chat-voice.css";
import { FishSignup } from "./fish-signup";
import { LiveCardView } from "./live-card";
import { PersonalityControl } from "./personality-control";
import { SpeedDial } from "./voice-dials";
import { checkLiveVoice, setLiveMicMuted, startLive, stopLive, useLiveVoice } from "./live-voice";
import type { OrbMood } from "./voice-orb-canvas";

/** The label a spoken reply carries in the chat transcript. */
export function voiceVia(t: VoiceTurn) {
  const r = t.result;
  if (!r) return "Voice";
  const voice = r.cast?.voiceName;
  // Handled by the local gate: no Jev call, just the model that answered.
  if (!r.decision) return r.workerLabel ? `${r.workerLabel}${voice ? ` · ${voice}` : ""}` : "Voice";
  const tier = r.decision.answers.tier;
  const pct = tier?.type === "choice" ? Math.round((tier.probabilities[r.decision.picked] ?? 0) * 100) : null;
  // A quick answer names the model Jev picked for it, e.g. "Jev · Sonnet 5 · Jarvis".
  if (r.workerLabel) return `Jev · ${r.workerLabel}${voice ? ` · ${voice}` : ""}`;
  return `Jev: ${TIER_NAME[r.decision.picked] ?? r.tier}${pct !== null ? ` ${pct}%` : ""}${voice ? ` · ${voice}` : ""}`;
}

export function ChatVoiceStrip() {
  const v = useVoice();
  useEffect(() => {
    if (!v.voices.length) loadVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = useLiveVoice();
  useEffect(() => {
    if (live.configured === undefined) void checkLiveVoice();
  }, [live.configured]);
  const [micOff, setMicOff] = useState(false);
  const hostRef = useRef<HTMLElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const { pointer, onPointerMove, onPointerLeave } = usePointerAura();
  // One voice mode: OpenAI Realtime listens and thinks, Fish (Jarvis) speaks.
  const mood: OrbMood = live.phase === "off" ? (live.error ? "error" : "idle") : live.phase === "connecting" ? "thinking" : live.phase;
  const caption =
    live.phase === "off"
      ? live.error ?? "Tap the orb once and just talk. It keeps listening, and you can interrupt it any time."
      : live.phase === "connecting"
        ? "Connecting…"
        : live.phase === "listening" && live.heard
          ? `“${live.heard.trim()}”`
          : live.caption || (live.phase === "listening" ? "Listening. Just talk." : live.heard ? `“${live.heard.trim()}”` : "");
  return (
    <section
      ref={hostRef}
      className="cv"
      data-mood={mood}
      data-live={live.phase !== "off" ? "" : undefined}
      aria-label="Voice mode"
      onPointerMove={(e) => onPointerMove(e, orbRef.current)}
      onPointerLeave={() => onPointerLeave(orbRef.current)}
    >
      <OrbBackdrop variant="nebula" mood={mood} levelRef={voiceLevel} pointerRef={pointer} orbSize={120} centerY={0.5} centerX={0.08} drift={1} />
      <button
        ref={orbRef}
        type="button"
        className="live-orb cv-orb"
        onClick={() => (live.phase === "off" ? void startLive() : stopLive())}
        aria-label={live.phase === "off" ? "Start a live conversation" : "End the conversation"}
      >
        <HybridOrb mood={mood} pointerRef={pointer} size={120} />
      </button>

      <div className="cv-now" aria-live="polite">
        <span className="cv-status">{live.phase === "listening" ? "Live · Listening" : live.phase === "speaking" ? "Live · Jarvis speaking" : "Live voice"}</span>
        <p className="cv-caption" data-quiet={mood === "idle" || undefined}>
          {caption}
        </p>
        <div className="cv-controls" data-no-talk>
          <button type="button" onClick={() => (live.phase === "off" ? void startLive() : stopLive())} className={live.phase === "off" ? "is-primary" : undefined}>
            {live.phase === "off" ? <Play size={14} /> : <Square size={12} />}
            {live.phase === "off" ? "Start talking" : "End"}
          </button>
          <button type="button" disabled={live.phase === "off"} aria-pressed={micOff} onClick={() => { setLiveMicMuted(!micOff); setMicOff(!micOff); }}>
            <Mic size={14} />
            {micOff ? "Mic off" : "Mic on"}
          </button>
          <button type="button" onClick={() => setMuted(!v.muted)} aria-pressed={v.muted} className={v.muted ? "is-warn" : undefined}>
            {v.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {v.muted ? "Muted, tap to hear replies" : "Sound on"}
          </button>
          {live.firstAudioMs !== undefined && <span className="cv-latency" title="From the end of your words to the first sound of the reply">{fmtMs(live.firstAudioMs)} to reply</span>}
        </div>
      </div>

      {live.card && (
        <div className="cv-card" data-no-talk>
          <LiveCardView card={live.card} />
        </div>
      )}
      <div className="cv-side" data-no-talk>
        {(live.recent?.length ?? 0) > 0 && (
          <ol className="cv-recent" aria-label="This conversation">
            {live.recent!.map((l, i, all) => (
              <li key={l.id} data-role={l.role} style={{ opacity: 0.4 + (0.6 * (i + 1)) / all.length }}>
                {l.role === "user" ? `You: ${l.text}` : l.role === "action" ? `✓ ${l.text}` : l.text}
              </li>
            ))}
          </ol>
        )}
        {live.taskChat && (
          <Link to="/chat" className="cv-taskchat" title={live.taskChat}>
            Opened task chat · {live.taskChat}
          </Link>
        )}
      </div>

      <div className="cv-settings" data-no-talk>
        <label className="cv-voicepick">
          <span>Voice</span>
          <select value={v.voiceId} onChange={(e) => setVoice(e.target.value)} disabled={!v.voices.length} aria-label="Jarvis's voice">
            {!v.voices.length && <option>Loading voices…</option>}
            {v.voices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cv-preview"
            aria-label="Hear this voice"
            title="Hear this voice"
            onClick={() => {
              const o = v.voices.find((x) => x.id === v.voiceId);
              if (o) void previewVoice(o);
            }}
          >
            ▶
          </button>
        </label>
        <SpeedDial value={v.speed} onChange={setSpeed} />
        <PersonalityControl />
        <FishSignup compact />
      </div>
    </section>
  );
}
