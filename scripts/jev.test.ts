import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJevEngine, savingsFor, validateJevRequest } from "./jev";
import type { JevDecideRequest } from "../src/lib/jev-types";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const request: JevDecideRequest = { surface: "router", purpose: "raw secret should not persist", input: "private message", state: { body: "private body", token: "secret-token" }, questions: { lane: { type: "choice", instructions: "Pick a lane", criteria: { fast: "Short answer", slow: "Complex work" } }, yes: { type: "noul", instructions: "Is it short?" }, rank: { type: "score", instructions: "Urgency", criteria: ["later", "now"] } }, headline: "lane" };
const response = (confidence = 0.9) => ({ answers: { lane: { choice: "fast", probabilities: { fast: confidence, slow: 1 - confidence }, confidence }, yes: { noul: 0.7 }, rank: { score: 0.3, probabilities: { "0": 0.7, "1": 0.3 }, confidence: 0.7 } }, usage: { cost: 0.00002, input_tokens: 100, output_tokens: 20 } });
function engine(mock: (url: string, init?: RequestInit) => Promise<Response> = async () => Response.json(response()), maxLogLines?: number) {
  const root = mkdtempSync(join(tmpdir(), "jev-test-")); dirs.push(root);
  return { root, ...createJevEngine({ root, fetch: mock as typeof fetch, key: () => "test-key", maxLogLines }) };
}
describe("Jev engine", () => {
  test("parses all three types, measures and compares using catalogue prices", async () => {
    const e = engine(); const d = await e.decide(request);
    expect(d.error).toBeUndefined(); expect(d.picked).toBe("fast"); expect(d.answers.yes).toEqual({ type: "noul", noul: 0.7 });
    expect(d.answers.rank.type).toBe("score"); expect(d.costUsd).toBe(0.00002); expect(d.ms).toBeGreaterThanOrEqual(0); expect(d.compare?.kind).toBe("estimated");
  });
  test("escalates only a low-confidence headline and preserves original odds", async () => {
    let calls = 0;
    const e = engine(async () => ++calls === 1 ? Response.json(response(0.51)) : Response.json({ choices: [{ message: { content: '{"picked":"slow"}' } }], usage: { cost: 0.001 } }));
    const d = await e.decide({ ...request, escalateBelow: 0.6 });
    expect(calls).toBe(2); expect(d.picked).toBe("slow"); expect(d.escalated).toBe(true); expect(d.answers.lane).toEqual({ type: "choice", ...response(0.51).answers.lane });
    expect(e.savings().costUsd).toBeCloseTo(0.00102, 8);
  });
  test("high confidence makes only one request", async () => {
    let calls = 0; const e = engine(async () => { calls++; return Response.json(response()); });
    await e.decide({ ...request, escalateBelow: 0.6 }); expect(calls).toBe(1);
  });
  test("errors never throw or echo provider bodies", async () => {
    const e = engine(async () => new Response("secret-key private body", { status: 401 }));
    const d = await e.decide(request); expect(d.error).toBe("Jev HTTP 401"); expect(JSON.stringify(d)).not.toContain("private body");
  });
  test("missing keys stop before fetch", async () => {
    const e = engine(); const isolated = createJevEngine({ root: e.root, key: () => "", fetch: (() => { throw new Error("must not call"); }) as unknown as typeof fetch });
    expect((await isolated.decide(request)).error).toBe("OPENROUTER_API_KEY is missing");
  });
  test("rejects malformed provider answers", async () => {
    const e = engine(async () => Response.json({ ...response(), answers: { ...response().answers, yes: { noul: 9 } } }));
    expect((await e.decide(request)).error).toBe("Invalid noul probability");
  });
  test("failed escalation retains Jev odds and reports failure", async () => {
    let calls = 0; const e = engine(async () => ++calls === 1 ? Response.json(response(0.51)) : new Response("bad", { status: 503 }));
    const d = await e.decide({ ...request, escalateBelow: 0.6 }); expect(d.error).toBe("Escalation HTTP 503"); expect(d.escalated).toBe(false); expect(d.answers.lane.type).toBe("choice");
  });
  test("rotates to a bounded newest-first log and streams constrained records", async () => {
    const e = engine(undefined, 3); const streamed: string[] = []; const stop = e.subscribe(d => streamed.push(d.id));
    for (let i = 0; i < 5; i++) await e.decide(request);
    stop(); expect(e.log()).toHaveLength(3); expect(e.log()[0].id).toBe(streamed[4]); expect(streamed).toHaveLength(5);
    const disk = readFileSync(join(e.root, ".operator-data/jev/decisions.jsonl"), "utf8");
    for (const secret of ["private body", "secret-token", "private message", "raw secret", "test-key"]) expect(disk).not.toContain(secret);
  });
  test("validates limits, headline and required instructions", () => {
    expect(() => validateJevRequest({ ...request, headline: "absent" })).toThrow();
    expect(() => validateJevRequest({ ...request, questions: { lane: { type: "score", instructions: "Rate", criteria: Array(11).fill("rung") } } })).toThrow();
    expect(() => validateJevRequest({ ...request, questions: { lane: { type: "noul", instructions: "" } } })).toThrow();
  });
  test("savings includes negative savings and does not award failed decisions a baseline", async () => {
    const d = await engine().decide(request);
    const s = savingsFor([{ ...d, costUsd: 2, compare: { model: "opus", ms: 20, costUsd: 1, kind: "estimated" } }, { ...d, error: "failed", costUsd: 0.1 }]);
    expect(s.calls).toBe(2); expect(s.savedUsd).toBeCloseTo(-1.1); expect(s.estimated).toBe(true); expect(s.bySurface.router?.calls).toBe(2);
  });
});
