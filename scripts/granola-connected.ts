import { DOMParser } from "linkedom";
import { withConnectedRead } from "./codex-connected-read";

const xmlText = (value: string) => value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (full, entity: string) => {
  const named: Record<string, string> = {amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
  if (entity[0] !== "#") return named[entity.toLowerCase()] || full;
  const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : full;
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Only provider meeting elements become data. Surrounding prose is never an instruction. */
export function granolaMeetings(raw: unknown) {
  const text = (raw as { text?: unknown })?.text;
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024) throw new Error("Granola returned an unsupported meeting response.");
  // An empty list comes back self-closed: <meetings_data count="0" />.
  if (/<meetings_data\b[^>]*\/>/.test(text) && !/<meeting\b/.test(text)) return [];
  const xml = text.match(/<meetings_data\b[\s\S]*?<\/meetings_data>/)?.[0];
  if (!xml) throw new Error("Granola returned no structured meeting list.");
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  return Array.from(doc.querySelectorAll("meeting")).map(meeting => {
    const id = meeting.getAttribute("id") || "";
    if (!uuid.test(id)) throw new Error("Granola returned an invalid meeting reference.");
    const title = xmlText(meeting.getAttribute("title") || "Granola meeting").slice(0, 300);
    const date = (meeting.getAttribute("date") || "").slice(0, 100);
    const at = Date.parse(date.replace(/\s+GMT([+-]\d{1,2})(?::?(\d{2}))?$/, (_m, h, m) => ` GMT${h[0]}${h.slice(1).padStart(2, "0")}${m || "00"}`));
    const url = meeting.getAttribute("url") || "";
    const participants = xmlText(meeting.querySelector("known_participants")?.textContent || "").trim().slice(0, 3000);
    const notes = Array.from(meeting.querySelectorAll("summary, private_notes, enhanced_notes, notes")).map(part => xmlText(part.textContent || "").trim()).filter(Boolean).join("\n\n");
    return {
      id,
      title,
      at: Number.isFinite(at) ? new Date(at).toISOString() : undefined,
      url: /^https:\/\/notes\.granola\.ai\//.test(url) ? url : undefined,
      text: notes ? `Date: ${Number.isFinite(at) ? new Date(at).toISOString() : date}\n${participants ? `Participants: ${participants}\n` : ""}\n${notes}` : "",
    };
  }).sort((a, b) => (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0));
}
const DAY = 864e5;
/**
 * Meeting notes through the Granola connection in Codex: every meeting of the
 * past year (not only this week, which is often empty), notes read ten at a time.
 */
export async function connectedGranolaNotes(root: string, read = withConnectedRead, now = Date.now(), days = 365) {
  return read(root, async client => {
    const range = {
      time_range: "custom",
      custom_start: new Date(now - days * DAY).toISOString().slice(0, 10),
      custom_end: new Date(now + DAY).toISOString().slice(0, 10),
    };
    const list = granolaMeetings(await client.call("granola.list_meetings", range));
    const ids = [...new Set(list.map(meeting => meeting.id))].slice(0, 300);
    if (!ids.length) return { documents: [], hasMore: false };
    const documents: ReturnType<typeof granolaMeetings> = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const got = granolaMeetings(await client.call("granola.get_meetings", { meeting_ids: batch }));
      if (got.length !== batch.length || new Set(got.map(doc => doc.id)).size !== batch.length || got.some(doc => !batch.includes(doc.id))) throw new Error("Granola returned an unexpected meeting. Saved memory was preserved.");
      documents.push(...got);
    }
    return { documents: documents.filter(doc => doc.text), hasMore: false };
  }, { timeoutMs: 300000, callTimeoutMs: 90000 });
}
