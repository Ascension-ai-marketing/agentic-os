import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, RefreshCw, SlidersHorizontal } from "lucide-react";
import { operatorRequest } from "@/lib/operator";
import { videoPerformance } from "@/lib/video-performance";
import type { CompetitorWatchData } from "@/lib/competitor-watch";
import { PublicVideoCard, compactCount } from "./public-video-card";

const key = ["business-competitors"];
export function CompetitorWatch() {
  const qc = useQueryClient();
  const query = useQuery<CompetitorWatchData>({
    queryKey: key,
    queryFn: () => operatorRequest("/business/competitors"),
    retry: false,
  });
  const [selected, setSelected] = useState("all"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("date");
  const [editing, setEditing] = useState(false),
    [inputs, setInputs] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const channels = query.data?.channels || [];
  async function refresh(next?: string[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await operatorRequest<CompetitorWatchData>(
        "/business/competitors/sync",
        next ? { inputs: next } : {},
      );
      qc.setQueryData(key, result);
      setEditing(false);
      if (selected !== "all" && !result.channels.some((c) => c.id === selected)) setSelected("all");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const videos = channels
    .filter((c) => selected === "all" || c.id === selected)
    .flatMap((channel) => {
      const metrics = videoPerformance(channel.videos, Date.parse(channel.recordedAt));
      return channel.videos
        .slice(0, 8)
        .map((video) => ({ video, channel, performance: metrics.get(video.id) }));
    })
    .filter(
      ({ video, channel, performance }) =>
        (filter !== "outliers" || (performance?.multiple || 0) >= 2) &&
        `${video.title} ${channel.name}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "multiple"
        ? (b.performance?.multiple || 0) - (a.performance?.multiple || 0)
        : sort === "views"
          ? (b.video.views || 0) - (a.video.views || 0)
          : Date.parse(b.video.publishedAt) - Date.parse(a.video.publishedAt),
    );
  return (
    <section className="studio-watch" aria-label="Competitor’s eye">
      <header className="audience-content-heading">
        <div>
          <p className="audience-eyebrow">PUBLIC CHANNEL WATCH</p>
          <h3>Competitor’s eye.</h3>
          <p>A small window into what’s landing in your corner of YouTube.</p>
        </div>
        <button
          type="button"
          className="audience-action"
          disabled={busy || query.isPending}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} className={busy ? "audience-syncing" : ""} />
          {busy ? "Refreshing…" : "Refresh watch list"}
        </button>
      </header>
      <div className="studio-channel-row">
        <button type="button" aria-pressed={selected === "all"} onClick={() => setSelected("all")}>
          <span className="studio-channel-all">
            <Eye size={24} />
          </span>
          <strong>All channels</strong>
          <small>{channels.length} watched</small>
        </button>
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={selected === c.id}
            onClick={() => setSelected(c.id)}
          >
            {c.avatar ? (
              <img src={c.avatar} alt="" />
            ) : (
              <span className="studio-channel-all">{c.name[0]}</span>
            )}
            <strong>{c.name}</strong>
            <small>{compactCount(c.subscribers)} subscribers</small>
          </button>
        ))}
        <button
          className="studio-edit-channels"
          type="button"
          onClick={() => {
            setInputs((query.data?.inputs || []).join("\n"));
            setEditing(!editing);
          }}
        >
          <span className="studio-channel-all">
            <SlidersHorizontal size={21} />
          </span>
          <strong>Edit channels</strong>
          <small>Up to six</small>
        </button>
      </div>
      {editing && (
        <form
          className="studio-watch-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void refresh(
              inputs
                .split(/\n|,/)
                .map((v) => v.trim())
                .filter(Boolean),
            );
          }}
        >
          <label>
            Channel links or @handles
            <textarea
              value={inputs}
              onChange={(e) => setInputs(e.target.value)}
              rows={3}
              aria-label="Channels to watch"
              placeholder="@NetworkChuck"
            />
          </label>
          <button type="submit" disabled={busy}>
            Save & refresh
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      <div className="studio-video-toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles & channels"
          aria-label="Search watched videos"
        />
        <div className="studio-segment">
          {["all", "outliers"].map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {id === "all" ? "All videos" : "2× or more"}
            </button>
          ))}
        </div>
        <select
          aria-label="Sort watched videos"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="date">Newest</option>
          <option value="multiple">View multiple</option>
          <option value="views">Most viewed</option>
        </select>
      </div>
      {(error || query.error) && (
        <p className="audience-form-error" role="alert">
          {error || query.error?.message}
        </p>
      )}
      {query.data?.warnings.map((warning) => (
        <p className="audience-sampling-warning" key={warning}>
          {warning}
        </p>
      ))}
      <div className="studio-video-grid">
        {videos.map(({ video, channel, performance }) => (
          <PublicVideoCard
            key={`${channel.id}:${video.id}`}
            video={video}
            performance={performance}
            channel={channel.name}
            subscribers={channel.subscribers}
          />
        ))}
      </div>
      {!videos.length && (
        <div className="studio-watch-empty">
          <Eye size={25} />
          <p>
            {query.isPending
              ? "Opening your watch list…"
              : channels.length
                ? "No videos match these filters."
                : "Refresh to bring in public videos from the channels in your watch list."}
          </p>
        </div>
      )}
      <p className="studio-metric-note">
        Multiples compare current views with the median of earlier uploads from the same channel.
        Rankings use current views, not video age. Public YouTube data only.
      </p>
    </section>
  );
}
