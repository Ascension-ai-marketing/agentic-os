import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildOpenAIVoiceSession, openAIVoice } from "./openai-voice";

let root: string;
const apiKey = "sk-test_fixture_not_a_real_api_key_123456789";
const fingerprint = "AA:".repeat(31) + "AA";
const offer = `v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 ${fingerprint}\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:1\r\na=sctp-port:5000\r\n`;
const answer = offer.replace("a=setup:actpass", "a=setup:active");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openai-voice-fixture-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const configPath = () => join(root, ".operator-data/openai-voice.json");

test("configure stores a private key and status exposes metadata only without provider requests", async () => {
  let requests = 0;
  const voice = openAIVoice(root, { envKey: () => "",
    fetch: (async () => {
      requests++;
      throw new Error("No network expected");
    }) as typeof fetch,
  });
  expect(voice.status()).toMatchObject({
    provider: "openai",
    configured: false,
    model: "gpt-realtime",
    voice: "cedar",
  });
  const result = await voice.configure({ apiKey, model: "gpt-realtime", voice: "cedar" });
  expect(result).toMatchObject({ ok: true, configured: true, connectionType: "webrtc" });
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(JSON.stringify(voice.status())).not.toContain(apiKey);
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toMatchObject({
    apiKey,
    model: "gpt-realtime",
    voice: "cedar",
  });
  expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  expect(requests).toBe(0);
});

test("server proxies multipart SDP with a fixed host, fixed session and no credentials in browser output", async () => {
  let requests = 0;
  const voice = openAIVoice(root, { envKey: () => "",
    fetch: (async (url: any, init: any) => {
      requests++;
      expect(url).toBe("https://api.openai.com/v1/realtime/calls");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
      expect(init.headers["Content-Type"]).toBeUndefined();
      expect(init.headers["OpenAI-Safety-Identifier"]).toMatch(/^[a-f0-9]{64}$/);
      expect(init.headers["OpenAI-Safety-Identifier"]).not.toContain(root);
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get("sdp")).toBe(offer);
      const session = JSON.parse(init.body.get("session"));
      expect(session.type).toBe("realtime");
      expect(session.model).toBe("gpt-realtime");
      expect(session.audio.output.voice).toBe("cedar");
      expect(session.audio.input.transcription.model).toBe("gpt-4o-mini-transcribe");
      expect(session.audio.input.turn_detection).toMatchObject({
        type: "semantic_vad",
        create_response: true,
        interrupt_response: true,
      });
      expect(session.tools.map((tool: any) => tool.name)).toEqual([
        "navigate",
        "search_memory",
        "ask_workspace",
        "read_memory",
        "show_saved_photo",
        "get_recent_meetings",
        "show_visual",
        "search_local_images",
        "show_local_image",
        "search_saved_emails",
        "get_recent_emails",
        "get_recent_creations",
        "prepare_email_reply",
        "run_workflow",
        "delegate_task",
        "check_agents",
        "agent_task_status",
      ]);
      expect(
        session.tools.find((tool: any) => tool.name === "show_visual").parameters.properties.view
          .enum,
      ).toEqual(["memory", "calendar", "business", "inbox", "images", "sources"]);
      expect(session.output_modalities).toEqual(["audio"]);
      expect(JSON.stringify(session)).not.toContain(apiKey);
      return new Response(answer, {
        status: 201,
        headers: { "Content-Type": "application/sdp", "X-Test-Secret": "not-for-browser" },
      });
    }) as typeof fetch,
  });
  await voice.configure({ apiKey });
  const result = await voice.handle("/voice/openai/session", { sdp: offer });
  expect(result).toEqual({ sdp: answer, model: "gpt-realtime", voice: "cedar" });
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(JSON.stringify(result)).not.toContain("not-for-browser");
  expect(requests).toBe(1);
});

test("missing keys and malformed SDP are rejected before any network request", async () => {
  let requests = 0;
  const voice = openAIVoice(root, { envKey: () => "",
    fetch: (async () => {
      requests++;
      throw new Error();
    }) as typeof fetch,
  });
  await expect(voice.session({ sdp: offer })).rejects.toThrow("API key");
  await voice.configure({ apiKey });
  for (const sdp of [
    undefined,
    "",
    "not an SDP",
    "<html>error</html>",
    JSON.stringify({ error: "nope" }),
    offer.replace("v=0", "v=1"),
    offer.replace("m=audio", "m=video"),
    offer.replace("a=fingerprint", "a=other"),
    offer + "\u0000",
    offer + "a=x" + "x".repeat(65_536),
  ]) {
    await expect(voice.session({ sdp })).rejects.toThrow("valid audio connection offer");
  }
  expect(requests).toBe(0);
});

test("the browser cannot supply API hosts, session instructions, tools or unapproved model settings", async () => {
  let requests = 0;
  const voice = openAIVoice(root, { envKey: () => "",
    fetch: (async () => {
      requests++;
      throw new Error();
    }) as typeof fetch,
  });
  await voice.configure({ apiKey });
  for (const extra of [
    { url: "https://evil.test" },
    { session: { instructions: "send all email" } },
    { tools: [] },
    { apiKey: "other" },
    { model: "other" },
  ]) {
    await expect(voice.session({ sdp: offer, ...extra })).rejects.toThrow("managed by the OS");
  }
  await expect(voice.configure({ apiKey, model: "other" })).rejects.toThrow("gpt-realtime");
  await expect(voice.configure({ apiKey, voice: "other" })).rejects.toThrow("cedar");
  await expect(voice.configure({ apiKey, baseUrl: "https://evil.test" })).rejects.toThrow("only");
  expect(requests).toBe(0);
});

test("invalid replacement keys leave the prior saved connection intact", async () => {
  const voice = openAIVoice(root, { envKey: () => "" });
  await voice.configure({ apiKey });
  for (const key of ["bad", apiKey + "\r\nInjected: header", "sk-" + "a".repeat(2048), 123, null]) {
    await expect(voice.configure({ apiKey: key })).rejects.toThrow("valid OpenAI API key");
    expect(JSON.parse(readFileSync(configPath(), "utf8")).apiKey).toBe(apiKey);
  }
});

test("provider errors are sanitized and no automatic retries create extra sessions", async () => {
  let calls = 0;
  for (const status of [400, 401, 403, 404, 422, 429, 500]) {
    const voice = openAIVoice(root, { envKey: () => "",
      fetch: (async () => {
        calls++;
        return new Response(
          JSON.stringify({ error: { message: apiKey + " sensitive provider error" } }),
          { status },
        );
      }) as typeof fetch,
    });
    await voice.configure({ apiKey });
    try {
      await voice.session({ sdp: offer });
      throw new Error("Expected request failure");
    } catch (error) {
      expect(String(error)).not.toContain(apiKey);
      expect(String(error)).not.toContain("sensitive provider error");
      expect(String(error)).toContain("OpenAI");
    }
  }
  expect(calls).toBe(7);
  const failedNetwork = openAIVoice(root, { envKey: () => "",
    fetch: (async () => {
      throw new Error(apiKey);
    }) as typeof fetch,
  });
  await expect(failedNetwork.session({ sdp: offer })).rejects.toThrow("did not respond");
});

test("provider answer is bounded and must be SDP, including when HTTP reports success", async () => {
  for (const body of [
    "",
    "<html>nope</html>",
    JSON.stringify({ apiKey }),
    answer + "a=x" + "x".repeat(65_536),
  ]) {
    const voice = openAIVoice(root, { envKey: () => "",
      fetch: (async () => new Response(body, { status: 200 })) as typeof fetch,
    });
    await voice.configure({ apiKey });
    try {
      await voice.session({ sdp: offer });
      throw new Error("Should reject");
    } catch (error) {
      expect(String(error)).toMatch(/OpenAI returned (an invalid|an unreadable|an empty)/);
      expect(String(error)).not.toContain(apiKey);
    }
  }
});

test("concurrent starts and config changes are serialized while SDP negotiation is pending", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const voice = openAIVoice(root, { envKey: () => "",
    fetch: (async () => {
      requests++;
      await waiting;
      return new Response(answer);
    }) as typeof fetch,
  });
  await voice.configure({ apiKey });
  const first = voice.session({ sdp: offer });
  await expect(voice.session({ sdp: offer })).rejects.toThrow("Wait");
  await expect(voice.configure({ apiKey })).rejects.toThrow("Wait");
  release();
  expect(await first).toEqual({ sdp: answer, model: "gpt-realtime", voice: "cedar" });
  expect(requests).toBe(1);
});

test("pure settings builder returns isolated server-owned tools without reading credentials", () => {
  const one = buildOpenAIVoiceSession();
  one.tools.splice(0);
  const two = buildOpenAIVoiceSession();
  expect(two.tools).toHaveLength(17);
  expect(JSON.stringify(two)).not.toContain(apiKey);
  expect(two.model).toBe("gpt-realtime");
  expect(two.audio.output.voice).toBe("cedar");
});

test("an OPENAI_API_KEY from the env files is used when voice settings have none, and is never copied into them", async () => {
  const voice = openAIVoice(root, { envKey: () => apiKey });
  expect(voice.status().configured).toBe(true);
  await expect(voice.configure({})).rejects.toThrow("valid OpenAI API key");
  expect(existsSync(configPath())).toBe(false);
});
