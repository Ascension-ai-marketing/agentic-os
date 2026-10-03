import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { businessContent, youtubeDurationSeconds } from "./business-content";

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const id = (number: number) => `video${String(number).padStart(6, "0")}`;
const rawVideo = (number: number, duration: unknown = "PT12M30S") => ({
  id: id(number), contentDetails: { duration }, status: { privacyStatus: "public" },
  snippet: { channelId: CHANNEL, title: `Video ${number}`, publishedAt: new Date(Date.UTC(2026, 8, 16) - number * 3600000).toISOString(), liveBroadcastContent: "none" },
  statistics: { viewCount: "0", commentCount: "9" },
});
const comment = (commentId: string, body: string, owner = false) => ({ snippet: { topLevelComment: { id: commentId, snippet: {
  textOriginal: body, authorDisplayName: owner ? "Channel" : "Viewer", authorChannelId: { value: owner ? CHANNEL : "UC-viewer" }, publishedAt: "2026-09-16T12:00:00Z", likeCount: 0,
} } } });

test("loads twenty video observations while keeping comment sampling bounded to six", async () => {
  const f = fixture(), requestedComments: string[] = [];
  try {
    const request = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input)), endpoint = url.pathname.split("/").at(-1);
      if (endpoint === "channels") return Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" } } }] });
      if (endpoint === "playlistItems") return Response.json({ items: Array.from({length:30},(_,i)=>({contentDetails:{videoId:id(i+1)}})) });
      if (endpoint === "videos") return Response.json({ items: Array.from({length:30},(_,i)=>rawVideo(i+1)) });
      if (endpoint === "commentThreads") { requestedComments.push(url.searchParams.get("videoId")!); return Response.json({ items:[] }); }
      throw new Error("Unexpected request");
    }) as typeof fetch;
    const result = await businessContent(f.root,{homeDir:f.home,request}).sync();
    expect(result.videos).toHaveLength(20);expect(requestedComments).toHaveLength(6);
    expect(result.videos.slice(6).every(v=>v.commentStatus==="not-sampled")).toBe(true);
    expect(result.videos[6].commentSummary?.text).toContain("six newest");
  } finally { f.cleanup(); }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "business-content-test-"));
  const home = join(root, "home");
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(home, ".config", "agentic-os.env"), `YOUTUBE_API_KEY="fixture-key"\nYOUTUBE_CHANNEL_ID=${CHANNEL}\n`);
  return { root, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("long-form YouTube content", () => {
  test("parses provider duration and excludes ambiguous/invalid values", () => {
    for (const [value, expected] of [["PT3M", 180], ["PT3M1S", 181], ["PT1H2M3S", 3723], ["P1DT1H", 90000], ["PT0S", 0], ["PT180.1S", 180.1], [undefined, null], ["", null], ["PT", null], ["P", null], ["3:01", null], ["PT-1M", null], ["P1M", null]] as const) expect(youtubeDurationSeconds(value)).toBe(expected);
  });

  test("paginates beyond Shorts, skips unknown/private/live videos, fills six and summarizes only eligible viewers", async () => {
    const f = fixture(), requestedComments: string[] = [], pages: string[] = [];
    try {
      const request = (async (input: URL | RequestInfo, init: RequestInit) => {
        const url = new URL(String(input)), endpoint = url.pathname.split("/").at(-1);
        expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
        if (endpoint === "channels") return Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: "UUexampleUploads00000000" } } }] });
        if (endpoint === "playlistItems") {
          pages.push(url.searchParams.get("pageToken") || "first");
          const first = !url.searchParams.has("pageToken");
          return Response.json({ items: (first ? [1, 2, 3, 4, 5, 6, 7] : [8, 9, 10, 11, 12]).map(number => ({ contentDetails: { videoId: id(number) } })), ...(first ? { nextPageToken: "second-page" } : {}) });
        }
        if (endpoint === "videos") {
          expect(url.searchParams.get("part")).toContain("contentDetails");
          const items = url.searchParams.get("id")!.split(",").map(value => {
            const number = Number(value.slice(5));
            const video = rawVideo(number, number === 1 ? "PT59S" : number === 2 ? "PT3M" : number === 3 ? "PT" : "PT12M30S");
            if (number === 4) video.status.privacyStatus = "private";
            if (number === 5) video.snippet.liveBroadcastContent = "upcoming";
            if (number === 6) video.snippet.channelId = "different-channel";
            return video;
          });
          return Response.json({ items: items.reverse() });
        }
        if (endpoint === "commentThreads") {
          const videoId = url.searchParams.get("videoId")!; requestedComments.push(videoId);
          expect(url.searchParams.get("order")).toBe("time");
          if (videoId === id(8)) return Response.json({ error: { errors: [{ reason: "commentsDisabled" }] } }, { status: 403 });
          if (videoId === id(9)) return Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 });
          if (videoId === id(10)) return Response.json({ items: [] });
          return Response.json({ items: [comment(`${videoId}-question`, "How do I set up a local Hermes agent for my business?"), comment(`${videoId}-owner`, "Free pricing guide and subscription credits", true), comment(`${videoId}-question`, "Duplicate entry must not inflate the count")] });
        }
        throw new Error("unexpected endpoint");
      }) as typeof fetch;
      const service = businessContent(f.root, { homeDir: f.home, request });
      const result = await service.sync();
      expect(pages).toEqual(["first", "second-page"]);
      expect(result.videos.map(video => video.id)).toEqual([7, 8, 9, 10, 11, 12].map(id));
      expect(requestedComments).toEqual([7, 8, 9, 10, 11, 12].map(id));
      expect(result.videos.every(video => video.durationSeconds > 180)).toBe(true);
      expect(result.selection.uploadsScanned).toBe(12);
      expect(result.videos[0].views).toBe(0); expect(result.videos[0].likes).toBeUndefined();
      expect(result.videos[1].commentStatus).toBe("disabled");
      expect(result.videos[2].commentStatus).toBe("unavailable");
      expect(result.videos[3].commentSummary?.text).toContain("No viewer comments");
      expect(result.videos[0].commentSummary?.questionCount).toBe(1);
      expect(result.videos[0].commentSummary?.viewerComments).toBe(1);
      expect(result.videos[0].commentSummary?.ownerCommentsExcluded).toBe(1);
      expect(result.sampling.audienceCommentsAnalyzed).toBe(3);
      expect(result.sampling.channelOwnerCommentsExcludedFromInsights).toBe(3);
      expect(result.insights.some(theme => theme.theme === "Pricing and access")).toBe(false);
      for (const theme of [...result.insights, ...result.videos.flatMap(video => video.commentSummary?.themes || [])]) for (const example of theme.examples) {
        const source = result.videos.find(video => video.id === example.videoId)?.comments.find(item => item.id === example.commentId);
        expect(source).toBeDefined(); expect(source?.isChannelOwner).toBe(false);
      }
      expect(JSON.stringify(result)).not.toContain("fixture-key");
      expect(service.read().videos).toEqual(result.videos);
      const before = readFileSync(join(f.root, ".operator-data", "business-content.json"), "utf8");
      await expect(businessContent(f.root, { homeDir: f.home, request: (async () => { throw new Error("?key=fixture-key"); }) as typeof fetch }).sync()).rejects.toThrow("saved video insights are unchanged");
      expect(readFileSync(join(f.root, ".operator-data", "business-content.json"), "utf8")).toBe(before);
    } finally { f.cleanup(); }
  });

  test("never reintroduces old cached Shorts or unverified durations", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.root, ".operator-data"));
      writeFileSync(join(f.root, ".operator-data", "business-content.json"), JSON.stringify({ sourceUrl: `https://www.youtube.com/channel/${CHANNEL}`, recordedAt: "2026-09-16T00:00:00Z", insights: [], sampling: {}, videos: [
        { ...rawVideo(1), comments: [], durationSeconds: 59 },
        { ...rawVideo(2), comments: [] },
        { ...rawVideo(3), comments: [], durationSeconds: 181, commentStatus: "none" },
      ] }));
      const result = businessContent(f.root, { homeDir: f.home }).read();
      expect(result.videos.map(video => video.id)).toEqual([id(3)]);
      expect(result.warnings.join(" ")).toContain("Refresh videos");
    } finally { f.cleanup(); }
  });

  test("stops at the scan bound when a channel has only Shorts", async () => {
    const f = fixture(); let pages = 0, commentCalls = 0;
    try {
      const request = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/channels")) return Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: "UUexampleUploads00000000" } } }] });
        if (url.pathname.endsWith("/playlistItems")) { pages++; return Response.json({ items: [{ contentDetails: { videoId: id(pages) } }], nextPageToken: `page-${pages + 1}` }); }
        if (url.pathname.endsWith("/videos")) return Response.json({ items: [rawVideo(pages, "PT3M")] });
        commentCalls++; throw new Error("No comment calls expected");
      }) as typeof fetch;
      const result = await businessContent(f.root, { homeDir: f.home, request }).sync();
      expect(pages).toBe(4); expect(commentCalls).toBe(0); expect(result.videos).toEqual([]);
    } finally { f.cleanup(); }
  });
});

test("a key without an explicit channel cannot start content requests", async () => {
  const f = fixture(); let calls = 0;
  try {
    writeFileSync(join(f.home, ".config", "agentic-os.env"), "YOUTUBE_API_KEY=fixture-key\n");
    const service = businessContent(f.root, { homeDir: f.home, request: (async () => { calls++; throw new Error("unreachable"); }) as typeof fetch });
    expect(service.read().channelId).toBe("");
    expect(service.read().sourceUrl).toBe("https://www.youtube.com/");
    await expect(service.sync()).rejects.toThrow("API key and channel ID");
    expect(calls).toBe(0);
  } finally { f.cleanup(); }
});

test("channel changes hide a different-channel cache without overwriting it", async () => {
  const f = fixture();
  try {
    const other = "UC1234567890123456789012";
    mkdirSync(join(f.root, ".operator-data"));
    const file = join(f.root, ".operator-data/business-content.json");
    const saved = JSON.stringify({ channelId: CHANNEL, sourceUrl: `https://www.youtube.com/channel/${CHANNEL}`, recordedAt: "2026-09-16T00:00:00Z", insights: [], sampling: {}, videos: [{ id: id(1), comments: [], durationSeconds: 181, commentStatus: "none" }] });
    writeFileSync(file, saved);
    const service = businessContent(f.root, { homeDir: f.home });
    expect(service.read().videos).toHaveLength(1);
    writeFileSync(join(f.home, ".config/agentic-os.env"), `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${other}\n`);
    const changed = service.read();
    expect(changed.channelId).toBe(other); expect(changed.videos).toHaveLength(0);
    expect(changed.sourceUrl).toBe(`https://www.youtube.com/channel/${other}`);
    expect(changed.warnings.join(" ")).toContain("different or unverified channel");
    expect(readFileSync(file, "utf8")).toBe(saved);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), channelId: undefined, sourceUrl: undefined }));
    expect(service.read().videos).toHaveLength(0);
  } finally { f.cleanup(); }
});

test("changing the configured channel during a refresh preserves the previous cache", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, ".operator-data"));
    const file = join(f.root, ".operator-data/business-content.json"), original = "previous saved cache";
    writeFileSync(file, original);
    const request = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/channels")) {
        expect(url.searchParams.get("id")).toBe(CHANNEL);
        writeFileSync(join(f.home, ".config/agentic-os.env"), "YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=UC1234567890123456789012\n");
        return Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" } } }] });
      }
      return Response.json({ items: [] });
    }) as typeof fetch;
    await expect(businessContent(f.root, { homeDir: f.home, request }).sync()).rejects.toThrow("saved video insights are unchanged");
    expect(readFileSync(file, "utf8")).toBe(original);
  } finally { f.cleanup(); }
});
