import { expect, test } from "bun:test";
import { audienceSeries, type AudienceSnapshot } from "../src/lib/business-workspace";
test("audience charts never join legacy period views or another channel to the verified current series", () => {
  const base = { platform: "youtube" as const, origin: "connector" as const, sourceLabel: "Same label", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" };
  const snapshots: AudienceSnapshot[] = [
    { ...base, id: "legacy", recordedAt: "2026-09-14T00:00:00Z", metrics: { views: 67096 } },
    { ...base, id: "other", recordedAt: "2026-09-15T00:00:00Z", metrics: { views: 2 }, measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UC1234567890123456789012" },
    { ...base, id: "current-1", recordedAt: "2026-09-16T00:00:00Z", metrics: { views: 15358000 }, measurementScope: "youtube-channel-totals-v1" },
    { ...base, id: "current-2", recordedAt: "2026-09-17T00:00:00Z", metrics: { views: 15358602 }, measurementScope: "youtube-channel-totals-v1" },
  ];
  const before = JSON.stringify(snapshots);
  expect(audienceSeries(snapshots, "youtube", "views").map(row => row.value)).toEqual([15358000, 15358602]);
  expect(audienceSeries(snapshots, "youtube", "views", Date.parse("2026-09-17")).map(row => row.value)).toEqual([15358602]);
  expect(JSON.stringify(snapshots)).toBe(before);
});
