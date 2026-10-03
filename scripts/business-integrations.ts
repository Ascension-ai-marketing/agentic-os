import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AudienceMeasurementScope } from "../src/lib/audience-measurement";

type Provider = "youtube";
type AdapterOptions = { homeDir?: string; request?: typeof fetch };
export type BusinessIntegrationSnapshot = {
  platform: Provider;
  recordedAt: string;
  metrics: Record<string, number>;
  origin: "connector";
  sourceLabel: string;
  sourceUrl: string;
  measurementScope?: AudienceMeasurementScope;
};

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Read only the named integration's existing configuration. Do not copy credentials
// into the workspace, expose them through discovery, or scan unrelated providers.
function readConfig(file: string, keys: string[]) {
  const values: Record<string, string> = {};
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match || !keys.includes(match[1])) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      values[match[1]] = value.replace(/\\n$/, "").trim();
    }
  } catch {
    /* Missing configuration is reported as unavailable, without its path. */
  }
  return values;
}

/** Named configuration only. A key never implies ownership of a default channel. */
export function youtubeConfiguration(home = homedir()) {
  const keys = ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"];
  const env = {
    ...readConfig(join(home, ".config", "agentic-os.env"), keys),
  };
  return {
    key: env.YOUTUBE_API_KEY || "",
    channelId: /^UC[A-Za-z0-9_-]{22}$/.test(env.YOUTUBE_CHANNEL_ID || "")
      ? env.YOUTUBE_CHANNEL_ID
      : "",
  };
}

/** Resolve only channel identifiers. User URLs are never fetched directly. */
export function youtubeChannelSelector(
  input: unknown,
): { id: string } | { forHandle: string } | { forUsername: string } {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error("Enter a YouTube channel URL or @handle.");
  const value = input.trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(value)) return { id: value };
  if (/^@[\p{L}\p{N}\p{M}._-]{1,100}$/u.test(value)) return { forHandle: value };
  try {
    const url = new URL(/^(?:www\.|m\.)?youtube\.com\//i.test(value) ? `https://${value}` : value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error();
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    if (
      parts.length > 2 ||
      (parts.length === 2 &&
        parts[0].startsWith("@") &&
        !["videos", "shorts", "streams", "featured", "about", "playlists", "community"].includes(
          parts[1],
        ))
    )
      throw new Error();
    if (/^@[\p{L}\p{N}\p{M}._-]{1,100}$/u.test(parts[0] || "")) return { forHandle: parts[0] };
    if (parts[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1] || ""))
      return { id: parts[1] };
    if (parts[0] === "user" && /^[A-Za-z0-9._-]{1,100}$/.test(parts[1] || ""))
      return { forUsername: parts[1] };
  } catch {
    /* Return one actionable message without echoing the input. */
  }
  throw new Error("Enter a YouTube channel URL or @handle, rather than a video link.");
}

export async function configureYouTubeChannel(
  input: unknown,
  options: AdapterOptions = {},
): Promise<{ id: string; title: string; url: string }> {
  const selector = youtubeChannelSelector(input);
  const home = options.homeDir || homedir();
  const before = youtubeConfiguration(home);
  if (!before.key)
    throw new Error("Add a YouTube API key to ~/.config/agentic-os.env before choosing a channel.");
  let channel: { id: string; title: string; url: string };
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.search = new URLSearchParams({ part: "snippet", ...selector, key: before.key }).toString();
    const response = await (options.request || fetch)(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error();
    const data = JSON.parse(await responseText(response));
    if (!Array.isArray(data.items) || data.items.length !== 1) throw new Error();
    const item = data.items[0];
    if (
      !/^UC[A-Za-z0-9_-]{22}$/.test(item?.id || "") ||
      ("id" in selector && item.id !== selector.id) ||
      typeof item.snippet?.title !== "string" ||
      !item.snippet.title.trim()
    )
      throw new Error();
    channel = {
      id: item.id,
      title: item.snippet.title
        .replace(/[\u0000-\u001f]/g, "")
        .trim()
        .slice(0, 200),
      url: `https://www.youtube.com/channel/${item.id}`,
    };
  } catch {
    throw new Error(
      "YouTube could not find that channel. Check the link and your API connection, then try again. Your saved channel is unchanged.",
    );
  }
  const current = youtubeConfiguration(home);
  if (current.key !== before.key || current.channelId !== before.channelId)
    throw new Error("Your YouTube connection changed while checking the channel. Try again.");
  const directory = join(home, ".config"),
    file = join(directory, "agentic-os.env");
  const temporary = file + "." + randomUUID();
  try {
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()))
      throw new Error();
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    let replaced = false;
    const lines = existing.split(/\r?\n/).flatMap((line) => {
      if (!/^\s*(?:export\s+)?YOUTUBE_CHANNEL_ID\s*=/.test(line)) return [line];
      if (replaced) return [];
      replaced = true;
      return [`YOUTUBE_CHANNEL_ID=${channel.id}`];
    });
    if (!replaced) {
      if (lines.at(-1) === "") lines.pop();
      lines.push(`YOUTUBE_CHANNEL_ID=${channel.id}`);
    }
    const updated = lines
      .join(existing.includes("\r\n") ? "\r\n" : "\n")
      .replace(/(?:\r?\n)*$/, existing.includes("\r\n") ? "\r\n" : "\n");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(temporary, updated, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } catch {
    rmSync(temporary, { force: true });
    throw new Error(
      "The channel was found, but its selection could not be saved. Your other connection settings are unchanged.",
    );
  }
  return channel;
}

export function discoverBusinessIntegrations(options: AdapterOptions = {}) {
  const config = youtubeConfiguration(options.homeDir || homedir());
  return [
    {
      id: "youtube" as const,
      configured: Boolean(config.key && config.channelId),
      keyConfigured: Boolean(config.key),
      channelId: config.channelId,
    },
  ];
}

async function responseText(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body)
    throw new Error("Invalid provider response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0,
    text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("Invalid provider response");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function metric(value: unknown) {
  // Empty strings, absent fields and provider errors never become zero metrics.
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

export async function syncBusinessIntegration(
  provider: Provider,
  options: AdapterOptions = {},
): Promise<{ snapshots: BusinessIntegrationSnapshot[] }> {
  if (provider !== "youtube") throw new Error("Choose a supported business connection.");
  const config = youtubeConfiguration(options.homeDir || homedir());
  const request = options.request || fetch;
  if (!config.key || !config.channelId)
    throw new Error(
      "Configure your YouTube API key and channel ID in ~/.config/agentic-os.env first.",
    );

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.search = new URLSearchParams({
      part: "statistics",
      id: config.channelId,
      key: config.key,
    }).toString();
    const response = await request(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Provider unavailable");
    const item = JSON.parse(await responseText(response)).items?.find(
      (entry: any) => entry.id === config.channelId,
    );
    if (!item?.statistics || item.statistics.hiddenSubscriberCount)
      throw new Error("Missing channel count");
    const subscribers = metric(item.statistics.subscriberCount);
    if (subscribers === undefined) throw new Error("Missing channel count");
    const values: Record<string, number> = { followers: subscribers };
    const views = metric(item.statistics.viewCount),
      videos = metric(item.statistics.videoCount);
    if (views !== undefined) values.views = views;
    if (videos !== undefined) values.videos = videos;
    const snapshot: BusinessIntegrationSnapshot = {
      platform: "youtube",
      recordedAt: new Date().toISOString(),
      metrics: values,
      origin: "connector",
      sourceLabel: "YouTube · live API, rounded subscribers",
      measurementScope: "youtube-channel-totals-v1",
      sourceUrl: `https://www.youtube.com/channel/${config.channelId}`,
    };
    const current = youtubeConfiguration(options.homeDir || homedir());
    if (current.key !== config.key || current.channelId !== config.channelId)
      throw new Error("Connection changed");
    return { snapshots: [snapshot] };
  } catch {
    // Network exceptions can contain request URLs (including API keys), so never
    // forward a provider error, header, response body or credential path.
    throw new Error(
      "YouTube could not confirm a subscriber total. Check the saved connection and retry; existing numbers are unchanged.",
    );
  }
}
