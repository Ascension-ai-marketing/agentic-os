import { test, expect } from "bun:test";
import { rankImageDescriptions } from "./jev-image-search";
test("meaning search sends descriptions only, caps at 200 and runs ten calls at a time", async () => {
  let active = 0, max = 0, calls = 0;
  const candidates = Array.from({ length: 205 }, (_, i) => ({ id: String(i), path: `/private/not-sent/${i}.png`, desc: `image ${i}`, text: "saved OCR", tags: ["landscape"] }));
  const result = await rankImageDescriptions("a forest", candidates, async req => {
    active++; max = Math.max(max, active); calls++; expect(JSON.stringify(req.state)).not.toContain("/private");
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    const probability = Number((req.state as any).image.description.split(" ")[1]) / 200;
    return { id: String(calls), at: "", surface: "image-search", input: "", purpose: "match", answers: { matches: { type: "noul", noul: probability } }, picked: "yes", escalated: false, ms: 1, costUsd: 0.00002 };
  });
  expect(calls).toBe(200); expect(max).toBe(10); expect(result.ranked[0].id).toBe("199"); expect(result.hits).toHaveLength(100); expect(result.stats.costUsd).toBeCloseTo(0.004, 8);
});
test("stops scheduling after a failed batch instead of silently inventing a ranking", async () => {
  let calls = 0; const result = await rankImageDescriptions("forest", Array.from({ length: 30 }, (_, i) => ({ id: String(i), path: "unused", desc: "sample" })), async () => { calls++; return { id: "error", at: "", surface: "image-search", purpose: "", input: "", answers: {}, picked: "unavailable", ms: 1, costUsd: 0, escalated: false, error: "Jev HTTP 503" }; });
  expect(calls).toBe(10); expect(result.error).toBe("Jev HTTP 503"); expect(result.hits).toHaveLength(0);
});
