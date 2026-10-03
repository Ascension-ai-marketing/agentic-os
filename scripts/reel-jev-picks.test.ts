import { test, expect } from "bun:test";
import { simulateReelJevPick, reelStyleFor, reelPickRequest, REEL_PICK_CRITERIA } from "../src/lib/reel-jev-picks";
const takes = [{ key: "A", family: "A" as const }, { key: "A2", family: "A" as const }, { key: "B", family: "B" as const }, { key: "C", family: "C" as const }, { key: "C2", family: "C" as const }];
test("Jev scores every take on three plain criteria and explains the pick with the spoken line", () => {
  expect(REEL_PICK_CRITERIA.map(c => c.label)).toEqual(["Matches the line's energy", "Reads in one second", "Different from the section before"]);
  const pick = simulateReelJevPick({ id: "s1", name: "Hook: free credits", words: "Claude is handing out free credits right now, up to $250," }, 0, 7, takes)!;
  expect(pick.family).toBe("C");
  expect(pick.reason).toContain("“up to $250” is the hook, so it needs the loudest look.");
  expect(pick.reason).not.toContain("—");
  expect(Object.keys(pick.scores).sort()).toEqual(["energy", "glance", "variety"]);
  expect(pick.odds[0].key).toBe(pick.pick);
  expect(pick.odds.reduce((n, o) => n + o.p, 0)).toBeCloseTo(1, 6);
  expect(pick.sample).toBe(true);
});
test("the section before lowers a repeat of the same style", () => {
  const s = { id: "s3", name: "Pro $100, Max $250", words: "you get $100 on Pro and $250 on Max," };
  const fresh = simulateReelJevPick(s, 2, 7, takes)!;
  const repeat = simulateReelJevPick(s, 2, 7, takes, fresh.family)!;
  expect(repeat.scores.variety).toBeLessThan(fresh.scores.variety);
  if (repeat.family === fresh.family) expect(repeat.reason).toContain("repeats the last look");
  expect(simulateReelJevPick(s, 2, 7, takes, "A")!.reason).toContain("changes the look from the section before");
});
test("style rules follow the beat, and the live request uses the criteria", () => {
  expect(reelStyleFor({ name: "Claim by 7 October", words: "but only if you claim by October the 7th." }, 3, 7).family).toBe("C");
  expect(reelStyleFor({ name: "Close your laptop", words: "close your laptop and wake up" }, 5, 7).family).toBe("A");
  expect(simulateReelJevPick({ id: "s9", name: "x", words: "y" }, 1, 3, [])).toBeNull();
  const req = reelPickRequest({ name: "Hook", words: "free credits" }, takes, "B");
  expect(Object.keys(req.questions)).toEqual(["best", "energy", "glance", "variety"]);
  expect(req.surface).toBe("reels");
});
