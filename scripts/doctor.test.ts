import { expect, test } from "bun:test";
import { diagnose, sinceStart, type Seen } from "./doctor";

const UP = { loaded: true, answered: true, ms: 300 };
const BANNER = "Speech Engine seng_sample · model claude-sonnet-5-5\n  Brain  ws://127.0.0.1:3001/ws\n";
const CREDITS = '[speech 00:56:03] reply failed: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}\n';
const healthy: Seen = {
  jobs: { brain: UP, tunnel: UP, dashboard: UP },
  logs: { brain: BANNER, dashboard: "  VITE v7.3.3  ready in 980 ms\n" },
  claude: { installed: true, ready: true, detail: "Claude Code reports signed in.", ms: 900 },
  anthropicKey: true,
  tunnel: { saved: "sample.ngrok.app", live: ["sample.ngrok.app"] },
  openclaw: { installed: true, version: "2026.9.9", agreed: true },
};
const statuses = (seen: Seen) => diagnose(seen).map((item) => `${item.status} ${item.area}`);

test("a healthy computer has nothing to fix", () => {
  const findings = diagnose(healthy);
  expect(findings.every((item) => item.status === "ok")).toBe(true);
  expect(findings.map((item) => item.area)).toContain("OpenClaw");
});

test("a job that is installed but does not answer is the first thing to fix, with its log and restart", () => {
  const [first] = diagnose({ ...healthy, jobs: { ...healthy.jobs, dashboard: { loaded: true, answered: false, ms: 15_000 } } });
  expect(first).toMatchObject({ area: "Dashboard", status: "fail", says: "Installed, but it did not answer within 15 s." });
  expect(first.fix).toContain("tail -n 40 .operator-data/ceo/logs/dashboard.log");
  expect(first.fix).toContain("bun run install:ceo --apply --only dashboard");
  expect(statuses({ ...healthy, jobs: { ...healthy.jobs, brain: { loaded: false, answered: false, ms: 10 } } })[0]).toBe("fail Jarvis's brain");
  expect(statuses({ ...healthy, jobs: { ...healthy.jobs, dashboard: { loaded: true, answered: true, ms: 9000 } } })[0]).toBe("warn Dashboard");
});

test("a job with nothing listening is told apart from one that took the connection and never answered", () => {
  const [refused] = diagnose({ ...healthy, jobs: { ...healthy.jobs, brain: { loaded: true, answered: false, listening: false, ms: 30_400 } } });
  expect(refused.says).toBe("Installed, but nothing was listening on its port for 30 s: it stopped, or keeps failing to start.");
  const [slow] = diagnose({ ...healthy, jobs: { ...healthy.jobs, brain: { loaded: true, answered: false, listening: true, ms: 15_000 } } });
  expect(slow.says).toBe("Installed, but it did not answer within 15 s.");
});

test("credits that ran out since the brain last started are named, with where to add them", () => {
  const [first] = diagnose({ ...healthy, logs: { brain: BANNER + CREDITS } });
  expect(first.status).toBe("fail");
  expect(first.says).toBe("Jarvis cannot think: the Anthropic API account has no credits left.");
  expect(first.fix).toContain("console.anthropic.com");
});

test("credits that ran out before the last restart are a warning, not a verdict", () => {
  const [first] = diagnose({ ...healthy, logs: { brain: CREDITS + "[speech 01:17:33] connection dropped\n" + BANNER } });
  expect(first.status).toBe("warn");
  expect(first.says).toStartWith("Before its last restart:");
});

test("the log since a start is what follows the latest start banner", () => {
  expect(sinceStart("brain", `old\n${BANNER}middle\n${BANNER}new\n`).current).toBe(`${BANNER}new\n`);
  expect(sinceStart("dashboard", "x\n  VITE v7.3.3  ready in 5884 ms\ny\n  VITE v7.3.3  ready in 979 ms\nz\n").current).toBe("VITE v7.3.3  ready in 979 ms\nz\n");
  expect(sinceStart("brain", "no banner at all\n")).toEqual({ before: "", current: "no banner at all\n" });
});

test("Claude Code the OS cannot find, cannot sign in to, or checks too slowly is told apart", () => {
  const claude = (patch: Partial<NonNullable<Seen["claude"]>>) => diagnose({ ...healthy, claude: { ...healthy.claude!, ...patch } })[0];
  expect(claude({ installed: false, ready: false })).toMatchObject({ status: "fail", area: "Claude Code" });
  expect(claude({ installed: false, ready: false }).fix).toContain("ln -sf");
  expect(claude({ ready: false, detail: "Claude Code is installed but signed out." })).toMatchObject({ status: "fail", says: "Claude Code is installed but signed out." });
  expect(claude({ ms: 6500 })).toMatchObject({ status: "warn" });
  expect(claude({ ms: 6500 }).says).toContain("6.5 s");
});

test("a tunnel open at another address than the one ElevenLabs calls is broken; one not saved is a warning", () => {
  expect(diagnose({ ...healthy, tunnel: { saved: "sample.ngrok.app", live: ["other.ngrok.app"] } })[0]).toMatchObject({ area: "Public tunnel", status: "fail" });
  expect(diagnose({ ...healthy, tunnel: { saved: "" } })[0]).toMatchObject({ area: "Public tunnel", status: "warn" });
});

test("no Anthropic key for the brain is a failure; OpenClaw not cleared is only reported", () => {
  expect(diagnose({ ...healthy, anthropicKey: false })[0]).toMatchObject({ area: "Jarvis's brain", status: "fail" });
  const claw = diagnose({ ...healthy, openclaw: { installed: true, version: "2026.9.9", agreed: false } }).find((item) => item.area === "OpenClaw")!;
  expect(claw.status).toBe("ok");
  expect(claw.says).toContain("takes no work until you agree to its limits");
});

test("what was not seen is not guessed at", () => {
  expect(diagnose({})).toEqual([]);
});
