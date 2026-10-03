// The right panel on Live. Top: what Jev adds to voice, the lane it picked for
// your last request, with odds, time and cost. Then the voice that speaks
// (Jarvis by default, your picks from the Fish library, or your own clone),
// the speed, and an optional switch to let Jev pick the voice too.
import { FishSignup } from "./fish-signup";
import { useEffect } from "react";
import { Pause, Play, Sparkles } from "lucide-react";
import { JevMark, fmtMs, fmtUsd } from "./jev-card";
import { JEV_SAMPLES } from "./jev-samples";
import { TIER_NAME } from "./voice-orb";
import { loadVoices, previewVoice, setSpeed, setVoice, setVoiceMode, stopOutput, useVoice } from "./voice-store";
import "./voice-cast.css";

const TONE_WORD: Record<string, string> = {
  calm: "calm",
  happy: "happy",
  excited: "excited",
  confident: "confident",
  empathetic: "caring",
  curious: "curious",
  surprised: "surprised",
  satisfied: "pleased",
};

export function VoiceCast() {
  const v = useVoice();
  useEffect(() => {
    loadVoices();
  }, []);
  const auto = v.voiceMode === "auto";
  const last = v.history.find((t) => t.result?.cast);
  return (
    <section className="vcast" aria-label="Voice cast">
      <header className="vcast-head">
        <span className="vcast-eyebrow">Voice · Jev + Fish Audio</span>
        <FishSignup compact />
        {v.speakingAs && (
          <span className="vcast-now">
            <i /> {v.speakingAs.name}
            {v.speakingAs.tone ? ` · ${TONE_WORD[v.speakingAs.tone] ?? v.speakingAs.tone}` : ""}
          </span>
        )}
      </header>

      <JevLane />

      {v.voices.length === 0 ? (
        <p className="vcast-empty">{v.engine === "missing" ? "The voice engine is not running on this server." : "Loading voices…"}</p>
      ) : (
        <ul className="vcast-list">
          {v.voices.map((o) => {
            const chosen = !auto && v.voiceId === o.id;
            const playing = v.previewing === o.id;
            return (
              <li key={o.id} data-chosen={chosen || undefined} data-self={o.kind === "self" || undefined}>
                <button
                  type="button"
                  className="vcast-play"
                  aria-label={playing ? `Stop ${o.name}` : `Hear ${o.name}`}
                  onClick={() => (playing ? stopOutput() : void previewVoice(o))}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button type="button" className="vcast-pick" onClick={() => setVoice(o.id)} aria-pressed={chosen}>
                  <b>{o.kind === "self" ? "Your voice" : o.name}</b>
                  <small>{o.kind === "self" ? "Your Fish Audio clone" : o.persona}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <label className="vcast-speed" htmlFor="vcast-speed-input">
        <span>Speed</span>
        <input
          id="vcast-speed-input"
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={v.speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <b>{v.speed.toFixed(2)}×</b>
      </label>

      <button type="button" className="vcast-auto" aria-pressed={auto} onClick={() => setVoiceMode(auto ? "fixed" : "auto")}>
        <span className="vcast-auto-text">
          <b>Let Jev pick the voice</b>
          <small>Optional. Jev casts a voice and a mood for each reply, in the same call that picks the lane.</small>
        </span>
        <span className="vcast-switch" aria-hidden="true">
          <i />
        </span>
      </button>
      {auto && last?.result?.cast && (
        <p className="vcast-last">
          <Sparkles size={12} /> Last reply: <b>{last.result.cast.voiceName}</b>, {TONE_WORD[last.result.cast.tone] ?? last.result.cast.tone}
        </p>
      )}
    </section>
  );
}

/** Jev's real job in voice: pick the cheapest lane that can do the request. */
function JevLane() {
  const v = useVoice();
  const turn = v.history.find((t) => t.result);
  const d = turn?.result?.decision ?? JEV_SAMPLES.find((x) => x.id === "sample-voice2");
  if (!d) return null;
  const tier = d.answers.tier;
  const p = tier?.type === "choice" ? tier.probabilities : {};
  const count = v.history.filter((t) => t.result).length;
  return (
    <div className="vlane">
      <div className="vlane-head">
        <span className="vlane-mark">
          <JevMark size={15} />
        </span>
        <span>
          <b>Jev picks the lane</b>
          <small>{turn ? `“${turn.text}”` : "Sample decision"}</small>
        </span>
      </div>
      <ul className="vlane-bars">
        {(["tier-1", "tier-2", "tier-3"] as const).map((id) => {
          const pct = Math.round((p[id] ?? 0) * 100);
          return (
            <li key={id} data-picked={d.picked === id || undefined}>
              <span>{TIER_NAME[id]}</span>
              <i style={{ ["--w" as string]: `${pct}%` }} />
              <b>{pct}%</b>
            </li>
          );
        })}
      </ul>
      <p className="vlane-foot">
        {fmtMs(d.ms)} · {fmtUsd(d.costUsd)}
        {count > 0 ? ` · ${count} routed this session` : ""}
      </p>
      <p className="vlane-note">Instant needs no AI. Quick answer uses a small model. Real work starts Claude Code or Codex, and asks first when Jev is under 80% sure.</p>
    </div>
  );
}
