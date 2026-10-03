import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileImage, Loader2 } from "lucide-react";
import { memorySpaces, operatorRequest, useOperator } from "@/lib/operator";
type Photo = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  description: string;
  extraction?: "local-ocr" | "design-vision";
  indexed?: boolean;
  path?: string;
  importedSourceId?: string;
};
type VisionStatus = {
  ok: boolean;
  available: boolean;
  model?: string;
  visionEstimate?: { perImageUsd: number };
  job?: {
    running: boolean;
    done: number;
    total: number;
    failed: number;
    mode: string;
    lastError?: string;
  } | null;
};
type Photos = {
  images: Photo[];
  total: number;
  availableDesign: number;
  indexedText: number;
  indexedVision: number;
  unavailable: number;
  nextOffset?: number | null;
  note?: string;
};
export function MemoryPhotoConnections({
  onDevice,
  onImported,
}: {
  onDevice: () => void;
  onImported: () => void;
}) {
  const { state } = useOperator();
  const queryClient = useQueryClient();
  const spaces = memorySpaces(state);
  const [ids, setIds] = useState<string[]>([]),
    [collection, setCollection] = useState("business"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery<Photos>({
    queryKey: ["memory-photo-connections", offset],
    queryFn: () => operatorRequest(`/memory/photos?offset=${offset}&limit=24`),
  });
  const [visionPending, setVisionPending] = useState(false);
  const [visionStarting, setVisionStarting] = useState(false);
  const startedAt = useRef(0);
  const observedRunning = useRef(false);
  const finishingVision = useRef(false);
  const selectedForVision = useRef<string[]>([]);
  const refetchPhotos = query.refetch;
  const vision = useQuery<VisionStatus>({
    queryKey: ["memory-photo-vision-status"],
    queryFn: async () => {
      const response = await fetch("/__design_index_status");
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Could not check visual descriptions.");
      return result;
    },
    refetchInterval: (current) =>
      visionPending || current.state.data?.job?.running ? 1200 : false,
  });
  useEffect(() => {
    const running = !!vision.data?.job?.running;
    if (observedRunning.current && !running && !visionPending) {
      void queryClient.invalidateQueries({ queryKey: ["memory-photo-connections"] });
      void queryClient.invalidateQueries({ queryKey: ["memory-photos"] });
      window.dispatchEvent(new Event("memory:photos-change"));
    }
    observedRunning.current = running;
  }, [vision.data?.job?.running, visionPending, queryClient]);
  const selectedPhotos = (query.data?.images || []).filter((photo) => ids.includes(photo.id));
  const paths = selectedPhotos.map((photo) => photo.path).filter((path): path is string => !!path);
  const unindexed = selectedPhotos.some(
    (photo) => photo.indexed === false || (!photo.extraction && !photo.description),
  );
  const perImage = vision.data?.visionEstimate?.perImageUsd;
  const estimate =
    typeof perImage === "number" && Number.isFinite(perImage) ? perImage * paths.length : null;
  useEffect(() => {
    if (
      !visionPending ||
      finishingVision.current ||
      vision.dataUpdatedAt < startedAt.current ||
      !vision.data ||
      vision.data.job?.running
    )
      return;
    finishingVision.current = true;
    void (async () => {
      try {
        const refreshed = await refetchPhotos();
        if (refreshed.isError || !refreshed.data)
          throw new Error(
            "Could not verify the selected photo descriptions. Refresh the library before importing them.",
          );
        const missing = selectedForVision.current.filter(
          (id) =>
            refreshed.data.images.find((photo) => photo.id === id)?.extraction !== "design-vision",
        );
        if (missing.length) {
          const job = vision.data.job;
          const reason = !job
            ? "This job is no longer reporting progress."
            : job.failed
              ? `${job.failed} descriptions failed.`
              : job.done + job.failed < job.total
                ? "The job stopped before finishing."
                : "Some photos were not described.";
          setError(
            `${reason} ${missing.length} selected ${missing.length === 1 ? "photo still has" : "photos still have"} no visual description. Retry, or import any text already indexed.`,
          );
        } else {
          setNotice("Descriptions are ready. Add the selected photos to memory when you’re ready.");
        }
        void queryClient.invalidateQueries({ queryKey: ["memory-photos"] });
        window.dispatchEvent(new Event("memory:photos-change"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        finishingVision.current = false;
        setVisionPending(false);
      }
    })();
  }, [visionPending, vision.dataUpdatedAt, vision.data, queryClient, refetchPhotos]);
  async function describeSelected() {
    if (
      visionStarting ||
      visionPending ||
      !paths.length ||
      paths.length !== ids.length ||
      !vision.data?.available ||
      estimate === null
    )
      return;
    selectedForVision.current = [...ids];
    setVisionStarting(true);
    setError("");
    setNotice("");
    try {
      const token = (await (await fetch("/__token")).json()).token;
      const response = await fetch("/__design_index_start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
        body: JSON.stringify({ scope: "paths", mode: "vision", paths }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Could not start photo descriptions.");
      if (result.already) {
        await vision.refetch();
        throw new Error(
          "Another image indexing job is running. Wait for it to finish, then try these photos again.",
        );
      }
      if (result.queued === 0) {
        await query.refetch();
        setNotice(
          "No new descriptions were queued. Already described or unavailable images are skipped.",
        );
        return;
      }
      startedAt.current = Date.now();
      setVisionPending(true);
      await vision.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVisionStarting(false);
    }
  }
  async function add() {
    if (unindexed || visionPending || visionStarting) {
      setError("Describe the selected unindexed photos before adding them to memory.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operatorRequest<{
        added: number;
        updated: number;
        unchanged: number;
        skipped: number;
      }>("/memory/photos/import", { ids, collection });
      setNotice(
        `${result.added} added${result.updated ? ` · ${result.updated} updated` : ""}${result.unchanged ? ` · ${result.unchanged} already in memory` : ""}${result.skipped ? ` · ${result.skipped} could not be added` : ""}.`,
      );
      setIds([]);
      await query.refetch();
      void queryClient.invalidateQueries({ queryKey: ["memory-photos"] });
      onImported();
      window.dispatchEvent(new Event("memory:photos-change"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-photos">
      <button className="mx-photo-device" type="button" onClick={onDevice}>
        <FileImage size={21} />
        <span>
          <strong>Add photos from your device</strong>
          <small>Choose images to save in memory</small>
        </span>
        <span>+</span>
      </button>
      <div className="mx-photo-heading">
        <strong>Your Design library</strong>
        <span>{query.data?.availableDesign ?? "…"} images</span>
      </div>
      <p className="mx-help">Bring images already indexed in Design into your memory.</p>
      {query.isLoading ? (
        <p className="mx-loading">
          <Loader2 size={14} className="animate-spin" />
          Loading your images…
        </p>
      ) : query.isError ? (
        <div className="mx-feedback" role="alert">
          Could not load your Design library.
          <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : query.data?.images.length ? (
        <div className="mx-photo-grid">
          {query.data.images.map((photo) => (
            <button
              type="button"
              key={photo.id}
              aria-pressed={ids.includes(photo.id)}
              disabled={
                busy ||
                visionPending ||
                visionStarting ||
                (!ids.includes(photo.id) && ids.length >= 24)
              }
              aria-label={`Select ${photo.title}`}
              title={photo.description || photo.title}
              onClick={() =>
                setIds((old) =>
                  old.includes(photo.id)
                    ? old.filter((id) => id !== photo.id)
                    : old.length < 24
                      ? [...old, photo.id]
                      : old,
                )
              }
            >
              <img src={photo.thumbnailUrl || photo.url} alt={photo.title} loading="lazy" />
              <span>{ids.includes(photo.id) ? <Check size={12} /> : null}</span>
              <small>
                {photo.extraction === "design-vision"
                  ? "Visually described"
                  : photo.extraction === "local-ocr"
                    ? "Text searchable"
                    : "Not indexed"}
                {photo.importedSourceId ? " · Saved" : ""}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <p className="mx-photo-empty">
          No indexed Design images yet. Add photos from your device to start.
        </p>
      )}
      {!!query.data?.total && (
        <div className="mx-photo-paging">
          <button
            disabled={!offset || busy || !!ids.length || visionPending}
            onClick={() => setOffset(Math.max(0, offset - 24))}
          >
            Previous
          </button>
          <span>
            {Math.min(offset + 1, query.data.total)}–
            {Math.min(offset + (query.data.images.length || 0), query.data.total)} of{" "}
            {query.data.total}
          </span>
          <button
            disabled={query.data.nextOffset == null || busy || !!ids.length || visionPending}
            onClick={() => setOffset(query.data!.nextOffset!)}
          >
            Next
          </button>
        </div>
      )}
      {query.data?.note && <p className="mx-help">{query.data.note}</p>}
      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`mx-feedback${error ? "" : " is-success"}`}
        >
          {error || notice}
        </div>
      )}
      {!!ids.length && (
        <>
          <section className="mx-photo-vision">
            <div>
              <strong>Understand what’s in these photos</strong>
              <p>
                Selected image copies go to your configured vision model for a searchable
                description.
              </p>
              <small>
                {vision.isError
                  ? "Could not check the configured model."
                  : !vision.data?.available
                    ? "Connect a vision model in Design to describe photos."
                    : estimate === null
                      ? "Cost estimate unavailable."
                      : `Uses ${vision.data.model || "configured model"} · estimated $${estimate.toFixed(4)} for ${paths.length} ${paths.length === 1 ? "photo" : "photos"}`}
              </small>
            </div>
            <button
              type="button"
              className="mx-secondary"
              disabled={
                busy ||
                visionStarting ||
                visionPending ||
                !vision.data?.available ||
                !paths.length ||
                paths.length !== ids.length ||
                estimate === null ||
                !!vision.data.job?.running
              }
              onClick={() => void describeSelected()}
            >
              {visionStarting || visionPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {visionPending || vision.data?.job?.running
                ? `Describing ${vision.data?.job?.done || 0}/${vision.data?.job?.total || paths.length}`
                : "Describe selected"}
            </button>
          </section>
          {visionPending && vision.isError && (
            <div className="mx-feedback" role="alert">
              The description job may still be running. Status will retry automatically.
            </div>
          )}
          {unindexed && (
            <p className="mx-help">
              Some selected photos have no searchable context yet. Describe them first.
            </p>
          )}
          <label className="mx-destination">
            Save into
            <select
              aria-label="Photo knowledge space"
              value={collection}
              disabled={busy || visionPending || visionStarting}
              onChange={(event) => setCollection(event.target.value)}
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mx-detail-actions">
            <span className="mx-help">
              {ids.length} selected · up to 24 at a time{" "}
              <button
                type="button"
                className="mx-photo-clear"
                disabled={busy || visionPending || visionStarting}
                onClick={() => setIds([])}
              >
                Clear selection
              </button>
            </span>
            <button
              className="mx-primary"
              disabled={busy || unindexed || visionPending || visionStarting}
              onClick={() => void add()}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Add to
              memory
            </button>
          </div>
        </>
      )}
    </div>
  );
}
