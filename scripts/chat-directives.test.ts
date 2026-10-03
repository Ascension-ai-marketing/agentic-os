import { expect, test } from "bun:test";
import { pageNameFor, readNavDirective, shouldFollowNavDirective } from "../src/lib/chat-directives";

const allowed = ["/memory", "/settings", "/agents/hermes"];

test("a navigation directive is stripped from the reply and only allowlisted targets survive", () => {
  expect(readNavDirective("You can look for today's conversation in Memory. <<nav:/memory>>", allowed)).toEqual({
    text: "You can look for today's conversation in Memory.",
    target: "/memory",
  });
  expect(readNavDirective("Try the portal <<nav:/agents/hermes?intel=1>> now.", allowed)).toEqual({ text: "Try the portal  now.", target: "/agents/hermes?intel=1" });
  expect(readNavDirective("Nothing to see <<nav:/evil>>", allowed)).toEqual({ text: "Nothing to see" });
  expect(readNavDirective("Plain answer.", allowed)).toEqual({ text: "Plain answer." });
});

test("only a request that asks to go somewhere lets a reply move the user", () => {
  for (const request of ["Open my inbox", "take me to settings", "Show me the memory page", "where can I find my skills?"])
    expect(shouldFollowNavDirective(request)).toBe(true);
  for (const request of ["Hey, what was a conversation I had with Codex this morning?", "Summarise yesterday", "What is in Memory?"])
    expect(shouldFollowNavDirective(request)).toBe(false);
});

test("page names read from the path", () => {
  expect(pageNameFor("/memory")).toBe("Memory");
  expect(pageNameFor("/agents/hermes?intel=1")).toBe("Hermes");
  expect(pageNameFor("/memory-map")).toBe("Memory map");
  expect(pageNameFor("/")).toBe("Home");
});
