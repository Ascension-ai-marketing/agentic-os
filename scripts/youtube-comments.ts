import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { providerKey } from "./provider-config";
import { FALLBACK_GUIDE, pickExamples, voicePrompt } from "./voice-drafts";
import { distillPrompt, lessonsBlock, migrateLessons, readLessons, readVoiceFile, recordLesson, voicePaths, writeVoice, type VoiceLesson } from "./voice-lessons";
import { voiceRules, type VoiceRules } from "./voice-rules";
import { slopCleanse, type SlopReport } from "./slop-cleanse";
import { excerptsFor, transcriptStore, type Transcript } from "./youtube-transcripts";
import { checkPrompt, isQuestion, parseCheck, type CheckVerdict } from "./reply-check";

/**
 * YouTube comment queue: every comment on the operator's videos that they have
 * not answered, each with a reply drafted in their own voice, one click to post.
 * Reading uses the channel's API key. Posting a reply needs the operator's own
 * Google sign-in (youtube.force-ssl), captured once through a short-lived
 * loopback listener. Nothing here posts on its own.
 */

const YT = "https://www.googleapis.com/youtube/v3";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
// Jack's pick (22 Sep 2026): every draft in his name comes from GPT-5.6 Sol.
const DEFAULT_MODEL = "openai/gpt-5.6-sol";
const DEFAULT_CHECK_MODEL = "anthropic/claude-haiku-4.5";
const AUTO_DRAFT_GAP_MS = 90000;
const DEFAULT_PORT = 8976;
const BATCH_SIZE = 10;
const DRAFT_CONCURRENCY = 3;
const DISTILL_EVERY = 5;
const MAX_THREAD = 30;
const MAX_DRAFT_LENGTH = 1500;
const MAX_PAGES = 30;
const MAX_COMMENTS = 6000;
const COMMENT_ID = /^[A-Za-z0-9_.-]{8,120}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY_HINT = "Add OPENROUTER_API_KEY to ~/.config/agentic-os.env, then try again.";
const UNCERTAIN = "YouTube may have received this reply, but it could not be confirmed. Check the comment on YouTube before replying again.";

export type YouTubeReply = { id: string; author: string; authorAvatar?: string; text: string; publishedAt: string; fromSelf: boolean };
export type YouTubeComment = {
  id: string;
  videoId: string;
  author: string;
  authorAvatar?: string;
  authorChannelId?: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  replyCount: number;
  /** The replies under the comment (other viewers and the owner), so the thread can be read in the queue. */
  replies?: YouTubeReply[];
  answered: boolean;
};
export type YouTubeDraft = {
  commentId: string;
  videoId: string;
  videoTitle: string;
  author: string;
  authorAvatar?: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  url: string;
  draft: string;
  generated?: string;
  note?: string;
  status: "draft" | "sent" | "skipped" | "hearted" | "removed";
  /** Set when the operator hearted it on YouTube or hid it from the video. */
  clearedAt?: string;
  /** The author was hidden from the whole channel, not just this comment. */
  bannedAuthor?: boolean;
  authorChannelId?: string;
  /** Set once the operator has had this comment on screen; the Unread filter shows the rest. */
  seenAt?: string;
  /** Short or long-form, from the video's length and YouTube's own /shorts/ answer. */
  kind?: VideoKind;
  /** SlopMonster pass: lint score before and after the rival-model cleanse. */
  slop?: SlopReport;
  /** Fact-check against the video transcript, for comments that ask something. */
  check?: { verdict: CheckVerdict | "unavailable"; evidence?: string; at: string };
  generatedAt: string;
  editedAt?: string;
  requestId?: string;
  replyId?: string;
  sentAt?: string;
  sentContent?: string;
};
type Voice = { version: 1; builtAt: string; guide: string; examples: string[]; sources: { replies: number }; model?: string; updatedAt?: string; lessonsDistilled?: number };
type Progress = { startedAt: string; done: number; total: number; stage: "voice" | "drafts" | "checks" | "polish"; error?: string; finishedAt?: string };
export type VideoKind = "short" | "video";
type Store = { version: 1; days: number; syncedAt?: string; lastError?: string; channel?: { avatar?: string; handle?: string; title?: string }; comments: YouTubeComment[]; videoTitles: Record<string, string>; videoKinds?: Record<string, VideoKind>; myReplies: string[]; drafts: YouTubeDraft[]; progress?: Progress; generatedAt?: string; model?: string };
/** ISO 8601 duration ("PT1M5S") in seconds. */
export function parseDuration(value: unknown): number | undefined {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value || ""));
  if (!match) return undefined;
  return (Number(match[1]) || 0) * 86400 + (Number(match[2]) || 0) * 3600 + (Number(match[3]) || 0) * 60 + (Number(match[4]) || 0);
}
type Connection = { version: 1; refreshToken: string; accessToken?: string; expires?: number; channelId: string; channelTitle: string; connectedAt: string };
type SendRequest = { requestId: string; commentId: string; contentHash: string; status: "pending" | "sent" | "failed" | "uncertain"; createdAt: string; finishedAt?: string; replyId?: string; error?: string };
export type YouTubeReplyResult = { status: "sent" | "failed" | "uncertain"; requestId: string; commentId: string; replyId?: string; error?: string; duplicate: boolean; retryable: boolean };
type Options = { homeDir?: string; request?: typeof fetch; model?: string; checkModel?: string; port?: number; listen?: boolean; now?: () => number; transcripts?: { get(videoId: string): Promise<Transcript | undefined>; count(): number }; rules?: VoiceRules };

function atomicWrite(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}
function text(value: unknown, limit = 5000) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
export function commentUrl(videoId: string, commentId: string) {
  return `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`;
}
/** A comment waits on the operator when someone else wrote it, nobody from the channel answered, and it is recent enough. */
export function needsReply(comment: YouTubeComment, channelId: string, days: number, now = Date.now()) {
  if (!comment || comment.authorChannelId === channelId || comment.answered) return false;
  return (now - Date.parse(comment.publishedAt)) / 86400000 <= days;
}
/** The operator's own YouTube replies, each canned line counted once. */
export function ownReplies(replies: string[], limit = 300) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of replies) {
    const content = raw.trim();
    if (content.length < 3 || content.length > 600) continue;
    const key = normalize(content).split(" ").slice(1).join(" ").slice(0, 50) || normalize(content);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(content);
  }
  return out.slice(0, limit);
}
export function parseDrafts(value: string, allowed: Set<string>) {
  const start = value.indexOf("{"), end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The drafting model did not return usable drafts. Try again.");
  const data = JSON.parse(value.slice(start, end + 1));
  const out = new Map<string, { reply: string; note?: string }>();
  for (const item of Array.isArray(data?.drafts) ? data.drafts : []) {
    const id = typeof item?.commentId === "string" ? item.commentId : "";
    const reply = typeof item?.reply === "string" ? item.reply.trim().replace(/—/g, ",") : "";
    if (!allowed.has(id) || !reply || reply.length > MAX_DRAFT_LENGTH) continue;
    const note = typeof item?.note === "string" && item.note.trim() ? item.note.trim().slice(0, 300) : undefined;
    out.set(id, { reply, ...(note ? { note } : {}) });
  }
  return out;
}
export function draftPrompt(voice: Voice, batch: YouTubeDraft[], lessons: VoiceLesson[] = [], rules = "") {
  const system = [
    "You write replies to YouTube comments AS the channel owner, in their exact voice. You are not an assistant; you are them.",
    "",
    "VOICE GUIDE:",
    voice.guide,
    "",
    "REAL COMMENT REPLIES THEY HAVE POSTED (match this register, length and warmth):",
    ...voice.examples.map(e => `- ${e.replace(/\s+/g, " ")}`),
    ...(rules ? ["", rules] : []),
    ...(lessons.length ? ["", lessonsBlock(lessons, rules ? 6 : 12)] : []),
    "",
    "RULES:",
    "- Reply to what the comment actually says. One or two short lines is normal; three at most.",
    "- Answer questions first, plainly. If the answer needs a fact you cannot know, write [detail] and say what to fill in inside \"note\".",
    "- Never invent links. A link that appears in the real replies above may be reused only for the same purpose it served there.",
    "- Thank compliments briefly, the way the examples do. Use the commenter's name only when the examples show that habit.",
    "- Stay kind under criticism; never argue, never get defensive.",
    "- At most one emoji, only where they would use one. No em dashes, no hashtags, no sign-offs, plain text only.",
    "- Return ONLY JSON: {\"drafts\":[{\"commentId\":\"...\",\"reply\":\"...\",\"note\":\"...\"}]}. Include every commentId given. \"note\" is optional and is for the owner, never posted.",
  ].join("\n");
  const user = batch.map((d, i) => `### Comment ${i + 1}\ncommentId: ${d.commentId}\nvideo: ${d.videoTitle}\nfrom: ${d.author}${d.likeCount ? ` (${d.likeCount} likes)` : ""}\n${d.text}`).join("\n\n");
  return { system, user: `Draft the owner's reply to each comment below.\n\n${user}` };
}

export function youtubeComments(root: string, options: Options = {}) {
  const directory = join(root, ".operator-data");
  const file = join(directory, "youtube-comments.json");
  const connectionFile = join(directory, "youtube-connection.json");
  const paths = voicePaths(root, "youtube");
  const voiceFile = paths.voice, lessonsFile = paths.lessons;
  migrateLessons(lessonsFile, join(directory, "youtube-voice-lessons.json"));
  const sendDirectory = join(directory, "youtube-send-requests");
  const home = options.homeDir || homedir();
  const fetcher = options.request || fetch;
  const now = options.now || Date.now;
  const port = options.port || Number(providerKey(root, "YOUTUBE_OAUTH_PORT", { home })) || DEFAULT_PORT;
  let running = false, syncing = false, lastAutoDraft = 0;
  const transcripts = options.transcripts || transcriptStore(root);
  const slop = slopCleanse(root, { homeDir: home, request: fetcher, rival: () => model() });
  const rules = options.rules || voiceRules(root, { homeDir: home, request: fetcher, now });
  let listener: { server: Server; state: string; timer: NodeJS.Timeout } | undefined;

  const apiKey = () => providerKey(root, "YOUTUBE_API_KEY", { home });
  const channelId = () => { const value = providerKey(root, "YOUTUBE_CHANNEL_ID", { home }); return /^UC[A-Za-z0-9_-]{22}$/.test(value) ? value : ""; };
  const client = () => ({ id: providerKey(root, "YOUTUBE_OAUTH_CLIENT_ID", { home }), secret: providerKey(root, "YOUTUBE_OAUTH_CLIENT_SECRET", { home }) });
  const modelKey = () => providerKey(root, "OPENROUTER_API_KEY", { home });
  const model = () => options.model || providerKey(root, "AGENTIC_YOUTUBE_DRAFT_MODEL", { home }) || DEFAULT_MODEL;
  const checkModel = () => options.checkModel || providerKey(root, "AGENTIC_YOUTUBE_CHECK_MODEL", { home }) || DEFAULT_CHECK_MODEL;

  const read = (): Store => {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.comments) || !Array.isArray(value.drafts)) throw new Error();
      return { days: 30, videoTitles: {}, myReplies: [], ...value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, days: 30, comments: [], videoTitles: {}, myReplies: [], drafts: [] };
      throw new Error("Your saved YouTube comments could not be read. The file was left unchanged.");
    }
  };
  const write = (value: Store) => { mkdirSync(directory, { recursive: true, mode: 0o700 }); atomicWrite(file, value); };
  const readConnection = (): Connection | undefined => {
    try {
      const value = JSON.parse(readFileSync(connectionFile, "utf8"));
      return value?.version === 1 && typeof value.refreshToken === "string" && value.refreshToken ? value : undefined;
    } catch { return undefined; }
  };
  const writeConnection = (value: Connection) => { mkdirSync(directory, { recursive: true, mode: 0o700 }); atomicWrite(connectionFile, value); };
  const readVoice = (): Voice | undefined => readVoiceFile<Voice>(voiceFile, join(directory, "youtube-voice.json"), "YouTube comment voice");

  async function apiGet(path: string, params: Record<string, string>, bearer?: string) {
    const url = new URL(`${YT}/${path}`);
    url.search = new URLSearchParams(bearer ? params : { ...params, key: apiKey() }).toString();
    let response: Response;
    try { response = await fetcher(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal: AbortSignal.timeout(30000) }); } catch { throw new Error("YouTube could not be reached. Check your connection and try again."); }
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiError(response.status, data));
    return data;
  }
  function apiError(status: number, data: any) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return "YouTube's daily API quota is used up. It resets at midnight Pacific time.";
    if (reason === "accessNotConfigured") return "The YouTube Data API is not enabled for this Google project. Enable it in Google Cloud Console, then try again.";
    if (reason === "insufficientPermissions" || status === 401) return "YouTube needs you to connect again. Choose Connect YouTube.";
    if (reason === "commentsDisabled") return "Comments are turned off for that video.";
    if (reason === "forbidden" || status === 403) return "YouTube refused this request for the connected account.";
    return `YouTube returned HTTP ${status}${data?.error?.message ? `: ${String(data.error.message).slice(0, 160)}` : ""}.`;
  }
  async function accessToken(): Promise<string> {
    const connection = readConnection();
    if (!connection) throw new Error("Connect YouTube before replying.");
    if (connection.accessToken && connection.expires && connection.expires - now() > 60000) return connection.accessToken;
    const { id, secret } = client();
    if (!id || !secret) throw new Error("Add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET to ~/.config/agentic-os.env.");
    let response: Response;
    try {
      response = await fetcher(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: connection.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(20000) });
    } catch { throw new Error("Google could not be reached to refresh the YouTube sign-in."); }
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.access_token !== "string") throw new Error("The YouTube sign-in expired. Choose Connect YouTube to sign in again.");
    writeConnection({ ...connection, accessToken: data.access_token, expires: now() + (Number(data.expires_in) || 3600) * 1000 });
    return data.access_token;
  }
  async function complete(system: string, user: string, maxTokens: number, useModel = model()) {
    const key = modelKey();
    if (!key) throw new Error(`No drafting model is configured. ${KEY_HINT}`);
    let response: Response;
    try {
      response = await fetcher(OPENROUTER, { method: "POST", signal: AbortSignal.timeout(180000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/ItsssssJack/claude-operating-system", "X-Title": "Agentic OS YouTube comment queue" }, body: JSON.stringify({ model: useModel, temperature: useModel === model() ? 0.7 : 0.2, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    } catch { throw new Error("The drafting model could not be reached. Check your connection and try again."); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) throw new Error(`OpenRouter rejected the API key. ${KEY_HINT}`);
      if (response.status === 402) throw new Error("OpenRouter has no credit left for this key. Top up, then draft again.");
      if (response.status === 429) throw new Error("The drafting model is rate limited. Wait a minute and try again.");
      throw new Error(`The drafting model returned HTTP ${response.status}. Try again.`);
    }
    const data: any = await response.json().catch(() => { throw new Error("The drafting model returned an unreadable response."); });
    const value = data?.choices?.[0]?.message?.content;
    if (typeof value !== "string" || !value.trim()) throw new Error(data?.error?.message ? `Drafting model error: ${String(data.error.message).slice(0, 200)}` : "The drafting model returned no text.");
    return value;
  }

  function replyOf(r: any, mine: string): YouTubeReply | undefined {
    const s = r?.snippet;
    if (!s || typeof r.id !== "string" || !COMMENT_ID.test(r.id)) return undefined;
    return { id: r.id, author: text(s.authorDisplayName, 120) || "YouTube viewer", authorAvatar: /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|lh3\.googleusercontent\.com)\//.test(String(s.authorProfileImageUrl || "")) ? String(s.authorProfileImageUrl) : undefined, text: text(s.textOriginal ?? s.textDisplay, 1500), publishedAt: new Date(String(s.publishedAt || 0)).toISOString(), fromSelf: s.authorChannelId?.value === mine };
  }
  function comment(raw: any, mine: string): YouTubeComment | undefined {
    const top = raw?.snippet?.topLevelComment, s = top?.snippet;
    if (!top || typeof top.id !== "string" || !COMMENT_ID.test(top.id) || !s || !VIDEO_ID.test(String(s.videoId || raw.snippet.videoId || ""))) return undefined;
    const replies: any[] = Array.isArray(raw.replies?.comments) ? raw.replies.comments : [];
    const thread = replies.map(r => replyOf(r, mine)).filter((r): r is YouTubeReply => !!r).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(0, MAX_THREAD);
    return {
      id: top.id, videoId: String(s.videoId || raw.snippet.videoId), author: text(s.authorDisplayName, 120) || "YouTube viewer",
      authorAvatar: /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|lh3\.googleusercontent\.com)\//.test(String(s.authorProfileImageUrl || "")) ? String(s.authorProfileImageUrl) : undefined,
      authorChannelId: text(s.authorChannelId?.value, 40) || undefined, text: text(s.textOriginal ?? s.textDisplay, 4000),
      publishedAt: new Date(String(s.publishedAt || 0)).toISOString(), likeCount: Number(s.likeCount) || 0,
      replyCount: Number(raw.snippet?.totalReplyCount) || replies.length, ...(thread.length ? { replies: thread } : {}), answered: replies.some(r => r?.snippet?.authorChannelId?.value === mine),
    };
  }
  async function sync(body: { days?: unknown } = {}) {
    if (syncing) throw new Error("YouTube comments are already refreshing.");
    const key = apiKey(), mine = channelId();
    if (!key || !mine) throw new Error("Add YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID to ~/.config/agentic-os.env first.");
    const days = typeof body.days === "number" && Number.isFinite(body.days) ? Math.max(1, Math.min(365, Math.round(body.days))) : read().days || 30;
    syncing = true;
    try {
      const cutoff = now() - days * 86400000;
      const collected: YouTubeComment[] = [];
      const collectedIds = new Set<string>();
      const myReplies: string[] = [];
      const needFullReplies: YouTubeComment[] = [];
      let page = "";
      for (let i = 0; i < MAX_PAGES; i++) {
        const data = await apiGet("commentThreads", { part: "snippet,replies", allThreadsRelatedToChannelId: mine, order: "time", maxResults: "100", textFormat: "plainText", ...(page ? { pageToken: page } : {}) });
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        let reachedCutoff = false;
        for (const raw of items) {
          const item = comment(raw, mine);
          if (!item) continue;
          for (const r of Array.isArray(raw.replies?.comments) ? raw.replies.comments : []) if (r?.snippet?.authorChannelId?.value === mine) myReplies.push(text(r.snippet.textOriginal ?? r.snippet.textDisplay, 600));
          if (Date.parse(item.publishedAt) < cutoff) { reachedCutoff = true; continue; }
          if (collectedIds.has(item.id)) continue;
          collectedIds.add(item.id);
          if (!item.answered && item.replyCount > (Array.isArray(raw.replies?.comments) ? raw.replies.comments.length : 0)) needFullReplies.push(item);
          collected.push(item);
        }
        page = typeof data?.nextPageToken === "string" ? data.nextPageToken : "";
        if (!page || reachedCutoff || collected.length >= MAX_COMMENTS) break;
      }
      for (const item of needFullReplies.slice(0, 200)) {
        const data = await apiGet("comments", { part: "snippet", parentId: item.id, maxResults: "100", textFormat: "plainText" });
        const full: any[] = Array.isArray(data?.items) ? data.items : [];
        for (const r of full) if (r?.snippet?.authorChannelId?.value === mine) { item.answered = true; myReplies.push(text(r.snippet.textOriginal ?? r.snippet.textDisplay, 600)); }
        const thread = full.map(r => replyOf(r, mine)).filter((r): r is YouTubeReply => !!r).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(0, MAX_THREAD);
        if (thread.length) item.replies = thread;
      }
      const current = read();
      // The owner's own avatar and handle, for the creator heart and the reply rows (once, then cached).
      let channelInfo = current.channel;
      if (!channelInfo?.avatar) {
        try {
          const data = await apiGet("channels", { part: "snippet", id: mine, maxResults: "1" });
          const snippet = data?.items?.[0]?.snippet;
          const avatarUrl = String(snippet?.thumbnails?.default?.url || snippet?.thumbnails?.medium?.url || "");
          channelInfo = { ...(channelInfo || {}), ...(/^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|lh3\.googleusercontent\.com)\//.test(avatarUrl) ? { avatar: avatarUrl } : {}), handle: text(snippet?.customUrl, 80) || channelInfo?.handle, title: text(snippet?.title, 120) || channelInfo?.title };
        } catch { /* Initials do until the next refresh. */ }
      }
      const titles = { ...current.videoTitles };
      const kinds: Record<string, VideoKind> = { ...(current.videoKinds || {}) };
      const missing = [...new Set(collected.map(c => c.videoId))].filter(id => !titles[id] || !kinds[id]);
      for (let i = 0; i < missing.length; i += 50) {
        const data = await apiGet("videos", { part: "snippet,contentDetails", id: missing.slice(i, i + 50).join(","), maxResults: "50" });
        for (const v of Array.isArray(data?.items) ? data.items : []) {
          if (!VIDEO_ID.test(String(v?.id || ""))) continue;
          titles[v.id] = text(v.snippet?.title, 200) || "Untitled video";
          const seconds = parseDuration(v.contentDetails?.duration);
          // Anything over three minutes cannot be a Short. Under that, YouTube itself says: /shorts/<id> stays put for a Short and redirects for a video.
          if (seconds === undefined) continue;
          if (seconds > 180) { kinds[v.id] = "video"; continue; }
          if (seconds <= 60) { kinds[v.id] = "short"; continue; }
          try {
            const probe = await fetcher(`https://www.youtube.com/shorts/${v.id}`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0" } });
            await probe.body?.cancel().catch(() => {});
            kinds[v.id] = probe.status >= 300 && probe.status < 400 ? "video" : "short";
          } catch { kinds[v.id] = "short"; }
        }
      }
      const answeredNow = new Set(collected.filter(c => c.answered).map(c => c.id));
      const drafts = current.drafts.filter(d => d.status === "sent" || !answeredNow.has(d.commentId)).map(d => ({ ...d, videoTitle: titles[d.videoId] || d.videoTitle }));
      write({ ...current, days, syncedAt: new Date(now()).toISOString(), lastError: undefined, ...(channelInfo ? { channel: channelInfo } : {}), comments: collected, videoTitles: titles, videoKinds: kinds, myReplies: ownReplies([...myReplies, ...current.myReplies], 600), drafts });
      void autoDraft();
      return status();
    } catch (error) {
      const reason = (error as Error).message || "YouTube comments could not be refreshed.";
      try { write({ ...read(), lastError: reason }); } catch { /* The error is returned either way. */ }
      throw error;
    } finally { syncing = false; }
  }

  async function buildVoice(): Promise<Voice> {
    const replies = ownReplies(read().myReplies);
    if (replies.length < 5) throw new Error("Refresh YouTube comments first so your past replies can teach the queue your voice.");
    let guide = FALLBACK_GUIDE, used: string | undefined;
    if (modelKey()) {
      const prompt = voicePrompt(replies.slice(0, 160), []);
      guide = (await complete(prompt.system, prompt.user, 1200)).trim().slice(0, 4000);
      used = model();
    }
    const voice: Voice = { version: 1, builtAt: new Date(now()).toISOString(), guide, examples: pickExamples(replies.map(content => ({ content })), 40), sources: { replies: replies.length }, ...(used ? { model: used } : {}) };
    writeVoice(voiceFile, voice, "YouTube comment voice");
    return voice;
  }
  /** One draft per comment: a sent one wins, otherwise the newest. */
  function uniqueDrafts(drafts: YouTubeDraft[]) {
    const byId = new Map<string, YouTubeDraft>();
    for (const d of drafts) {
      const have = byId.get(d.commentId);
      if (!have || (have.status !== "sent" && (d.status === "sent" || (d.generatedAt || "") >= (have.generatedAt || "")))) byId.set(d.commentId, d);
    }
    return [...byId.values()];
  }
  function waiting(store: Store, days: number) {
    const mine = channelId();
    return store.comments.filter(c => needsReply(c, mine, days, now())).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  async function run(days: number, force: boolean) {
    const started = read();
    const current = new Map(started.drafts.map(d => [d.commentId, d]));
    const targets = waiting(started, days);
    const keep = (d: YouTubeDraft | undefined) => !!d && (d.status === "sent" || (!force && (d.status === "skipped" || !!d.draft)));
    const pending = targets.filter(c => !keep(current.get(c.id)));
    const pendingIds = new Set(pending.map(c => c.id)), liveIds = new Set(targets.map(c => c.id));
    const progress: Progress = { startedAt: new Date(now()).toISOString(), done: 0, total: pending.length, stage: "voice" };
    const save = (extra: Partial<Store> = {}) => {
      const latest = read();
      const kept = latest.drafts.filter(d => !pendingIds.has(d.commentId) && (liveIds.has(d.commentId) || d.status === "sent"));
      const regenerated = pending.map(c => {
        const mine = current.get(c.id);
        if (!mine) return undefined;
        const disk = latest.drafts.find(d => d.commentId === c.id);
        if (!disk) return mine;
        if (disk.status === "sent") return disk;
        return { ...mine, status: disk.status, ...(disk.editedAt ? { draft: disk.draft, editedAt: disk.editedAt } : {}) };
      }).filter((d): d is YouTubeDraft => !!d);
      const sentHistory = kept.filter(d => d.status === "sent").sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")).slice(0, 500);
      write({ ...latest, ...extra, days, progress, drafts: uniqueDrafts([...kept.filter(d => d.status !== "sent"), ...sentHistory, ...regenerated]) });
    };
    try {
      for (const c of pending) {
        const previous = current.get(c.id);
        current.set(c.id, { commentId: c.id, videoId: c.videoId, videoTitle: started.videoTitles[c.videoId] || "Untitled video", author: c.author, authorAvatar: c.authorAvatar, ...(c.authorChannelId ? { authorChannelId: c.authorChannelId } : {}), text: c.text, publishedAt: c.publishedAt, likeCount: c.likeCount, url: commentUrl(c.videoId, c.id), draft: previous?.draft || "", status: "draft", generatedAt: previous?.generatedAt || "" });
      }
      save();
      let voice = readVoice() || (await buildVoice());
      const lessons = readLessons(lessonsFile);
      if (lessons.length >= DISTILL_EVERY && lessons.length - (voice.lessonsDistilled || 0) >= DISTILL_EVERY) {
        try {
          const prompt = distillPrompt(voice.guide, lessons);
          const guide = (await complete(prompt.system, prompt.user, 1300)).trim().slice(0, 4500);
          if (guide.length > 200) { voice = { ...voice, guide, updatedAt: new Date(now()).toISOString(), lessonsDistilled: lessons.length }; writeVoice(voiceFile, voice, "YouTube comment voice"); }
        } catch { /* The previous guide still applies; the corrections are in the prompt anyway. */ }
      }
      try { await rules.catchUp(lessons); await rules.refine(lessons); } catch { /* The rules already written still apply. */ }
      const rulesText = rules.block("youtube");
      progress.stage = "drafts";
      save({ model: model() });
      const queue = pending.map(c => current.get(c.id)!);
      const batches: YouTubeDraft[][] = [];
      for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));
      let next = 0, failure: Error | undefined;
      const worker = async () => {
        while (next < batches.length && !failure) {
          const batch = batches[next++];
          try {
            const prompt = draftPrompt(voice, batch, lessons, rulesText);
            const value = await complete(prompt.system, prompt.user, 600 + batch.length * 260);
            const drafts = parseDrafts(value, new Set(batch.map(d => d.commentId)));
            for (const item of batch) {
              const made = drafts.get(item.commentId);
              current.set(item.commentId, { ...item, draft: made?.reply || item.draft, ...(made ? { generated: made.reply } : {}), ...(made?.note ? { note: made.note } : {}), generatedAt: new Date(now()).toISOString(), ...(made ? {} : { note: "The model skipped this one. Write the reply yourself or draft again." }) });
            }
            // SlopMonster: a rival model strips the tells the drafting model wrote.
            if (slop.configured()) {
              const polished = await slop.polish(batch.filter(i => current.get(i.commentId)?.draft).map(i => ({ id: i.commentId, text: current.get(i.commentId)!.draft })), "This is a short reply from a YouTube creator to a comment under their own video.");
              for (const [id, result] of polished) { const item = current.get(id)!; current.set(id, { ...item, draft: result.text, generated: result.text, slop: result.report }); }
            }
            progress.done = Math.min(queue.length, progress.done + batch.length);
            save({ generatedAt: new Date(now()).toISOString() });
          } catch (error) { failure = error as Error; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, batches.length) }, worker));
      if (failure) throw failure;
      progress.finishedAt = new Date(now()).toISOString();
      save({ generatedAt: new Date(now()).toISOString() });
    } catch (error) {
      progress.error = (error as Error).message || "Drafting stopped unexpectedly.";
      progress.finishedAt = new Date(now()).toISOString();
      save();
      running = false;
      return;
    }
    // Drafting done: now check every answer to a question against its video.
    await runChecks();
  }
  /** Checks one drafted answer against the video; a wrong draft is rewritten to match the video. */
  async function checkDraft(item: YouTubeDraft): Promise<YouTubeDraft> {
    if (!item.draft || !isQuestion(item.text)) return item;
    const at = new Date(now()).toISOString();
    let transcript: Transcript | undefined, problem = "This video has no transcript.";
    try { transcript = await transcripts.get(item.videoId); } catch (error) { transcript = undefined; problem = (error as Error).message || problem; }
    if (!transcript || !transcript.text) return { ...item, check: { verdict: "unavailable", evidence: problem.slice(0, 200), at } };
    const prompt = checkPrompt({ comment: item.text, draft: item.draft, videoTitle: item.videoTitle, excerpts: excerptsFor(transcript, `${item.text} ${item.draft}`) });
    const result = parseCheck(await complete(prompt.system, prompt.user, 500, checkModel()));
    if (result.verdict === "contradicted" && result.reply) {
      return { ...item, draft: result.reply, generated: result.reply, note: `Fixed from the video${result.evidence ? `: "${result.evidence}"` : "."}`, check: { verdict: "contradicted", evidence: result.evidence, at } };
    }
    if (result.verdict === "not_in_video") return { ...item, ...(item.note ? {} : { note: "The video does not cover this. Check the answer before sending." }), check: { verdict: "not_in_video", at } };
    return { ...item, check: { verdict: "supported", evidence: result.evidence, at } };
  }
  /** Checks every unchecked question draft; runs on its own after drafting and on demand. */
  async function runChecks() {
    const progress: Progress = { startedAt: new Date(now()).toISOString(), done: 0, total: 0, stage: "checks" };
    try {
      const store = read();
      // A check that could not run (no transcript yet, helper missing) is tried again next time.
      const targets = store.drafts.filter(d => d.status === "draft" && !!d.draft && (!d.check || d.check.verdict === "unavailable") && isQuestion(d.text)).map(d => d.commentId);
      progress.total = targets.length;
      write({ ...store, progress });
      let next = 0;
      const worker = async () => {
        while (next < targets.length) {
          const id = targets[next++];
          const latest = read();
          const item = latest.drafts.find(d => d.commentId === id);
          if (!item || item.status !== "draft" || (item.check && item.check.verdict !== "unavailable")) { progress.done++; continue; }
          let checked: YouTubeDraft;
          try { checked = await checkDraft(item); } catch (error) {
            const message = (error as Error).message || "";
            if (/credit|rejected the API key|rate limited/.test(message)) throw error;
            checked = { ...item, check: { verdict: "unavailable", evidence: message.slice(0, 160), at: new Date(now()).toISOString() } };
          }
          const fresh = read();
          const current = fresh.drafts.find(d => d.commentId === id);
          // A draft the operator edited or sent meanwhile keeps their text; only the check result lands.
          if (current) Object.assign(current, current.editedAt || current.status !== "draft" ? { check: checked.check } : checked);
          progress.done++;
          write({ ...fresh, progress });
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
      progress.finishedAt = new Date(now()).toISOString();
      write({ ...read(), progress });
    } catch (error) {
      progress.error = (error as Error).message || "Checking stopped unexpectedly.";
      progress.finishedAt = new Date(now()).toISOString();
      try { write({ ...read(), progress }); } catch { /* Reported on the next status read. */ }
    } finally { running = false; }
  }
  /** Runs the SlopMonster pass over every waiting draft that has not had it yet. */
  async function runPolish() {
    const progress: Progress = { startedAt: new Date(now()).toISOString(), done: 0, total: 0, stage: "polish" };
    try {
      const store = read();
      const targets = store.drafts.filter(d => d.status === "draft" && !!d.draft && !d.slop && !d.editedAt).map(d => ({ id: d.commentId, text: d.draft }));
      progress.total = targets.length;
      write({ ...store, progress });
      await slop.polish(targets, "This is a short reply from a YouTube creator to a comment under their own video.", (id, result) => {
        const latest = read();
        const item = latest.drafts.find(d => d.commentId === id);
        if (item && item.status === "draft" && !item.editedAt) Object.assign(item, { draft: result.text, generated: result.text, slop: result.report });
        progress.done++;
        write({ ...latest, progress });
      });
      progress.finishedAt = new Date(now()).toISOString();
      write({ ...read(), progress });
    } catch (error) {
      progress.error = (error as Error).message || "The cleanse stopped unexpectedly.";
      progress.finishedAt = new Date(now()).toISOString();
      try { write({ ...read(), progress }); } catch { /* Reported on the next read. */ }
    } finally { running = false; }
  }
  function polish() {
    if (running) throw new Error("Drafts are already being written. Wait for that to finish.");
    if (!slop.configured()) throw new Error(`No cleanse model is configured. ${KEY_HINT}`);
    running = true;
    void runPolish();
    return { started: true };
  }
  function check(body: { all?: unknown } = {}) {
    if (running) throw new Error("Drafts are already being written. Wait for that to finish.");
    if (!modelKey()) throw new Error(`No checking model is configured. ${KEY_HINT}`);
    running = true;
    void runChecks();
    return { started: true, all: body.all === true };
  }
  /** Starts drafting on its own when comments are waiting without a draft. Cheap when there is nothing new. */
  function autoDraft() {
    if (running || !modelKey() || now() - lastAutoDraft < AUTO_DRAFT_GAP_MS) return false;
    let store: Store;
    try { store = read(); } catch { return false; }
    if (!store.syncedAt) return false;
    const needs = waiting(store, store.days || 30).some(c => { const d = store.drafts.find(x => x.commentId === c.id); return !d || (d.status === "draft" && !d.draft); });
    if (!needs) return false;
    lastAutoDraft = now();
    try { generate({ days: store.days || 30 }); return true; } catch { return false; }
  }
  function generate(body: { days?: unknown; force?: unknown } = {}) {
    if (running) throw new Error("Drafts are already being written. Wait for that to finish.");
    const store = read();
    if (!store.syncedAt) throw new Error("Refresh YouTube comments before drafting replies.");
    if (!modelKey()) throw new Error(`No drafting model is configured. ${KEY_HINT}`);
    const days = typeof body.days === "number" && Number.isFinite(body.days) ? Math.max(1, Math.min(365, Math.round(body.days))) : store.days || 30;
    running = true;
    void run(days, body.force === true);
    return { started: true, days };
  }
  function update(body: { commentId?: unknown; draft?: unknown; status?: unknown } = {}) {
    if (typeof body.commentId !== "string" || !COMMENT_ID.test(body.commentId)) throw new Error("Choose a drafted comment first.");
    const store = read();
    const item = store.drafts.find(d => d.commentId === body.commentId);
    if (!item) throw new Error("That comment is not in the queue any more.");
    if (item.status === "sent") throw new Error("This reply was already posted.");
    if (typeof body.draft === "string") {
      if (body.draft.length > MAX_DRAFT_LENGTH || body.draft.includes("\0")) throw new Error(`Keep the reply under ${MAX_DRAFT_LENGTH} characters.`);
      item.draft = body.draft; item.editedAt = new Date(now()).toISOString();
    }
    if (body.status === "skipped" || body.status === "draft" || body.status === "hearted") {
      if (item.status === "removed") throw new Error("This comment was removed from the video.");
      item.status = body.status;
      if (body.status === "hearted") item.clearedAt = new Date(now()).toISOString();
    }
    write(store);
    return item;
  }

  /**
   * Hide a comment from the video (YouTube "rejected" moderation status). Only
   * the channel owner's sign-in can do this, and only for comments on their
   * own videos. Nothing is drafted or posted; the card just leaves the queue.
   */
  /** Hides a comment from the video. With banAuthor, YouTube also auto-rejects anything else that person posts on the channel (Studio calls it "Hide user from channel"). */
  async function remove(body: { commentId?: unknown; banAuthor?: unknown } = {}) {
    if (typeof body.commentId !== "string" || !COMMENT_ID.test(body.commentId)) throw new Error("Choose a comment first.");
    const banAuthor = body.banAuthor === true;
    const store = read();
    const item = store.drafts.find(d => d.commentId === body.commentId);
    if (!item) throw new Error("That comment is not in the queue any more.");
    if (item.status === "removed" && (!banAuthor || item.bannedAuthor)) return item;
    if (!readConnection()) throw new Error("Connect YouTube first. Removing a comment uses your own sign-in.");
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetcher(`${YT}/comments/setModerationStatus?id=${encodeURIComponent(item.commentId)}&moderationStatus=rejected${banAuthor ? "&banAuthor=true" : ""}`, {
        method: "POST", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}` },
      });
    } catch { throw new Error("YouTube did not answer. The comment is still on the video; try again."); }
    if (!response.ok) {
      const data: any = await response.json().catch(() => undefined);
      throw new Error(apiError(response.status, data));
    }
    const fresh = read();
    const current = fresh.drafts.find(d => d.commentId === item.commentId);
    const at = new Date(now()).toISOString();
    if (current) {
      current.status = "removed"; current.clearedAt = at; if (banAuthor) current.bannedAuthor = true;
      // Their other waiting comments leave the queue too: YouTube will not show anything more from them.
      if (banAuthor) for (const d of fresh.drafts) if (d.status === "draft" && d.author === current.author && (d.authorChannelId ? d.authorChannelId === current.authorChannelId : true)) { d.status = "removed"; d.clearedAt = at; d.bannedAuthor = true; }
      write(fresh); return current;
    }
    return { ...item, status: "removed" as const, clearedAt: at, ...(banAuthor ? { bannedAuthor: true } : {}) };
  }

  const sendFile = (requestId: string) => join(sendDirectory, `${requestId}.json`);
  function readSend(requestId: string): SendRequest | undefined {
    try {
      const item = JSON.parse(readFileSync(sendFile(requestId), "utf8"));
      if (item.requestId !== requestId || !COMMENT_ID.test(item.commentId) || !/^[a-f0-9]{64}$/.test(item.contentHash)) throw new Error();
      return item;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("The saved record for this YouTube reply could not be read. Check YouTube before replying again.");
    }
  }
  function saveSend(item: SendRequest) { atomicWrite(sendFile(item.requestId), item); }
  function sendHistory(): SendRequest[] {
    let files: string[];
    try { files = readdirSync(sendDirectory); } catch { return []; }
    return files.filter(name => name.endsWith(".json") && REQUEST_ID.test(name.slice(0, -5))).map(name => readSend(name.slice(0, -5))!).filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((item, index) => index < 100 || item.status === "pending" || item.status === "uncertain")
      .map(item => ({ ...item, status: item.status === "pending" ? "uncertain" as const : item.status }));
  }
  function result(item: SendRequest, duplicate = false): YouTubeReplyResult {
    const status = item.status === "pending" ? "uncertain" : item.status;
    return { status, requestId: item.requestId, commentId: item.commentId, replyId: item.replyId, error: status === "uncertain" ? UNCERTAIN : item.error, duplicate, retryable: status === "failed" };
  }
  /** The operator pressed Reply on an edited draft: that is the lesson, whether or not YouTube confirms it. */
  function recordEdit(commentId: string, content: string) {
    let store: Store;
    try { store = read(); } catch { return; }
    const item = store.drafts.find(d => d.commentId === commentId);
    if (!item?.generated || content.trim() === item.generated.trim()) return;
    const lesson = { source: "youtube" as const, who: item.author, theirMessage: item.text, generated: item.generated, final: content.trim() };
    try { recordLesson(lessonsFile, lesson); } catch { /* Lessons are a bonus. */ }
    void rules.learn({ at: new Date(now()).toISOString(), ...lesson }).catch(() => undefined);
  }
  function markSent(commentId: string, replyId: string | undefined, content: string) {
    let store: Store;
    try { store = read(); } catch { return; }
    const item = store.drafts.find(d => d.commentId === commentId);
    if (!item) return;
    Object.assign(item, { status: "sent", replyId, sentAt: new Date(now()).toISOString(), sentContent: content });
    const target = store.comments.find(c => c.id === commentId);
    if (target) target.answered = true;
    write(store);
    if (item.generated && content.trim() !== item.generated.trim()) {
      const lesson = { source: "youtube" as const, who: item.author, theirMessage: item.text, generated: item.generated, final: content };
      try { recordLesson(lessonsFile, lesson); } catch { /* Lessons are a bonus. */ }
      void rules.learn({ at: new Date(now()).toISOString(), ...lesson }).catch(() => undefined);
    }
  }
  /** Posts one reply, once. The durable request record blocks a second post for the same request ID. */
  async function reply(body: { commentId?: unknown; content?: unknown; requestId?: unknown } = {}): Promise<YouTubeReplyResult> {
    if (typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId)) throw new Error("Create a stable request ID before posting this reply.");
    if (typeof body.commentId !== "string" || !COMMENT_ID.test(body.commentId)) throw new Error("Choose a comment first.");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > MAX_DRAFT_LENGTH || body.content.includes("\0")) throw new Error(`Write a reply between 1 and ${MAX_DRAFT_LENGTH} characters.`);
    const content = body.content.trim(), requestId = body.requestId.toLowerCase(), commentId = body.commentId;
    const contentHash = createHash("sha256").update(JSON.stringify([commentId, content])).digest("hex");
    const previous = readSend(requestId);
    if (previous) {
      if (previous.commentId !== commentId || previous.contentHash !== contentHash) throw new Error("This request ID already belongs to a different reply.");
      return result(previous, true);
    }
    if (!read().comments.some(c => c.id === commentId)) throw new Error("Refresh YouTube comments before replying; that comment is not in the local copy.");
    const token = await accessToken();
    const pending: SendRequest = { requestId, commentId, contentHash, status: "pending", createdAt: new Date(now()).toISOString() };
    mkdirSync(sendDirectory, { recursive: true, mode: 0o700 });
    try { writeFileSync(sendFile(requestId), JSON.stringify(pending), { flag: "wx", mode: 0o600 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const duplicate = readSend(requestId)!;
        if (duplicate.commentId !== commentId || duplicate.contentHash !== contentHash) throw new Error("This request ID already belongs to a different reply.");
        return result(duplicate, true);
      }
      throw new Error("The reply could not be recorded safely. Nothing was posted.");
    }
    const finish = (status: SendRequest["status"], error?: string, replyId?: string) => {
      const finished: SendRequest = { ...pending, status, finishedAt: new Date(now()).toISOString(), ...(error ? { error } : {}), ...(replyId ? { replyId } : {}) };
      try { saveSend(finished); } catch { /* The known result stays accurate. */ }
      return result(finished);
    };
    let response: Response;
    try {
      response = await fetcher(`${YT}/comments?part=snippet`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: content } }) });
    } catch { return finish("uncertain", UNCERTAIN); }
    const data: any = await response.json().catch(() => undefined);
    if (!response.ok) {
      if ([400, 401, 403, 404].includes(response.status)) return finish("failed", apiError(response.status, data));
      return finish("uncertain", UNCERTAIN);
    }
    if (typeof data?.id !== "string" || !COMMENT_ID.test(data.id)) return finish("uncertain", UNCERTAIN);
    const done = finish("sent", undefined, data.id);
    markSent(commentId, data.id, content);
    return done;
  }

  function connect() {
    const { id, secret } = client();
    if (!id || !secret) throw new Error("Add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET to ~/.config/agentic-os.env first.");
    if (!channelId()) throw new Error("Add YOUTUBE_CHANNEL_ID to ~/.config/agentic-os.env first.");
    const redirect = `http://localhost:${port}/callback`;
    if (!listener) {
      const state = randomBytes(16).toString("hex");
      const server = createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${port}`);
        const page = (title: string, detail: string, ok: boolean) => { res.statusCode = ok ? 200 : 400; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0f1520;color:#e8edf6;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px;text-align:center"><h1 style="font-size:22px">${title}</h1><p style="color:#9aa6ba;line-height:1.6">${detail}</p></div>`); };
        if (url.pathname !== "/callback") return page("Not found", "This address only completes the YouTube sign-in.", false);
        if (url.searchParams.get("state") !== state) return page("Sign-in did not match", "Start Connect YouTube again from the OS.", false);
        const code = url.searchParams.get("code");
        if (!code) return page("Sign-in cancelled", url.searchParams.get("error") === "access_denied" ? "You cancelled on Google's page. Nothing changed." : "Google did not return a sign-in code.", false);
        try {
          const response = await fetcher(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }), signal: AbortSignal.timeout(20000) });
          const data: any = await response.json().catch(() => ({}));
          if (!response.ok || typeof data.refresh_token !== "string" || typeof data.access_token !== "string") throw new Error("Google did not return a refresh token. Start Connect YouTube again.");
          const me = await apiGet("channels", { part: "snippet", mine: "true" }, data.access_token);
          const channel = me?.items?.[0];
          if (!channel || channel.id !== channelId()) throw new Error(`That Google account owns ${channel?.snippet?.title ? `"${String(channel.snippet.title).slice(0, 80)}"` : "no channel"}, not the channel in YOUTUBE_CHANNEL_ID. Nothing was saved.`);
          writeConnection({ version: 1, refreshToken: data.refresh_token, accessToken: data.access_token, expires: now() + (Number(data.expires_in) || 3600) * 1000, channelId: channel.id, channelTitle: text(channel.snippet?.title, 120), connectedAt: new Date(now()).toISOString() });
          page("YouTube connected", `Replies will post as ${text(channel.snippet?.title, 120) || "your channel"}. You can close this tab and go back to the OS.`, true);
        } catch (error) { page("YouTube was not connected", (error as Error).message, false); }
        finally { closeListener(); }
      });
      const timer = setTimeout(closeListener, 10 * 60 * 1000);
      listener = { server, state, timer };
      if (options.listen !== false) server.listen(port, "127.0.0.1");
      server.on("error", () => { closeListener(); });
    }
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: listener.state }).toString();
    return { url: url.toString(), redirect };
  }
  function closeListener() {
    if (!listener) return;
    clearTimeout(listener.timer);
    listener.server.close();
    listener = undefined;
  }
  function disconnect() {
    try { rmSync(connectionFile, { force: true }); } catch { /* Already gone. */ }
    closeListener();
    return status();
  }
  function status(store = read()) {
    if (store.progress && !store.progress.finishedAt && !running) {
      store.progress = { ...store.progress, finishedAt: new Date(now()).toISOString(), error: "Drafting was interrupted. Choose Draft replies to continue where it stopped." };
      try { write(store); } catch { /* The next run rewrites progress anyway. */ }
    }
    const connection = readConnection();
    const voice = readVoice();
    const days = store.days || 30;
    const live = waiting(store, days);
    const threads = new Map(store.comments.map(c => [c.id, c]));
    const { id, secret } = client();
    return {
      configured: !!apiKey() && !!channelId(),
      channelId: channelId(),
      oauthReady: !!id && !!secret,
      connected: !!connection,
      channelTitle: connection?.channelTitle || store.channel?.title,
      channelAvatar: store.channel?.avatar,
      channelHandle: store.channel?.handle,
      connectedAt: connection?.connectedAt,
      draftsConfigured: !!modelKey(),
      model: model(),
      days,
      syncedAt: store.syncedAt,
      syncing,
      lastError: store.lastError,
      counts: { comments: store.comments.length, waiting: live.length, unread: store.drafts.filter(d => d.status === "draft" && !d.seenAt).length, drafted: store.drafts.filter(d => d.status === "draft" && !!d.draft).length, sent: store.drafts.filter(d => d.status === "sent").length, checked: store.drafts.filter(d => d.check && d.check.verdict !== "unavailable").length, fixed: store.drafts.filter(d => d.check?.verdict === "contradicted").length, transcripts: transcripts.count() },
      checkModel: checkModel(),
      generatedAt: store.generatedAt,
      progress: store.progress,
      voice: voice ? { builtAt: voice.builtAt, updatedAt: voice.updatedAt, sources: voice.sources, guide: voice.guide, examples: voice.examples.length, lessons: readLessons(lessonsFile).length, rules: rules.count() } : undefined,
      sendRequests: sendHistory(),
      drafts: uniqueDrafts(store.drafts).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(d => { const c = threads.get(d.commentId); const kind = store.videoKinds?.[d.videoId]; return { ...d, ...(kind ? { kind } : {}), ...(c ? { replyCount: c.replyCount, ...(c.replies?.length ? { replies: c.replies } : {}) } : {}) }; }),
    };
  }
  /** The operator has had these comments on screen; they leave the Unread filter. */
  function seen(body: { commentIds?: unknown } = {}) {
    const ids = Array.isArray(body.commentIds) ? body.commentIds.filter((id): id is string => typeof id === "string" && COMMENT_ID.test(id)).slice(0, 500) : [];
    if (!ids.length) return { seen: 0 };
    const store = read();
    const at = new Date(now()).toISOString();
    let count = 0;
    for (const item of store.drafts) if (ids.includes(item.commentId) && !item.seenAt) { item.seenAt = at; count += 1; }
    if (count) write(store);
    return { seen: count };
  }
  return {
    status, sync, generate, update, seen, reply, recordEdit, remove, connect, disconnect, buildVoice, closeListener, autoDraft, check, polish,
    async handle(path: string, method: string, body: any = {}) {
      if (path === "/connections/youtube/status" && method === "GET") { const { drafts: _drafts, sendRequests: _requests, voice: _voice, ...light } = status(); return light; }
      if (path === "/connections/youtube" && method === "GET") return status();
      if (path === "/connections/youtube/connect" && method === "POST") return connect();
      if (path === "/connections/youtube/disconnect" && method === "POST") return disconnect();
      if (path === "/connections/youtube/sync" && method === "POST") return sync(body || {});
      if (path === "/connections/youtube/drafts/generate" && method === "POST") return generate(body || {});
      if (path === "/connections/youtube/drafts/check" && method === "POST") return check(body || {});
      if (path === "/connections/youtube/drafts/polish" && method === "POST") return polish();
      if (path === "/connections/youtube/drafts/update" && method === "POST") return update(body || {});
      if (path === "/connections/youtube/drafts/seen" && method === "POST") return seen(body || {});
      if (path === "/connections/youtube/drafts/voice" && method === "POST") { const voice = await buildVoice(); return { builtAt: voice.builtAt, sources: voice.sources, examples: voice.examples.length }; }
      if (path === "/connections/youtube/reply" && method === "POST") return reply(body || {});
      if (path === "/connections/youtube/remove" && method === "POST") return remove(body || {});
      throw new Error("Choose a supported YouTube action.");
    },
  };
}
