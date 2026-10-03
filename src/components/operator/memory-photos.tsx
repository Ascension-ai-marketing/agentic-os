import { useEffect, useRef, useState } from "react";
import { FilePlus2, FileText, ImagePlus, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { brainEnabled } from "@/lib/brain-sources";
import { memorySpaces, operatorRequest, useOperator, type MemorySource } from "@/lib/operator";
import { SourceBrand } from "./source-brand";
import { PhotoIndexSetup } from "./photo-index-setup";
import { MacMemorySearch } from "./mac-memory-search";
import { Busy, Notice } from "./ui";
import "./memory-photos.css";

function preview(source: MemorySource) {
  return source.image;
}
export function MemoryPhotos() {
  const { state, refresh } = useOperator();
  const photos = state.sources.filter((source) => source.origin === "images" && !source.deletedAt);
  const documents = state.sources
    .filter(
      (source) => source.kind === "document" && source.origin !== "images" && !source.deletedAt,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [indexOpen, setIndexOpen] = useState(false);
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<MemorySource | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [destination, setDestination] = useState("personal");
  const picker = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const selectedId = selected?.id;
  useEffect(() => {
    setEditing(false);
    setDescription("");
  }, [selectedId]);
  const enabled = brainEnabled(state, "images");
  const visible = photos.filter((photo) =>
    `${photo.title} ${photo.text}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    const add = () => picker.current?.click();
    const show = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      const source = photos.find((photo) => photo.id === id);
      if (source) {
        setSelected(source);
        setOpen(true);
      }
    };
    window.addEventListener("memory:add-photos", add);
    window.addEventListener("memory:show-photo", show);
    return () => {
      window.removeEventListener("memory:add-photos", add);
      window.removeEventListener("memory:show-photo", show);
    };
  }, [photos]);
  useEffect(() => {
    if (!selectedId) return;
    const current = photos.find((photo) => photo.id === selectedId);
    if (!current) setSelected(null);
    else if (current.updatedAt !== selected?.updatedAt || current.status !== selected?.status)
      setSelected(current);
  }, [photos, selectedId, selected]);
  async function upload(files: File[]) {
    if (busy || !files.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    let added = 0;
    const failures: string[] = [];
    for (const file of files.slice(0, 24)) {
      try {
        if (
          !/\.(pdf|txt|md|markdown|csv|json|html?|vtt|srt|eml|png|jpe?g|webp|heic|heif|tiff?|bmp)$/i.test(
            file.name,
          )
        )
          throw new Error("Choose a photo, PDF, text document or email file.");
        if (!file.size || file.size > 5 * 1024 * 1024)
          throw new Error("Files must be under 5 MB each.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        const result = await operatorRequest<{ duplicate?: boolean }>("/memory", {
          filename: file.name,
          base64: btoa(binary),
          collection: destination,
          origin: /\.(png|jpe?g|webp|heic|heif|tiff?|bmp)$/i.test(file.name) ? "images" : "files",
          kind: "document",
        });
        if (!result.duplicate) added++;
      } catch (cause) {
        failures.push(`${file.name}: ${(cause as Error).message}`);
      }
    }
    if (files.length > 24)
      failures.push("Add up to 24 files at a time. The remaining files were not uploaded.");
    setBusy(false);
    setError(failures.join(" "));
    setNotice(
      added
        ? `${added} ${added === 1 ? "file" : "files"} saved to ${memorySpaces(state).find(space => space.id === destination)?.name || destination} on this Mac. Indexing text…`
        : !failures.length
          ? "These files are already in memory."
          : "",
    );
    if (added) void refresh();
  }
  function ask(photo: MemorySource) {
    if (!enabled || photo.status !== "ready") return;
    window.dispatchEvent(
      new CustomEvent("memory:selection", {
        detail: { id: photo.id, title: photo.title, origin: "images", text: photo.text },
      }),
    );
    setOpen(false);
    window.setTimeout(() => {
      document
        .getElementById("memory-chat")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document
        .querySelector<HTMLButtonElement>('#memory-chat [aria-label="Open prompt input"]')
        ?.click();
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLTextAreaElement>('#memory-chat [aria-label="Prompt"]')
            ?.focus({ preventScroll: true }),
        80,
      );
    }, 50);
  }
  function tile(photo: MemorySource) {
    const image = preview(photo);
    return (
      <button
        className="mp-photo"
        key={photo.id}
        type="button"
        onClick={() => {
          setSelected(photo);
          setOpen(true);
        }}
        aria-label={`Open photo ${photo.title}`}
      >
        {image ? (
          <img src={image.thumbnailUrl || image.url} alt={photo.title} loading="lazy" />
        ) : (
          <SourceBrand id="images" size={32} />
        )}
        <span>{photo.title}</span>
        {photo.status === "indexing" && <small>Indexing…</small>}
      </button>
    );
  }
  return (
    <>
      <section
        className={`memory-photos ${dragging ? "is-dragging" : ""}`}
        aria-label="Photos and documents in memory"
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) {
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          if (--dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!busy) void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="mp-header">
          <span className="mp-photo-mark"><SourceBrand id="images" size={62} /></span>
          <div>
            <h2>Photos & documents</h2>
            <p>Your photos, screenshots and documents. Ready to recall.</p>
          </div>
          <div className="mp-actions">
            <button
              type="button"
              className="op-text-link"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              {busy ? <Busy /> : <FilePlus2 size={14} />} {busy ? "Adding files…" : "Add files"}
            </button>
            <MacMemorySearch onAdded={refresh} className="op-button mp-search-computer" />
          </div>
        </div>
        <input
          type="file"
          ref={picker}
          hidden
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.vtt,.srt,.eml,.png,.jpg,.jpeg,.webp,.heic,.heif,.tif,.tiff,.bmp"
          aria-label="Add photos or documents to memory"
          disabled={busy}
          onChange={(event) => {
            void upload(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
        {!photos.length && (
          <button
            className="mp-upload-empty"
            type="button"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <ImagePlus size={22} strokeWidth={1.5} />
            <span>
              <strong>
                {dragging ? "Drop to remember these files" : "Drop a document, photo or screenshot"}
              </strong>
              <small>PDF, text, images and email files · up to 5 MB each</small>
            </span>
          </button>
        )}
        <div className="mp-library-heading">
          <span>
            {photos.length
              ? `${photos.length.toLocaleString()} ${photos.length === 1 ? "photo" : "photos"} saved`
              : "Search beyond filenames"}
          </span>
          <button className="op-text-link" onClick={() => setIndexOpen(true)}>
            Choose photo folders to index
          </button>
        </div>
        {!!photos.length && (
          <div className="mp-strip">
            {photos.slice(0, 6).map(tile)}
            {photos.length > 6 && (
              <button
                type="button"
                className="mp-more"
                onClick={() => {
                  setSelected(null);
                  setOpen(true);
                }}
              >
                View all {photos.length}
              </button>
            )}
          </div>
        )}
        {!!documents.length && (
          <div className="mp-documents" aria-label="Recent documents">
            {documents.slice(0, 4).map((document) => (
              <Link key={document.id} to="/memory" search={{ source: document.id }}>
                <FileText size={15} />
                <span>
                  {document.title}
                  <small>
                    {document.status === "indexing"
                      ? "Indexing text…"
                      : document.status === "error"
                        ? "Needs attention"
                        : "Saved document"}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        )}
        {
          <label className="mp-destination">
            Save to{" "}
            <select
              aria-label="File destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              disabled={busy}
            >
              {memorySpaces(state).map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
            <small>Text is indexed locally. Originals stay on your computer.</small>
          </label>
        }
        {notice && (
          <p className="mp-notice" role="status">
            {notice}
          </p>
        )}
        {error && <Notice error>{error}</Notice>}
      </section>
      <Dialog open={indexOpen} onOpenChange={setIndexOpen}>
        <DialogContent className="op-modal mp-index-dialog">
          <DialogTitle>Make your photos searchable</DialogTitle>
          <DialogDescription>
            Choose folders, preview the files, then start indexing. You control the model and any
            cloud processing.
          </DialogDescription>
          {indexOpen && <PhotoIndexSetup />}
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="op-modal mp-dialog">
          <DialogTitle>{selected ? selected.title : "Your photos"}</DialogTitle>
          <DialogDescription>
            {selected
              ? "The image and its searchable memory stay together."
              : "Find pictures by their name, indexed text or saved description."}
          </DialogDescription>
          {selected ? (
            <div className="mp-detail">
              {preview(selected) && (
                <img className="mp-preview" src={preview(selected)!.url} alt={selected.title} />
              )}
              <div className="mp-detail-footer">
                <span>
                  {selected.status === "indexing"
                    ? "Reading image text…"
                    : selected.status === "error"
                      ? "Image saved · indexing needs attention"
                      : selected.extraction === "local-ocr"
                        ? "Text read on this Mac"
                        : selected.extraction === "local-vision"
                          ? "Visually described on this Mac"
                          : selected.extraction === "cloud-vision"
                            ? "AI visual description"
                            : selected.extraction === "design-vision"
                              ? "Description from Design"
                              : "Your photo context"}
                </span>
                <button
                  className="op-button primary"
                  disabled={!enabled || selected.status !== "ready"}
                  onClick={() => ask(selected)}
                >
                  <MessageSquare size={14} /> Ask about this photo
                </button>
              </div>
              {!enabled && (
                <p className="mp-notice">
                  Turn on Photos in your memory sources to chat about them.
                </p>
              )}
              {selected.error && <Notice error>{selected.error}</Notice>}
              <details>
                <summary>What memory knows</summary>
                <p className="mp-description">
                  {selected.text || "No image text or visual description has been indexed yet."}
                </p>
              </details>
              {editing ? (
                <form
                  className="mp-description-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!selected || savingDescription) return;
                    setSavingDescription(true);
                    setError("");
                    try {
                      await operatorRequest(`/memory/${selected.id}`, { text: description });
                      await refresh();
                      setEditing(false);
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setSavingDescription(false);
                    }
                  }}
                >
                  <label>
                    What should memory know about this photo?
                    <textarea
                      aria-label="Photo context"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="What is in the picture, why you saved it, or an idea it gave you…"
                      minLength={15}
                      required
                    />
                  </label>
                  <button className="op-button primary" disabled={savingDescription}>
                    {savingDescription ? <Busy /> : null} Save context
                  </button>
                  <button type="button" className="op-text-link" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  className="op-text-link"
                  onClick={() => {
                    setDescription(selected.text || "");
                    setEditing(true);
                  }}
                >
                  Add or edit context
                </button>
              )}
              {error && <Notice error>{error}</Notice>}
              <button className="op-text-link" onClick={() => setSelected(null)}>
                All photos
              </button>
            </div>
          ) : (
            <>
              <label className="mp-search">
                <Search size={15} />
                <input
                  aria-label="Search photos"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your pictures…"
                />
              </label>
              <div className="mp-grid">{visible.slice(0, 120).map(tile)}</div>
              {!visible.length && <p className="mp-notice">No matching photos yet.</p>}
              {visible.length > 120 && (
                <p className="mp-notice">Showing 120 photos. Search to narrow them down.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
