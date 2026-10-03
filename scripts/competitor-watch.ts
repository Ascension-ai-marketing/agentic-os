import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { youtubeConfiguration, youtubeChannelSelector } from "./business-integrations";
import { youtubeDurationSeconds } from "./business-content";
import type { CompetitorWatchData, WatchChannel, WatchVideo } from "../src/lib/competitor-watch";

const defaults = ["@NetworkChuck", "@mreflow", "@LiamOttley"];
const number = (value: unknown) => {
  const n =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
const string = (value: unknown, limit = 500) =>
  typeof value === "string" ? value.slice(0, limit) : "";
function image(value: unknown) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" &&
      ["i.ytimg.com", "i9.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com"].includes(
        u.hostname,
      ) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}

/** Small public channel watch list. No Content Studio data or private strategy is read. */
export function competitorWatch(
  root: string,
  options: { homeDir?: string; request?: typeof fetch } = {},
) {
  const directory = join(root, ".operator-data"),
    file = join(directory, "competitor-watch.json");
  let pending = false;
  function read(): CompetitorWatchData {
    if (!existsSync(file)) return { channels: [], inputs: defaults, warnings: [] };
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(data.channels) || !Array.isArray(data.inputs) || data.inputs.length > 6)
        throw new Error();
      return data;
    } catch {
      throw new Error("The saved watch list could not be read. It has been preserved.");
    }
  }
  async function sync(input?: unknown): Promise<CompetitorWatchData> {
    if (pending) throw new Error("The watch list is already refreshing.");
    const prior = read();
    const supplied = input === undefined ? prior.inputs : input;
    if (
      !Array.isArray(supplied) ||
      supplied.length > 6 ||
      supplied.some((v) => typeof v !== "string")
    )
      throw new Error("Choose up to six YouTube channel links or handles.");
    const inputs = [...new Set(supplied.map((v) => v.trim()).filter(Boolean))];
    const selectors = inputs.map((value) => ({ value, selector: youtubeChannelSelector(value) }));
    const home = options.homeDir || homedir(),
      { key } = youtubeConfiguration(home);
    if (inputs.length && !key)
      throw new Error("Connect YouTube in Accounts to refresh the public watch list.");
    pending = true;
    try {
      const request = options.request || fetch;
      async function get(endpoint: string, params: Record<string, string>) {
        const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
        url.search = new URLSearchParams({ ...params, key }).toString();
        try {
          const response = await request(url, {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          });
          if (
            !response.ok ||
            !response.body ||
            Number(response.headers.get("content-length")) > 3 * 1024 * 1024
          )
            throw new Error();
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let bytes = 0,
            contents = "";
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 3 * 1024 * 1024) throw new Error();
              contents += decoder.decode(value, { stream: true });
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          const data = JSON.parse(contents + decoder.decode());
          if (!Array.isArray(data.items)) throw new Error();
          return data;
        } catch {
          throw new Error("Public YouTube data is temporarily unavailable.");
        }
      }
      const channels: WatchChannel[] = [],
        warnings: string[] = [];
      for (const { value, selector } of selectors) {
        try {
          const data = await get("channels", {
            part: "snippet,statistics,contentDetails",
            ...selector,
          });
          const channel = data.items[0];
          if (
            !channel ||
            !/^UC[A-Za-z0-9_-]{22}$/.test(channel.id) ||
            ("id" in selector && channel.id !== selector.id)
          )
            throw new Error();
          const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
          if (typeof playlistId !== "string" || !/^[\w-]{10,100}$/.test(playlistId))
            throw new Error();
          const uploads = await get("playlistItems", {
            part: "contentDetails",
            playlistId,
            maxResults: "50",
          });
          const ids = [
            ...new Set<string>(
              uploads.items
                .slice(0, 50)
                .map((item: any) => item.contentDetails?.videoId)
                .filter((id: unknown) => typeof id === "string" && /^[\w-]{11}$/.test(id)),
            ),
          ];
          const details = ids.length
            ? await get("videos", {
                part: "snippet,statistics,status,contentDetails",
                id: ids.join(","),
              })
            : { items: [] };
          const videos: WatchVideo[] = details.items
            .filter(
              (video: any) =>
                ids.includes(video.id) &&
                video.snippet?.channelId === channel.id &&
                video.status?.privacyStatus === "public" &&
                !["upcoming", "live"].includes(video.snippet?.liveBroadcastContent) &&
                Date.parse(video.snippet?.publishedAt) <= Date.now() &&
                (youtubeDurationSeconds(video.contentDetails?.duration) || 0) > 180,
            )
            .map((video: any) => ({
              id: video.id,
              title: string(video.snippet.title),
              publishedAt: new Date(video.snippet.publishedAt).toISOString(),
              thumbnailUrl:
                image(video.snippet.thumbnails?.high?.url) ||
                `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${video.id}`,
              views: number(video.statistics?.viewCount),
              durationSeconds: youtubeDurationSeconds(video.contentDetails.duration)!,
            }))
            .sort(
              (a: WatchVideo, b: WatchVideo) =>
                Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
            )
            .slice(0, 24);
          if (!channels.some((c) => c.id === channel.id))
            channels.push({
              id: channel.id,
              input: value,
              name: string(channel.snippet?.title, 160) || value,
              avatar: image(channel.snippet?.thumbnails?.medium?.url),
              subscribers: number(channel.statistics?.subscriberCount),
              recordedAt: new Date().toISOString(),
              videos,
            });
        } catch {
          const old = prior.channels.find((channel) => channel.input === value);
          if (old) channels.push(old);
          warnings.push(
            `${value} could not refresh.${old ? " Its earlier snapshot is still shown." : " Try refreshing again."}`,
          );
        }
      }
      if (inputs.length && !channels.length)
        throw new Error("The watch list could not refresh. Saved channels are unchanged.");
      if (youtubeConfiguration(home).key !== key)
        throw new Error("The YouTube connection changed. Refresh again.");
      const data = { channels, inputs, warnings, updatedAt: new Date().toISOString() };
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}`;
      writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      renameSync(temporary, file);
      return data;
    } finally {
      pending = false;
    }
  }
  return { read, sync };
}
