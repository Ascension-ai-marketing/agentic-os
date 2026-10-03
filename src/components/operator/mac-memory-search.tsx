import { jevFetch } from "@/lib/jev-client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Search,
  Plus,
  FileText,
  FolderSearch,
  Image,
  ArrowLeft,
  FolderOpen,
} from "lucide-react";
import { Modal, Notice } from "./ui";
import { operatorRequest, useOperator } from "@/lib/operator";
import { PhotoIndexSetup } from "./photo-index-setup";
import "./computer-memory-search.css";

type LocalFile = {
  id: string;
  path: string;
  name?: string;
  desc?: string;
  kind?: string;
  memoryId?: string;
  previewUrl?: string;
};
export function MacMemorySearch({
  onAdded,
  label = "Search this computer",
  className = "op-button",
}: {
  onAdded: () => unknown;
  label?: string;
  className?: string;
}) {
  const { state } = useOperator();
  const [meaning, setMeaning] = useState(false);
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [kind, setKind] = useState<"documents" | "images">("documents"),
    [files, setFiles] = useState<LocalFile[]>([]),
    [indexing, setIndexing] = useState(false),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState<string>(),
    [added, setAdded] = useState<Set<string>>(() => new Set()),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  // Ignore stale results after changing the search or closing the panel.
  const request = useRef(0);
  useEffect(() => {
    if (!open) {
      request.current++;
      setBusy(false);
    }
  }, [open]);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    const attempt = ++request.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let data: { files?: LocalFile[]; hits?: LocalFile[]; error?: string };
      if (kind === "documents")
        data = await operatorRequest(`/files?q=${encodeURIComponent(q.trim())}`);
      else {
        const terms = q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const saved = state.sources
          .filter(
            (source) =>
              source.origin === "images" &&
              !source.deletedAt &&
              source.status === "ready" &&
              terms.every((term) =>
                `${source.title} ${source.text}`.toLocaleLowerCase().includes(term),
              ),
          )
          .slice(0, 40)
          .map(
            (source): LocalFile => ({
              id: `memory:${source.id}`,
              memoryId: source.id,
              name: source.title,
              path: source.filename || source.title,
              desc: source.text.slice(0, 180),
              previewUrl: source.image?.thumbnailUrl || source.image?.url,
            }),
          );
        try {
          const response = await (meaning ? jevFetch : fetch)(`/__design_search?q=${encodeURIComponent(q.trim())}${meaning ? "&mode=jev" : ""}`);
          const indexed = (await response.json()) as { hits?: LocalFile[]; error?: string; filenameCount?: number; meaningCount?: number; stats?: { count: number; ms: number; costUsd: number } };
          if (!response.ok || indexed.error)
            throw new Error(indexed.error || "Design index unavailable");
          data = { hits: meaning ? indexed.hits : [...saved, ...(indexed.hits || [])] };
          if (meaning && indexed.stats && request.current === attempt) setMessage(`${indexed.filenameCount} file-name results · ${indexed.meaningCount} meaning results · ${indexed.stats.count} checked in ${(indexed.stats.ms / 1000).toFixed(2)} s · $${indexed.stats.costUsd.toFixed(6)}`);
        } catch (error) {
          if (meaning) throw error;
          data = { hits: saved };
          if (request.current === attempt)
            setMessage("Showing saved photo memories. The Design image index is unavailable.");
        }
      }
      if (request.current !== attempt) return;
      const hits = (data.files || data.hits || []).slice(0, 40);
      setFiles(hits);
      if (!hits.length && !(meaning && kind === "images"))
        setMessage(
          kind === "images"
            ? "No matching indexed images. Choose photo folders below, or try another search."
            : "No matching documents. Try a filename, or add a file directly on the Memory page.",
        );
    } catch (cause) {
      if (request.current === attempt) setError((cause as Error).message);
    } finally {
      if (request.current === attempt) setBusy(false);
    }
  }
  async function add(file: LocalFile) {
    if (adding) return;
    if (file.memoryId) {
      setOpen(false);
      window.dispatchEvent(new CustomEvent("memory:show-photo", { detail: { id: file.memoryId } }));
      return;
    }
    setAdding(file.id);
    setError("");
    try {
      const result = await operatorRequest<{ duplicate?: boolean }>(
        "/memory",
        kind === "documents"
          ? { localFileId: file.id, collection: "projects" }
          : {
              title: file.path.split("/").pop(),
              text: `Image reference: ${file.path}\n${file.desc || "No indexed visual description."}`,
              kind: "note",
              collection: "content",
            },
      );
      await onAdded();
      setAdded((current) => new Set([...current, file.id]));
      setMessage(
        result.duplicate
          ? "Already saved in Memory."
          : kind === "documents"
            ? "Document saved. Its text is being indexed locally."
            : "Image reference and description saved. The original stays on your computer.",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setAdding(undefined);
    }
  }
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <FolderSearch size={15} />
        {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Search this computer"
        description="Find a document or photo, then choose what your AI should remember."
      >
        <div className="computer-memory-search">
          {indexing ? (
            <>
              <button className="op-text-link cms-back" onClick={() => setIndexing(false)}>
                <ArrowLeft size={14} /> Back to search
              </button>
              <div className="cms-index-intro">
                <FolderOpen size={23} />
                <div>
                  <h3>Choose your photo folders</h3>
                  <p>
                    Preview the files, choose how they are read, then start a bounded indexing job.
                    Nothing starts automatically.
                  </p>
                </div>
              </div>
              <PhotoIndexSetup />
            </>
          ) : (
            <>
              <div className="cms-kinds" role="group" aria-label="Computer search type">
                {(
                  [
                    ["documents", "Documents", FileText],
                    ["images", "Photos", Image],
                  ] as const
                ).map(([id, name, Icon]) => (
                  <button
                    key={id}
                    aria-pressed={kind === id}
                    disabled={!!adding}
                    onClick={() => {
                      request.current++;
                      setBusy(false);
                      setKind(id);
                      setFiles([]);
                      setMessage("");
                      setError("");
                    }}
                  >
                    <Icon size={16} />
                    {name}
                  </button>
                ))}
              </div>
              {kind === "images" && <div className="mb-3 text-xs"><label><input type="checkbox" checked={meaning} onChange={e => setMeaning(e.target.checked)} /> Search by meaning</label>{meaning && <p>Jev reads each image's saved description, not the pixels. Up to 200 descriptions go to OpenRouter. Provider usage is billed.</p>}</div>}
              <form className="cms-search" onSubmit={search}>
                <Search size={18} />
                <input
                  aria-label="Search files on this computer"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={
                    kind === "documents"
                      ? "Search a document name…"
                      : "A place, object, filename or words in a photo…"
                  }
                  minLength={2}
                />
                <button
                  className="op-button primary"
                  disabled={busy || q.trim().length < 2 || !!adding}
                >
                  {busy ? "Searching…" : "Search"}
                </button>
              </form>
              <p className="cms-scope">
                {kind === "documents"
                  ? "Filename search · Desktop, Documents and Downloads · up to 40 matches"
                  : "Search saved photo memories and your Design image index. Only indexed photos appear here."}
              </p>
              {kind === "images" && (
                <button className="cms-index-action" onClick={() => setIndexing(true)}>
                  <FolderOpen size={18} />
                  <span>
                    <strong>Make more photos searchable</strong>
                    <small>Choose folders · preview · index</small>
                  </span>
                  <Plus size={16} />
                </button>
              )}
              {busy && (
                <p className="cms-progress" role="status">
                  <span /> Searching the local index…
                </p>
              )}
              {error && <Notice error>{error}</Notice>}
              {message && (
                <p className="cms-feedback" role="status">
                  {message}
                </p>
              )}
              <div className="cms-results" aria-live="polite">
                {files.map((file) => (
                  <div className="cms-file" key={file.id}>
                    {kind === "images" ? (
                      file.previewUrl || !file.memoryId ? (
                        <img
                          src={
                            file.previewUrl || `/__design_file?id=${encodeURIComponent(file.id)}`
                          }
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <Image size={22} />
                      )
                    ) : (
                      <FileText size={22} />
                    )}
                    <span>
                      <strong>{file.name || file.path.split("/").pop()}</strong>
                      <small>{file.desc || file.path}</small>
                    </span>
                    <button
                      className="op-button"
                      disabled={!!adding || added.has(file.id)}
                      onClick={() => void add(file)}
                    >
                      {added.has(file.id) ? <Check size={13} /> : <Plus size={13} />}
                      {adding === file.id
                        ? "Saving…"
                        : file.memoryId
                          ? "Open"
                          : added.has(file.id)
                            ? "Saved"
                            : "Remember"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="cms-footnote">
                {kind === "documents"
                  ? "Document discovery uses macOS Spotlight. Only the files you choose are copied into Memory and indexed."
                  : "Photos are never scanned across your whole computer. Folder indexing shows the selected model and any cloud cost before you start."}
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
