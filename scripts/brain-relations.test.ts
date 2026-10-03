import { describe, expect, test } from "bun:test";
import {
  memoryTime,
  relateRecords,
  topicWords,
  type RelationFacet,
} from "../src/components/brain/brain-relations";

const filler = (i: number): RelationFacet => ({
  id: `f${i}`,
  origin: i % 2 ? "obsidian" : "claude",
  name: `note ${["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"][i % 6]}${i}`,
});

describe("brain relations", () => {
  test("topic words drop noise and fold plurals", () => {
    expect(topicWords("Update the Stacked decks for the podcast")).toEqual([
      "stacked",
      "deck",
      "podcast",
    ]);
    expect(topicWords("feedback_no_cringe_titles")).toEqual(["cringe"]);
  });

  test("links records across sources on shared rare words, never inside one source", () => {
    const facets: RelationFacet[] = [
      {
        id: "codex:1",
        origin: "codex",
        name: "Premiere autocut panel fix",
        time: Date.parse("2026-09-19T10:00Z"),
      },
      {
        id: "claude:1",
        origin: "claude",
        name: "project premiere autocut",
        time: Date.parse("2026-09-19T18:00Z"),
      },
      { id: "claude:2", origin: "claude", name: "premiere autocut notes v2" },
      ...Array.from({ length: 40 }, (_, i) => filler(i)),
    ];
    const { links, byId } = relateRecords(facets);
    const pairs = links.map((l) => [l.source, l.target].sort().join(" "));
    expect(pairs).toContain("claude:1 codex:1");
    expect(pairs).not.toContain("claude:1 claude:2");
    const rel = byId.get("codex:1")!.find((r) => r.id === "claude:1")!;
    expect(rel.reasons).toContain("Same day");
    expect(rel.reasons.join(" ")).toContain("premiere");
  });

  test("same person and same project are strong on their own", () => {
    const facets: RelationFacet[] = [
      { id: "inbox:1", origin: "email", name: "Invoice for March", people: ["Ana Ruiz"] },
      { id: "event:1", origin: "meetings", name: "Weekly call", people: ["Ana Ruiz", "Bo"] },
      { id: "codex:1", origin: "codex", name: "Tidy header", project: "stacked-daily" },
      { id: "claude:1", origin: "claude", name: "Radar app notes", project: "stacked-daily" },
      ...Array.from({ length: 30 }, (_, i) => filler(i)),
    ];
    const { byId } = relateRecords(facets);
    expect(byId.get("inbox:1")?.[0]).toMatchObject({ id: "event:1" });
    expect(byId.get("inbox:1")?.[0].reasons[0]).toBe("Same person: Ana Ruiz");
    expect(byId.get("codex:1")?.[0].reasons[0]).toBe("Same project: stacked-daily");
  });

  test("each record keeps only its best few links", () => {
    const facets: RelationFacet[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      origin: `s${i}`,
      name: "glaido launch checklist",
      project: "glaido",
    }));
    const { byId } = relateRecords(
      [...facets, ...Array.from({ length: 400 }, (_, i) => filler(i))],
      { perNode: 3 },
    );
    for (const f of facets) expect((byId.get(f.id) || []).length).toBeLessThanOrEqual(3);
  });

  test("memory time reads ISO and relative text", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    expect(memoryTime({ updated: "2026-09-01T00:00:00Z" }, now)).toBe(
      Date.parse("2026-09-01T00:00:00Z"),
    );
    expect(memoryTime({ updated: "2d ago" }, now)).toBe(now - 2 * 864e5);
    expect(memoryTime({}, now)).toBeNull();
  });
});
