import { test, expect } from "bun:test";
import { gate } from "../src/lib/jev-gate";

test("plain questions and conversation go straight to the chat model", () => {
  for (const q of ["What's on my calendar today?", "How are my sales this week?", "Explain what Jev does", "thanks, that's great", "Show me what's on my calendar today", "Can you tell me who emailed me?", "What should I post on Instagram?", "Is Fish Audio better than ElevenLabs?"])
    expect(gate(q)).toEqual({ kind: "chat" });
});
test("clear navigation opens the page with no Jev call", () => {
  const cases: [string, string][] = [
    ["Take me to my dashboard", "/business"], ["Let's go check out my dashboard", "/business"], ["open reels", "/design?mode=reels"],
    ["show me my inbox", "/inbox"], ["Hey Jev, open the calendar", "/calendar"], ["go to settings", "/settings"],
    ["pull up the design library", "/design?mode=library"], ["open memory", "/memory"], ["take me to Hermes", "/agents/hermes"], ["open the website builder", "/websites"],
  ];
  for (const [q, path] of cases) expect(gate(q)).toMatchObject({ kind: "open", path });
});
test("unclear navigation asks Jev once; 'show me how' is not navigation", () => {
  expect(gate("take me to the thing from earlier")).toEqual({ kind: "ask-jev" });
  expect(gate("show me how to price a course")).toEqual({ kind: "chat" });
  expect(gate("open the calendar and delete everything")).toEqual({ kind: "ask-jev" });
});
test("questions about the past go to Memory, focused", () => {
  expect(gate("Hey Jev, when did I chat to Claude about pricing?")).toEqual({ kind: "memory", focus: { source: "claude", query: "pricing", range: "all", view: "timeline", open: true } });
  expect(gate("find where I talked about the gym page last week")).toMatchObject({ kind: "memory", focus: { query: "gym page", range: "7d" } });
});
test("real work goes to Jev for the executor and model", () => {
  for (const q of ["Build me a landing page for my gym", "Can you fix the failing build script", "Research the top five AI voice tools", "Draft a reply to Sam about Friday", "please write a script that renames my photos", "send the invoice to Tal"])
    expect(gate(q)).toEqual({ kind: "work" });
});
test("a follow-up continues the open task only when one is open", () => {
  expect(gate("also make the accent blue", { hasOpenTask: true })).toEqual({ kind: "continue" });
  expect(gate("also make the accent blue")).toEqual({ kind: "chat" });
});

test("walkthrough actions open the page that presses the button", () => {
  expect(gate("sort my inbox")).toMatchObject({ kind: "open", path: "/inbox?jev=sort" });
  expect(gate("find the Halden invoice from August")).toMatchObject({ kind: "open", path: "/inbox?jev=invoices&q=halden%20invoice%20from%20august" });
  expect(gate("let Jev pick my reels")).toMatchObject({ kind: "open", path: "/design?mode=reels&jev=pick" });
  expect(gate("run the audio pipeline")).toMatchObject({ kind: "open", path: "/design?mode=reels&audio=run" });
  expect(gate("Jev, add sound effects to my reel")).toMatchObject({ kind: "open", path: "/design?mode=reels&audio=run" });
  expect(gate("add sound effects to my reels please")).toMatchObject({ kind: "open", path: "/design?mode=reels&audio=run" });
  expect(gate("search my images for robots")).toMatchObject({ kind: "open", path: "/design?mode=library&q=robots&ask=1" });
  expect(gate("open that file")).toEqual({ kind: "open-current" });
  expect(gate("open the note about Clay")).toMatchObject({ kind: "memory", focus: { openOriginal: true } });
  expect(gate("what day is it")).toEqual({ kind: "chat" });
  expect(gate("build me a landing page")).toEqual({ kind: "work" });
});
test("naming an agent to do something is work", () => {
  expect(gate("Kick something off in Codex, do some research on Galileo")).toEqual({ kind: "work" });
  expect(gate("get Claude Code to tidy the readme")).toEqual({ kind: "work" });
  expect(gate("what is Codex?")).toEqual({ kind: "chat" });
});
