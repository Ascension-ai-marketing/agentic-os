export type ChatCalendarDraft = {
  title: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  note?: string;
};
export function isCalendarCreateIntent(text: string): boolean {
  return /^(?:(?:can|could|would) you\s+|(?:i'd|i would) like (?:you )?to\s+)?(?:please\s+)?(?:schedule|book|(?:add|create) (?:an? )?(?:event|meeting|appointment))\b/i.test(
    text.trim(),
  );
}
export function parseCalendarDraft(answer: string): ChatCalendarDraft | { question: string } {
  const value = JSON.parse(
    answer
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim(),
  );
  if (typeof value?.question === "string" && value.question.trim())
    return { question: value.question.slice(0, 500) };
  const instant = (text: unknown) =>
    typeof text === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) &&
    Number.isFinite(Date.parse(text));
  if (
    typeof value?.title !== "string" ||
    !value.title.trim() ||
    !instant(value.start) ||
    !instant(value.end) ||
    Date.parse(value.end) <= Date.parse(value.start)
  )
    throw new Error("Include a date, start time and duration so you can review the event.");
  const attendees = Array.isArray(value.attendees)
    ? value.attendees
    : typeof value.attendees === "string"
      ? value.attendees.split(/[,;\n]/)
      : [];
  return {
    title: value.title.trim().slice(0, 200),
    start: value.start,
    end: value.end,
    location: typeof value.location === "string" ? value.location.slice(0, 500) : "",
    attendees: attendees
      .filter((item: unknown): item is string => typeof item === "string")
      .map((item: string) => item.trim())
      .filter(Boolean)
      .slice(0, 50),
    note: typeof value.note === "string" ? value.note.slice(0, 500) : undefined,
  };
}
