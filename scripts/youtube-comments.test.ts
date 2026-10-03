import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commentUrl, draftPrompt, needsReply, ownReplies, parseDrafts, youtubeComments, type YouTubeComment } from "./youtube-comments";
import { readLessons } from "./voice-lessons";

const MINE = "UC" + "a".repeat(22);
const now = Date.parse("2026-09-19T12:00:00Z");
function comment(over: Partial<YouTubeComment> = {}): YouTubeComment {
  return { id: "UgzExampleComment1234567890AaABAg", videoId: "dQw4w9WgXcQ", author: "Sam Viewer", authorChannelId: "UC" + "b".repeat(22), text: "Which plan do I need for this?", publishedAt: "2026-09-18T10:00:00Z", likeCount: 3, replyCount: 0, answered: false, ...over };
}
function setup(request: typeof fetch) {
  const root = mkdtempSync(join(tmpdir(), "yt-queue-"));
  const home = mkdtempSync(join(tmpdir(), "yt-home-"));
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(home, ".config", "agentic-os.env"), `YOUTUBE_API_KEY=key\nYOUTUBE_CHANNEL_ID=${MINE}\nOPENROUTER_API_KEY=test-key\nYOUTUBE_OAUTH_CLIENT_ID=cid\nYOUTUBE_OAUTH_CLIENT_SECRET=csecret\n`);
  const transcripts = { get: async (videoId: string) => videoId === "dQw4w9WgXcQ" ? { videoId, fetchedAt: "2026-09-19T00:00:00Z", text: "to run this you need the twenty dollar plan, the free tier will not work for the agent command center", segments: [] } : undefined, count: () => 1 };
  return { root, home, queue: youtubeComments(root, { homeDir: home, request, listen: false, now: () => now, transcripts }) };
}

test("a comment waits when someone else wrote it, nobody from the channel answered, and it is recent", () => {
  expect(needsReply(comment(), MINE, 30, now)).toBe(true);
  expect(needsReply(comment({ answered: true }), MINE, 30, now)).toBe(false);
  expect(needsReply(comment({ authorChannelId: MINE }), MINE, 30, now)).toBe(false);
  expect(needsReply(comment({ publishedAt: "2026-07-01T00:00:00Z" }), MINE, 30, now)).toBe(false);
  expect(commentUrl("dQw4w9WgXcQ", "Ugz1")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=Ugz1");
});

test("canned replies count once and model output is accepted only for the batch", () => {
  const canned = "If you're looking for the free resource pack, here you go, brother: https://example.com/pack";
  expect(ownReplies([canned, canned, "yes it can", "Thank you, Gavin, I appreciate that 🙏"])).toEqual([canned, "yes it can", "Thank you, Gavin, I appreciate that 🙏"]);
  const parsed = parseDrafts(`{"drafts":[{"commentId":"UgzA","reply":"Yes it can — the $20 plan"},{"commentId":"UgzB","reply":"nope"}]}`, new Set(["UgzA"]));
  expect(parsed.get("UgzA")).toEqual({ reply: "Yes it can , the $20 plan" });
  expect(parsed.has("UgzB")).toBe(false);
  const prompt = draftPrompt({ version: 1, builtAt: "", guide: "Short and warm.", examples: ["yes it can"], sources: { replies: 1 } }, [{ commentId: "UgzA", videoId: "dQw4w9WgXcQ", videoTitle: "Build JARVIS", author: "Sam", text: "Which plan?", publishedAt: "2026-09-18T10:00:00Z", likeCount: 0, url: "", draft: "", status: "draft", generatedAt: "" }]);
  expect(prompt.system).toContain("yes it can");
  expect(prompt.user).toContain("commentId: UgzA");
  expect(prompt.user).toContain("video: Build JARVIS");
});

test("sync keeps unanswered comments, learns the owner's replies and titles, then drafting and a posted reply are recorded once", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const thread = (id: string, text: string, replies: any[] = [], total = replies.length) => ({ snippet: { videoId: "dQw4w9WgXcQ", totalReplyCount: total, topLevelComment: { id, snippet: { videoId: "dQw4w9WgXcQ", authorDisplayName: "Sam Viewer", authorChannelId: { value: "UC" + "b".repeat(22) }, authorProfileImageUrl: "https://yt3.ggpht.com/a.jpg", textOriginal: text, publishedAt: "2026-09-18T10:00:00Z", likeCount: 3 } } }, replies: { comments: replies } });
  const myReply = { snippet: { authorChannelId: { value: MINE }, textOriginal: "Yes it can broski" } };
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/commentThreads")) return Response.json({ items: [thread("UgzWaiting000000000000000AaABAg", "Which plan do I need?"), thread("UgzAnswered00000000000000AaABAg", "Great video", [myReply])] });
    if (url.includes("/videos")) return Response.json({ items: [{ id: "dQw4w9WgXcQ", snippet: { title: "Build JARVIS with GPT-6" } }] });
    if (url.includes("openrouter.ai")) {
      const body = JSON.parse(String(init?.body));
      const model = body.model;
      if (String(body.messages[0].content).includes("SlopMonster")) return Response.json({ choices: [{ message: { content: "it's totally free broski\n<<<SLOPMONSTER-NOTES>>>\n- nothing" } }] });
      if (model === "anthropic/claude-haiku-4.5") return Response.json({ choices: [{ message: { content: `{"verdict":"contradicted","evidence":"the free tier will not work","reply":"you need the $20 plan for this one broski, free tier won't cut it"}` } }] });
      return Response.json({ choices: [{ message: { content: `{"drafts":[{"commentId":"UgzWaiting000000000000000AaABAg","reply":"it's totally free broski"}]}` } }] });
    }
    if (url.includes("/comments?part=snippet")) return Response.json({ id: "UgzWaiting000000000000000AaABAg.9xReply" });
    return new Response("{}", { status: 404 });
  };
  const { root, queue } = setup(request);
  const synced = await queue.sync({ days: 30 });
  expect(synced.counts).toMatchObject({ comments: 2, waiting: 1 });
  expect(calls.some(c => c.url.includes("key=key"))).toBe(true);
  writeFileSync(join(root, ".operator-data", "youtube-voice.json"), JSON.stringify({ version: 1, builtAt: "2026-09-19T00:00:00Z", guide: "Short and warm.", examples: ["yes it can"], sources: { replies: 1 } }));
  expect(queue.generate({ days: 30 })).toEqual({ started: true, days: 30 });
  for (let i = 0; i < 50 && !queue.status().progress?.finishedAt; i++) await new Promise(r => setTimeout(r, 20));
  const status = queue.status();
  expect(status.progress?.error).toBeUndefined();
  expect(status.drafts).toHaveLength(1);
  // The comment asks a question, so the draft was checked against the transcript and corrected.
  expect(status.drafts[0]).toMatchObject({ commentId: "UgzWaiting000000000000000AaABAg", videoTitle: "Build JARVIS with GPT-6", draft: "you need the $20 plan for this one broski, free tier won't cut it", check: { verdict: "contradicted", evidence: "the free tier will not work" } });
  expect(status.drafts[0].note).toContain("Fixed from the video");
  // Drafting, the SlopMonster cleanse, and the transcript check: three model calls.
  expect(calls.filter(c => c.url.includes("openrouter.ai")).length).toBe(3);
  expect(status.counts).toMatchObject({ checked: 1, fixed: 1, transcripts: 1 });
  // Posting needs a sign-in.
  await expect(queue.reply({ commentId: "UgzWaiting000000000000000AaABAg", content: "The $20 plan.", requestId: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow(/Connect YouTube/);
  writeFileSync(join(root, ".operator-data", "youtube-connection.json"), JSON.stringify({ version: 1, refreshToken: "r", accessToken: "a", expires: now + 3600000, channelId: MINE, channelTitle: "Jack", connectedAt: "2026-09-19T00:00:00Z" }));
  const first = await queue.reply({ commentId: "UgzWaiting000000000000000AaABAg", content: "The $20 plan.", requestId: "11111111-1111-4111-8111-111111111111" });
  expect(first).toMatchObject({ status: "sent", replyId: "UgzWaiting000000000000000AaABAg.9xReply", duplicate: false });
  const again = await queue.reply({ commentId: "UgzWaiting000000000000000AaABAg", content: "The $20 plan.", requestId: "11111111-1111-4111-8111-111111111111" });
  expect(again).toMatchObject({ status: "sent", duplicate: true });
  expect(calls.filter(c => c.url.includes("/comments?part=snippet")).length).toBe(1);
  const posted = JSON.parse(String(calls.find(c => c.url.includes("/comments?part=snippet"))!.init!.body));
  expect(posted).toEqual({ snippet: { parentId: "UgzWaiting000000000000000AaABAg", textOriginal: "The $20 plan." } });
  expect(queue.status().drafts[0]).toMatchObject({ status: "sent", sentContent: "The $20 plan." });
  expect(readLessons(join(root, "data", "voice", "youtube-lessons.json"))).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(root, ".operator-data", "youtube-comments.json"), "utf8")).comments.find((c: any) => c.id === "UgzWaiting000000000000000AaABAg").answered).toBe(true);
});

test("connect builds a Google sign-in link for the loopback listener and refuses without keys", () => {
  const { queue } = setup(async () => new Response("{}"));
  const { url, redirect } = queue.connect();
  expect(redirect).toBe("http://localhost:8976/callback");
  const parsed = new URL(url);
  expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
  expect(parsed.searchParams.get("access_type")).toBe("offline");
  expect(parsed.searchParams.get("state")).toHaveLength(32);
  queue.closeListener();
});
