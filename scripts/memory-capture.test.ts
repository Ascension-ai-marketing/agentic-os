import { expect, test } from "bun:test";
import { memorySaveFeedback } from "../src/components/operator/memory-capture-feedback";

const spaces = [
  { id: "personal", name: "Personal" },
  { id: "business", name: "Business" },
];
test("save receipt names the actual destination and links to the saved source", () => {
  expect(
    memorySaveFeedback(
      [{ source: { id: "new", collection: "business", status: "ready" } }],
      spaces,
    ),
  ).toEqual({
    notice: "Saved to Business on this Mac.",
    added: 1,
    sourceId: "new",
  });
});
test("a duplicate in another collection points to the original without claiming a new save", () => {
  expect(
    memorySaveFeedback(
      [{ source: { id: "original", collection: "personal", status: "ready" }, duplicate: true }],
      spaces,
    ),
  ).toEqual({
    notice: "Already saved in Personal.",
    added: 0,
    sourceId: "original",
  });
});
test("mixed duplicates and uploads keep the new destination and indexing state clear", () => {
  const result = memorySaveFeedback(
    [
      { source: { id: "old", collection: "personal", status: "ready" }, duplicate: true },
      { source: { id: "new", collection: "business", status: "indexing" } },
    ],
    spaces,
  )!;
  expect(result).toEqual({
    notice: "Saved to Business on this Mac. 1 already in memory. Indexing in the background.",
    added: 1,
    sourceId: "new",
  });
  expect(result.notice).not.toContain("searchable");
});
test("an indexing error stays visible and an empty receipt does not claim a save", () => {
  expect(memorySaveFeedback([], spaces)).toBeNull();
  expect(
    memorySaveFeedback(
      [{ source: { id: "needs-help", collection: "business", status: "error" } }],
      spaces,
    )?.notice,
  ).toContain("indexing attention");
});
