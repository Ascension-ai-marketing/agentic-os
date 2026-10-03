import { expect, test } from "bun:test";
import { businessEvidence, businessMemoryDocuments } from "./business-memory";
const sourceUrl = "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv";
const base = { platform: "youtube", sourceUrl, sourceLabel: "Same label", origin: "connector" };
test("business memory omits old unscoped numbers and keeps current scope explicit", () => {
  const snapshots = [
    { ...base, recordedAt: "2026-09-15T00:00:00Z", metrics: { views: 67096 } },
    { ...base, recordedAt: "2026-09-16T00:00:00Z", metrics: { views: 15358602 }, measurementScope: "youtube-channel-totals-v1" },
  ];
  const before = JSON.stringify(snapshots), doc = businessMemoryDocuments({ snapshots })[0];
  expect(doc.text).not.toContain("67096");expect(doc.text).toContain("15358602");expect(doc.text).toContain("youtube-channel-totals-v1");expect(doc.text).toContain("youtube:UCabcdefghijklmnopqrstuv");expect(doc.text).toContain("not comparison baselines");
  expect(JSON.stringify(snapshots)).toBe(before);
  expect(businessEvidence({snapshots}).audience[0].measurementScope).toBe("youtube-channel-totals-v1");
});
test("unknown current scope exposes one observation with no older numeric baseline", () => {
  const snapshots=[{...base,recordedAt:"2026-09-15T00:00:00Z",metrics:{views:67096},measurementScope:"youtube-channel-totals-v1"},{...base,recordedAt:"2026-09-16T00:00:00Z",metrics:{views:99}}];
  const doc=businessMemoryDocuments({snapshots})[0];expect(doc.text).not.toContain("67096");expect(doc.text).toContain("views: 99");expect(doc.text).toContain("Do not infer growth or decline");expect(businessEvidence({snapshots}).audience[0].measurementScope).toBe("unknown");
});
test("verified memory history excludes another channel even under equal scope and label", () => {
  const snapshots=[{...base,sourceUrl:"https://www.youtube.com/channel/UC1234567890123456789012",recordedAt:"2026-09-14T00:00:00Z",metrics:{views:6789},measurementScope:"youtube-channel-totals-v1"},{...base,recordedAt:"2026-09-15T00:00:00Z",metrics:{views:100},measurementScope:"youtube-channel-totals-v1"},{...base,recordedAt:"2026-09-16T00:00:00Z",metrics:{views:120},measurementScope:"youtube-channel-totals-v1"}];
  const doc=businessMemoryDocuments({snapshots})[0];expect(doc.text).not.toContain("6789");expect(doc.text).toContain("views: 100");expect(doc.text).toContain("views: 120");
});
