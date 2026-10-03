import { expect, test } from "bun:test";
import { isCalendarCreateIntent, parseCalendarDraft } from "../src/lib/chat-calendar";

test("booking intent reaches review while schedule questions stay conversational", () => {
  for (const request of [
    "book a call tomorrow",
    "Can you please schedule a meeting?",
    "I'd like to book an appointment",
    "please create an event",
  ])
    expect(isCalendarCreateIntent(request)).toBe(true);
  for (const request of [
    "What's on my calendar?",
    "Don't book that meeting",
    "Explain how to book an appointment",
    "Can you show tomorrow's schedule?",
  ])
    expect(isCalendarCreateIntent(request)).toBe(false);
});
test("calendar proposals preserve explicit guest text, require qualified dates and strip action fields", () => {
  const original = {
    title: "Synthetic call",
    start: "2030-01-02T10:00:00+04:00",
    end: "2030-01-02T10:30:00+04:00",
    attendees: ["guest@example.test"],
    confirm: true,
    provider: "google",
    reviewId: "injected",
  };
  const draft = parseCalendarDraft(JSON.stringify(original));
  expect(draft).not.toHaveProperty("confirm");
  expect(draft).not.toHaveProperty("provider");
  expect(draft).not.toHaveProperty("reviewId");
  expect(draft).toHaveProperty("attendees", ["guest@example.test"]);
  expect(() =>
    parseCalendarDraft(JSON.stringify({ ...original, start: "2030-01-02T10:00:00" })),
  ).toThrow("Include a date");
  expect(() => parseCalendarDraft(JSON.stringify({ ...original, end: original.start }))).toThrow(
    "Include a date",
  );
  expect(parseCalendarDraft('{"question":"Which day?"}')).toEqual({ question: "Which day?" });
});
