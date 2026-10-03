import { useEffect, useState } from "react";
import { ArrowUpRight, MessageCircle, Video } from "lucide-react";
import { performanceExplanation, type VideoPerformance } from "@/lib/video-performance";
import type { WatchVideo } from "@/lib/competitor-watch";
export const compactCount = (value?: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      )
    : "—";
function relativeDate(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  if (!Number.isFinite(days)) return "Date unavailable";
  return days < 1
    ? "Today"
    : days < 7
      ? `${days}d ago`
      : days < 30
        ? `${Math.floor(days / 7)}w ago`
        : `${Math.floor(days / 30)}mo ago`;
}
export function PublicVideoCard({
  video,
  performance,
  channel,
  subscribers,
  onSelect,
  selected,
}: {
  video: WatchVideo;
  performance?: VideoPerformance;
  channel?: string;
  subscribers?: number;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [video.thumbnailUrl]);
  const src = /^https:\/\/(?:i|i9)\.ytimg\.com\//.test(video.thumbnailUrl)
    ? video.thumbnailUrl
    : "";
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
  const explanation = performance ? performanceExplanation(performance) : "";
  const minutes = Math.floor(video.durationSeconds / 60),
    seconds = Math.floor(video.durationSeconds % 60);
  const body = (
    <>
      <div className="studio-video-thumbnail">
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className="studio-video-fallback">
            <Video size={26} />
            Thumbnail unavailable
          </span>
        )}
        {performance?.rank && (
          <span className="studio-rank" title={explanation}>
            {performance.rank}/{performance.rankCount}
          </span>
        )}
        <span className="studio-duration">
          {minutes}:{String(seconds).padStart(2, "0")}
        </span>
      </div>
      <div className="studio-video-copy">
        <h4>
          {performance?.multiple !== undefined && (
            <span
              className="studio-multiple"
              data-level={
                performance.multiple >= 3 ? "high" : performance.multiple >= 1 ? "up" : "low"
              }
              title={explanation}
            >
              {performance.multiple.toFixed(1)}×
            </span>
          )}
          {video.title}
        </h4>
        {channel && (
          <p>
            {channel}
            {subscribers !== undefined ? ` · ${compactCount(subscribers)} subscribers` : ""}
          </p>
        )}
        <p>
          <strong>{compactCount(video.views)}</strong> views ·{" "}
          <time dateTime={video.publishedAt} title={new Date(video.publishedAt).toLocaleString()}>
            {relativeDate(video.publishedAt)}
          </time>
        </p>
      </div>
    </>
  );
  return (
    <article className="studio-video-card" data-selected={!!selected}>
      {onSelect ? (
        <button
          type="button"
          className="studio-video-main"
          onClick={onSelect}
          aria-label={`Explore comments on ${video.title}`}
          aria-pressed={!!selected}
        >
          {body}
        </button>
      ) : (
        <a className="studio-video-main" href={url} target="_blank" rel="noreferrer">
          {body}
        </a>
      )}
      {onSelect && (
        <footer>
          <button type="button" onClick={onSelect}>
            <MessageCircle size={12} />
            {selected ? "Viewing comments" : "View comments"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Watch ${video.title} on YouTube`}
          >
            <ArrowUpRight size={14} />
          </a>
        </footer>
      )}
    </article>
  );
}
