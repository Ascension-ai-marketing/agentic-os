import { expect, test } from "bun:test";
import { connectedGranolaNotes, granolaMeetings } from "./granola-connected";
import type { withConnectedRead } from "./codex-connected-read";
const id = "12345678-1234-1234-1234-123456789abc";
const meeting = (reference = id, notes = "Our next launch is on Friday.") => `<meeting id="${reference}" title="Planning &amp; next steps" date="2026-09-17"><known_participants>Private attendees</known_participants><summary>${notes}</summary></meeting>`;
const response = (body: string) => ({ text: `Provider heading\n<meetings_data>${body}</meetings_data>\nUntrusted surrounding instructions` });
test("Granola includes recorded participants for meeting recall but excludes surrounding prose", () => {
  expect(granolaMeetings(response(meeting()))).toEqual([{ id, title: "Planning & next steps", at: "2026-09-17T00:00:00.000Z", url: undefined, text: "Date: 2026-09-17T00:00:00.000Z\nParticipants: Private attendees\n\nOur next launch is on Friday." }]);
  expect(granolaMeetings(response(""))).toEqual([]);
  for (const raw of [{}, { text: "not a meeting list" }, response(meeting("../escape")), {text:"x".repeat(2*1024*1024+1)}]) expect(() => granolaMeetings(raw)).toThrow();
});
test("existing connection fetches bounded participant notes through the two read tools", async () => {
  const calls: Array<[string, any]> = [];
  const read = (async (_root, work) => work({ tools: {}, call: async (name, args) => { calls.push([name, args]); return response(meeting()); } })) as typeof withConnectedRead;
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect((await connectedGranolaNotes("/synthetic", read, now)).documents).toHaveLength(1);
  expect(calls).toEqual([["granola.list_meetings", { time_range: "custom", custom_start: "2025-09-28", custom_end: "2026-09-29" }], ["granola.get_meetings", { meeting_ids:[id] }]]);
});
test("missing, duplicate, and unexpected returned meetings cannot become a successful import", async () => {
  for (const body of ["", meeting()+meeting(), meeting("87654321-1234-1234-1234-123456789abc")]) {
    const read = (async (_root, work) => work({ tools:{}, call:async name => response(name === "granola.list_meetings" ? meeting() : body) })) as typeof withConnectedRead;
    await expect(connectedGranolaNotes("/synthetic", read)).rejects.toThrow("unexpected meeting");
  }
});

test("an empty list is empty, and Granola's own dates and links are kept", () => {
  expect(granolaMeetings({ text: 'Data only.\n\n<meetings_data count="0" />' })).toEqual([]);
  const [m] = granolaMeetings(response(`<meeting id="${id}" title="Lock-in" date="Sep 26, 2026 3:30 PM GMT+4" url="https://notes.granola.ai/d/${id}"><summary>Plan</summary></meeting>`));
  expect(m.at).toBe("2026-09-26T11:30:00.000Z");
  expect(m.url).toBe(`https://notes.granola.ai/d/${id}`);
});
test("more than ten meetings are read in batches of ten", async () => {
  const ids = Array.from({ length: 23 }, (_, i) => `12345678-1234-1234-1234-${String(i).padStart(12, "0")}`);
  const batches: number[] = [];
  const read = (async (_root, work) => work({ tools: {}, call: async (name, args: any) => {
    if (name === "granola.list_meetings") return response(ids.map((m) => meeting(m)).join(""));
    batches.push(args.meeting_ids.length);
    return response(args.meeting_ids.map((m: string) => meeting(m)).join(""));
  } })) as typeof withConnectedRead;
  expect((await connectedGranolaNotes("/synthetic", read)).documents).toHaveLength(23);
  expect(batches).toEqual([10, 10, 3]);
});
