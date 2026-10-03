// What the live voice shows while Jarvis talks about it: emails or a day's
// agenda. Lives in the voice strip (and in the Live pill on other pages).
import { ArrowUpRight, Bot, CalendarDays, Mail, X } from "lucide-react";
import { cancelPendingTask, closeLiveCard, confirmPendingTask, type LiveCard } from "./live-voice";
import "./live-card.css";

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
const when = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function LiveCardView({ card }: { card: LiveCard }) {
  if (card.type === "task")
    return (
      <div className="lcard" data-type="task" role="region" aria-label="Start this task?">
        <header>
          <Bot size={14} />
          <b>{card.agent === "hermes" ? "Send this to Hermes?" : `Start ${card.agent === "codex" ? "Codex" : card.agent === "claude" ? "Claude Code" : "an agent"} on this?`}</b>
          <button type="button" onClick={() => cancelPendingTask()} aria-label="Cancel" data-no-talk>
            <X size={13} />
          </button>
        </header>
        <p className="lcard-task">{card.prompt}</p>
        <div className="lcard-actions" data-no-talk>
          <button type="button" className="is-primary" onClick={confirmPendingTask}>
            Start
          </button>
          <button type="button" onClick={() => cancelPendingTask()}>
            Cancel
          </button>
          <small>or say “yes”</small>
        </div>
      </div>
    );
  return (
    <div className="lcard" data-type={card.type} role="region" aria-label={card.type === "email" ? "Emails" : "Agenda"}>
      <header>
        {card.type === "email" ? <Mail size={14} /> : <CalendarDays size={14} />}
        <b>{card.type === "email" ? (card.query ? `Email · ${card.query}` : "Latest email") : card.date === new Date().toLocaleDateString("en-CA") ? "Today" : new Date(`${card.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</b>
        <button type="button" onClick={closeLiveCard} aria-label="Close" data-no-talk>
          <X size={13} />
        </button>
      </header>
      {card.type === "email" ? (
        card.items.length ? (
          <ul>
            {card.items.map((m, i) => (
              <li key={i}>
                <div className="lcard-row">
                  <b>{m.from.replace(/<.*>/, "").trim() || m.from}</b>
                  <small>{when(m.date)}</small>
                </div>
                <p className="lcard-subject">{m.subject}</p>
                {m.snippet && <p className="lcard-snippet">{m.snippet}</p>}
                {m.link && (
                  <a href={m.link} target="_blank" rel="noopener noreferrer" data-no-talk>
                    Open in {m.provider === "outlook" ? "Outlook" : "Gmail"} <ArrowUpRight size={11} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="lcard-empty">No matching email in the imported mail.</p>
        )
      ) : card.events.length ? (
        <ul className="lcard-agenda">
          {card.events.map((e, i) => (
            <li key={i}>
              <span>{e.allDay ? "All day" : time(e.start)}</span>
              <b>{e.title}</b>
              {e.location && <small>{e.location}</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lcard-empty">Nothing on the saved calendar.</p>
      )}
    </div>
  );
}
