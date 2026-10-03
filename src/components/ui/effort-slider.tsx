import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** Discrete native effort values, presented as a continuous-feeling control. */
export function EffortSlider({ levels, value, onChange, disabled }: {
  levels: string[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const id = useId();
  const index = Math.max(0, levels.indexOf(value));
  const power = index / Math.max(1, levels.length - 1);
  const maxEffort = levels.length > 1 && index === levels.length - 1;
  const pixels = Array.from({ length: 336 }, (_, i) => {
    const column = i % 56, row = Math.floor(i / 56);
    const noise = ((i * 73 + row * 19) % 101) / 100;
    return { x: column * 5, y: row * 5, active: column / 55 <= .08 + power * .92 && noise < .18 + power * .82, opacity: (.24 + noise * .76) * (.3 + column / 55 * .7), phase: -column / 55 * 2.4 - row * .08 };
  });
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const theme = getComputedStyle(anchor.current);
      const width = Math.min(320, window.innerWidth - 24);
      const variables = Object.fromEntries(["--op-bg", "--op-panel", "--op-ink", "--op-muted", "--op-border", "--op-accent"].map(key => [key, theme.getPropertyValue(key)]));
      setStyle({ ...variables, position: "fixed", width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), bottom: Math.max(12, window.innerHeight - rect.top + 12), zIndex: 10000 });
    };
    const outside = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false); };
    const keyboard = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); anchor.current?.focus(); } };
    position();
    range.current?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard); };
  }, [open]);
  return <>
    <button ref={anchor} type="button" className="agentic-effort-trigger" disabled={disabled || levels.length < 2}
      aria-label={`Reasoning effort: ${value}`} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={e => { e.stopPropagation(); setOpen(!open); }}>
      <span className="agentic-effort-bars" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} data-lit={i <= index} />)}</span>
      <span>{value}</span>
    </button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label="Adjust reasoning effort" className="agentic-effort-popover" data-effort-level={index} data-max-effort={maxEffort} style={{ ...style, "--effort-power": power } as CSSProperties} onClick={e => e.stopPropagation()}>
      <div className="agentic-effort-heading"><span>Effort</span><strong>{value}</strong><span title="Higher effort can take longer." aria-label="Higher effort can take longer." className="agentic-effort-help">?</span></div>
      <div className="agentic-effort-endpoints"><span>Faster</span><span>Smarter</span></div>
      <div className="agentic-effort-track" style={{ "--effort-progress": `${index / Math.max(1, levels.length - 1) * 100}%` } as CSSProperties}>
        <div className="agentic-effort-energy" aria-hidden="true" />
        <svg className="agentic-effort-pixel-field" viewBox="0 0 280 30" preserveAspectRatio="none" aria-hidden="true">
          {pixels.map((pixel, i) => <rect key={i} x={pixel.x} y={pixel.y} width="3.6" height="3.6" rx=".7" className={pixel.active ? "is-active" : ""}
            style={{ "--pixel-opacity": pixel.opacity, "--pixel-delay": `${pixel.phase}s` } as CSSProperties} />)}
        </svg>
        <div className="agentic-effort-stops" aria-hidden="true">{levels.map(level => <i key={level} />)}</div>
        <input ref={range} type="range" min={0} max={levels.length - 1} step={1} value={index} aria-label="Reasoning effort" aria-valuetext={value}
          onChange={e => onChange(levels[Number(e.target.value)])} />
      </div>
    </div>, document.body)}
  </>;
}
