import { expect, test } from "bun:test";
import { voiceDestination, voiceIntent } from "../src/lib/voice-actions";

test("navigation only accepts exact internal app destinations", () => {
  expect(voiceDestination("/calendar")?.label).toBe("Calendar");
  for (const path of [
    "https://example.com",
    "//example.com",
    "/calendar?redirect=https://example.com",
    "/__operator/voice/configure",
    "/memory/../settings",
    "javascript:alert(1)",
    "/settings#external",
    null,
    {},
    1,
  ]) {
    expect(voiceDestination(path)).toBeUndefined();
  }
});

test("direct navigation works without invoking a language model", () => {
  expect(voiceIntent("Jarvis, open my calendar")).toEqual({ kind: "navigate", path: "/calendar" });
  expect(voiceIntent("Show me my memories")).toEqual({ kind: "navigate", path: "/memory" });
  expect(voiceIntent("Take me to Hermes")).toEqual({ kind: "navigate", path: "/agents/hermes" });
  expect(voiceIntent("Open my inbox")).toEqual({ kind: "navigate", path: "/inbox" });
});

test("memory requests preserve the search query rather than just opening the page", () => {
  expect(voiceIntent("Find my memories about product launch")).toEqual({
    kind: "memory",
    query: "product launch",
  });
  expect(voiceIntent("Show me notes on the London meeting")).toEqual({
    kind: "memory",
    query: "the London meeting",
  });
});

test("questions and unsupported requests stay with the grounded assistant", () => {
  for (const request of [
    "What needs my attention?",
    "What is on my calendar tomorrow?",
    "Delete all my memories",
    "Open https://example.com",
    "",
  ])
    expect(voiceIntent(request)).toEqual({ kind: "ask" });
});

test("Motion Library is reachable by voice", () => {
  expect(voiceIntent("Open Motion Library")).toEqual({ kind: "navigate", path: "/motion" });
  expect(voiceIntent("Take me to the animation styles")).toEqual({
    kind: "navigate",
    path: "/motion",
  });
  expect(voiceDestination("/motion")?.label).toBe("Motion Library");
});
