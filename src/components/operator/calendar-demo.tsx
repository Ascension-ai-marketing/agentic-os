import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, EyeOff, MapPin, Users } from "lucide-react";
import { localDay } from "@/lib/operator";
import { Empty, Modal, Panel } from "./ui";

export const CALENDAR_DEMO_KEY = "agentic-os:calendar-demo";

// Deliberately accepts no calendar data and never calls a provider or write endpoint.
export function CalendarDemo({ onExit }: { onExit: () => void }) {
  const [booking] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return { day: localDay(date), title: "Project planning", time: "10:30", end: "11:00" };
  });
  const [day, setDay] = useState(booking.day);
  const [month, setMonth] = useState(() => {
    const date = new Date(`${booking.day}T12:00:00`);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [open, setOpen] = useState(false);
  const today = localDay(new Date());
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((offset + days) / 7) * 7 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1),
  );
  function showBooking() {
    const date = new Date(`${booking.day}T12:00:00`);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setDay(booking.day);
  }
  return (
    <div className="op-page" data-calendar-demo="true">
      <header className="ar-page-title">
        <div>
          <h1>Calendar</h1>
          <p>A little space for what matters.</p>
        </div>
        <div className="ar-page-actions">
          <span className="op-pill">
            <EyeOff size={13} /> Demo calendar
          </span>
          <button className="op-button" onClick={onExit}>
            Show my real calendar
          </button>
        </div>
      </header>
      <div className="ar-calendar-sync">
        <EyeOff size={18} className="op-muted" />
        <div className="ar-calendar-sync-copy">
          <strong>Your real schedule is hidden</strong>
          <small>Fictional booking for your demo. No invitations sent.</small>
        </div>
      </div>
      <div className="op-calendar-layout ar-calendar-layout">
        <div>
          <Panel className="op-calendar-panel">
            <div className="op-calendar-toolbar">
              <h2>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2>
              <div>
                <button className="op-button quiet" onClick={showBooking}>
                  Next event
                </button>
                <button
                  className="op-button quiet"
                  onClick={() => {
                    const date = new Date();
                    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                    setDay(today);
                  }}
                >
                  Today
                </button>
                <button
                  className="op-icon-button"
                  aria-label="Previous month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="op-icon-button"
                  aria-label="Next month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="op-weekdays">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="op-month-grid">
              {cells.map((date) => {
                const key = localDay(date);
                const hasBooking = key === booking.day;
                return (
                  <button
                    key={key}
                    className={`op-calendar-day ${key === day ? "selected" : ""} ${key === today ? "today" : ""} ${date.getMonth() !== month.getMonth() ? "outside" : ""}`}
                    aria-label={`${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, ${hasBooking ? 1 : 0} events`}
                    aria-pressed={key === day}
                    onClick={() => setDay(key)}
                  >
                    <span>{date.getDate()}</span>
                    {hasBooking && (
                      <div className="op-calendar-event">
                        {booking.time} {booking.title}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Panel>
          <p className="op-form-help" style={{ padding: "12px 3px" }}>
            Demo stays on in this browser until you choose to show your real calendar. Times are
            local.
          </p>
        </div>
        <div className="op-calendar-aside">
          <Panel>
            <div className="op-panel-title">
              <div>
                <h2>
                  {new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </h2>
                <small>{day === booking.day ? "1 scheduled event" : "No events"}</small>
              </div>
              <CalendarDays size={17} className="op-muted" />
            </div>
            {day === booking.day ? (
              <button className="op-agenda-item" onClick={() => setOpen(true)}>
                <span className="op-agenda-time">{booking.time}</span>
                <div>
                  <h3>{booking.title}</h3>
                  <p>Video call · 30 minutes</p>
                  <span className="op-pill">Demo</span>
                </div>
              </button>
            ) : (
              <Empty title="A little breathing room">
                Choose Next event to see your demo booking.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={booking.title}
        description="Fictional demo booking"
      >
        <p>
          {new Date(`${booking.day}T12:00:00`).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}{" "}
          · {booking.time}–{booking.end}
        </p>
        <p>
          <MapPin size={15} /> Video call
        </p>
        <p>
          <Users size={15} /> Alex Morgan, Taylor Reed
        </p>
        <p>Review project priorities and agree the next steps.</p>
      </Modal>
    </div>
  );
}
