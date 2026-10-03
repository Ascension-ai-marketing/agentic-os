import { describe, expect, test } from "bun:test";
import {
  inboxQuestions,
  parseInboxQuestionAnswer,
  parseInboxQuestionModel,
} from "./inbox-questions";
import { retrieveInboxQuestion } from "./inbox-question-search";
import type { OperatorState } from "../src/lib/operator";

function fixture(): OperatorState {
  return {
    version: 1,
    sources: [],
    events: [],
    hiddenMemoryTitles: [],
    goals: { longTerm: "", quarter: "", week: "", metrics: [] },
    settings: { mission: false, openclaw: false, news: true },
    brainSources: { email: true },
    inbox: [
      {
        id: "mail-budget",
        subject: "Launch budget",
        body: "Could you approve the EUR 12,400 launch budget?",
        from: "Alex",
        receivedAt: "2026-09-16T10:00:00Z",
        source: "gmail",
        direction: "inbound",
        category: "needs-you",
        status: "open",
      },
    ],
  };
}
const valid = JSON.stringify({
  answer:
    "Alex asked for approval of the EUR 12,400 launch budget. Open the conversation to review and reply.",
  references: ["mail-budget"],
});
function service(
  state = fixture(),
  generate = async (_prompt: string, _model: unknown, _signal: AbortSignal) => valid,
  available = true,
  timeoutMs = 500,
) {
  return inboxQuestions({
    load: () => state,
    generate,
    available: () => available,
    timeoutMs,
  });
}

describe("grounded inbox questions", () => {
  test("archive retrieval finds historical mail and respects hidden providers and AI opt-out", async () => {
    const state = fixture();
    state.inbox = [];
    const old = {
      ...fixture().inbox[0],
      id: "old-mail",
      receivedAt: "2017-01-01T00:00:00Z",
      body: "A historical zebra budget",
    };
    let calls = 0,
      search = "";
    const ask = inboxQuestions({
      load: () => state,
        available: () => true,
      generate: async () => {
        calls++;
        return "{}";
      },
      archive: (query) => {
        search = query;
        return { items: [old], total: 12000, matched: 1, importing: true };
      },
    });
    const result = await ask.ask({ question: "Find my zebra emails", summarize: false });
    expect(search).toBe("zebra");
    expect(result.results[0].id).toBe("old-mail");
    expect(result.coverage).toContain("12,000");
    expect(result.coverage).toContain("incomplete or paused");
    state.brainSources = { email: false };
    expect((await ask.ask({ question: "zebra" })).canSummarize).toBe(false);
    state.settings.inboxAccounts = { gmail: false };
    expect((await ask.ask({ question: "zebra" })).results).toHaveLength(0);
    expect(calls).toBe(0);
  });
  test("archive bodies replace duplicate previews while current read and status metadata remain authoritative", async () => {
    const state = fixture();
    state.inbox[0] = { ...state.inbox[0], body: "Short inbox preview", read: true, status: "done" };
    const before = JSON.stringify(state);
    const archived = {
      ...state.inbox[0],
      body: "Could you review the buriedkeyword in the complete archived body?",
      read: false,
      status: "open" as const,
    };
    let prompt = "",
      calls = 0;
    const ask = inboxQuestions({
      load: () => state,
        archive: () => ({ items: [archived], total: 1, matched: 1, importing: false }),
      available: () => true,
      generate: async (value) => {
        prompt = value;
        calls++;
        return JSON.stringify({
          answer: "The archived message asks for a review.",
          references: [archived.id],
        });
      },
    });
    const answer = await ask.ask({ question: "buriedkeyword" });
    expect(answer.mode).toBe("answer");
    expect(answer.results).toHaveLength(1);
    expect(answer.results[0].excerpt).toContain("complete archived body");
    expect(prompt).toContain("buriedkeyword");
    expect(
      (await ask.ask({ question: "unread buriedkeyword", summarize: false })).results,
    ).toHaveLength(0);
    expect(
      (await ask.ask({ question: "Who needs a reply about buriedkeyword?", summarize: false }))
        .results,
    ).toHaveLength(0);
    expect(JSON.stringify(state)).toBe(before);
    state.brainSources = { email: false };
    const disabled = await ask.ask({ question: "buriedkeyword" });
    expect(disabled.canSummarize).toBe(false);
    expect(disabled.results[0].excerpt).toContain("complete archived body");
    expect(calls).toBe(1);
  });
  test("local retrieval responds without a model call and leaves the workspace untouched", async () => {
    const state = fixture(),
      before = JSON.stringify(state);
    let called = false;
    const result = await service(state, async () => {
      called = true;
      return valid;
    }).ask({ question: "What is the launch budget?", summarize: false });
    expect(result.mode).toBe("search");
    expect(result.canSummarize).toBe(true);
    expect(result.results[0].id).toBe("mail-budget");
    expect(called).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
  test("answers are grounded in retrieved text and exact source IDs", async () => {
    let supplied = "";
    const result = await service(fixture(), async (prompt) => {
      supplied = prompt;
      return valid;
    }).ask({ question: "Who needs a reply about the budget?" });
    expect(result.mode).toBe("answer");
    expect(result.results[0].id).toBe("mail-budget");
    expect(supplied).toContain("EUR 12,400");
    expect(supplied).toContain("untrusted data");
    expect(supplied).toContain("Do not claim you sent a reply");
  });
  test("turning email off for AI still permits local retrieval but never calls a model", async () => {
    const state = fixture();
    state.brainSources = { email: false };
    let called = false;
    const result = await service(state, async () => {
      called = true;
      return valid;
    }).ask({ question: "launch budget" });
    expect(result.mode).toBe("search");
    expect(result.canSummarize).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.notice).toContain("switched off");
    expect(called).toBe(false);
  });
  test("hidden provider text is excluded from both retrieval and model context", async () => {
    const state = fixture();
    state.settings.inboxAccounts = { gmail: false };
    let called = false;
    const result = await service(state, async () => {
      called = true;
      return valid;
    }).ask({ question: "launch budget" });
    expect(result.totalSearched).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(called).toBe(false);
  });
  test("unavailable models and zero matches return useful local responses", async () => {
    let called = false;
    const ask = service(
      fixture(),
      async () => {
        called = true;
        return valid;
      },
      false,
    );
    const found = await ask.ask({ question: "budget" });
    expect(found.mode).toBe("search");
    expect(found.canSummarize).toBe(false);
    expect(found.notice).toContain("Connect an assistant");
    const empty = await service(fixture(), async () => {
      called = true;
      return valid;
    }).ask({ question: "submarine" });
    expect(empty.results).toHaveLength(0);
    expect(empty.answer).toContain("No matching");
    expect(called).toBe(false);
  });
  test("unknown citations or malformed output fall back to real excerpts", async () => {
    for (const answer of [
      "not JSON",
      JSON.stringify({ answer: "Invented claim", references: ["invented-id"] }),
      JSON.stringify({ answer: "Uncited", references: [] }),
    ]) {
      const result = await service(fixture(), async () => answer).ask({ question: "budget" });
      expect(result.mode).toBe("search");
      expect(result.results[0].id).toBe("mail-budget");
      expect(result.answer).not.toContain("Invented");
    }
  });
  test("source changes during generation discard the generated answer and refresh matches", async () => {
    const state = fixture();
    const result = await service(state, async () => {
      state.settings.inboxAccounts = { gmail: false };
      return valid;
    }).ask({ question: "budget" });
    expect(result.mode).toBe("search");
    expect(result.results).toHaveLength(0);
    expect(result.answer).not.toContain("EUR 12,400");
    const next = fixture();
    const disabled = await service(next, async () => {
      next.brainSources = { email: false };
      return valid;
    }).ask({ question: "budget" });
    expect(disabled.mode).toBe("search");
    expect(disabled.canSummarize).toBe(false);
    expect(disabled.results).toHaveLength(1);
  });
  test("a slow or uncooperative model is aborted and cannot block local results", async () => {
    let received: AbortSignal | undefined;
    const before = Date.now();
    const result = await service(
      fixture(),
      async (_p, _m, signal) => {
        received = signal;
        return new Promise<string>(() => {});
      },
      true,
      15,
    ).ask({ question: "budget" });
    expect(received?.aborted).toBe(true);
    expect(Date.now() - before).toBeLessThan(1000);
    expect(result.mode).toBe("search");
    expect(result.results).toHaveLength(1);
    expect(result.notice).toContain("stopped");
  });
  test("caller cancellation aborts model work, while already-aborted requests never start it", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const ask = service(fixture(), async (_p, _m, signal) => {
      received = signal;
      return new Promise<string>(() => {});
    });
    const pending = ask.ask({ question: "budget" }, controller.signal);
    controller.abort();
    expect((await pending).mode).toBe("search");
    expect(received?.aborted).toBe(true);
    let called = false;
    await service(fixture(), async () => {
      called = true;
      return valid;
    }).ask({ question: "budget" }, controller.signal);
    expect(called).toBe(false);
  });
  test("concurrent generated answers are bounded while searches remain available", async () => {
    const finish: ((value: string) => void)[] = [];
    const ask = service(
      fixture(),
      async () => new Promise<string>((resolve) => finish.push(resolve)),
    );
    const first = ask.ask({ question: "budget" }),
      second = ask.ask({ question: "budget" });
    const third = await ask.ask({ question: "budget" });
    expect(finish).toHaveLength(2);
    expect(third.mode).toBe("search");
    expect(third.notice).toContain("already being prepared");
    expect((await ask.ask({ question: "budget", summarize: false })).results).toHaveLength(1);
    finish.forEach((resolve) => resolve(valid));
    expect((await first).mode).toBe("answer");
    await second;
  });
  test("untrusted request fields are validated before generation", async () => {
    const ask = service();
    for (const body of [
      { question: "" },
      { question: "x".repeat(601) },
      { question: "budget", summarize: "true" },
      { question: "budget", model: { backend: "local", provider: "ollama", name: { bad: 1 } } },
      {
        question: "budget",
        model: { backend: "local", provider: "ollama", name: "private:cloud" },
      },
    ])
      await expect(ask.ask(body)).rejects.toThrow();
    expect(
      parseInboxQuestionModel({
        backend: "deepseek",
        provider: "openrouter",
        name: "deepseek/deepseek-v4.1-flash",
      })?.name,
    ).toBe("deepseek/deepseek-v4.1-flash");
  });
  test("fenced JSON is supported but unknown IDs and oversized answers are rejected", () => {
    const matches = retrieveInboxQuestion({ question: "budget", state: fixture() });
    expect(parseInboxQuestionAnswer("```json\n" + valid + "\n```", matches).results).toHaveLength(
      1,
    );
    expect(() =>
      parseInboxQuestionAnswer(JSON.stringify({ answer: "x", references: ["unknown"] }), matches),
    ).toThrow();
    expect(() => parseInboxQuestionAnswer("x".repeat(18001), matches)).toThrow();
  });
});
