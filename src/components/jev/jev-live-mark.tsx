// The Jev mark, alive. Idle it breathes; thinking, a spark runs round the
// hexagon and rings pulse out; done, the J redraws and the mark flashes.
// Motion is CSS only and switches off under prefers-reduced-motion.
import { useId } from "react";
import "./jev-live-mark.css";

export type JevMood = "idle" | "thinking" | "done";

export function JevLiveMark({ size = 44, mood = "idle" }: { size?: number; mood?: JevMood }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="jlm" data-mood={mood} style={{ width: size, height: size }} aria-hidden="true">
      <span className="jlm-ring" />
      <span className="jlm-ring jlm-ring-2" />
      <svg viewBox="0 0 48 48" width={size} height={size}>
        <defs>
          <linearGradient id={`jlm-g-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F386A1" />
            <stop offset="1" stopColor="#D45BB6" />
          </linearGradient>
          <radialGradient id={`jlm-f-${id}`} cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#D45BB6" stopOpacity="0.38" />
            <stop offset="1" stopColor="#D45BB6" stopOpacity="0.04" />
          </radialGradient>
        </defs>
        <path className="jlm-hex-fill" d="M24 4.5 40.9 14.25v19.5L24 43.5 7.1 33.75v-19.5Z" fill={`url(#jlm-f-${id})`} />
        <path className="jlm-hex" d="M24 4.5 40.9 14.25v19.5L24 43.5 7.1 33.75v-19.5Z" fill="none" stroke={`url(#jlm-g-${id})`} strokeWidth="2.6" strokeLinejoin="round" />
        <path className="jlm-spark" pathLength={100} d="M24 4.5 40.9 14.25v19.5L24 43.5 7.1 33.75v-19.5Z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <path className="jlm-j" pathLength={100} d="M25.8 15.5v12.6a4.9 4.9 0 0 1-8.8 3" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
