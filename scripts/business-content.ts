import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { youtubeConfiguration } from "./business-integrations";
const VIDEO_LIMIT = 20;
const COMMENT_VIDEO_LIMIT = 6;
const UPLOAD_PAGE_SIZE = 50;
const MAX_UPLOAD_PAGES = 4;
const MIN_LONG_FORM_SECONDS = 180;
const COMMENTS_PER_VIDEO = 15;
const API_BASE = "https://www.googleapis.com/youtube/v3/";
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

type Options = { homeDir?: string; request?: typeof fetch };
type CommentStatus = "sampled" | "disabled" | "unavailable" | "none" | "not-sampled";
export type BusinessVideoComment = { id: string; text: string; author: string; authorChannelId?: string; isChannelOwner?: boolean; likes?: number; publishedAt: string };
export type BusinessVideo = {
  id: string; title: string; publishedAt: string; thumbnailUrl: string; url: string;
  views?: number; likes?: number; commentCount?: number;
  comments: BusinessVideoComment[]; commentStatus: CommentStatus; commentSampleSize: number;
  durationSeconds: number;
  commentSummary?: { text: string; viewerComments: number; ownerCommentsExcluded: number; questionCount: number; themes: { theme: string; count: number; examples: { videoId: string; commentId: string; text: string }[] }[] };
};
export type BusinessContentSnapshot = {
  channelId: string;
  videos: BusinessVideo[];
  recordedAt: string | null;
  sourceLabel: string;
  sourceUrl: string;
  insights: { theme: string; count: number; examples: { videoId: string; commentId: string; text: string }[] }[];
  insightMethod: string;
  sampling: {
    videoLimit: number; commentsPerVideo: number; commentsFetched: number;
    commentOrder: "time"; scope: string; videosWithUnavailableComments: number;
    audienceCommentsAnalyzed: number; channelOwnerCommentsExcludedFromInsights: number;
    firstVideoPublishedAt: string | null; lastVideoPublishedAt: string | null;
    earliestCommentAt: string | null; latestCommentAt: string | null;
  };
  warnings: string[];
  selection: { rule: "duration_gt_180"; minimumDurationSeconds: number; uploadsScanned: number; maxUploadsScanned: number };
};

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const numeric = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";

// YouTube's public API exposes ISO 8601 duration, not a reliable isShort flag.
// Requiring >3 minutes conservatively excludes Shorts and shorter landscape clips.
// https://support.google.com/youtube/answer/15424877
export function youtubeDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some(part => part !== undefined)) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

class ProviderFailure extends Error {
  constructor(readonly reason = "unavailable") { super("The video provider could not complete this request."); }
}

async function boundedJson(response: Response) {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new ProviderFailure();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, contents = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ProviderFailure();
      contents += decoder.decode(value, { stream: true });
    }
    return JSON.parse(contents + decoder.decode());
  } catch { throw new ProviderFailure(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function thumbnail(videoId: string, value: unknown) {
  try {
    const url = new URL(text(value, 2000));
    if (url.protocol === "https:" && ["i.ytimg.com", "i9.ytimg.com"].includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* Use the provider's canonical thumbnail URL. */ }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const themeRules = [
  { theme: "Setup and tutorials", pattern: /\b(how (?:do|can|to)|set[ -]?up|install(?:ation)?|tutorial|walkthrough|step.by.step|guide)\b/i },
  { theme: "Models and agents", pattern: /\b(claude|codex|deepseek|hermes|gpt|gemini|agent|agents|model|models|openclaw)\b/i },
  { theme: "Pricing and access", pattern: /\b(price|pricing|cost|costs|paid|free|subscription|credits|access|paywall)\b/i },
  { theme: "Reliability and limitations", pattern: /\b(bug|bugs|broken|error|errors|limit|limits|limitation|hallucination|doesn.t work|not working)\b/i },
  { theme: "Business applications", pattern: /\b(business|client|clients|customer|customers|revenue|sales|workflow|workflows|automation|automations)\b/i },
  { theme: "Privacy and local models", pattern: /\b(privacy|private|local|offline|ollama|self.host|on.device)\b/i },
];

function insights(videos: BusinessVideo[], channelId: string) {
  return themeRules.map(rule => {
    const matches = videos.flatMap(video => video.comments.filter(comment => comment.authorChannelId !== channelId && !comment.isChannelOwner && rule.pattern.test(comment.text)).map(comment => ({ videoId: video.id, commentId: comment.id, text: comment.text.slice(0, 300) })));
    return { theme: rule.theme, count: matches.length, examples: matches.slice(0, 3) };
  }).filter(theme => theme.count > 0).sort((a, b) => b.count - a.count);
}

function summarizeVideo(video: BusinessVideo, channelId: string): BusinessVideo["commentSummary"] {
  const viewers = video.comments.filter(comment => comment.authorChannelId !== channelId && !comment.isChannelOwner);
  const themes = insights([video], channelId);
  const questionCount = viewers.filter(comment => /\?/.test(comment.text)).length;
  const lead = video.commentStatus === "not-sampled" ? "Comment sampling covers the six newest videos. Open YouTube for this video’s comments."
    : video.commentStatus === "unavailable" ? "Comments could not be fetched for this video."
    : video.commentStatus === "disabled" ? "Comments are turned off for this video."
    : !viewers.length ? "No viewer comments were returned in this sample."
    : themes.length ? `In ${viewers.length} sampled viewer ${viewers.length === 1 ? "comment" : "comments"}, ${themes.slice(0, 2).map(item => `${item.theme.toLowerCase()} (${item.count})`).join(" and ")} ${themes.length === 1 ? "is the most frequent keyword theme" : "are the most frequent keyword themes"}.`
    : `${viewers.length} viewer ${viewers.length === 1 ? "comment was" : "comments were"} sampled; none matched the tracked keyword themes.`;
  return { text: lead + (questionCount ? ` ${questionCount} ${questionCount === 1 ? "comment includes" : "comments include"} a question.` : ""), viewerComments: viewers.length, ownerCommentsExcluded: video.comments.length - viewers.length, questionCount, themes };
}

function snapshot(videos: BusinessVideo[], recordedAt: string | null, channelId: string, uploadsScanned = 0): BusinessContentSnapshot {
  videos = videos.filter(video => Number.isFinite(video.durationSeconds) && video.durationSeconds > MIN_LONG_FORM_SECONDS).slice(0, VIDEO_LIMIT).map(video => ({ ...video, commentSummary: summarizeVideo(video, channelId) }));
  const comments = videos.flatMap(video => video.comments);
  const commentDates = comments.map(comment => comment.publishedAt).filter(Boolean).sort();
  const videoDates = videos.map(video => video.publishedAt).filter(Boolean).sort();
  const unavailable = videos.filter(video => video.commentStatus === "unavailable").length;
  const ownerComments = comments.filter(comment => comment.authorChannelId === channelId || comment.isChannelOwner).length;
  return {
    channelId, videos, recordedAt, sourceLabel: "YouTube · long-form uploads and sampled public comments",
    sourceUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : "https://www.youtube.com/",
    insights: insights(videos, channelId),
    insightMethod: "Keyword matches within sampled comments, excluding the channel owner identified by YouTube channel ID. A comment can match several themes. Counts describe this sample, not sentiment or the whole audience.",
    sampling: {
      videoLimit: VIDEO_LIMIT, commentsPerVideo: COMMENTS_PER_VIDEO, commentsFetched: comments.length, commentOrder: "time",
      scope: "Up to twenty recent public videos longer than three minutes; fifteen newest top-level comments on each of the six newest videos. Shorts and shorter clips are excluded, as are replies. This is a sample, not a complete comment history.",
      videosWithUnavailableComments: unavailable,
      audienceCommentsAnalyzed: comments.length - ownerComments, channelOwnerCommentsExcludedFromInsights: ownerComments,
      firstVideoPublishedAt: videoDates[0] || null, lastVideoPublishedAt: videoDates.at(-1) || null,
      earliestCommentAt: commentDates[0] || null, latestCommentAt: commentDates.at(-1) || null,
    },
    warnings: unavailable ? [`Comments could not be refreshed for ${unavailable} ${unavailable === 1 ? "video" : "videos"}. Themes include only successfully fetched comments.`] : [],
    selection: { rule: "duration_gt_180", minimumDurationSeconds: MIN_LONG_FORM_SECONDS, uploadsScanned, maxUploadsScanned: UPLOAD_PAGE_SIZE * MAX_UPLOAD_PAGES },
  };
}

export function businessContent(root: string, options: Options = {}) {
  const directory = join(root, ".operator-data"), file = join(directory, "business-content.json");
  const configuration = () => youtubeConfiguration(options.homeDir || homedir());
  const read = (): BusinessContentSnapshot => {
    const { channelId } = configuration();
    if (!existsSync(file)) return snapshot([], null, channelId);
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(data.videos) || !Array.isArray(data.insights) || !data.recordedAt || !data.sampling) throw new Error();
      // Legacy caches declare their channel in the source URL. Never re-label
      // another channel's videos/owner comments when the user changes accounts.
      const urlChannel = typeof data.sourceUrl === "string" ? data.sourceUrl.match(/^https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1] : undefined;
      const savedChannel = data.channelId || urlChannel;
      if (!channelId || savedChannel !== channelId || (urlChannel && urlChannel !== savedChannel)) {
        const empty = snapshot([], null, channelId);
        empty.warnings.push(channelId ? "Saved videos belong to a different or unverified channel. Refresh to load your configured channel; the earlier cache is preserved until a successful refresh." : "Choose your YouTube channel before displaying saved videos. Existing data is preserved.");
        return empty;
      }
      // Upgrade older caches on read without showing duration-unverified clips.
      const result = snapshot(data.videos, data.recordedAt, channelId, data.selection?.uploadsScanned || 0);
      if (data.videos.some((video: BusinessVideo) => !Number.isFinite(video.durationSeconds))) result.warnings.push("Refresh videos to verify the duration of older saved uploads.");
      return result;
    } catch { throw new Error("Saved video insights could not be read. Existing data was preserved."); }
  };

  return {
    read,
    async sync(): Promise<BusinessContentSnapshot> {
      const { key, channelId } = configuration();
      if (!key || !channelId) throw new Error("Configure your YouTube API key and channel ID in ~/.config/agentic-os.env first.");
      const request = options.request || fetch;
      const get = async (endpoint: "channels" | "playlistItems" | "videos" | "commentThreads", params: Record<string, string>) => {
        const url = new URL(API_BASE + endpoint);
        url.search = new URLSearchParams({ ...params, key }).toString();
        try {
          const response = await request(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
          const data = await boundedJson(response);
          if (!response.ok) {
            const disabled = Array.isArray(data?.error?.errors) && data.error.errors.some((error: any) => error.reason === "commentsDisabled");
            throw new ProviderFailure(disabled ? "commentsDisabled" : "unavailable");
          }
          if (!Array.isArray(data.items)) throw new ProviderFailure();
          return data;
        } catch (error) {
          if (error instanceof ProviderFailure) throw error;
          throw new ProviderFailure(); // Never expose URLs containing the key.
        }
      };

      try {
        const channelData = await get("channels", { part: "contentDetails", id: channelId });
        const uploads = channelData.items.find((channel: any) => channel.id === channelId)?.contentDetails?.relatedPlaylists?.uploads;
        if (typeof uploads !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(uploads)) throw new ProviderFailure();
        const candidates: any[] = [], seenUploads = new Set<string>(), seenTokens = new Set<string>();
        let pageToken = "";
        for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
          const playlist = await get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: String(UPLOAD_PAGE_SIZE), ...(pageToken ? { pageToken } : {}) });
          const ids = [...new Set<string>(playlist.items.slice(0, UPLOAD_PAGE_SIZE).map((item: any) => item.contentDetails?.videoId).filter((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id) && !seenUploads.has(id)))];
          ids.forEach(id => seenUploads.add(id));
          if (ids.length) {
            const details = await get("videos", { part: "snippet,statistics,status,contentDetails", id: ids.join(","), maxResults: String(UPLOAD_PAGE_SIZE) });
            candidates.push(...details.items.filter((video: any) => ids.includes(video.id) && video.snippet?.channelId === channelId && video.status?.privacyStatus === "public" && !["live", "upcoming"].includes(video.snippet?.liveBroadcastContent) && date(video.snippet?.publishedAt) && (youtubeDurationSeconds(video.contentDetails?.duration) ?? 0) > MIN_LONG_FORM_SECONDS));
          }
          if (candidates.length >= VIDEO_LIMIT) break;
          const next = text(playlist.nextPageToken, 1000);
          if (!next || seenTokens.has(next)) break;
          seenTokens.add(next); pageToken = next;
        }
        const publicVideos = [...new Map(candidates.map(video => [video.id, video])).values()].sort((a, b) => Date.parse(b.snippet.publishedAt) - Date.parse(a.snippet.publishedAt)).slice(0, VIDEO_LIMIT);
        const videos: BusinessVideo[] = [];
        // Sequential calls keep the public API workload bounded and gentle.
        for (const raw of publicVideos) {
          const s = raw.snippet, stats = raw.statistics || {};
          const video: BusinessVideo = {
            id: raw.id, title: text(s.title, 500) || "Untitled video", publishedAt: date(s.publishedAt),
            thumbnailUrl: thumbnail(raw.id, s.thumbnails?.high?.url || s.thumbnails?.medium?.url),
            url: `https://www.youtube.com/watch?v=${raw.id}`,
            comments: [], commentStatus: "none", commentSampleSize: 0,
            durationSeconds: youtubeDurationSeconds(raw.contentDetails.duration)!,
          };
          const views = numeric(stats.viewCount), likes = numeric(stats.likeCount), commentCount = numeric(stats.commentCount);
          if (views !== undefined) video.views = views;
          if (likes !== undefined) video.likes = likes;
          if (commentCount !== undefined) video.commentCount = commentCount;
          if (videos.length < COMMENT_VIDEO_LIMIT) try {
            const result = await get("commentThreads", { part: "snippet", videoId: raw.id, maxResults: String(COMMENTS_PER_VIDEO), order: "time", textFormat: "plainText" });
            const seen = new Set<string>();
            for (const row of result.items.slice(0, COMMENTS_PER_VIDEO)) {
              const comment = row.snippet?.topLevelComment, content = comment?.snippet;
              const id = text(comment?.id, 200), body = text(content?.textOriginal || content?.textDisplay, 12_000), publishedAt = date(content?.publishedAt);
              if (!id || !body || !publishedAt || seen.has(id)) continue;
              seen.add(id);
              const likes = numeric(content.likeCount);
              const authorChannelId = text(content.authorChannelId?.value, 100);
              video.comments.push({ id, text: body, author: text(content.authorDisplayName, 200) || "YouTube viewer", publishedAt,
                ...(authorChannelId ? { authorChannelId, isChannelOwner: authorChannelId === channelId } : {}),
                ...(likes !== undefined ? { likes } : {}) });
            }
            video.commentStatus = video.comments.length ? "sampled" : "none";
          } catch (error) {
            video.commentStatus = error instanceof ProviderFailure && error.reason === "commentsDisabled" ? "disabled" : "unavailable";
          }
          else video.commentStatus = "not-sampled";
          video.commentSampleSize = video.comments.length;
          videos.push(video);
        }
        const data = snapshot(videos, new Date().toISOString(), channelId, seenUploads.size);
        const current = configuration();
        if (current.channelId !== channelId || current.key !== key) throw new ProviderFailure("connectionChanged");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = file + "." + randomUUID();
        writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        renameSync(temporary, file);
        return data;
      } catch {
        throw new Error("YouTube could not refresh recent videos. Check the connection and try again; saved video insights are unchanged.");
      }
    },
  };
}
