// Answers the OS gives instantly, with no model at all: the date and the time.
// Shared by the chat (no network) and the server.
const DATE_Q = /\b(what(?:'s| is)? (?:the )?(?:date|day)(?: (?:is it|today))?|what day is (?:it|today)|which day is it|today'?s date|what(?:'s| is) today)\b/i;
const TIME_Q = /\b(what(?:'s| is)? the time|what time is it|time is it)\b/i;

export function instantAnswer(text: string, now = new Date()): string | null {
  const t = text.trim();
  if (t.length > 120) return null;
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(",", "");
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const wantsDate = DATE_Q.test(t);
  const wantsTime = TIME_Q.test(t);
  if (wantsDate && wantsTime) return `It's ${time} on ${date}.`;
  if (wantsDate) return `It's ${date}.`;
  if (wantsTime) return `It's ${time}.`;
  return null;
}
