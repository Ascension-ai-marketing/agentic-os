import { AccountConnections, useAccounts, ProviderLogo } from "./account-connections";
import "./calendar-fixes.css";
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CalendarDemo, CALENDAR_DEMO_KEY } from "./calendar-demo";
import {
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  MessageSquare,
  ArrowUpRight,
  Link2,
  Trash2,
  Upload,
  RefreshCw,
} from "lucide-react";
import {
  type CalendarEvent,
  localDay,
  operatorRequest,
  useOperator,
  askOperator,
} from "@/lib/operator";
import { Busy, ConnectionNote, Empty, Modal, Notice, PageHeading, Panel } from "./ui";
import { ChatPageComposer } from "./chat-page-composer";
import { NativeCalendarConnection, useNativeCalendar } from "./native-calendar-connection";
const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const providerName: Record<CalendarEvent["source"], string> = {
  google: "Google Calendar",
  outlook: "Outlook Calendar",
  cal: "Cal.com",
  ics: "Imported calendar",
  local: "Local event",
};
const eventOrder = (a: CalendarEvent, b: CalendarEvent) =>
  Date.parse(a.start) - Date.parse(b.start);
export function eventOnDay(event: CalendarEvent, day: string) {
  if (!day) return false;
  if (event.allDay) return event.start.slice(0, 10) <= day && event.end.slice(0, 10) > day;
  const start = new Date(`${day}T00:00:00`),
    end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (Date.parse(event.start) === Date.parse(event.end))
    return new Date(event.start) >= start && new Date(event.start) < end;
  return new Date(event.start) < end && new Date(event.end) > start;
}
export function CalendarWorkspace() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(search).get("demo") === "1";
    let enabled = requested;
    try {
      enabled ||= localStorage.getItem(CALENDAR_DEMO_KEY) === "true";
      if (requested) localStorage.setItem(CALENDAR_DEMO_KEY, "true");
    } catch { /* The URL still enables the private demo when storage is unavailable. */ }
    setDemo(enabled);
  }, [search]);
  // Resolve privacy mode before mounting anything that reads the real calendar.
  if (demo === null) return <div className="op-page" aria-label="Loading calendar"><Busy /></div>;
  return demo ? <CalendarDemo onExit={() => {
    try { localStorage.removeItem(CALENDAR_DEMO_KEY); } catch { /* No persisted setting. */ }
    window.location.assign("/calendar");
  }} /> : <LiveCalendarWorkspace />;
}
function LiveCalendarWorkspace() {
  const { state, refresh, error } = useOperator();
  const { data: accounts, refetch: refreshAccounts, error: accountError } = useAccounts();
  const nativeCalendar = useNativeCalendar();
  const [view, setView] = useState("calendar");
  const [layout, setLayout] = useState("month");
  const [agendaRange, setAgendaRange] = useState("upcoming");
  const [syncing, setSyncing] = useState(false);
  const [month, setMonth] = useState<Date | null>(null),
    [day, setDay] = useState(""),
    [today, setToday] = useState(""),
    [add, setAdd] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [location, setLocation] = useState(""),
    [attendees, setAttendees] = useState(""),
    [notes, setNotes] = useState(""),
    [actions, setActions] = useState<CalendarEvent["actions"]>([]),
    [actionText, setActionText] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setDay(localDay(now));
    setToday(localDay(now));
  }, []);
  const event = state.events.find((e) => e.id === selected),
    dayEvents = state.events.filter((e) => eventOnDay(e, day)).sort(eventOrder);
  const calendarAccounts =
    accounts?.accounts.filter((a) => a.connected && ["google", "outlook", "cal"].includes(a.id)) ||
    [];
  const connected = calendarAccounts.filter((a) => a.calendarAccess === "granted");
  const syncable = calendarAccounts.filter((a) => a.calendarAccess !== "missing");
  const missingAccess = calendarAccounts.some((a) => a.calendarAccess === "missing");
  const calendarErrors = connected.filter((a) => a.error);
  const upcoming = state.events
    .filter((e) => new Date(e.end) > new Date(`${today}T00:00:00`))
    .sort(eventOrder);
  const agendaEvents = agendaRange === "all" ? [...state.events].sort(eventOrder) : upcoming;
  const lastSync = connected
    .map((a) => a.calendarCoverage?.syncedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const chatCandidates = [
    ...new Map(
      [
        ...dayEvents,
        ...upcoming.filter((event) => Date.parse(event.start) < Date.now() + 7 * 86400000),
      ].map((event) => [event.id, event]),
    ).values(),
  ].sort(eventOrder);
  const chatEvents = chatCandidates.slice(0, 100);
  function jumpToEvent(e: CalendarEvent) {
    const date = new Date(e.allDay ? e.start.slice(0, 10) + "T12:00:00" : e.start);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setDay(localDay(date));
  }
  async function syncCalendars() {
    setSyncing(true);
    setFailure("");
    setNotice("");
    try {
      const anchor = month || new Date();
      const timeMin = new Date(anchor.getFullYear(), anchor.getMonth() - 3, 1).toISOString();
      const timeMax = new Date(anchor.getFullYear(), anchor.getMonth() + 13, 1).toISOString();
      const results = await Promise.allSettled(
        syncable.map((a) =>
          operatorRequest<{ events: number }>("/connections/sync", {
            provider: a.id,
            calendarOnly: true,
            timeMin,
            timeMax,
          }),
        ),
      );
      const failed = results.flatMap((r, index) =>
        r.status === "rejected"
          ? [
              `${syncable[index].id === "google" ? "Google" : syncable[index].id === "outlook" ? "Outlook" : "Cal.com"}: ${r.reason?.message || "Sync failed."}`,
            ]
          : [],
      );
      const count = results.reduce(
        (n, r) => n + (r.status === "fulfilled" ? r.value.events : 0),
        0,
      );
      await Promise.all([refresh(), refreshAccounts()]);
      if (failed.length) setFailure(failed.join(" "));
      if (results.some((r) => r.status === "fulfilled"))
        setNotice(
          `${count} calendar event${count === 1 ? "" : "s"} synced. Your saved notes are kept.`,
        );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  const cells: Date[] = [];
  if (month) {
    const first = new Date(month);
    first.setDate(1 - ((first.getDay() + 6) % 7));
    const rows = Math.ceil(
      (((month.getDay() + 6) % 7) +
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) /
        7,
    );
    for (let n = 0; n < rows * 7; n++) {
      const d = new Date(first);
      d.setDate(first.getDate() + n);
      cells.push(d);
    }
  }
  function newEvent() {
    setTitle("");
    setStart(`${day}T09:00`);
    setEnd(`${day}T10:00`);
    setLocation("");
    setAttendees("");
    setFailure("");
    setAdd(true);
  }
  function openEvent(e: CalendarEvent) {
    setSelected(e.id);
    setNotes(e.notes);
    setActions(e.actions);
    setActionText("");
    setFailure("");
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setFailure("");
    try {
      if (file.size > 1000000) throw new Error("Choose an .ics file under 1 MB.");
      const anchor = month || new Date();
      const r = await operatorRequest("/calendar/import", {
        ics: await file.text(),
        timeMin: new Date(anchor.getFullYear(), anchor.getMonth() - 3, 1).toISOString(),
        timeMax: new Date(anchor.getFullYear(), anchor.getMonth() + 13, 1).toISOString(),
      });
      await refresh();
      setNotice(
        `${r.added} event${r.added === 1 ? "" : "s"} imported. ${r.message || "Duplicates were skipped."}`,
      );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  }
  async function saveNotes() {
    if (!event) return false;
    setBusy(true);
    try {
      await operatorRequest("/calendar", { id: event.id, notes, actions });
      await refresh();
      setNotice("Meeting notes and actions saved.");
      return true;
    } catch (e) {
      setFailure((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="op-page">
      <header className="ar-page-title">
        <div>
          <h1>Calendar</h1>
          <p>Your schedule, booking links and availability.</p>
        </div>
        <div className="ar-page-actions">
          <a className="op-button" href="/calendar?demo=1">Demo view</a>
          <AccountConnections
            calendarOnly
            label={
              connected.length || nativeCalendar.data?.enabled ? "Calendars" : "Connect calendar"
            }
          />
          <button className="op-button primary" onClick={newEvent}>
            <Plus size={14} />
            New event
          </button>
        </div>
      </header>
      <div className="ar-calendar-toolbar">
        <div className="ar-network-views">
          {[
            ["calendar", "Calendar"],
            ["links", "Booking links"],
            ["availability", "Availability"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ar-page-actions">
          <button className="op-text-link" onClick={() => upload.current?.click()} disabled={busy}>
            <Upload size={13} />
            Import .ics
          </button>
          {view === "calendar" && (
            <select
              className="op-select"
              aria-label="Calendar layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
            >
              <option value="month">Month</option>
              <option value="agenda">Agenda</option>
            </select>
          )}
        </div>
      </div>
      {view !== "calendar" && (
        <section className="ar-booking-content">
          {!accounts?.accounts.find((a) => a.id === "cal")?.connected ? (
            <div className="ar-cal-empty">
              <span className="ar-cal-wordmark">Cal.com</span>
              <h2>
                {view === "links"
                  ? "Your booking links, right here."
                  : "Set the hours that work for you."}
              </h2>
              <p>
                {view === "links"
                  ? "Connect Cal.com to see your event types and open your booking pages."
                  : "Bring your Cal.com availability into view alongside your calendar."}
              </p>
              <AccountConnections only="cal" />
              <a
                className="op-text-link"
                href={
                  view === "links"
                    ? "https://app.cal.com/event-types"
                    : "https://app.cal.com/availability"
                }
                target="_blank"
                rel="noreferrer"
              >
                Open Cal.com <ArrowUpRight size={13} />
              </a>
            </div>
          ) : view === "links" ? (
            <div className="ar-booking-list">
              {accounts.eventTypes.length ? (
                accounts.eventTypes.map((t: any) => (
                  <article key={t.id}>
                    <span className="ar-booking-icon">
                      <Link2 size={19} />
                    </span>
                    <div>
                      <h3>{t.title}</h3>
                      <p>
                        {t.lengthInMinutes || t.length} minutes ·{" "}
                        {t.description || "Cal.com booking link"}
                      </p>
                    </div>
                    {accounts.calUsername && t.slug && (
                      <a
                        className="op-button"
                        href={`https://cal.com/${encodeURIComponent(accounts.calUsername)}/${encodeURIComponent(t.slug)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open link <ArrowUpRight size={13} />
                      </a>
                    )}
                  </article>
                ))
              ) : (
                <Empty title="No booking links synced yet.">
                  Open Connections and sync Cal.com.
                </Empty>
              )}
              <a
                className="op-button"
                href="https://app.cal.com/event-types"
                target="_blank"
                rel="noreferrer"
              >
                Manage booking links <ArrowUpRight size={13} />
              </a>
            </div>
          ) : (
            <div className="ar-booking-list">
              {accounts.schedules.length ? (
                accounts.schedules.map((s: any) => (
                  <article key={s.id}>
                    <Clock3 size={19} />
                    <div>
                      <h3>{s.name}</h3>
                      <p>
                        {s.timeZone}
                        {s.isDefault ? " · Default schedule" : ""}
                      </p>
                      {(s.availability || []).map((a: any, i: number) => (
                        <p key={i}>
                          {(a.days || [])
                            .map((d: number | string) =>
                              typeof d === "number"
                                ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]
                                : d,
                            )
                            .join(", ")}{" "}
                          · {a.startTime?.slice(0, 5)}–{a.endTime?.slice(0, 5)}
                        </p>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <Empty title="No availability synced yet.">
                  Open Connections and sync Cal.com.
                </Empty>
              )}
              <a
                className="op-button"
                href="https://app.cal.com/availability"
                target="_blank"
                rel="noreferrer"
              >
                Edit availability in Cal.com <ArrowUpRight size={13} />
              </a>
            </div>
          )}
        </section>
      )}
      <input
        ref={upload}
        type="file"
        accept=".ics"
        hidden
        aria-label="Import ICS calendar"
        onChange={(e) => importFile(e.target.files?.[0])}
      />
      {(failure || error || accountError) && (
        <Notice error>{failure || error?.message || accountError?.message}</Notice>
      )}
      {notice && (
        <Notice>
          {notice}
          <button onClick={() => setNotice("")}>Dismiss</button>
        </Notice>
      )}
      {view === "calendar" && <NativeCalendarConnection month={month} autoRefresh />}
      {view === "calendar" &&
        !nativeCalendar.isPending &&
        (!nativeCalendar.data?.available || connected.length > 0 || syncable.length > 0) && (
          <div className="ar-calendar-sync" role="status">
            <div className="ar-calendar-sync-logos" aria-hidden="true">
              <ProviderLogo provider="calendar" />
              <ProviderLogo provider="outlook" />
            </div>
            <div className="ar-calendar-sync-copy">
              <strong>
                {connected.length
                  ? `${connected.length} calendar ${connected.length === 1 ? "account" : "accounts"} connected`
                  : missingAccess
                    ? "Calendar access is missing"
                    : syncable.length
                      ? "Calendar access is unverified"
                      : state.events.length
                        ? "Saved calendar snapshot"
                        : "Your calendar is not connected"}
              </strong>
              <small>
                {connected.length
                  ? calendarErrors.length
                    ? "The last sync needs attention. Retry here or reconnect in Calendars."
                    : lastSync
                      ? `Updated ${new Date(lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${state.events.length} saved events`
                      : "Sync to verify your calendars and the date range."
                  : missingAccess
                    ? "Open Connections, reconnect Google or Microsoft, and allow calendar access. Email access alone is not enough."
                    : syncable.length
                      ? "Verify access to load your calendars. Saved email does not verify calendar access."
                      : state.events.length
                        ? `${state.events.length} saved events. Connect a provider or re-import your export to refresh them.`
                        : "No events have been imported yet. Connect Google, Outlook or Cal.com, or import an .ics export."}
              </small>
            </div>
            {syncable.length > 0 ? (
              <button className="op-button" onClick={() => void syncCalendars()} disabled={syncing}>
                {syncing ? <Busy /> : <RefreshCw size={13} />}
                {syncing ? "Syncing…" : connected.length ? "Sync now" : "Verify calendar access"}
              </button>
            ) : (
              <button
                className="op-text-link"
                onClick={() => upload.current?.click()}
                disabled={busy}
              >
                <Upload size={13} /> Import calendar
              </button>
            )}
          </div>
        )}
      {view === "calendar" && (connected.length > 0 || state.events.length > 0) && (
        <details className="ar-calendar-coverage">
          <summary>Calendar coverage · {state.events.length} saved events</summary>
          <div>
            {connected.map((account) => {
              const coverage = account.calendarCoverage;
              const outside =
                month &&
                coverage &&
                (new Date(month.getFullYear(), month.getMonth(), 1).getTime() <
                  Date.parse(coverage.timeMin) ||
                  new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() >
                    Date.parse(coverage.timeMax));
              return (
                <p key={account.id}>
                  <strong>
                    {account.id === "google"
                      ? "Google"
                      : account.id === "outlook"
                        ? "Outlook"
                        : "Cal.com"}
                  </strong>
                  {coverage ? (
                    <>
                      {" "}
                      · {coverage.calendarCount} readable calendars · {coverage.eventCount} events ·{" "}
                      {new Date(coverage.timeMin).toLocaleDateString("en-GB")}–
                      {new Date(coverage.timeMax).toLocaleDateString("en-GB")}
                      <span>{coverage.calendars.map((calendar) => calendar.name).join(" · ")}</span>
                      {outside && (
                        <span className="ar-calendar-range-warning">
                          This month is outside the saved range. Sync this view to load it.
                        </span>
                      )}
                    </>
                  ) : (
                    <span>
                      Coverage has not been verified. Sync now to load all readable calendars.
                    </span>
                  )}
                </p>
              );
            })}
            {state.events.some((event) => event.source === "ics") && (
              <p>
                <strong>Imported .ics</strong> ·{" "}
                {state.events.filter((event) => event.source === "ics").length} events
                <span>
                  Saved snapshot. Recurring series expand within the imported date window; re-import
                  to refresh.
                </span>
              </p>
            )}
            {!connected.length && !nativeCalendar.data?.enabled && (
              <p>These events are saved locally; no live provider connection is active.</p>
            )}
          </div>
        </details>
      )}
      {view === "calendar" && (
        <div
          className={`op-calendar-layout ar-calendar-layout ${layout === "agenda" ? "is-agenda" : ""}`}
        >
          <div>
            {layout === "agenda" ? (
              <section className="ar-upcoming-agenda">
                <header className="ar-agenda-heading">
                  <h2>{agendaRange === "all" ? "All events" : "Upcoming"}</h2>
                  <select
                    className="op-select"
                    aria-label="Agenda date range"
                    value={agendaRange}
                    onChange={(e) => setAgendaRange(e.target.value)}
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="all">All saved events</option>
                  </select>
                </header>
                {agendaEvents.map((e) => (
                  <button key={e.id} onClick={() => openEvent(e)}>
                    <time>
                      {new Date(
                        e.allDay ? e.start.slice(0, 10) + "T12:00:00" : e.start,
                      ).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                    <div>
                      <strong>{e.title}</strong>
                      <p>
                        {e.allDay ? "All day" : clock(e.start)} ·{" "}
                        {e.location || e.calendarName || providerName[e.source]}
                      </p>
                    </div>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
                {!agendaEvents.length && (
                  <Empty title={agendaRange === "all" ? "No saved events" : "No upcoming events"}>
                    {state.events.length
                      ? "Your saved events are in the past. Choose All saved events to see them."
                      : connected.length
                        ? "Sync your connected calendars to bring in your schedule."
                        : "Your calendars have not been connected yet."}
                  </Empty>
                )}
              </section>
            ) : (
              <Panel className="op-calendar-panel">
                <div className="op-calendar-toolbar">
                  <h2>
                    {month?.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) ||
                      "Your calendar"}
                  </h2>
                  <div>
                    {upcoming[0] && (
                      <button className="op-button quiet" onClick={() => jumpToEvent(upcoming[0])}>
                        Next event
                      </button>
                    )}
                    <button
                      className="op-button quiet"
                      onClick={() => {
                        const d = new Date();
                        setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                        setDay(localDay(d));
                      }}
                    >
                      Today
                    </button>
                    <button
                      className="op-icon-button"
                      aria-label="Previous month"
                      onClick={() =>
                        month && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
                      }
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className="op-icon-button"
                      aria-label="Next month"
                      onClick={() =>
                        month && setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
                      }
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="op-weekdays">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="op-month-grid">
                  {cells.map((d) => {
                    const key = localDay(d),
                      events = state.events.filter((e) => eventOnDay(e, key)).sort(eventOrder);
                    return (
                      <button
                        key={key}
                        className={`op-calendar-day ${key === day ? "selected" : ""} ${key === today ? "today" : ""} ${d.getMonth() !== month?.getMonth() ? "outside" : ""}`}
                        onClick={() => setDay(key)}
                        aria-label={`${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, ${events.length} events`}
                        aria-pressed={key === day}
                      >
                        <span>{d.getDate()}</span>
                        {events.slice(0, 2).map((e) => (
                          <div key={e.id} className="op-calendar-event">
                            {e.allDay ? "" : clock(e.start) + " "}
                            {e.title}
                          </div>
                        ))}
                        {events.length > 2 && (
                          <div className="op-calendar-event more">+{events.length - 2} more</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}
            <p className="op-form-help" style={{ padding: "12px 3px" }}>
              Times follow your browser’s timezone; all-day dates stay on their calendar day.{" "}
              {nativeCalendar.data?.enabled
                ? "Google Calendar refreshes your primary calendar around the month you’re viewing."
                : "Sync loads your connected calendars around this view."}{" "}
              Imported files are saved snapshots.
            </p>
          </div>
          <div className="op-calendar-aside">
            <Panel>
              <div className="op-panel-title">
                <div>
                  <h2>
                    {day
                      ? new Date(`${day}T12:00`).toLocaleDateString("en-GB", {
                          weekday: "long",
                          day: "numeric",
                          month: "short",
                        })
                      : "Your day"}
                  </h2>
                  <small>
                    {dayEvents.length} scheduled {dayEvents.length === 1 ? "event" : "events"}
                  </small>
                </div>
                <CalendarDays size={17} className="op-muted" />
              </div>
              {dayEvents.length ? (
                dayEvents.map((e) => (
                  <button key={e.id} className="op-agenda-item" onClick={() => openEvent(e)}>
                    <span className="op-agenda-time">{e.allDay ? "All day" : clock(e.start)}</span>
                    <div>
                      <h3>{e.title}</h3>
                      <p>{e.location || e.calendarName || "Open notes & action items"}</p>
                      {e.actions.length > 0 && (
                        <span className="op-pill">
                          {e.actions.filter((a) => a.done).length}/{e.actions.length} actions done
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <Empty
                  icon={<CalendarDays size={23} />}
                  title="No events this day"
                  action={
                    <button className="op-button" onClick={newEvent}>
                      <Plus size={13} /> Add an event
                    </button>
                  }
                >
                  {state.events.length
                    ? "Choose another day to see its events."
                    : "Connect your calendar above to bring your schedule here."}
                </Empty>
              )}
            </Panel>
          </div>
        </div>
      )}
      <ChatPageComposer
        contextSource="meetings"
        title="Ask about your calendar"
        description="Prepare for meetings, spot clashes or plan your day. Continue the conversation in Chat."
        suggestions={[
          "Prepare for my next meeting",
          "What does my week look like?",
          "Check for scheduling clashes",
        ]}
        placeholder="Help me prepare for my next meeting…"
        context={`CALENDAR SNAPSHOT: ${JSON.stringify({ now: new Date().toISOString(), selectedDay: day, coverage: nativeCalendar.data?.coverage, connected: connected.length > 0 || !!nativeCalendar.data?.enabled, totalRelevantEvents: chatCandidates.length, truncated: chatCandidates.length > chatEvents.length, events: chatEvents.map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, calendar: e.calendarName, location: e.location, notes: e.notes.slice(0, 300), actions: e.actions.slice(0, 8) })) })}. Events cover the selected day and the next seven days, with a maximum of 100 items. This is saved context, not live availability. Missing events never prove a free slot; other calendars may not be included. Calendar changes require the separate event review and confirmation.`}
      />
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Make time for it."
        description="Add an event to your local calendar. No invitations are sent."
      >
        <form
          className="op-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailure("");
            try {
              await operatorRequest("/calendar", {
                title,
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
                location,
                attendees,
              });
              await refresh();
              setAdd(false);
              setDay(localDay(new Date(start)));
              setMonth(new Date(new Date(start).getFullYear(), new Date(start).getMonth(), 1));
              setNotice("Event added to your calendar.");
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Event title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What’s on the agenda?"
              required
            />
          </label>
          <div className="op-form-row">
            <label>
              Starts
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Ends
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <label>
            Location or meeting link
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add a place or call link"
            />
          </label>
          <label>
            People
            <input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="Names for your reference"
            />
          </label>
          {failure && <Notice error>{failure}</Notice>}
          <button className="op-button primary" disabled={busy}>
            {busy ? <Busy /> : <Plus size={14} />} Add event
          </button>
        </form>
      </Modal>
      <Modal
        open={!!event}
        onClose={() => setSelected(null)}
        title={event?.title || "Meeting"}
        description={
          event
            ? `${new Date(event.allDay ? event.start.slice(0, 10) + "T12:00:00" : event.start).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} · ${event.allDay ? "All day" : `${clock(event.start)} – ${clock(event.end)}`} · ${event.calendarName || providerName[event.source]}`
            : ""
        }
      >
        {event && (
          <>
            <div className="op-detail-meta">
              {event.location && (
                <span>
                  <MapPin size={12} style={{ display: "inline", marginRight: 5 }} />
                  {event.location}
                </span>
              )}
              {event.attendees && <span>{event.attendees}</span>}
            </div>
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveNotes();
              }}
            >
              <label>
                Meeting notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Agenda, decisions, or a transcript from your notetaker…"
                />
              </label>
              <div>
                <div className="op-eyebrow" style={{ marginBottom: 8 }}>
                  NEXT STEPS
                </div>
                {actions.map((a) => (
                  <label key={a.id} className={`op-action-item ${a.done ? "done" : ""}`}>
                    <input
                      type="checkbox"
                      checked={a.done}
                      onChange={(e) =>
                        setActions((items) =>
                          items.map((x) => (x.id === a.id ? { ...x, done: e.target.checked } : x)),
                        )
                      }
                    />
                    <span style={{ flex: 1 }}>{a.text}</span>
                    <button
                      type="button"
                      className="op-icon-button"
                      aria-label={`Remove action ${a.text}`}
                      onClick={() => setActions((items) => items.filter((x) => x.id !== a.id))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input
                    value={actionText}
                    onChange={(e) => setActionText(e.target.value)}
                    placeholder="Add an action item…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (actionText.trim()) {
                          setActions((a) => [
                            ...a,
                            { id: crypto.randomUUID(), text: actionText.trim(), done: false },
                          ]);
                          setActionText("");
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="op-button"
                    disabled={!actionText.trim()}
                    onClick={() => {
                      setActions((a) => [
                        ...a,
                        { id: crypto.randomUUID(), text: actionText.trim(), done: false },
                      ]);
                      setActionText("");
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              {failure && <Notice error>{failure}</Notice>}
              <div className="op-detail-actions">
                <button
                  type="button"
                  className="op-button"
                  onClick={async () => {
                    if (!notes.trim()) {
                      setFailure("Add your meeting notes before saving to Memory.");
                      return;
                    }
                    if (!(await saveNotes())) return;
                    try {
                      await operatorRequest("/memory", {
                        title: event.title,
                        text: `Meeting: ${event.title}\nDate: ${event.start}\n\n${notes}\n\nActions:\n${actions.map((a) => `${a.done ? "[done]" : "[open]"} ${a.text}`).join("\n")}`,
                        kind: "meeting",
                        collection: "business",
                      });
                      await refresh();
                      setNotice("Meeting notes saved to Business memory.");
                      setSelected(null);
                    } catch (e) {
                      setFailure((e as Error).message);
                    }
                  }}
                >
                  <BookmarkPlus size={13} /> Save to memory
                </button>
                <button
                  type="button"
                  className="op-button danger"
                  onClick={async () => {
                    try {
                      await operatorRequest("/calendar", { id: event.id, action: "delete" });
                      await refresh();
                      setSelected(null);
                      setNotice(
                        event.source === "local" || event.source === "ics"
                          ? "Event removed from this workspace."
                          : "Event removed from this workspace. It is unchanged in your connected calendar and will return on sync.",
                      );
                    } catch (e) {
                      setFailure((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
                <button className="op-button primary" disabled={busy}>
                  {busy ? <Busy /> : <Check size={13} />} Save notes
                </button>
              </div>
            </form>
          </>
        )}
      </Modal>
    </div>
  );
}
