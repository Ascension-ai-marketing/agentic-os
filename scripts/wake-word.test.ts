import { expect, test } from "bun:test";
import { QUIET_MS, REPLY_MS, quietTooLong, wakeStatus } from "../src/lib/wake-word";

test("the page listens for the word only when switched on, clicked once and the microphone is free", () => {
  const on = { enabled: true, clicked: true, holds: 0, ready: true };
  expect(wakeStatus({ ...on, enabled: false })).toBe("off");
  expect(wakeStatus({ ...on, clicked: false })).toBe("waiting");
  expect(wakeStatus({ ...on, ready: false })).toBe("starting");
  expect(wakeStatus(on)).toBe("listening");
  expect(wakeStatus({ ...on, holds: 1 })).toBe("paused");
  expect(wakeStatus({ ...on, error: "No key." })).toBe("error");
  expect(wakeStatus({ ...on, enabled: false, error: "No key." })).toBe("off");
});

test("a quiet conversation closes after 20 seconds, but not while Jarvis speaks or is still answering", () => {
  const call = { now: 100_000, lastSound: 100_000 - QUIET_MS - 1, speaking: false, awaitingReply: false };
  expect(quietTooLong(call)).toBe(true);
  expect(quietTooLong({ ...call, lastSound: 100_000 - QUIET_MS + 1 })).toBe(false);
  expect(quietTooLong({ ...call, speaking: true })).toBe(false);
  expect(quietTooLong({ ...call, awaitingReply: true })).toBe(false);
  expect(quietTooLong({ ...call, awaitingReply: true, lastSound: 100_000 - REPLY_MS - 1 })).toBe(true);
});
