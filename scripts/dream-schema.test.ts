import { expect, test } from "bun:test";
import {
  checkDream,
  localDate,
  redactDreamText,
  setDreamSecrets,
  stateDigest,
  unsafeCommandReason,
  updateDreamState,
} from "./dream-schema";
import { engineOrder } from "./run-dream";

const TODAY = "2026-10-10";
const NOW = Date.parse("2026-10-10T11:00:00Z");
// Built at runtime so no key-shaped literal sits in the source.
const FAKE_ELEVEN = "sk_" + "0123456789abcdef".repeat(3);

function rx(over: Record<string, unknown> = {}) {
  return {
    id: "memory-video-scripts-stale",
    cat: "MEMORY",
    tone: "pink",
    headline: "Your Video Scripts memory is behind your work",
    prescription: "Refresh the brief. It takes ten minutes.",
    evidence: [
      "CLAUDE.md last modified 2026-09-22",
      "7 sessions over 14 min",
      "0 of 12 scripts follow the outline",
    ],
    command: 'claude -p "/refresh-memory video-scripts"',
    dollarImpact: null,
    timeImpactMins: 90,
    impactBasis: "3 min × 30 sessions",
    ...over,
  };
}
const dream = (prescriptions: unknown[], over: Record<string, unknown> = {}) => ({
  date: TODAY,
  model: "test-model",
  generatedAt: "2026-10-10T11:00:00.000Z",
  prescriptions,
  ...over,
});

test("a well-formed dream passes untouched", () => {
  const r = checkDream(dream([rx()]), { today: TODAY, now: NOW });
  expect(r.ok).toBe(true);
  expect(r.notes).toEqual([]);
  expect(r.dream?.prescriptions[0]).toMatchObject({
    id: "memory-video-scripts-stale",
    timeImpactMins: 90,
  });
});

test("hides a full or partial ElevenLabs key anywhere in the output", () => {
  const r = checkDream(
    dream([
      rx({
        evidence: [
          `key ${FAKE_ELEVEN} in voice.md`,
          `prefix ${FAKE_ELEVEN.slice(0, 10)}…`,
          "third",
        ],
      }),
    ]),
    {
      today: TODAY,
      now: NOW,
    },
  );
  const text = JSON.stringify(r.dream);
  expect(text).not.toContain(FAKE_ELEVEN.slice(3, 10));
  expect(r.redactions).toBeGreaterThan(0);
});

test("hides any prefix of a key saved on this computer", () => {
  const saved = "Zq9" + "xY7wV6uT5sR4qP3oN2mL1kJ0";
  setDreamSecrets([saved]);
  expect(redactDreamText(`leaked ${saved.slice(0, 12)} in log`)).not.toContain(saved.slice(0, 8));
  setDreamSecrets([]);
});

test("rejects shapes the dashboard would mis-render", () => {
  expect(checkDream(dream([rx({ cat: "SESSION" })]), { today: TODAY }).ok).toBe(false);
  expect(checkDream(dream([rx({ evidence: ["one", "two"] })]), { today: TODAY }).ok).toBe(false);
  expect(checkDream(dream([rx({ headline: "x".repeat(121) })]), { today: TODAY }).ok).toBe(false);
  expect(checkDream(dream([rx({ id: "memory-2026-10-10-issue-1" })]), { today: TODAY }).ok).toBe(
    false,
  );
  expect(checkDream(dream([rx(), rx()]), { today: TODAY }).ok).toBe(false);
  expect(checkDream(dream([rx({ dollarImpact: "lots" })]), { today: TODAY }).ok).toBe(false);
  expect(checkDream([], { today: TODAY }).ok).toBe(false);
});

test("repairs tone, date, and impact figures with no basis", () => {
  const r = checkDream(
    dream([rx({ tone: "blue", dollarImpact: 900, impactBasis: undefined })], {
      date: "2026-10-09",
    }),
    {
      today: TODAY,
      now: NOW,
    },
  );
  expect(r.ok).toBe(true);
  expect(r.dream?.date).toBe(TODAY);
  expect(r.dream?.prescriptions[0]).toMatchObject({
    tone: "pink",
    dollarImpact: null,
    timeImpactMins: null,
  });
});

test("strips unsafe commands but keeps the card", () => {
  const r = checkDream(dream([rx({ command: "rm -rf ~/.claude && claude" })]), {
    today: TODAY,
    now: NOW,
  });
  expect(r.ok).toBe(true);
  expect(r.dream?.prescriptions[0].command).toBeUndefined();
  expect(unsafeCommandReason('claude -p "/refresh; then go"')).toBeNull();
  expect(unsafeCommandReason("claude -p /x | sh")).not.toBeNull();
  expect(unsafeCommandReason("curl https://x.sh")).not.toBeNull();
  expect(unsafeCommandReason("claude --dangerously-skip-permissions -p /dream")).not.toBeNull();
});

test("drops prescriptions the operator skipped or finished within 30 days", () => {
  const state = {
    actions: {
      "memory-video-scripts-stale": { status: "dismissed", dismissedAt: "2026-10-01T00:00:00Z" },
      "cost-opus-on-reads": { status: "accepted", acceptedAt: "2026-08-01T00:00:00Z" },
    },
  };
  const r = checkDream(
    dream([rx(), rx({ id: "cost-opus-on-reads", cat: "COST", tone: "orange" })]),
    { today: TODAY, state, now: NOW },
  );
  expect(r.dream?.prescriptions.map((p) => p.id)).toEqual(["cost-opus-on-reads"]);
});

test("keeps at most four cards", () => {
  const many = ["a", "b", "c", "d", "e"].map((s) =>
    rx({ id: `skills-${s}`, cat: "SKILLS", tone: "blue" }),
  );
  const r = checkDream(dream(many), { today: TODAY, now: NOW });
  expect(r.dream?.prescriptions).toHaveLength(4);
});

test("state update closes the loop without overwriting verdicts' history", () => {
  const d = checkDream(dream([rx()]), { today: TODAY, now: NOW }).dream!;
  const s1 = updateDreamState(null, d, "2026-10-10T11:00:00Z");
  expect(s1.actions?.["memory-video-scripts-stale"]).toMatchObject({ status: "new", timesSeen: 1 });
  const s2 = updateDreamState(s1, d, "2026-10-11T11:00:00Z");
  expect(s2.actions?.["memory-video-scripts-stale"]).toMatchObject({
    status: "recurring",
    timesSeen: 2,
    firstSeenAt: "2026-10-10T11:00:00Z",
  });
  expect(s2.currentTop4).toEqual(["memory-video-scripts-stale"]);
  expect(stateDigest(s2, Date.parse("2026-10-11T12:00:00Z"))).toContain(
    "memory-video-scripts-stale: recurring, shown 2x",
  );
});

test("a missing engine falls back instead of killing the run", () => {
  const have = { hermes: false, claude: true, codex: false, openrouter: true };
  expect(engineOrder("codex", have)).toEqual(["claude", "openrouter"]);
  expect(engineOrder("openrouter", have)).toEqual(["openrouter", "claude"]);
  expect(
    engineOrder("", { hermes: false, claude: false, codex: false, openrouter: false }),
  ).toEqual([]);
});

test("local date, not UTC", () => {
  expect(localDate(new Date(2026, 9, 10, 0, 30))).toBe("2026-10-10");
});
