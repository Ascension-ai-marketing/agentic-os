// Speed and humour controls for the voice strip. Both animate to their new
// value, and glow for a moment when the value changes from somewhere else
// (you asked Jarvis by voice), so you see the change happen.
import { useEffect, useRef, useState } from "react";
import { HUMOUR_LEVELS, type Humour } from "@/lib/jev-personality";
import "./voice-dials.css";

/** True for ~1.4 s after `value` changes without a click or drag on this control. */
function useBump<T>(value: T) {
  const local = useRef(false);
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    if (local.current) {
      local.current = false;
      return;
    }
    setBump((b) => b + 1);
  }, [value]);
  return { bump, markLocal: () => (local.current = true) };
}

export function SpeedDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { bump, markLocal } = useBump(value);
  const pct = ((value - 0.5) / 1.5) * 100;
  return (
    <div className="vdl" data-bump={bump || undefined}>
      {bump > 0 && <span className="vdl-glow" key={bump} aria-hidden="true" />}
      <span className="vdl-label">Speed</span>
      <div className="vdl-track is-speed">
        <i className="vdl-fill" style={{ width: `${pct}%` }} />
        <i className="vdl-ticks" aria-hidden="true">{[0.5, 1, 1.5, 2].map((t) => <b key={t} style={{ left: `${((t - 0.5) / 1.5) * 100}%` }} />)}</i>
        <i className="vdl-knob" style={{ left: `${pct}%` }} />
        <input type="range" min={0.5} max={2} step={0.05} value={value} aria-label="Speaking speed" onChange={(e) => { markLocal(); onChange(Number(e.target.value)); }} />
      </div>
      <b className="vdl-value" key={value}>{value.toFixed(2)}×</b>
    </div>
  );
}

export function HumourDial({ value, onChange }: { value: Humour; onChange: (v: Humour) => void }) {
  const { bump, markLocal } = useBump(value);
  const at = Math.max(0, HUMOUR_LEVELS.findIndex((h) => h.id === value));
  return (
    <div className="vdl" data-bump={bump || undefined}>
      {bump > 0 && <span className="vdl-glow" key={bump} aria-hidden="true" />}
      <span className="vdl-label">Humour</span>
      <div className="vdl-steps" role="radiogroup" aria-label="Humour">
        {HUMOUR_LEVELS.map((h, i) => (
          <button key={h.id} type="button" role="radio" aria-checked={i === at} aria-label={h.label} data-on={i <= at || undefined} style={{ ["--i" as string]: i }} onClick={() => { markLocal(); onChange(h.id); }}>
            <i />
          </button>
        ))}
      </div>
      <b className="vdl-value is-word" key={value}>{HUMOUR_LEVELS[at].label}</b>
    </div>
  );
}
