import { useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronDown, MessageSquare } from "lucide-react";
import { askOperator, type InboxItem, type OperatorState } from "@/lib/operator";
import type { AccountStatus } from "./account-connections";

const sourceNames: Record<string, string> = {
  gmail: "Gmail",
  google: "Google",
  outlook: "Outlook",
  slack: "Slack",
};

export function InboxDailyBrief({
  state,
  inbox,
  accounts,
  onSelect,
}: {
  state: OperatorState;
  inbox: InboxItem[];
  accounts: AccountStatus[];
  onSelect: (item: InboxItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const open = inbox.filter((item) => item.status === "open");
  const unread = open.filter((item) => item.read !== true).length;
  const primary = open
    .filter((item) => item.category === "needs-you")
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const waiting = open.filter((item) => item.category === "waiting").length;
  const events = state.events
    .filter((event) => {
      const start = new Date(event.start).getTime();
      const end = new Date(event.end).getTime();
      return start < tomorrow.getTime() && end > today.getTime();
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = events.filter((event) => new Date(event.end).getTime() > now.getTime());
  const visibleProviders = new Set(inbox.map((item) => item.source));
  const syncs = accounts
    .filter((account) => account.connected && account.lastSync)
    .map((account) => ({
      time: account.lastSync!,
      label: `${sourceNames[account.id] || account.id} synced`,
    }));
  const snapshots = (state.inboxImports || [])
    .filter((entry) => visibleProviders.has(entry.provider))
    .map((entry) => ({ time: entry.importedAt, label: `${sourceNames[entry.provider]} snapshot` }));
  const latest = [...syncs, ...snapshots]
    .filter((entry) => Number.isFinite(new Date(entry.time).getTime()))
    .sort((a, b) => b.time.localeCompare(a.time))[0];
  const latestSaved = [...inbox].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const stamp = (value: string) =>
    new Date(value).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section className="ar-daily-brief" aria-label="Daily brief">
      <div className="ar-brief-heading">
        <button
          className="ar-brief-toggle"
          aria-expanded={expanded}
          aria-controls="inbox-daily-brief-content"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="ar-brief-label">Daily brief</span>
          <span className="ar-brief-date">
            {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          </span>
          <ChevronDown size={14} className={expanded ? "is-open" : ""} />
        </button>
        <span className="ar-brief-overview">
          {unread} unread <i /> {events.length} event{events.length === 1 ? "" : "s"} today
        </span>
        <button
          className="ar-brief-ask"
          onClick={() =>
            askOperator(
              "Give me today's brief: prioritise my inbox, today's calendar and current business goals. Explain which enabled sources support each priority. Be clear about saved snapshots and missing connections; an empty local calendar does not establish that I have no meetings.",
              "",
              true,
            )
          }
          title="Ask using the sources enabled in Memory"
        >
          <MessageSquare size={13} /> Ask about today
        </button>
      </div>
      {expanded && (
        <div id="inbox-daily-brief-content" className="ar-brief-content">
          <div className="ar-brief-column">
            <p className="ar-brief-column-title">
              Your inbox
              <span>
                {primary.length} primary · {waiting} waiting
              </span>
            </p>
            {primary.length ? (
              <div className="ar-brief-items">
                {primary.slice(0, 2).map((item) => (
                  <button key={item.id} onClick={() => onSelect(item)}>
                    <span>{item.subject}</span>
                    <small>{item.from || "You"}</small>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="ar-brief-empty">
                {inbox.length
                  ? "No messages in Primary. Your other conversations are below."
                  : "Connect an account or capture a message to start your brief."}
              </p>
            )}
            <p className="ar-brief-freshness">
              {latest
                ? `${latest.label} · ${stamp(latest.time)}`
                : latestSaved
                  ? `Latest saved message · ${stamp(latestSaved.receivedAt)}`
                  : "Based on messages saved in this workspace."}
              {snapshots.length > 0 && " · Snapshots do not refresh automatically."}
            </p>
          </div>
          <div className="ar-brief-column">
            <p className="ar-brief-column-title">
              Coming up
              <a href="/calendar">
                Calendar <ArrowUpRight size={11} />
              </a>
            </p>
            {upcoming.length ? (
              <div className="ar-brief-events">
                {upcoming.slice(0, 2).map((event) => (
                  <a href="/calendar" key={event.id}>
                    <CalendarDays size={13} />
                    <time>
                      {event.allDay
                        ? "All day"
                        : new Date(event.start).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                    </time>
                    <span>{event.title}</span>
                  </a>
                ))}
                {upcoming.length > 2 && <small>+{upcoming.length - 2} more in your calendar</small>}
              </div>
            ) : (
              <p className="ar-brief-empty">
                {events.length
                  ? "No more events saved for today."
                  : "No events saved for today. Connect or import your calendar to include it."}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
