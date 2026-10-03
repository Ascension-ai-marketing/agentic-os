import { expect, test } from "bun:test";
import { confirmsTask, confirmWord, CONFIRM_WINDOW_MS } from "../src/lib/voice-confirm";

test("only a plain yes starts work", () => {
  for (const t of ["Yes.", "yeah go ahead", "Okay, do it", "Sure", "Go for it!", "Start it", "please do", "Yes please.", "OK then, thanks"]) expect(confirmWord(t)).toBe("yes");
  for (const t of ["No.", "nope", "Cancel that", "wait a second", "Don't", "not now", "Okay, don't start anything", "Yes, but cancel that", "yes stop", "sure, do the other one instead"]) expect(confirmWord(t)).toBe("no");
  for (const t of ["", "what's the weather", "Please read the email instead".replace(" instead", ""), "make it blue", "I said yes to the invite", "okay so what about my calendar"]) expect(confirmWord(t)).toBeNull();
});

test("the yes must be spoken after the card appeared, and in time", () => {
  const proposed = 1_000_000;
  expect(confirmsTask({ text: "yes", spokenAt: proposed + 500 }, proposed, proposed + 2000)).toBe("yes");
  // Words that started before the card (a late transcript) never confirm it.
  expect(confirmsTask({ text: "yes", spokenAt: proposed - 1 }, proposed, proposed + 2000)).toBeNull();
  // A card left alone expires.
  expect(confirmsTask({ text: "yes", spokenAt: proposed + CONFIRM_WINDOW_MS + 5 }, proposed, proposed + CONFIRM_WINDOW_MS + 10)).toBeNull();
});

test("only a clear request changes how Jarvis sounds", async () => {
  const { asksForStyleChange } = await import("../src/lib/voice-confirm");
  for (const t of ["Be funnier", "talk faster please", "Be more sarcastic, and talk a bit faster.", "can you be less sarcastic", "slow down your speed", "turn the humour up"]) expect(asksForStyleChange(t)).toBe(true);
  for (const t of ["Do not change your speed or humour", "Give me a quick summary", "don't be sarcastic about it", "what's on my calendar", "keep your humour as it is", "Don’t talk faster", "I would rather you did not talk faster", "Make this email funnier", "make the caption more sarcastic", "Can you make this email funnier?", "Jarvis, make the caption more sarcastic", "No more changes to your speed"]) expect(asksForStyleChange(t)).toBe(false);
});
