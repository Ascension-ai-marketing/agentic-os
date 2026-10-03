import { FlowButton } from "@/components/ui/flow-button";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderOpen, ImagePlus, Loader2, ScanEye } from "lucide-react";
import { memorySpaces, operatorRequest, useOperator } from "@/lib/operator";
import "./photo-index-setup.css";

type Model = { id: string; name: string; location: "local" | "remote"; perImageUsd: number };
type Job = {
  id: string;
  status: "queued" | "running" | "paused" | "complete";
  model: Model;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  reservedUsd: number;
  budgetUsd: number;
  message?: string;
  errors: { filename: string; message: string }[];
};
type Status = {
  models: Model[];
  preferredModel?: string;
  presets: { name: string; path: string }[];
  jobs: Job[];
};
type Preview = {
  id: string;
  count: number;
  bytes: number;
  skipped: number;
  truncated: boolean;
  samples: string[];
};

/** Rendering discovers capabilities only. Pixels are sent only after a reviewed job is confirmed. */
export function PhotoIndexSetup({ compact = false }: { compact?: boolean }) {
  const { state } = useOperator(),
    client = useQueryClient();
  const spaces = memorySpaces(state);
  const [folders, setFolders] = useState<string[]>([]),
    [customFolder, setCustomFolder] = useState("");
  const [uploads, setUploads] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview>();
  const [modelId, setModelId] = useState(""),
    [collection, setCollection] = useState("personal");
  const [limit, setLimit] = useState(50),
    [budget, setBudget] = useState(0.25),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const status = useQuery<Status>({
    queryKey: ["photo-index-status"],
    queryFn: () => operatorRequest("/memory/photo-index/status"),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ["queued", "running"].includes(job.status))
        ? 1500
        : false,
  });
  const model = status.data?.models.find((m) => m.id === (modelId || status.data?.preferredModel));
  const job = status.data?.jobs[0];
  useEffect(() => {
    if (job?.status === "complete") {
      void client.invalidateQueries({ queryKey: ["operator-state"] });
      void client.invalidateQueries({ queryKey: ["memory-photos"] });
      window.dispatchEvent(new Event("memory:photos-change"));
    }
  }, [job?.id, job?.status, client]);
  function changed() {
    setPreview(undefined);
    setConsent(false);
    setError("");
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: File[]) {
    await action(async () => {
      if (files.length + uploads.length > 24)
        throw new Error("Choose up to 24 photos here, or use a folder for a larger library.");
      changed();
      const ids = [...uploads];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024)
          throw new Error(`${file.name} is larger than 5 MB. Use a folder instead.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        const saved = await operatorRequest<{ id: string }>("/memory/photo-index/uploads", {
          filename: file.name,
          base64: btoa(binary),
        });
        ids.push(saved.id);
        setUploads([...ids]);
      }
    });
  }
  const count = preview ? Math.min(limit, preview.count) : 0;
  const estimate = count * (model?.perImageUsd || 0);
  const active = job && ["queued", "running"].includes(job.status);
  return (
    <section
      className={`photo-index-setup ${compact ? "is-compact" : ""}`}
      aria-label="Find photos by what is in them"
    >
      {!compact && (
        <div className="photo-index-intro">
          <ScanEye size={22} />
          <div>
            <h3>Find it by what’s in it.</h3>
            <p>Search “burger”, “beach”, or the words in a screenshot.</p>
          </div>
        </div>
      )}
      <div className="photo-index-folders" aria-label="Photo folders">
        {(status.data?.presets || []).map((folder) => (
          <button
            type="button"
            key={folder.path}
            disabled={busy}
            aria-pressed={folders.includes(folder.path)}
            onClick={() => {
              changed();
              setFolders((current) =>
                current.includes(folder.path)
                  ? current.filter((p) => p !== folder.path)
                  : [...current, folder.path],
              );
            }}
          >
            {folders.includes(folder.path) ? <Check size={14} /> : <FolderOpen size={14} />}{" "}
            {folder.name}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => picker.current?.click()}>
          <ImagePlus size={14} />
          {uploads.length ? `${uploads.length} uploaded` : "Upload photos"}
        </button>
        {!!uploads.length && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              changed();
              setUploads([]);
            }}
          >
            Clear uploads
          </button>
        )}
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept="image/*,.heic,.heif"
          onChange={(event) => {
            void upload(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
      </div>
      <details className="photo-index-folder-details" open={compact ? undefined : true}>
        <summary>Choose another folder</summary>
        <label className="photo-index-path">
          <span>Or a folder on this computer</span>
          <input
            value={customFolder}
            onChange={(event) => {
              changed();
              setCustomFolder(event.target.value);
            }}
            placeholder="~/Pictures/My photos"
            disabled={busy}
          />
        </label>
        <p className="photo-index-hint">
          Subfolders included. To use Apple Photos, export the photos you choose to a folder first.
        </p>
      </details>
      {!preview && (
        <FlowButton
          type="button"
          className="photo-index-action"
          disabled={busy || (!folders.length && !customFolder.trim() && !uploads.length)}
          onClick={() =>
            void action(async () => {
              const result = await operatorRequest<Preview>("/memory/photo-index/preview", {
                folders: [...folders, ...(customFolder.trim() ? [customFolder.trim()] : [])],
                uploadIds: uploads,
              });
              setPreview(result);
              setLimit(Math.min(50, result.count) || 1);
              setConsent(false);
            })
          }
        >
          {busy && <Loader2 size={15} className="animate-spin" />} Preview photos
        </FlowButton>
      )}
      {preview && (
        <div className="photo-index-review">
          <div className="photo-index-preview">
            <strong>{preview.count.toLocaleString()} photos found</strong>
            <span>{preview.samples.slice(0, 3).join(" · ")}</span>
            {preview.truncated && (
              <small>Preview limit reached. Choose a smaller folder to see the rest.</small>
            )}
          </div>
          <div className="photo-index-settings">
            <label>
              <span>Describe with</span>
              <select
                value={model?.id || ""}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setConsent(false);
                }}
                disabled={busy || !status.data?.models.length}
              >
                <option value="" disabled>
                  Choose a vision model
                </option>
                {status.data?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.location === "local" ? " · on this computer" : " · via OpenRouter"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Save in</span>
              <select
                disabled={busy}
                value={spaces.some((s) => s.id === collection) ? collection : spaces[0]?.id || ""}
                onChange={(e) => setCollection(e.target.value)}
              >
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Photos this time</span>
              <input
                type="number"
                disabled={busy}
                min={1}
                max={Math.min(500, preview.count) || 1}
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setConsent(false);
                }}
              />
            </label>
            {model?.location === "remote" && (
              <label>
                <span>Budget (USD)</span>
                <input
                  type="number"
                  disabled={busy}
                  min={model.perImageUsd}
                  max={5}
                  step={0.05}
                  value={budget}
                  onChange={(e) => {
                    setBudget(Number(e.target.value));
                    setConsent(false);
                  }}
                />
              </label>
            )}
          </div>
          {!status.data?.models.length && (
            <p className="photo-index-hint">
              Load a vision model in Ollama, or configure OpenRouter. Your photos stay here until
              you choose a model.
            </p>
          )}
          {model && (
            <label className="photo-index-consent">
              <input
                type="checkbox"
                disabled={busy}
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                {model.location === "local"
                  ? `Describe these ${count} photos on this computer. No images leave the device.`
                  : `Send resized copies of these ${count} photos to ${model.name} via OpenRouter. Estimated allowance $${estimate.toFixed(3)}; stop before the next request exceeds $${budget.toFixed(2)}.`}
              </span>
            </label>
          )}
          {model?.location === "remote" && (
            <p className="photo-index-hint">
              Budget uses a conservative per-photo allowance. Provider billing may vary. Originals
              stay on this computer.
            </p>
          )}
          <RainbowButton
            type="button"
            className="photo-index-action"
            disabled={busy || !consent || !model || !count || !!active}
            onClick={() =>
              void action(async () => {
                await operatorRequest("/memory/photo-index/jobs", {
                  previewId: preview.id,
                  modelId: model?.id,
                  collection: spaces.some((s) => s.id === collection) ? collection : spaces[0]?.id,
                  limit,
                  budgetUsd: budget,
                  consent: true,
                  remoteConsent: model?.location === "remote",
                });
                setPreview(undefined);
                setUploads([]);
                setConsent(false);
                await status.refetch();
              })
            }
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanEye size={15} />} Make
            photos searchable
          </RainbowButton>
        </div>
      )}
      {job && (
        <div className="photo-index-progress" role="status">
          <div>
            <strong>
              {job.status === "complete"
                ? job.failed
                  ? "Photo indexing needs attention"
                  : "Photo memory is ready"
                : job.status === "paused"
                  ? "Photo indexing paused"
                  : "Building photo memory"}
            </strong>
            <span>
              {job.done} saved · {job.skipped} already indexed · {job.failed} need attention
            </span>
          </div>
          <progress
            aria-label="Photo indexing progress"
            max={job.total}
            value={job.done + job.skipped + job.failed}
          />
          <p>
            {job.message ||
              `${job.done + job.skipped + job.failed} of ${job.total} · ${job.model.name}`}
          </p>
          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await operatorRequest(`/memory/photo-index/jobs/${job.id}/pause`, {});
                  await status.refetch();
                })
              }
            >
              Pause indexing
            </button>
          )}
          {job.status === "paused" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await operatorRequest(`/memory/photo-index/jobs/${job.id}/resume`, {});
                  await status.refetch();
                })
              }
            >
              Resume indexing
            </button>
          )}
          {!!job.errors.length && (
            <details>
              <summary>Photos that need attention</summary>
              {job.errors.map((item, index) => (
                <p key={index}>
                  {item.filename}: {item.message}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      {(error || status.isError) && (
        <p className="photo-index-error" role="alert">
          {error || (status.error as Error)?.message}
        </p>
      )}
    </section>
  );
}
