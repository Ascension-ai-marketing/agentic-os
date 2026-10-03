// The Hermes window in Chat: Hermes' face, what it is doing right now, and the
// list of actions it takes (commands, searches, pages, clicks). It opens by
// itself as soon as Hermes starts acting, and folds away once the answer is in.
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import hermesFace from "@/assets/hermes-face.png";
import "./hermes-window.css";

/** "💻 $ python3 …  0.1s" → icon "💻", text "python3 …", time "0.1s". */
export function splitAction(raw: string) {
  const m = raw.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
  const icon = m ? m[1] : "•";
  let text = (m ? m[2] : raw).replace(/^\$\s*/, "");
  const time = text.match(/\s(\d+(?:\.\d+)?s)(?:\s|$)/)?.[1];
  if (time) text = text.replace(new RegExp(`\\s${time.replace(".", "\\.")}(\\s|$)`), " ").trim();
  return { icon, text, time };
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function HermesWindow({ actions, working, startedAt, model }: { actions: string[]; working: boolean; startedAt?: number; model: string }) {
  const [open, setOpen] = useState(working && actions.length > 0);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLOListElement>(null);
  // Open by itself when Hermes starts acting; fold away when it is done.
  useEffect(() => {
    if (working && actions.length) setOpen(true);
  }, [working, actions.length]);
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [working]);
  useEffect(() => {
    const el = listRef.current;
    if (el && working) el.scrollTop = el.scrollHeight;
  }, [actions.length, working]);
  const status = working
    ? `${actions.length ? `${actions.length} ${actions.length === 1 ? "action" : "actions"} · ` : "Thinking · "}${startedAt ? elapsed(now - startedAt) : ""}`
    : `Done · ${actions.length} ${actions.length === 1 ? "action" : "actions"}`;
  return (
    <section className="hw" data-working={working || undefined} data-open={open || undefined} aria-label="Hermes Agent">
      <button type="button" className="hw-head" onClick={() => actions.length && setOpen((o) => !o)} aria-expanded={open} disabled={!actions.length}>
        <span className="hw-face">
          <img src={hermesFace} alt="" />
          {working && <i className="hw-ring" aria-hidden="true" />}
        </span>
        <span className="hw-title">
          <b>Hermes</b>
          <small>{model}</small>
        </span>
        <span className="hw-status" aria-live="polite">
          {working && <i className="hw-pulse" aria-hidden="true" />}
          {status}
        </span>
        {actions.length > 0 && <ChevronDown size={14} className="hw-chevron" aria-hidden="true" />}
      </button>
      {open && actions.length > 0 && (
        <ol className="hw-actions" ref={listRef}>
          {actions.map((raw, i) => {
            const a = splitAction(raw);
            return (
              <li key={i} data-latest={working && i === actions.length - 1 ? "" : undefined}>
                <span className="hw-icon" aria-hidden="true">{a.icon}</span>
                <span className="hw-text" title={a.text}>{a.text}</span>
                {a.time && <span className="hw-time">{a.time}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
