import { useEffect, useRef, useState } from "react";
import { operatorRequest } from "@/lib/operator";
import type { ChatCalendarDraft } from "@/lib/chat-calendar";

type Provider = "google" | "outlook";
type Account = {
  id: string;
  connected: boolean;
  email?: string;
  capabilities?: { calendarCreate?: boolean };
};
type Review = {
  reviewId: string;
  expiresAt: string;
  provider: Provider;
  account: string;
  calendar: { id: string; name: string };
  event: {
    title: string;
    start: string;
    end: string;
    timeZone: string;
    attendees: string[];
    location: string;
    notes: string;
  };
  invitations: boolean;
};
type Request = <T>(path: string, body?: unknown) => Promise<T>;
const name = (provider: Provider) =>
  provider === "google" ? "Google Calendar" : "Outlook Calendar";
const localInput = (instant: string) => {
  const date = new Date(instant);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** The model proposes text. Only these explicit controls can save or book an event. */
export function ChatCalendarReview({
  draft,
  onDismiss,
  onSaved,
  onBusyChange,
  request = operatorRequest,
}: {
  draft: ChatCalendarDraft;
  onDismiss: () => void;
  onSaved: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
  request?: Request;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<Provider | "local" | "">("");
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([]);
  const [calendarId, setCalendarId] = useState("");
  const [title, setTitle] = useState(draft.title);
  const [start, setStart] = useState(localInput(draft.start));
  const [end, setEnd] = useState(localInput(draft.end));
  const [location, setLocation] = useState(draft.location);
  const [attendees, setAttendees] = useState(draft.attendees.join(", "));
  const [review, setReview] = useState<Review | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const submittedReviews = useRef(new Set<string>());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const setWorking = (value: boolean) => {
    inFlight.current = value;
    setBusy(value);
    onBusyChange?.(value);
  };
  useEffect(() => {
    let active = true;
    request<{ accounts: Account[] }>("/connections")
      .then((result) => {
        if (active)
          setAccounts(
            result.accounts.filter(
              (item) =>
                item.connected &&
                item.capabilities?.calendarCreate &&
                ["google", "outlook"].includes(item.id),
            ),
          );
      })
      .catch(() => {
        if (active)
          setError("Could not check calendar access. Open Connections to check your accounts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);
  useEffect(() => {
    setCalendars([]);
    setCalendarId("");
    if (!provider || provider === "local") return;
    let active = true;
    setLoading(true);
    request<{ calendars: Array<{ id: string; name: string }> }>("/connections/calendar/options", {
      provider,
    })
      .then((result) => {
        if (active) {
          setCalendars(result.calendars);
          setCalendarId(result.calendars[0]?.id || "");
        }
      })
      .catch(() => {
        if (active) setError("Could not load writable calendars. Check access in Connections.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider, request]);
  useEffect(() => {
    if (!review) return;
    const remaining = Date.parse(review.expiresAt) - Date.now();
    setExpired(!Number.isFinite(remaining) || remaining <= 0);
    if (!(remaining > 0)) return;
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [review]);

  async function prepare() {
    if (inFlight.current || !provider) return;
    setWorking(true);
    setError("");
    try {
      const begin = new Date(start),
        finish = new Date(end);
      if (
        !title.trim() ||
        !Number.isFinite(begin.valueOf()) ||
        !Number.isFinite(finish.valueOf()) ||
        finish <= begin
      )
        throw new Error("Check the title, start time and end time.");
      const people = attendees
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const event = {
        title: title.trim(),
        start: begin.toISOString(),
        end: finish.toISOString(),
        timeZone,
        location: location.trim(),
        attendees: people,
        notes: "",
      };
      if (provider === "local") {
        await request("/calendar", {
          ...event,
          attendees: people.join(", "),
          allDay: false,
          actions: [],
        });
        onSaved("Added to your local calendar. No invitations were sent.");
      } else {
        if (!calendarId) throw new Error("Choose a writable calendar first.");
        if (people.some((person) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person)))
          throw new Error(
            "Use an email address for each guest, or remove guests to book time for yourself.",
          );
        setReview(
          await request<Review>("/connections/calendar/prepare", {
            ...event,
            provider,
            calendarId,
          }),
        );
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function confirm() {
    if (
      !review ||
      inFlight.current ||
      expired ||
      uncertain ||
      submittedReviews.current.has(review.reviewId) ||
      Date.parse(review.expiresAt) <= Date.now()
    )
      return;
    submittedReviews.current.add(review.reviewId);
    setWorking(true);
    setError("");
    try {
      const result = await request<{ status: "created" | "uncertain"; message?: string }>(
        "/connections/calendar/create",
        { provider: review.provider, reviewId: review.reviewId, confirm: true },
      );
      if (result.status === "created")
        onSaved(
          `Booked in ${name(review.provider)} on ${review.calendar.name}.${review.invitations ? " Guest invitations were requested." : " No invitations were sent."}`,
        );
      else {
        setUncertain(true);
        setError(
          result.message ||
            "Booking status is unclear. Check your calendar before creating another event.",
        );
      }
    } catch {
      setUncertain(true);
      setError("Booking status is unclear. Check your calendar before creating another event.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="ar-event-proposal ar-calendar-review" aria-label="Review calendar event">
      <h3>{review ? "Confirm your booking" : "Review your event"}</h3>
      {review ? (
        <>
          <p>
            <strong>{review.event.title}</strong>
          </p>
          <p>
            {name(review.provider)} · {review.account} · {review.calendar.name}
          </p>
          <p>
            {new Date(review.event.start).toLocaleString(undefined, {
              timeZone: review.event.timeZone,
            })}{" "}
            to{" "}
            {new Date(review.event.end).toLocaleString(undefined, {
              timeZone: review.event.timeZone,
            })}{" "}
            · {review.event.timeZone}
          </p>
          {review.event.location && <p>{review.event.location}</p>}
          <p>
            {review.invitations
              ? `Invitations will be sent to: ${review.event.attendees.join(", ")}`
              : "No guest invitations."}
          </p>
          {review.event.notes && <p>{review.event.notes}</p>}
          {expired && (
            <p role="status">This review expired. Review the event again before booking.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="ar-calendar-review-actions">
            <button type="button" className="op-button" disabled={busy} onClick={onDismiss}>
              {uncertain ? "Close" : "Cancel"}
            </button>
            {!uncertain && (
              <button
                type="button"
                className="op-button"
                disabled={busy}
                onClick={() => {
                  setReview(null);
                  setError("");
                }}
              >
                Edit event
              </button>
            )}
            <button
              type="button"
              className="op-button primary"
              disabled={busy || uncertain || expired}
              onClick={() => void confirm()}
            >
              {busy ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void prepare();
          }}
        >
          {draft.note && <p>{draft.note}</p>}
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              disabled={busy}
            />
          </label>
          <div className="ar-calendar-review-times">
            <label>
              Start
              <input
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              End
              <input
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
                disabled={busy}
              />
            </label>
          </div>
          <p>Times in {timeZone}.</p>
          <label>
            Location
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={500}
              disabled={busy}
            />
          </label>
          <label>
            Guests
            <input
              value={attendees}
              onChange={(event) => setAttendees(event.target.value)}
              placeholder="Email addresses, separated by commas"
              disabled={busy}
            />
          </label>
          <label>
            Save to
            <select
              aria-label="Calendar account"
              value={provider}
              disabled={busy}
              onChange={(event) => {
                setProvider(event.target.value as typeof provider);
                setError("");
              }}
            >
              <option value="">Choose a calendar account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {name(account.id as Provider)}
                  {account.email ? ` · ${account.email}` : ""}
                </option>
              ))}
              <option value="local">Local calendar only, no invitations</option>
            </select>
          </label>
          {provider && provider !== "local" && (
            <label>
              Calendar
              <select
                aria-label="Writable calendar"
                value={calendarId}
                disabled={busy || loading}
                onChange={(event) => setCalendarId(event.target.value)}
              >
                {!calendars.length && (
                  <option value="">
                    {loading ? "Loading calendars…" : "No writable calendars found"}
                  </option>
                )}
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!loading && !accounts.length && (
            <p>
              To book with Google or Outlook, allow calendar write access in{" "}
              <a href="/settings#connections">Connections</a>.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="ar-calendar-review-actions">
            <button type="button" className="op-button" disabled={busy} onClick={onDismiss}>
              Discard
            </button>
            <button
              type="submit"
              className="op-button primary"
              disabled={busy || !provider || (provider !== "local" && (!calendarId || loading))}
            >
              {busy ? "Preparing…" : provider === "local" ? "Save local event" : "Review booking"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
