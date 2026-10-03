import { expect, test } from "bun:test";
import { businessToday, cityFromTimeZone, parseBriefNews, parseGeocode, parseWeather } from "./business-today";

test("news rejects unsafe links, deduplicates and selects three newest articles", () => {
  const article = (id: number, url = `https://example.com/${id}`) => ({ id, title: `<b>Article ${id}</b>`, summary: "A report", source_url: url, published_at: `2026-09-${10 + id}T07:00:00Z` });
  const result = parseBriefNews({ articles: [article(1), article(2), article(3), article(4), article(5, "javascript:alert(1)"), article(4), article(6, "https://user:secret@example.com")] });
  expect(result.map(a => a.id)).toEqual(["4", "3", "2"]);
  expect(result[0].title).toBe("Article 4");
});

test("weather keeps zero degrees and night, rejecting absent measurements", () => {
  const raw = { current: { temperature_2m: 0, apparent_temperature: -2, weather_code: 0, is_day: 0, time: 1790000000 }, daily: { temperature_2m_max: [4], temperature_2m_min: [-2] } };
  expect(parseWeather(raw)).toMatchObject({ temperatureC: 0, isDay: false, lowC: -2 });
  expect(() => parseWeather({ ...raw, daily: {} })).toThrow();
});

test("article imagery accepts public HTTPS and leaves unsafe or absent images out", () => {
  const article = { id: 1, title: "News", source_url: "https://example.com/news", published_at: "2026-09-17T07:00:00Z" };
  expect(parseBriefNews({ articles: [{ ...article, image_url: "https://media.beehiiv.com/picture.jpg" }] })[0].imageUrl).toBe("https://media.beehiiv.com/picture.jpg");
  for (const image_url of [undefined, "javascript:alert(1)", "http://example.com/image.jpg", "https://localhost/image", "https://127.0.0.1/image", "https://user:secret@example.com/image", "https://printer.local/image"])
    expect(parseBriefNews({ articles: [{ ...article, image_url }] })[0].imageUrl).toBeUndefined();
});

test("a failed weather feed does not hide news and concurrent requests share a fetch", async () => {
  let calls = 0;
  const request = (async (url: string) => { calls++; return url.includes("open-meteo") ? new Response("unavailable", { status: 503 }) : Response.json({ articles: [{ id: "a", title: "A source", source_url: "https://example.com/a", published_at: "2026-09-17T07:00:00Z" }] }); }) as typeof fetch;
  const service = businessToday({ request, weatherLocation: { name: "Example city", latitude: 1, longitude: 2 } });
  const [first, second] = await Promise.all([service.read(), service.read()]);
  expect(calls).toBe(2); expect(first).toEqual(second);
  expect(first.weather).toBeNull(); expect(first.weatherError).toBeTruthy(); expect(first.news).toHaveLength(1);
  await service.read(); expect(calls).toBe(2);
});


test("a fresh community copy sends no weather-location request", async () => {
  const requests: string[] = [];
  const request = (async (url: string) => { requests.push(url); return Response.json({ articles: [] }); }) as typeof fetch;
  const result = await businessToday({ request, weatherLocation: null }).read();
  expect(result.weather).toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toContain("latitude");
  expect(JSON.stringify(result)).not.toContain("Vienna");
});

test("a city falls out of the time zone when the profile has none", () => {
  expect(cityFromTimeZone("Europe/Vienna")).toBe("Vienna");
  expect(cityFromTimeZone("America/New_York")).toBe("New York");
  expect(cityFromTimeZone("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  for (const zone of ["UTC", "Etc/GMT+2", "US/Eastern", "GMT", "", undefined, 42]) expect(cityFromTimeZone(zone)).toBe("");
});

test("the profile city is geocoded once, weather follows it and a changed city refreshes the cache", async () => {
  const requests: string[] = [];
  let city = { name: "Vienna", source: "profile" as const };
  const request = (async (url: string) => {
    requests.push(url);
    if (url.includes("geocoding-api")) return Response.json({ results: [{ name: new URL(url).searchParams.get("name") === "Vienna" ? "Vienna" : "Graz", latitude: 47.5, longitude: 19.04, country: "PRIVATE_EXTRA" }] });
    if (url.includes("/v1/forecast")) return Response.json({ current: { temperature_2m: 21, apparent_temperature: 20, weather_code: 1, is_day: 1, time: 1790000000 }, daily: { temperature_2m_max: [25], temperature_2m_min: [14] } });
    return Response.json({ articles: [] });
  }) as typeof fetch;
  const service = businessToday({ request, city: () => city });
  const first = await service.read();
  expect(first.weather?.location).toBe("Vienna"); expect(first.weatherCity).toEqual({ name: "Vienna", source: "profile" });
  expect(requests.filter(url => url.includes("geocoding-api"))).toHaveLength(1);
  expect(requests.find(url => url.includes("/v1/forecast"))).toContain("latitude=47.5");
  expect(JSON.stringify(first)).not.toContain("PRIVATE_EXTRA");
  await service.read(); expect(requests.filter(url => url.includes("/v1/forecast"))).toHaveLength(1);
  city = { name: "Graz", source: "profile" };
  const second = await service.read();
  expect(second.weather?.location).toBe("Graz"); expect(requests.filter(url => url.includes("geocoding-api"))).toHaveLength(2);
  expect(() => parseGeocode({ results: [] }, "Nowhere")).toThrow("City not found");
});

test("an unknown city reports a clear weather error and still returns news", async () => {
  const request = (async (url: string) => url.includes("geocoding-api") ? Response.json({ results: [] }) : Response.json({ articles: [{ id: "a", title: "A source", source_url: "https://example.com/a", published_at: "2026-09-17T07:00:00Z" }] })) as typeof fetch;
  const result = await businessToday({ request, city: () => ({ name: "Atlantis", source: "timezone" }) }).read();
  expect(result.weather).toBeNull(); expect(result.weatherError).toContain("could not be found"); expect(result.weatherCity?.source).toBe("timezone"); expect(result.news).toHaveLength(1);
});
