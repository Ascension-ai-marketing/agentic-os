import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureYouTubeChannel,
  discoverBusinessIntegrations,
  syncBusinessIntegration,
  youtubeChannelSelector,
  youtubeConfiguration,
} from "./business-integrations";
const channel = "UCabcdefghijklmnopqrstuv",
  other = "UC1234567890123456789012";
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "business-provider-test-"));
  mkdirSync(join(home, ".config"));
  return {
    home,
    write: (name: string, value: string) => writeFileSync(join(home, ".config", name), value),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}
test("YouTube needs both explicit channel and key before any request", async () => {
  const f = fixture();
  let requests = 0;
  const request = (async () => {
    requests++;
    throw new Error("must not request");
  }) as typeof fetch;
  try {
    for (const data of [
      "",
      "YOUTUBE_API_KEY=fixture-key",
      `YOUTUBE_CHANNEL_ID=${channel}`,
      "YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=https://example.test",
    ]) {
      f.write("agentic-os.env", data);
      expect(
        discoverBusinessIntegrations({ homeDir: f.home }).find((row) => row.id === "youtube")
          ?.configured,
      ).toBe(false);
      await expect(
        syncBusinessIntegration("youtube", { homeDir: f.home, request }),
      ).rejects.toThrow("API key and channel ID");
    }
    expect(requests).toBe(0);
  } finally {
    f.cleanup();
  }
});
test("community configuration ignores creator-specific legacy files", () => {
  const f = fixture();
  try {
    f.write("example-keys.env", "YOUTUBE_API_KEY=legacy-key\n");
    expect(youtubeConfiguration(f.home)).toEqual({ key: "", channelId: "" });
    f.write("example-keys.env", `YOUTUBE_API_KEY=legacy-key\nYOUTUBE_CHANNEL_ID=${other}`);
    expect(youtubeConfiguration(f.home)).toEqual({ key: "", channelId: "" });
    f.write(
      "agentic-os.env",
      `YOUTUBE_API_KEY="generic-key"\nYOUTUBE_CHANNEL_ID=${channel}\nUNRELATED_SECRET=not-read`,
    );
    expect(youtubeConfiguration(f.home)).toEqual({ key: "generic-key", channelId: channel });
    expect(
      discoverBusinessIntegrations({ homeDir: f.home }).find((row) => row.id === "youtube"),
    ).toEqual({ id: "youtube", configured: true, keyConfigured: true, channelId: channel });
    f.write("agentic-os.env", "YOUTUBE_CHANNEL_ID=\n");
    expect(
      discoverBusinessIntegrations({ homeDir: f.home }).find((row) => row.id === "youtube")
        ?.configured,
    ).toBe(false);
  } finally {
    f.cleanup();
  }
});
test("subscriber refresh fetches only the configured channel and records its source", async () => {
  const f = fixture();
  try {
    f.write("agentic-os.env", `YOUTUBE_API_KEY=private-fixture-key\nYOUTUBE_CHANNEL_ID=${channel}`);
    const request = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("id")).toBe(channel);
      return Response.json({
        items: [
          { id: other, statistics: { subscriberCount: "999" } },
          {
            id: channel,
            statistics: { subscriberCount: "123", viewCount: "456", videoCount: "0" },
          },
        ],
      });
    }) as typeof fetch;
    const result = await syncBusinessIntegration("youtube", { homeDir: f.home, request });
    expect(result.snapshots[0].metrics).toEqual({ followers: 123, views: 456, videos: 0 });
    expect(result.snapshots[0].measurementScope).toBe("youtube-channel-totals-v1");
    expect(result.snapshots[0].sourceUrl).toBe(`https://www.youtube.com/channel/${channel}`);
    expect(JSON.stringify(result)).not.toContain("private-fixture-key");
    await expect(
      syncBusinessIntegration("youtube", {
        homeDir: f.home,
        request: (async () => {
          throw new Error("private-fixture-key");
        }) as typeof fetch,
      }),
    ).rejects.toThrow("could not confirm");
  } finally {
    f.cleanup();
  }
});

test("channel selector supports IDs, handles and channel URLs without arbitrary fetches", () => {
  for (const input of [
    channel,
    `https://www.youtube.com/channel/${channel}`,
    `youtube.com/channel/${channel}`,
  ])
    expect(youtubeChannelSelector(input)).toEqual({ id: channel });
  for (const input of [
    "@fixture-channel",
    "https://youtube.com/@fixture-channel",
    "https://www.youtube.com/@fixture-channel/videos?view=0",
  ])
    expect(youtubeChannelSelector(input)).toEqual({ forHandle: "@fixture-channel" });
  expect(youtubeChannelSelector("https://youtube.com/user/FixtureUser")).toEqual({
    forUsername: "FixtureUser",
  });
  for (const input of [
    "https://example.com/@fixture",
    "https://youtube.com.evil.test/@fixture",
    "https://user:pass@youtube.com/@fixture",
    "https://youtube.com:8000/@fixture",
    "file:///etc/passwd",
    "https://youtu.be/abcdefghijk",
    "https://youtube.com/watch?v=abcdefghijk",
    "@fixture\nOTHER_KEY=bad",
    "https://youtube.com/@fixture/invalid",
    null,
  ])
    expect(() => youtubeChannelSelector(input)).toThrow("YouTube channel");
});

test("choosing a verified channel preserves the recipient key and unrelated config", async () => {
  const f = fixture();
  try {
    f.write("example-keys.env", "YOUTUBE_API_KEY=private-legacy-fixture-key\n");
    f.write("agentic-os.env", "# Keep this comment\nYOUTUBE_API_KEY=own-fixture-key\nSOME_OTHER_SETTING='keep me'\n");
    const request = (async (input: URL | RequestInfo, init: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(url.pathname).toBe("/youtube/v3/channels");
      expect(url.searchParams.get("forHandle")).toBe("@fixture");
      expect(init.redirect).toBe("error");
      return Response.json({ items: [{ id: channel, snippet: { title: "Fixture channel" } }] });
    }) as typeof fetch;
    const result = await configureYouTubeChannel("@fixture", { homeDir: f.home, request });
    expect(result).toEqual({
      id: channel,
      title: "Fixture channel",
      url: `https://www.youtube.com/channel/${channel}`,
    });
    const saved = readFileSync(join(f.home, ".config", "agentic-os.env"), "utf8");
    expect(saved).toBe(
      `# Keep this comment\nYOUTUBE_API_KEY=own-fixture-key\nSOME_OTHER_SETTING='keep me'\nYOUTUBE_CHANNEL_ID=${channel}\n`,
    );
    expect(saved).not.toContain("private-legacy-fixture-key");
    expect(JSON.stringify(result)).not.toContain("private-legacy-fixture-key");
    expect(statSync(join(f.home, ".config", "agentic-os.env")).mode & 0o777).toBe(0o600);
  } finally {
    f.cleanup();
  }
});

test("channel selection rejects failures and mismatched identities without writing", async () => {
  const f = fixture();
  try {
    const initial = `YOUTUBE_API_KEY=private-fixture-key\nYOUTUBE_CHANNEL_ID=${other}\nOTHER=unchanged\n`;
    f.write("agentic-os.env", initial);
    for (const payload of [
      { items: [] },
      { items: [{ id: other, snippet: { title: "Wrong channel" } }] },
      { items: [{ id: channel, snippet: { title: "" } }] },
    ]) {
      await expect(
        configureYouTubeChannel(channel, {
          homeDir: f.home,
          request: (async () => Response.json(payload)) as typeof fetch,
        }),
      ).rejects.toThrow("saved channel is unchanged");
      expect(readFileSync(join(f.home, ".config", "agentic-os.env"), "utf8")).toBe(initial);
    }
    await expect(
      configureYouTubeChannel(channel, {
        homeDir: f.home,
        request: (async () => {
          throw new Error("https://provider.test/?key=private-fixture-key");
        }) as typeof fetch,
      }),
    ).rejects.toThrow("could not find");
    expect(readFileSync(join(f.home, ".config", "agentic-os.env"), "utf8")).toBe(initial);
  } finally {
    f.cleanup();
  }
});

test("channel selector requires an existing key and rejects concurrent connection edits", async () => {
  const f = fixture();
  let requests = 0;
  try {
    const request = (async () => {
      requests++;
      f.write(
        "agentic-os.env",
        `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${other}\nOTHER=kept`,
      );
      return Response.json({ items: [{ id: channel, snippet: { title: "Fixture" } }] });
    }) as typeof fetch;
    await expect(configureYouTubeChannel(channel, { homeDir: f.home, request })).rejects.toThrow(
      "API key",
    );
    expect(requests).toBe(0);
    f.write("agentic-os.env", "YOUTUBE_API_KEY=fixture-key\n");
    await expect(configureYouTubeChannel(channel, { homeDir: f.home, request })).rejects.toThrow(
      "connection changed",
    );
    expect(youtubeConfiguration(f.home).channelId).toBe(other);
    expect(requests).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("channel update replaces duplicate declarations and refuses symlink writes", async () => {
  const f = fixture();
  const request = (async () =>
    Response.json({ items: [{ id: channel, snippet: { title: "Fixture" } }] })) as typeof fetch;
  try {
    f.write(
      "agentic-os.env",
      `YOUTUBE_API_KEY=fixture-key\nexport YOUTUBE_CHANNEL_ID=${other}\nOTHER=kept\nYOUTUBE_CHANNEL_ID=${other}\n`,
    );
    await configureYouTubeChannel(channel, { homeDir: f.home, request });
    expect(readFileSync(join(f.home, ".config", "agentic-os.env"), "utf8")).toBe(
      `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${channel}\nOTHER=kept\n`,
    );
    f.write("target.env", `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${other}`);
    rmSync(join(f.home, ".config", "agentic-os.env"));
    symlinkSync(join(f.home, ".config", "target.env"), join(f.home, ".config", "agentic-os.env"));
    await expect(configureYouTubeChannel(channel, { homeDir: f.home, request })).rejects.toThrow(
      "could not be saved",
    );
    expect(readFileSync(join(f.home, ".config", "target.env"), "utf8")).toContain(other);
  } finally {
    f.cleanup();
  }
});

test("subscriber sync discards response if channel changes during its request", async () => {
  const f = fixture();
  try {
    f.write("agentic-os.env", `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${channel}`);
    const request = (async () => {
      f.write("agentic-os.env", `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${other}`);
      return Response.json({ items: [{ id: channel, statistics: { subscriberCount: "123" } }] });
    }) as typeof fetch;
    await expect(syncBusinessIntegration("youtube", { homeDir: f.home, request })).rejects.toThrow(
      "existing numbers are unchanged",
    );
  } finally {
    f.cleanup();
  }
});

test("a verified new YouTube channel may have zero subscribers", async () => {
  const f = fixture();
  try {
    f.write("agentic-os.env", `YOUTUBE_API_KEY=fixture-key\nYOUTUBE_CHANNEL_ID=${channel}`);
    const result = await syncBusinessIntegration("youtube", {
      homeDir: f.home,
      request: (async () =>
        Response.json({
          items: [
            { id: channel, statistics: { subscriberCount: "0", videoCount: "0", viewCount: "0" } },
          ],
        })) as typeof fetch,
    });
    expect(result.snapshots[0].metrics).toEqual({ followers: 0, videos: 0, views: 0 });
  } finally {
    f.cleanup();
  }
});
