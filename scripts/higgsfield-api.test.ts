import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHiggsfieldInput,
  consoleRecords,
  createHiggsfieldApi,
  higgsfieldEnvironmentKey,
  higgsfieldPriceLines,
  higgsfieldParams,
  normalizeHiggsfieldKey,
  parseHiggsfieldModels,
  parseHiggsfieldSchema,
  publicAddress,
  requestUrl,
  readHiggsfieldRequests,
} from "./higgsfield-api";

const key = "fixture-id:fixture-secret";
const id = "00000000-0000-4000-8000-000000000001";
const endpoint = "higgsfield-ai/soul/v2/standard";
const inputSchema = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string" },
    batch_size: { type: "integer", default: 4 },
    resolution: { type: "string", enum: ["720p", "1080p"], default: "720p" },
    seed: { type: "integer", minimum: 1, maximum: 1000000 },
    enhance_prompt: { type: "boolean", default: true },
    image_urls: { type: "array" },
  },
};
const page = (object: unknown) =>
  `<script>self.__next_f.push(${JSON.stringify([1, `14:${JSON.stringify(object)}\n`])})</script>`;
const catalog = page({
  initialCatalog: {
    image: {
      results: [
        {
          slug: endpoint,
          title: "Soul 2",
          output_types: ["image"],
          default_mode_id: endpoint,
          availability_state: "available",
        },
      ],
    },
  },
});
const schema = page({ slug: endpoint, input_schema: inputSchema });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const accepted = {
  request_id: id,
  status: "queued",
  status_url: `https://api.higgsfield.ai/requests/${id}/status`,
  cancel_url: `https://api.higgsfield.ai/requests/${id}/cancel`,
};
const publicDns = async () => [{ address: "93.184.216.34" }];

function mockApi(
  overrides: (url: string, init?: RequestInit) => Response | undefined = () => undefined,
  requestStore?: string,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = createHiggsfieldApi({
    requestStore,
    resolveHost: publicDns,
    pause: async () => {},
    fetcher: (async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      const custom = overrides(url, init);
      if (custom) return custom;
      if (url.endsWith("/explore")) return new Response(catalog);
      if (url.endsWith("/api-reference")) return new Response(schema);
      if (url.endsWith("/generate-upload-url"))
        return json({
          public_url: "https://cdn.example.com/input.png",
          upload_url: "https://storage.example.com/upload",
          upload_headers: { "Content-Type": "image/png", "x-amz-tagging": "temporary" },
        });
      if (url === `https://api.higgsfield.ai/${endpoint}`) return json(accepted);
      if (url.endsWith("/status"))
        return json({
          status: "completed",
          images: [{ url: "https://cdn.example.com/output.png" }],
        });
      if (url.endsWith("/cancel")) return new Response(null, { status: 202 });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch,
  });
  return { api, calls };
}

describe("Higgsfield direct API", () => {
  test("accepts documented key names and pair format without reading CLI sessions", () => {
    expect(normalizeHiggsfieldKey(`Key ${key}`)).toBe(key);
    expect(normalizeHiggsfieldKey("fixture-id:a+b/c=d~")).toBe("fixture-id:a+b/c=d~");
    expect(normalizeHiggsfieldKey("single-secret")).toBeNull();
    expect(normalizeHiggsfieldKey("key:secret\nAuthorization: bad")).toBeNull();
    expect(
      higgsfieldEnvironmentKey({
        HF_API_KEY_ID: "fixture-id",
        HF_API_KEY_SECRET: "fixture-secret",
      }),
    ).toBe(key);
    expect(higgsfieldEnvironmentKey({ HF_KEY: key })).toBe(key);
  });
  test("discovers exact API endpoint IDs from official page data", () => {
    expect(consoleRecords(catalog).length).toBeGreaterThan(0);
    expect(parseHiggsfieldModels(catalog)).toEqual([
      { id: endpoint, label: "Soul 2", kind: "image", perUnit: null, pricingSource: "unavailable" },
    ]);
    expect(parseHiggsfieldSchema(schema, endpoint)).toEqual(inputSchema);
    expect(() => parseHiggsfieldSchema(schema, "other/model")).toThrow(
      "controls could not be loaded",
    );
    expect(higgsfieldParams(inputSchema).map((p) => p.name)).toEqual([
      "resolution",
      "seed",
      "enhance_prompt",
    ]);
  });
  test("validates schema controls and forces one output per requested generation", () => {
    expect(
      buildHiggsfieldInput(inputSchema, "hello", { seed: "5", batch_size: 4 }, [
        "https://cdn.example.com/a.png",
      ]),
    ).toEqual({
      prompt: "hello",
      seed: 5,
      resolution: "720p",
      enhance_prompt: true,
      batch_size: 1,
      image_urls: ["https://cdn.example.com/a.png"],
    });
    expect(() => buildHiggsfieldInput(inputSchema, "hello", { resolution: "4k" }, [])).toThrow(
      "supported resolution",
    );
    expect(() => buildHiggsfieldInput(inputSchema, "hello", { seed: 0 }, [])).toThrow(
      "invalid seed",
    );
    expect(() =>
      buildHiggsfieldInput({ properties: { prompt: {} } }, "hello", {}, ["image"]),
    ).toThrow("does not accept");
    expect(() =>
      buildHiggsfieldInput({ properties: { prompt: {}, first_frame_url: {} } }, "hello", {}, [
        "first-image",
        "second-image",
      ]),
    ).toThrow("does not accept");
  });
  test("verifies a key with a free upload grant, never a paid generation", async () => {
    const { api, calls } = mockApi();
    await api.verifyKey(key);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toEndWith("/files/generate-upload-url");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(`Key ${key}`);
  });
  test("uploads only selected references and never forwards API credentials to storage or assets", async () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-api-test-"));
    const file = join(folder, "input.png");
    writeFileSync(file, "fixture");
    try {
      const { api, calls } = mockApi();
      const result = await api.generate(key, endpoint, "image", "fixture prompt", {}, [file]);
      expect(result.buf.byteLength).toBe(3);
      expect(result.ext).toBe("png");
      const storage = calls.find((call) => call.url.includes("storage.example"))!;
      expect(new Headers(storage.init?.headers).get("authorization")).toBeNull();
      expect(new Headers(storage.init?.headers).get("x-amz-tagging")).toBe("temporary");
      expect(calls.find((call) => call.url.endsWith("output.png"))?.init?.headers).toBeUndefined();
      const create = calls.filter((call) => call.url === `https://api.higgsfield.ai/${endpoint}`);
      expect(create).toHaveLength(1);
      expect(JSON.parse(String(create[0].init?.body)).image_urls).toEqual([
        "https://cdn.example.com/input.png",
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  test("sanitizes malformed provider responses and credential failures", async () => {
    const broken = mockApi((url) =>
      url.endsWith("generate-upload-url") ? new Response(`bad response ${key}`) : undefined,
    );
    await expect(broken.api.verifyKey(key)).rejects.toThrow("unreadable API response");
    const denied = mockApi((url) =>
      url.endsWith("generate-upload-url") ? json({ detail: key }, 401) : undefined,
    );
    await expect(denied.api.verifyKey(key)).rejects.toThrow("rejected the API key");
  });
  test("rejects private and credential-bearing output URLs without downloading", async () => {
    for (const url of [
      "http://cdn.example.com/a.png",
      "https://localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://user:pass@cdn.example.com/a.png",
    ]) {
      const { api, calls } = mockApi((path) =>
        path.endsWith("/status") ? json({ status: "completed", images: [{ url }] }) : undefined,
      );
      await expect(api.generate(key, endpoint, "image", "hello", {}, [])).rejects.toThrow(
        "unsafe media URL",
      );
      expect(calls.some((call) => call.url === url)).toBe(false);
    }
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "not-an-ip",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true);
  });
  test("rejects malicious status URLs before sending credentials", async () => {
    const { api, calls } = mockApi((url) =>
      url === `https://api.higgsfield.ai/${endpoint}`
        ? json({ ...accepted, status_url: `https://attacker.example/requests/${id}/status` })
        : undefined,
    );
    await expect(api.generate(key, endpoint, "image", "hello", {}, [])).rejects.toThrow(
      "invalid request URL",
    );
    expect(calls.some((call) => call.url.includes("attacker"))).toBe(false);
  });
  test("retains accepted request ID on polling failure and does not resubmit", async () => {
    const { api, calls } = mockApi((url) => (url.endsWith("/status") ? json({}, 503) : undefined));
    await expect(api.generate(key, endpoint, "image", "hello", {}, [])).rejects.toThrow(
      `Request ${id}. Check API requests before retrying.`,
    );
    expect(
      calls.filter((call) => call.url === `https://api.higgsfield.ai/${endpoint}`),
    ).toHaveLength(1);
  });
  test("polls the official SDK origin returned by the provider", async () => {
    const statusUrl = `https://platform.higgsfield.ai/requests/${id}/status`;
    const { api, calls } = mockApi((url) =>
      url === `https://api.higgsfield.ai/${endpoint}`
        ? json({
            ...accepted,
            status_url: statusUrl,
            cancel_url: statusUrl.replace(/status$/, "cancel"),
          })
        : undefined,
    );
    await api.generate(key, endpoint, "image", "hello", {}, []);
    expect(calls.some((c) => c.url === statusUrl)).toBe(true);
    expect(requestUrl(`/requests/${id}/status`, id, "status")).toBe(accepted.status_url);
    for (const url of [
      `https://platform.higgsfield.ai.evil.test/requests/${id}/status`,
      `https://platform.higgsfield.ai/requests/different/status`,
      `http://platform.higgsfield.ai/requests/${id}/status`,
    ])
      expect(() => requestUrl(url, id, "status")).toThrow("invalid request URL");
  });
  test("persists accepted IDs even when returned request URLs are invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "higgsfield-requests-"));
    const path = join(dir, "requests.json");
    try {
      const { api, calls } = mockApi(
        (url) =>
          url === `https://api.higgsfield.ai/${endpoint}`
            ? json({ ...accepted, status_url: "https://attacker.example/status" })
            : undefined,
        path,
      );
      await expect(api.generate(key, endpoint, "image", "hello", {}, [])).rejects.toThrow(
        `Request ${id}`,
      );
      expect(readHiggsfieldRequests(path)[0]).toMatchObject({
        requestId: id,
        model: endpoint,
        status: "needs_attention",
      });
      expect(readFileSync(path, "utf8")).not.toContain(key);
      expect(calls.filter((c) => c.url === `https://api.higgsfield.ai/${endpoint}`)).toHaveLength(
        1,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("leaves Marketing Studio workflows out of the ordinary model picker", () => {
    expect(
      parseHiggsfieldModels(
        page({
          slug: "marketing-studio/image",
          title: "Marketing Studio Image",
          output_type: "image",
        }),
      ),
    ).toEqual([]);
  });
  test("cancels an accepted queued request on interruption", async () => {
    const controller = new AbortController();
    const { api, calls } = mockApi((url) => {
      if (url.endsWith("/status")) {
        controller.abort();
        return json({ status: "in_progress" });
      }
    });
    await expect(
      api.generate(key, endpoint, "image", "hello", {}, [], controller.signal),
    ).rejects.toThrow("Stopped waiting");
    expect(calls.filter((call) => call.url.endsWith("/cancel"))).toHaveLength(1);
  });
  test("rejects oversized references before making any network request", async () => {
    const { api, calls } = mockApi();
    await expect(
      api.generate(key, endpoint, "image", "hello", {}, Array(9).fill("unused")),
    ).rejects.toThrow("eight reference");
    expect(calls).toHaveLength(0);
  });
  test("Design no longer routes Higgsfield through its CLI or website credit estimator", () => {
    const server = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(server).not.toContain('runDesignCli("higgsfield"');
    expect(server).not.toContain('resolveCliBin("higgsfield"');
    expect(server).toContain(
      "higgsfieldApi.generate(key, model, kind, prompt, params, refPaths, signal)",
    );
    const ui = readFileSync(new URL("../src/routes/design.tsx", import.meta.url), "utf8");
    expect(ui).not.toContain("higgsfield auth login");
    expect(ui.includes("Current Higgsfield rates")).toBe(true);
  });
});

describe("Higgsfield published pricing", () => {
  const timestamp = Date.parse("2026-09-17T10:00:00Z");
  test("extracts catalog rates with units without pretending they match selected settings", () => {
    const rows = parseHiggsfieldModels(
      page({
        slug: endpoint,
        title: "Soul 2",
        output_type: "image",
        pricing: {
          primary: { amount: "0.0032", currency: "USD", unit: "image", qualifier: "exact" },
        },
      }),
    );
    expect(rows[0].pricingSource).toBe("live");
    expect(rows[0].pricing?.[0]).toMatchObject({
      costUsd: 0.0032,
      unit: "image",
      qualifier: "from",
      provider: "Higgsfield",
    });
  });
  test("keeps exact endpoint configuration prices and maps duration seconds to the composer", () => {
    const prices = higgsfieldPriceLines(
      {
        pricing: {
          primary: { amount: "0.144", currency: "USD", unit: "second" },
          options: [
            {
              amount: "0.3236",
              currency: "USD",
              unit: "second",
              configuration: { resolution: "720p", duration_seconds: 30, batch_size: null },
            },
          ],
        },
      },
      "bytedance/seedance-2.5/text-to-video",
      "video",
      timestamp,
    );
    expect(prices).toHaveLength(2);
    expect(prices[1]).toMatchObject({
      costUsd: 0.3236,
      qualifier: "exact",
      conditions: { resolution: "720p", duration: "30" },
      fetchedAt: "2026-09-17T10:00:00.000Z",
    });
    expect(prices[1].sourceUrl).toBe(
      "https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference",
    );
  });
  test("does not turn absent, invalid, non-USD or expired discounts into a price", () => {
    for (const primary of [
      { amount: null, currency: "USD", unit: "image" },
      { amount: "", currency: "USD", unit: "image" },
      { amount: "0.1", currency: "EUR", unit: "image" },
      { amount: "-1", currency: "USD", unit: "image" },
      {
        amount: "0.1",
        currency: "USD",
        unit: "image",
        discount_expires_at: "2026-01-01",
        original_amount: null,
      },
    ])
      expect(higgsfieldPriceLines({ pricing: { primary } }, endpoint, "image", timestamp)).toEqual(
        [],
      );
    expect(
      higgsfieldPriceLines(
        {
          pricing: {
            primary: {
              amount: "0.1",
              currency: "USD",
              unit: "image",
              discount_expires_at: "2026-01-01",
              original_amount: "0.2",
            },
          },
        },
        endpoint,
        "image",
        timestamp,
      )[0].costUsd,
    ).toBe(0.2);
  });
  test("loads bounded anonymous public pricing by exact model slug and keeps a one-output quote", async () => {
    const { api, calls } = mockApi((url) =>
      url.startsWith("https://dash.higgsfield.ai/")
        ? json({
            next: null,
            results: [
              {
                slug: endpoint,
                model_slug: "wrong-family-id",
                pricing: {
                  primary: { amount: "0.0032", currency: "USD", unit: "image" },
                  options: [
                    {
                      amount: "0.0057",
                      currency: "USD",
                      unit: "image",
                      configuration: { resolution: "1080p", batch_size: 1, aspect_ratio: "4:3" },
                    },
                  ],
                },
              },
            ],
          })
        : undefined,
    );
    const model = (await api.models())[0];
    expect(model.pricingSource).toBe("live");
    expect(model.pricing?.[1]).toMatchObject({
      costUsd: 0.0057,
      conditions: { resolution: "1080p", aspect_ratio: "4:3" },
    });
    expect(calls.filter((call) => call.url.startsWith("https://dash.higgsfield.ai/"))).toHaveLength(
      1,
    );
    expect(calls.every((call) => !new Headers(call.init?.headers).has("Authorization"))).toBe(true);
  });
});
