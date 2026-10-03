import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  MapPin,
  Moon,
  Pencil,
  Sun,
  X,
} from "lucide-react";
import { SourceBrand } from "@/components/operator/source-brand";
import "./brief-today.css";

/** "Europe/Paris" reads as Paris. Mirrors the server rule so the pill has a name before the feed answers. */
function cityFromZone(timeZone: string | undefined): string {
  if (!timeZone || !timeZone.includes("/")) return "";
  const parts = timeZone.split("/").filter(Boolean);
  if (parts.length < 2 || /^(?:Etc|SystemV|US|Canada|Brazil|Mexico|Chile|Antarctica)$/i.test(parts[0])) return "";
  const last = parts[parts.length - 1].replace(/_/g, " ").trim();
  return /^(?:GMT|UTC|UCT|Universal|Zulu|Greenwich)/i.test(last) ? "" : last.slice(0, 80);
}

export type BriefToday = {
  weather: {
    location: string;
    temperatureC: number;
    apparentTemperatureC: number;
    weatherCode: number;
    isDay: boolean;
    highC: number;
    lowC: number;
    observedAt: string;
    sourceUrl: string;
  } | null;
  news: Array<{
    id: string;
    title: string;
    summary: string;
    url: string;
    publishedAt: string;
    imageUrl?: string;
  }>;
  weatherCity?: { name: string; source: "profile" | "timezone" | "environment" };
  weatherError?: string;
  newsError?: string;
  updatedAt: string;
};

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
function safeImage(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.includes(":")
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
function ArticleImage({ url, index }: { url?: string; index: number }) {
  const [failed, setFailed] = useState(false);
  const src = safeImage(url);
  return (
    <div className={`brief-news-visual${!src || failed ? " is-fallback" : ""}`} aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>
          {String(index + 1).padStart(2, "0")}
          <small>AI TODAY</small>
        </span>
      )}
      <span className="brief-news-open">
        <ArrowUpRight size={14} />
      </span>
    </div>
  );
}
function temperature(value: number) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : "—";
}
function condition(code: number, isDay: boolean) {
  if (code === 0 || code === 1)
    return {
      label: code === 0 ? "Clear" : "Mostly clear",
      kind: isDay ? "sun" : "night",
      Icon: isDay ? Sun : Moon,
    };
  if (code === 2 || code === 3)
    return { label: code === 2 ? "Partly cloudy" : "Overcast", kind: "cloud", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "Fog", kind: "fog", Icon: CloudFog };
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { label: "Snow", kind: "snow", Icon: CloudSnow };
  if ([95, 96, 99].includes(code))
    return { label: "Thunderstorms", kind: "rain", Icon: CloudLightning };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return { label: "Rain", kind: "rain", Icon: CloudRain };
  return { label: "Current weather", kind: "unknown", Icon: Cloud };
}

export function BriefWeather({
  weather,
  loading,
}: {
  weather: BriefToday["weather"];
  loading: boolean;
}) {
  const current =
    weather && Number.isFinite(weather.temperatureC)
      ? condition(weather.weatherCode, weather.isDay)
      : null;
  const Icon = current?.Icon ?? Cloud;
  const href = weather?.sourceUrl ? safeLink(weather.sourceUrl) : undefined;
  const observed = weather?.observedAt ? new Date(weather.observedAt) : null;
  const timestamp =
    observed && !Number.isNaN(observed.getTime())
      ? observed.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <aside
      className={`brief-weather is-${current?.kind ?? "unavailable"}`}
      aria-label="Weather"
    >
      <svg className="brief-skyline" viewBox="0 0 320 110" fill="none" aria-hidden="true">
        <path className="brief-river" d="M0 101H320M9 106H74M140 106H231M278 106H320" />
        <path d="M0 93H45V72H59V93H74V78H88V93H112V73H120V50H126V73H139V49L151 35V25L160 10L169 25V35L181 49V73H194V50H200V73H208V93H232V78H248V93H266V72H280V93H320" />
        <path d="M112 93V83H208V93M143 73V54H177V73M154 73V53M166 73V53M149 42H171M120 49L123 38L126 49M194 49L197 38L200 49M48 71L52 59L56 71M269 71L273 59L277 71M32 93V87H45M280 87H295V93" />
        <path d="M147 93V85M160 93V85M173 93V85M132 93V85M187 93V85" />
      </svg>
      <div className="brief-weather-main">
        <div>
          <span className="brief-weather-place">{weather?.location || "Your weather"}</span>
          <strong>
            {current && weather ? temperature(weather.temperatureC) : "—"}
            <small>{current ? "C" : ""}</small>
          </strong>
          <span className="brief-weather-description">
            {current?.label ?? (loading ? "Checking weather…" : weather?.location ? "Weather pending" : "Set your city")}
          </span>
        </div>
        <div className="brief-weather-motion" aria-hidden="true">
          <Icon strokeWidth={1.25} />
          <i />
          <i />
          <i />
        </div>
      </div>
      {current && weather && (
        <div className="brief-weather-range">
          <span>
            Feels {temperature(weather.apparentTemperatureC)} · H {temperature(weather.highC)} / L{" "}
            {temperature(weather.lowC)}
          </span>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {timestamp ? `Updated ${timestamp}` : "Weather source"}
              <ArrowUpRight size={10} />
            </a>
          ) : (
            timestamp && <span>Updated {timestamp}</span>
          )}
        </div>
      )}
    </aside>
  );
}

/** One calendar entry as the rail shows it: the fields of a CalendarEvent that matter for a glance. */
export type BriefEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};
/** One recently saved memory, as GET /search?recent=1 lists it. */
export type BriefMemoryItem = {
  id: string;
  title: string;
  collection: string;
  createdAt: string;
  origin?: string;
};

function clock(iso: string, timeZone?: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  } catch {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
}
function since(iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The rail beside the brief. It fills the brief's height: up to six stories,
 * then today's calendar, then (when there is still room) the latest memories.
 * The body scrolls on its own when there is more than fits.
 */
export function BriefNews({
  news,
  loading,
  events,
  eventsLoading = false,
  memory,
  memoryLoading = false,
  timeZone,
}: {
  news: BriefToday["news"];
  loading: boolean;
  events?: BriefEvent[];
  eventsLoading?: boolean;
  memory?: BriefMemoryItem[];
  memoryLoading?: boolean;
  timeZone?: string;
}) {
  const items = news.filter((item) => item.title && safeLink(item.url)).slice(0, 6);
  const dayEvents = (events || []).slice(0, 6);
  const recent = (memory || []).filter((item) => item.title).slice(0, 3);
  const body = useRef<HTMLDivElement>(null);
  const memoryBlock = useRef<HTMLElement>(null);
  // Recent memory is only worth showing when it fits without pushing the calendar
  // into a scroll. Measured, not guessed, so a long news day hides it.
  const [room, setRoom] = useState(false);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const memoryHeight = memoryBlock.current?.offsetHeight ?? 0;
      const rest = element.scrollHeight - memoryHeight;
      setRoom((shown) =>
        shown ? rest <= element.clientHeight + 1 : element.clientHeight - element.scrollHeight >= 112,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
  return (
    <section className="brief-news" aria-labelledby="brief-news-heading">
      <header>
        <div>
          <h3 id="brief-news-heading">In AI today</h3>
        </div>
        <a href="https://aiwithjack.com" target="_blank" rel="noopener noreferrer">
          AI with Jack <ArrowUpRight size={13} />
        </a>
      </header>
      <div className="brief-news-body" ref={body}>
        {items.length ? (
          <div className="brief-news-grid">
            {items.map((item, index) => {
              const published = new Date(item.publishedAt);
              return (
                <a
                  key={item.id}
                  href={safeLink(item.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="brief-news-item"
                >
                  <ArticleImage key={item.imageUrl || item.id} url={item.imageUrl} index={index} />
                  <h4>{item.title}</h4>
                  <p>{item.summary}</p>
                  {!Number.isNaN(published.getTime()) && (
                    <time dateTime={item.publishedAt}>
                      {published.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </time>
                  )}
                </a>
              );
            })}
          </div>
        ) : (
          <p className="brief-news-unavailable" role="status">
            {loading
              ? "Checking the news…"
              : "The news feed is unavailable. You can still read AI with Jack."}
          </p>
        )}

        {events !== undefined && (
          <section className="brief-rail-block" aria-labelledby="brief-rail-today">
            <div className="brief-rail-head">
              <h4 id="brief-rail-today">
                <CalendarDays size={13} aria-hidden="true" /> Today
              </h4>
              <a href="/calendar">
                Calendar <ArrowUpRight size={11} />
              </a>
            </div>
            {dayEvents.length ? (
              <ul className="brief-rail-events">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.start}>
                      {event.allDay ? "All day" : clock(event.start, timeZone)}
                    </time>
                    <span>
                      <strong>{event.title || "Untitled event"}</strong>
                      {!event.allDay && event.end && event.end !== event.start && (
                        <small>
                          until {clock(event.end, timeZone)}
                          {event.location ? ` · ${event.location}` : ""}
                        </small>
                      )}
                      {(event.allDay || !event.end || event.end === event.start) && event.location && (
                        <small>{event.location}</small>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="brief-rail-empty" role="status">
                {eventsLoading ? "Checking your calendar…" : "Nothing on the calendar today."}
              </p>
            )}
          </section>
        )}

        {memory !== undefined && room && (
          <section className="brief-rail-block" aria-labelledby="brief-rail-memory" ref={memoryBlock}>
            <div className="brief-rail-head">
              <h4 id="brief-rail-memory">
                <BookOpen size={13} aria-hidden="true" /> Recent memory
              </h4>
              <a href="/memory">
                Memory <ArrowUpRight size={11} />
              </a>
            </div>
            {recent.length ? (
              <ul className="brief-rail-memory">
                {recent.map((item) => (
                  <li key={item.id}>
                    <SourceBrand id={item.origin || "manual"} size={18} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.collection}
                        {since(item.createdAt) ? ` · ${since(item.createdAt)}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="brief-rail-empty" role="status">
                {memoryLoading ? "Opening your memory…" : "Nothing saved yet."}
              </p>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

/**
 * A compact weather pill for the brief header. The city comes from the feed's answer, else the
 * profile city, else the profile time zone; click the pill to change it without leaving the brief.
 */
export function BriefWeatherPill({
  weather,
  city: served,
  profileCity,
  timeZone,
  loading,
  error,
  onChangeCity,
}: {
  weather: BriefToday["weather"];
  city?: BriefToday["weatherCity"];
  profileCity?: string;
  timeZone?: string;
  loading: boolean;
  error?: string;
  onChangeCity?: (city: string) => Promise<void>;
}) {
  const derived = cityFromZone(timeZone);
  const city: BriefToday["weatherCity"] =
    served ??
    (profileCity?.trim()
      ? { name: profileCity.trim(), source: "profile" }
      : derived
        ? { name: derived, source: "timezone" }
        : undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const current =
    weather && Number.isFinite(weather.temperatureC)
      ? condition(weather.weatherCode, weather.isDay)
      : null;
  const Icon = current?.Icon ?? Cloud;
  const name = weather?.location || city?.name || "";
  useEffect(() => {
    if (editing) {
      setDraft(name);
      requestAnimationFrame(() => input.current?.select());
    }
  }, [editing, name]);
  async function commit() {
    const next = draft.trim().slice(0, 80);
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    if (!onChangeCity) return;
    setBusy(true);
    setProblem("");
    try {
      await onChangeCity(next);
      setEditing(false);
    } catch (cause) {
      setProblem((cause as Error).message || "The city could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    }
    if (event.key === "Escape") setEditing(false);
  }
  if (editing)
    return (
      <form
        className="brief-city-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <MapPin size={12} aria-hidden="true" />
        <label>
          <span className="sr-only">Your city for the weather</span>
          <input
            ref={input}
            type="text"
            value={draft}
            maxLength={80}
            placeholder="City"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keys}
            autoComplete="off"
          />
        </label>
        <button type="submit" aria-label="Save city" disabled={busy}>
          <Check size={12} />
        </button>
        <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setEditing(false)}>
          <X size={12} />
        </button>
        {problem && <em role="alert">{problem}</em>}
      </form>
    );
  const summary = current && weather
    ? `${temperature(weather.temperatureC)} · ${current.label}`
    : loading
      ? "Checking…"
      : error
        ? "Weather unavailable"
        : name
          ? "Weather pending"
          : "Set your city";
  return (
    <button
      type="button"
      className={`brief-weather-pill is-${current?.kind ?? "unavailable"}`}
      onClick={() => onChangeCity && setEditing(true)}
      title={
        name
          ? `${name} · ${city?.source === "timezone" ? "from your time zone" : city?.source === "profile" ? "from your profile" : "configured"} · click to change`
          : "Choose the city for your weather"
      }
      aria-label={`Weather${name ? ` for ${name}` : ""}: ${summary}. Change city`}
    >
      <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
      {name && <strong>{name}</strong>}
      <span>{summary}</span>
      {onChangeCity && <Pencil size={11} className="brief-weather-edit" aria-hidden="true" />}
    </button>
  );
}
