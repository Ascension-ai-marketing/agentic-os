/** Public context for the brief. Failures are independent; private workspace data is never sent. */
export type BusinessToday = {
  weather: { location: string; temperatureC: number; apparentTemperatureC: number; weatherCode: number; isDay: boolean; highC: number; lowC: number; observedAt: string; sourceUrl: string } | null;
  news: Array<{ id: string; title: string; summary: string; url: string; publishedAt: string; imageUrl?: string }>;
  /** Which city the weather is for and where that choice came from, so the UI can offer to change it. */
  weatherCity?: WeatherCity;
  weatherError?: string;
  newsError?: string;
  updatedAt: string;
};
export type WeatherLocation = { name: string; latitude: number; longitude: number };
export type WeatherCity = { name: string; source: "profile" | "timezone" | "environment" };

/** "Europe/Paris" → "Paris", "America/New_York" → "New York". Region-only or offset zones give nothing. */
export function cityFromTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== "string") return "";
  const parts = timeZone.trim().split("/").filter(Boolean);
  if (parts.length < 2 || /^(?:Etc|SystemV|US|Canada|Brazil|Mexico|Chile|Antarctica)$/i.test(parts[0])) return "";
  const last = parts[parts.length - 1].replace(/_/g, " ").replace(/[^\p{L}\p{N} '.-]/gu, "").trim();
  if (!last || /^(?:GMT|UTC|UCT|Universal|Zulu|Greenwich)/i.test(last)) return "";
  return last.slice(0, 80);
}
function geocodeUrl(name: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name, count: "1", language: "en", format: "json" }).toString();
  return url.href;
}
/** One public coordinate pair for a city name. Only the name and coordinates are kept. */
export function parseGeocode(raw: any, requested: string): WeatherLocation {
  const hit = raw?.results?.[0];
  if (!hit || !finite(hit.latitude) || !finite(hit.longitude) || Math.abs(hit.latitude) > 90 || Math.abs(hit.longitude) > 180) throw new Error("City not found.");
  return { name: clean(hit.name, 80) || requested, latitude: hit.latitude, longitude: hit.longitude };
}
function configuredWeather(): WeatherLocation | undefined {
  const name = process.env.AGENTIC_WEATHER_CITY?.trim();
  const lat = process.env.AGENTIC_WEATHER_LATITUDE, lon = process.env.AGENTIC_WEATHER_LONGITUDE;
  if (!name || !lat?.trim() || !lon?.trim()) return;
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return;
  return { name: name.slice(0, 80), latitude, longitude };
}
function weatherUrl(location: WeatherLocation) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: "temperature_2m,apparent_temperature,is_day,weather_code", daily: "temperature_2m_max,temperature_2m_min", timezone: "auto", forecast_days: "1", timeformat: "unixtime" }).toString();
  return url.href;
}
const NEWS_URL = "https://ask-jack-api-production.up.railway.app/api/news?limit=16&sources=rundown&days=3";
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function publicImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(":")) return;
    return url.href;
  } catch { return; }
}

export function parseWeather(raw: any, location = "Your city"): BusinessToday["weather"] {
  const c = raw?.current, d = raw?.daily;
  if (!c || !d || ![c.temperature_2m, c.apparent_temperature, c.weather_code, c.time, d.temperature_2m_max?.[0], d.temperature_2m_min?.[0]].every(finite) || ![0, 1].includes(c.is_day)) throw new Error("Weather data is incomplete.");
  const observedAt = new Date(c.time * 1000).toISOString();
  return { location, temperatureC: c.temperature_2m, apparentTemperatureC: c.apparent_temperature, weatherCode: c.weather_code, isDay: c.is_day === 1, highC: d.temperature_2m_max[0], lowC: d.temperature_2m_min[0], observedAt, sourceUrl: "https://open-meteo.com/" };
}

export function parseBriefNews(raw: any): BusinessToday["news"] {
  if (!Array.isArray(raw?.articles)) throw new Error("News data is unavailable.");
  const seen = new Set<string>();
  return raw.articles.slice(0, 40).flatMap((article: any) => {
    const title = clean(article?.title, 200), summary = clean(article?.summary, 420), publishedAt = clean(article?.published_at, 40);
    let url: URL;
    try { url = new URL(article?.source_url); } catch { return []; }
    if (!title || !Number.isFinite(Date.parse(publishedAt)) || !["https:", "http:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return [];
    seen.add(url.href);
    const imageUrl = publicImage(article?.image_url);
    return [{ id: clean(String(article?.id ?? url.href), 200), title, summary, url: url.href, publishedAt: new Date(publishedAt).toISOString(), ...(imageUrl ? { imageUrl } : {}) }];
  }).sort((a: BusinessToday["news"][number], b: BusinessToday["news"][number]) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 3);
}

async function json(url: string, request: typeof fetch) {
  const response = await request(url, { signal: AbortSignal.timeout(12000), redirect: "error", headers: { Accept: "application/json" } });
  if (!response.ok || !response.body) throw new Error("Feed unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error("Feed exceeds its size limit."); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * `city` answers which city the operator wants (profile first, then their time zone).
 * A fixed `weatherLocation` (or null) bypasses it. Without either, the environment
 * coordinates apply, and a fresh copy with nothing configured never asks for weather.
 */
export function businessToday(options: { request?: typeof fetch; now?: () => number; ttlMs?: number; weatherLocation?: WeatherLocation | null; city?: () => WeatherCity | undefined } = {}) {
  const request = options.request || fetch, now = options.now || Date.now;
  const configured = configuredWeather();
  const fixed = options.weatherLocation === undefined ? undefined : options.weatherLocation;
  const geocoded = new Map<string, WeatherLocation>();
  let cache: { value: BusinessToday; expires: number; key: string } | undefined, pending: { key: string; promise: Promise<BusinessToday> } | undefined;
  const chooseCity = (): WeatherCity | undefined => {
    if (fixed !== undefined) return fixed ? { name: fixed.name, source: "environment" } : undefined;
    const chosen = options.city?.();
    const name = clean(chosen?.name, 80);
    if (name && chosen) return { name, source: chosen.source };
    return configured ? { name: configured.name, source: "environment" } : undefined;
  };
  const locate = async (city: WeatherCity): Promise<WeatherLocation> => {
    if (fixed) return fixed;
    if (city.source === "environment" && configured) return configured;
    if (configured && configured.name.toLowerCase() === city.name.toLowerCase()) return configured;
    const key = city.name.toLowerCase();
    const known = geocoded.get(key);
    if (known) return known;
    const found = parseGeocode(await json(geocodeUrl(city.name.split(",")[0].trim() || city.name), request), city.name);
    if (geocoded.size >= 20) geocoded.delete(geocoded.keys().next().value as string);
    geocoded.set(key, found);
    return found;
  };
  return {
    async read(): Promise<BusinessToday> {
      const city = chooseCity(), key = city ? `${city.source}:${city.name.toLowerCase()}` : "";
      if (cache && cache.expires > now() && cache.key === key) return structuredClone(cache.value);
      if (!pending || pending.key !== key) {
        const promise = (async () => {
          const [weather, news] = await Promise.allSettled([
            city ? locate(city).then(location => json(weatherUrl(location), request).then(raw => parseWeather(raw, location.name))) : Promise.resolve(null),
            json(NEWS_URL, request).then(parseBriefNews),
          ]);
          const weatherError = weather.status === "rejected" ? (/City not found/.test(String((weather.reason as Error)?.message)) ? "That city could not be found. Check the city in your profile." : "Weather is unavailable. Try again shortly.") : undefined;
          const value: BusinessToday = { weather: weather.status === "fulfilled" ? weather.value : null, news: news.status === "fulfilled" ? news.value : [], updatedAt: new Date(now()).toISOString(), ...(city ? { weatherCity: city } : {}), ...(weatherError ? { weatherError } : {}), ...(news.status === "rejected" ? { newsError: "AI with Jack news is unavailable. Try again shortly." } : {}) };
          cache = { value, expires: now() + (weather.status === "rejected" || news.status === "rejected" ? 60000 : options.ttlMs ?? 600000), key };
          return value;
        })().finally(() => { if (pending?.promise === promise) pending = undefined; });
        pending = { key, promise };
      }
      return structuredClone(await pending.promise);
    },
  };
}
