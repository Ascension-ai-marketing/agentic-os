export type VideoObservation = { id: string; publishedAt: string; views?: number };
export type VideoPerformance = {
  rank?: number;
  rankCount?: number;
  multiple?: number;
  baselineCount: number;
};

/** Current public counts, not YouTube Studio's same-age performance ranking. One channel per call. */
export function videoPerformance(videos: VideoObservation[], asOf = Date.now()) {
  const unique = [...new Map(videos.map((video) => [video.id, video])).values()]
    .filter(
      (video) =>
        Number.isFinite(Date.parse(video.publishedAt)) && Date.parse(video.publishedAt) <= asOf,
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const measured = (video: VideoObservation) =>
    typeof video.views === "number" && Number.isFinite(video.views) && video.views >= 0;
  const recent = unique.slice(0, 10).filter(measured);
  return new Map(
    unique.map((video) => {
      const older = unique
        .filter((other) => Date.parse(other.publishedAt) < Date.parse(video.publishedAt))
        .slice(0, 10)
        .filter(measured);
      const counts = older.map((other) => other.views!).sort((a, b) => a - b);
      const middle = Math.floor(counts.length / 2);
      const median = counts.length
        ? counts.length % 2
          ? counts[middle]
          : (counts[middle - 1] + counts[middle]) / 2
        : 0;
      const rank =
        measured(video) && recent.some((other) => other.id === video.id) && recent.length > 1
          ? 1 + recent.filter((other) => other.views! > video.views!).length
          : undefined;
      return [
        video.id,
        {
          rank,
          rankCount: rank ? recent.length : undefined,
          multiple:
            measured(video) && counts.length >= 5 && median > 0 ? video.views! / median : undefined,
          baselineCount: counts.length,
        } satisfies VideoPerformance,
      ];
    }),
  );
}

export function performanceExplanation(performance: VideoPerformance) {
  return `${performance.multiple !== undefined ? `Current views divided by the median current views of ${performance.baselineCount} earlier uploads. ` : ""}${performance.rank ? `Rank ${performance.rank} of ${performance.rankCount} recent uploads by current views. ` : ""}Public lifetime counts, not adjusted for video age or YouTube Studio's same-age ranking.`;
}
