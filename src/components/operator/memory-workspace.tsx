import "./memory-cortex.css";
import { MemoryStudio } from "./memory-studio";
import { MemoryPhotos } from "./memory-photos";
import { MemoryChat } from "./memory-chat";
import { MemoryCapture } from "./memory-capture";
import { MemoryConnections } from "./memory-connections";
import { MemorySpaces } from "./memory-spaces";
import { MemoryStorage } from "./memory-storage";
import "./memory-simplified.css";
import { BRAIN_SOURCES, brainEnabled, sourceOrigin } from "@/lib/brain-sources";
import { MacMemorySearch } from "./mac-memory-search";
import { MemoryUniverse } from "./memory-universe";
import { MemoryImports, useMemoryConnectors } from "./memory-imports";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  FileText,
  FileImage,
  Folder,
  UserRound,
  Link2,
  Mic,
  Pin,
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import {
  type MemorySource,
  memorySpaces,
  operatorRequest,
  useOperator,
  humanDate,
  askOperator,
} from "@/lib/operator";
import { Busy, Empty, Modal, Notice, Panel } from "./ui";
const spaceDetails = {
  business: {
    icon: Building2,
    idea: "Your company, offers, goals and decisions.",
    action: "Add business context",
    title: "Business overview",
    placeholder: "What does your business do, who does it serve, and what are you working towards?",
  },
  content: {
    icon: Video,
    idea: "Research, ideas and the way you communicate.",
    action: "Save a content idea",
    title: "Content idea",
    placeholder: "Capture an idea, useful research, or an example of your voice…",
  },
  projects: {
    icon: Folder,
    idea: "Briefs, working notes and what comes next.",
    action: "Add a project brief",
    title: "Project brief",
    placeholder: "What are you building, why does it matter, and what should happen next?",
  },
  personal: {
    icon: UserRound,
    idea: "Your preferences, principles and everyday life.",
    action: "Add a preference",
    title: "A little about me",
    placeholder: "What should your assistant know about you or how you like to work?",
  },
};
type MemoryDraft = {
  title?: string;
  text?: string;
  kind?: string;
  url?: string;
  collection?: string;
  origin?: string;
  provider?: "codex" | "claude";
};
const icons = { note: FileText, article: BookOpen, video: Video, document: FileText, meeting: Mic };
export function AddMemory({
  open,
  onClose,
  onAdded,
  initial,
  inline = false,
}: {
  inline?: boolean;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  initial?: MemoryDraft;
}) {
  const connectors = useMemoryConnectors(open);
  const { state } = useOperator();
  const spaces = memorySpaces(state);
  const [origin, setOrigin] = useState("auto");
  const [mode, setMode] = useState("note"),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [url, setUrl] = useState(""),
    [collection, setCollection] = useState("business"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setTitle(initial?.title || "");
      setContent(initial?.text || "");
      setUrl(initial?.url || "");
      setMode(
        ["meeting", "link", "file", "local", "notion"].includes(initial?.kind || "")
          ? initial!.kind!
          : "note",
      );
      setCollection(initial?.collection || "business");
      setOrigin(initial?.origin || "auto");
      setFile(null);
      setError("");
    }
  }, [open, initial]);
  const imageFile = !!file && /\.(png|jpe?g|webp|heic|tiff?|bmp)$/i.test(file.name);
  function chooseFile(next: File | null) {
    if (next && next.size > 5 * 1024 * 1024) {
      setError("Choose a file smaller than 5 MB.");
      setFile(null);
      return;
    }
    setFile(next);
    setError("");
  }
  function imported(message: string) {
    onAdded();
    onClose();
    window.dispatchEvent(new CustomEvent("operator:notice", { detail: message }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let base64;
      if (mode === "file" && file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        base64 = btoa(binary);
      }
      const result = await operatorRequest("/memory", {
        title,
        text: content,
        url: mode === "link" ? url : initial?.url,
        collection,
        origin: origin === "auto" ? undefined : origin,
        kind: mode === "link" ? undefined : mode === "file" ? "document" : mode,
        filename: mode === "file" ? file?.name : undefined,
        base64,
      });
      onAdded();
      onClose();
      window.dispatchEvent(
        new CustomEvent("operator:notice", {
          detail: result.duplicate
            ? "That source is already in your memory."
            : "Source added to memory.",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const Frame = inline ? InlineMemoryFrame : Modal;
  return (
    <Frame
      open={open}
      onClose={onClose}
      title="Add to your memory"
      description="Notes, links, documents and photos."
    >
      <div className="op-tabs">
        {[
          ["note", "Write a note"],
          ["link", "Paste a link"],
          ["file", "File or image"],
          ["notion", "Notion"],
          ["meeting", "Meeting notes"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={mode === id ? "active" : ""}
            aria-pressed={mode === id}
            onClick={() => {
              setMode(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "local" || mode === "notion" ? (
        <MemoryImports
          mode={mode}
          initialProvider={initial?.provider}
          collection={collection}
          onCollectionChange={setCollection}
          onImported={imported}
          onExportUpload={() => {
            setMode("file");
            setOrigin("notion");
          }}
        />
      ) : (
        <form className="op-form" onSubmit={submit}>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give this a useful name"
              required={mode === "note" || mode === "meeting"}
            />
          </label>
          {mode === "link" && (
            <>
              <label>
                Article or YouTube link
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
              <p className="op-form-help">
                Articles are extracted locally. YouTube imports use available English captions; if a
                transcript is unavailable, you can paste one instead.
              </p>
            </>
          )}
          {mode === "file" ? (
            <div className="cortex-upload-area">
              <label
                className={`cortex-dropzone ${file ? "has-file" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  chooseFile(e.dataTransfer.files[0] || null);
                }}
              >
                {imageFile ? <FileImage size={25} /> : <Upload size={25} />}
                <strong>{file ? file.name : "Drop a document, image or email"}</strong>
                <span>
                  {file
                    ? `${(file.size / 1024).toFixed(1)} KB · choose another file`
                    : "PDF, text, Markdown, HTML, images or .eml · up to 5 MB"}
                </span>
                <input
                  aria-label="Upload memory file"
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.vtt,.srt,.eml,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.bmp"
                  required={!file}
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0] || null);
                    if (e.target.files?.[0]?.size && e.target.files[0].size > 5 * 1024 * 1024)
                      e.target.value = "";
                  }}
                />
              </label>
              <div className="cortex-upload-note">
                <FileImage size={14} />
                <span>
                  {connectors.data?.imageOCR.available
                    ? "Image text is read locally on your CPU and made searchable. This reads words, rather than describing the picture."
                    : connectors.isLoading
                      ? "Checking local image text recognition…"
                      : "Local image text recognition is unavailable. You can still import documents, text or email files."}
                </span>
                {connectors.data?.imageOCR.available && <small>LOCAL OCR</small>}
              </div>
              {imageFile && !connectors.data?.imageOCR.available && !connectors.isLoading && (
                <Notice error>
                  Image reading is not available on this Mac. Choose a text export or a supported
                  document instead.
                </Notice>
              )}
            </div>
          ) : (
            <label>
              {mode === "link"
                ? "Source text or transcript (optional)"
                : mode === "meeting"
                  ? "Notes or transcript"
                  : "What should your workspace remember?"}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required={mode !== "link"}
                minLength={mode !== "link" ? 15 : undefined}
                placeholder={
                  mode === "meeting"
                    ? "Paste the notes from your meeting notetaker…"
                    : spaceDetails[collection as keyof typeof spaceDetails]?.placeholder ||
                      "Write or paste your context here…"
                }
              />
            </label>
          )}
          <label>
            Collection
            <select
              aria-label="Collection"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              {spaces.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select
              aria-label="Memory source"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              <option value="auto">Detect from what I add</option>
              {BRAIN_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {error && <Notice error>{error}</Notice>}
          <button
            className="op-button primary"
            disabled={
              busy ||
              (mode === "file" && (!file || (imageFile && !connectors.data?.imageOCR.available)))
            }
          >
            {busy ? <Busy /> : <Plus size={15} />}{" "}
            {busy && imageFile && mode === "file" ? "Reading image on this Mac…" : "Add to memory"}
          </button>
        </form>
      )}
    </Frame>
  );
}
function InlineMemoryFrame({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  description?: string;
}) {
  return open ? (
    <section className="ar-memory-entry">
      <div className="ar-entry-heading">
        <h2>More ways to add</h2>
        <button className="op-text-link" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </section>
  ) : null;
}
export function MemoryWorkspace() {
  const { state, refresh, isLoading, error } = useOperator();
  const spaces = memorySpaces(state);
  const [visibleCount, setVisibleCount] = useState(12);
  const [manageSpaces, setManageSpaces] = useState(false);
  const sourceParam = useRouterState({
    select: (s): string | undefined => (s.location.search as { source?: string }).source,
  });
  const [draft, setDraft] = useState<MemoryDraft>({ collection: "business" });
  const [add, setAdd] = useState(false),
    [collection, setCollection] = useState("all"),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [trash, setTrash] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [failure, setFailure] = useState(""),
    [edit, setEdit] = useState(false),
    [editTitle, setEditTitle] = useState(""),
    [editText, setEditText] = useState("");
  useEffect(() => {
    if (sourceParam && state.sources.some((s) => s.id === sourceParam)) setSelected(sourceParam);
  }, [sourceParam, state.sources]);
  const summary = state.sources.find((s) => s.id === selected);
  const [fullSource, setFullSource] = useState<MemorySource | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [sourceRetry, setSourceRetry] = useState(0);
  const source =
    fullSource?.id === summary?.id && fullSource?.hash === summary?.hash ? fullSource : summary;
  useEffect(() => {
    setFullSource(null);
    setSourceError("");
    setEdit(false);
    if (!summary?.textTruncated) return;
    let active = true;
    operatorRequest<{ source: MemorySource }>(`/memory/${summary.id}`)
      .then((result) => {
        if (active) setFullSource({ ...result.source, textTruncated: false });
      })
      .catch((e) => {
        if (active) setSourceError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [summary?.id, summary?.hash, summary?.updatedAt, summary?.textTruncated, sourceRetry]);
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    setSearchIds(null);
    setSearchError("");
    if (!query.trim()) {
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      operatorRequest<{ ids: string[] }>(
        `/memory/search?q=${encodeURIComponent(query.trim())}&trash=${trash ? "1" : "0"}${collection !== "all" ? `&collection=${encodeURIComponent(collection)}` : ""}`,
      )
        .then((result) => {
          if (active) setSearchIds(new Set(result.ids));
        })
        .catch((e) => {
          if (active) setSearchError((e as Error).message);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, collection, trash, state.sources]);
  useEffect(() => setVisibleCount(12), [collection, query, kind, trash]);
  const filtered = useMemo(
    () =>
      state.sources
        .filter(
          (s) =>
            !!s.deletedAt === trash &&
            (collection === "all" || s.collection === collection) &&
            (kind === "all" || s.kind === kind) &&
            (searchIds
              ? searchIds.has(s.id)
              : `${s.title} ${s.text}`.toLowerCase().includes(query.toLowerCase())),
        )
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [state, trash, collection, kind, query, searchIds],
  );
  useEffect(() => {
    const listener = (e: Event) => setNotice((e as CustomEvent).detail);
    window.addEventListener("operator:notice", listener);
    return () => window.removeEventListener("operator:notice", listener);
  }, []);
  async function update(
    id: string,
    body: Partial<MemorySource> & { action?: "trash" | "restore" | "retry" },
  ) {
    setFailure("");
    try {
      await operatorRequest(`/memory/${id}`, body);
      await refresh();
      if (body.action === "trash") {
        setNotice("Moved to trash. You can restore it from the Trash view.");
        setSelected(null);
      }
      if (body.action === "restore") {
        setNotice("Source restored.");
        setSelected(null);
      }
      if (body.text) setEdit(false);
    } catch (e) {
      setFailure((e as Error).message);
    }
  }
  function addToSpace(id = collection === "all" ? "business" : collection) {
    setDraft({ collection: id });
    setCollection(id);
    setAdd(false);
    window.setTimeout(() => {
      document
        .getElementById("memory-entry")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document
        .querySelector<HTMLTextAreaElement>('[aria-label="New memory text or link"]')
        ?.focus({ preventScroll: true });
    }, 40);
  }
  const importSource = useCallback(
    (id: string) => {
      if (["codex", "claude", "hermes", "chatgpt", "email"].includes(id)) {
        window.dispatchEvent(
          new CustomEvent("memory:connect", { detail: { app: id === "email" ? "gmail" : id } }),
        );
        document
          .getElementById("memory-connections")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const kind =
        id === "codex" || id === "claude"
          ? "local"
          : id === "notion"
            ? "notion"
            : id === "web"
              ? "link"
              : id === "meetings"
                ? "meeting"
                : ["business", "personal", "manual"].includes(id)
                  ? "note"
                  : "file";
      setDraft({
        kind,
        origin: id,
        collection:
          id === "personal"
            ? "personal"
            : id === "codebases"
              ? "projects"
              : collection === "all"
                ? "business"
                : collection,
        provider: id === "codex" || id === "claude" ? id : undefined,
      });
      setAdd(true);
      window.setTimeout(
        () =>
          document
            .getElementById("memory-entry")
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        80,
      );
    },
    [collection],
  );
  useEffect(() => {
    const addFromGraph = (e: Event) => importSource((e as CustomEvent).detail?.origin || "manual");
    window.addEventListener("memory:add", addFromGraph);
    return () => window.removeEventListener("memory:add", addFromGraph);
  }, [importSource]);
  return (
    <div className="op-page cortex-workspace">
      <header className="ar-page-title">
        <div>
          <h1>Memory</h1>
          <p>Your knowledge, connected.</p>
        </div>
      </header>
      <div className="memory-cortex-layout">
        <MemoryUniverse onSource={(id) => setSelected(id)} />
        <aside
          id="memory-connections"
          className="memory-cortex-sources"
          aria-label="Memory sources"
        >
          <MemoryConnections onAdded={refresh} onImport={importSource} />
        </aside>
      </div>
      {error && <Notice error>{error.message}</Notice>}
      {notice && (
        <Notice>
          {notice}
          <button onClick={() => setNotice("")}>Dismiss</button>
        </Notice>
      )}
      {failure && <Notice error>{failure}</Notice>}
      <MemoryStudio
        capture={
          <div id="memory-entry" className="cortex-capture-section">
            <MemoryCapture
              collection={collection === "all" ? "business" : collection}
              onAdded={refresh}
              onOrganize={() => setManageSpaces(true)}
              onAdvanced={() => {
                setDraft({ collection: collection === "all" ? "business" : collection });
                setAdd(!add);
              }}
            />
            <AddMemory
              inline
              initial={draft}
              open={add}
              onClose={() => setAdd(false)}
              onAdded={refresh}
            />
          </div>
        }
      />
      <MemoryPhotos />
      <MemoryChat />
      <details className="memory-saved-drawer">
        <summary>
          <span>Saved memories</span>
          <small>{state.sources.filter((s) => !s.deletedAt).length.toLocaleString()} items</small>
        </summary>
        <div className="memory-saved-content">
          <div className="op-library-header">
            <h2>
              {trash
                ? "Trash"
                : collection === "all"
                  ? "Recently added"
                  : `${spaces.find((c) => c.id === collection)?.name} memories`}{" "}
              <span className="op-muted" style={{ fontSize: 11, marginLeft: 8 }}>
                {filtered.length} sources
              </span>
            </h2>
            <div className="op-library-tools">
              <label className="op-search">
                <Search size={14} />
                <input
                  aria-label="Search memory"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your context…"
                />
              </label>
              <select
                aria-label="Filter source type"
                className="op-select"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">All sources</option>
                {Object.keys(icons).map((k) => (
                  <option key={k} value={k}>
                    {k[0].toUpperCase() + k.slice(1)}s
                  </option>
                ))}
              </select>
              <button
                className={`op-icon-button ${trash ? "active" : ""}`}
                onClick={() => setTrash(!trash)}
                title={trash ? "Back to library" : "Open trash"}
                aria-label={trash ? "Back to library" : "Open trash"}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {searchError && <Notice error>Full memory search could not load. {searchError}</Notice>}
          {searching && (
            <p className="op-muted" role="status">
              <Busy /> Searching your full memory…
            </p>
          )}
          {isLoading ? (
            <Panel>
              <Empty title="Opening your library…" icon={<Busy />}>
                Loading sources from this workspace.
              </Empty>
            </Panel>
          ) : filtered.length ? (
            <div className="op-source-grid">
              {filtered.slice(0, visibleCount).map((s) => {
                const Icon = icons[s.kind];
                return (
                  <button
                    className="op-panel op-source-card"
                    key={s.id}
                    onClick={() => {
                      setSelected(s.id);
                      setEdit(false);
                      setFailure("");
                    }}
                  >
                    <div className="op-source-top">
                      <span className="op-source-kind">
                        <Icon size={14} />
                        {s.kind}
                      </span>
                      {s.pinned ? <Pin size={12} /> : <span>{humanDate(s.createdAt)}</span>}
                    </div>
                    <h3>{s.title}</h3>
                    <p>
                      {s.status === "error"
                        ? s.error
                        : s.status === "indexing"
                          ? "Reading this source and preparing it for search…"
                          : s.text}
                    </p>
                    <div className="op-source-bottom">
                      <span>{spaces.find((c) => c.id === s.collection)?.name}</span>
                      <span className={`op-source-status ${s.status}`}>
                        {s.status === "ready" ? (
                          <>
                            <Check size={10} />
                            Indexed · {s.words.toLocaleString()} words
                          </>
                        ) : s.status === "indexing" ? (
                          <>
                            <Busy />
                            Processing
                          </>
                        ) : (
                          "Needs attention"
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cortex-library-empty">
              <FileText size={18} />
              <div>
                <strong>
                  {trash
                    ? "Trash is empty"
                    : query || kind !== "all"
                      ? "No matching memories"
                      : collection === "all"
                        ? "Your saved notes will appear here"
                        : `${spaces.find((c) => c.id === collection)?.name} notes will appear here`}
                </strong>
                <p>
                  {trash
                    ? "Removed memories can be restored here."
                    : query || kind !== "all"
                      ? "Try another word or source type."
                      : "Connect an app or drop in a file to start building this space."}
                </p>
              </div>
            </div>
          )}
          {filtered.length > visibleCount && (
            <button
              className="op-button cortex-show-more"
              onClick={() => setVisibleCount((n) => n + 24)}
            >
              Show more memories · {filtered.length - visibleCount} remaining
            </button>
          )}
          <div className="cortex-management">
            <MacMemorySearch onAdded={refresh} />
          </div>
          <MemoryStorage />
        </div>
      </details>
      <Modal
        open={manageSpaces}
        onClose={() => setManageSpaces(false)}
        title="Your folders"
        description="Organize what you save. Create a folder for a project, your business or an idea."
      >
        <MemorySpaces
          selected={collection}
          onSelect={(id) => {
            setCollection(id || "all");
            setTrash(false);
            setQuery("");
          }}
          onAdd={(id) => {
            setManageSpaces(false);
            addToSpace(id);
          }}
        />
      </Modal>

      <Modal
        open={!!source}
        onClose={() => setSelected(null)}
        title={source?.title || "Memory source"}
        description="Review the original context, refine it, or ask a question."
      >
        {source && (
          <>
            <div className="op-detail-meta">
              <span>{source.kind}</span>
              <span>{source.words.toLocaleString()} words</span>
              <span>Added {humanDate(source.createdAt)}</span>
              <span>{source.status === "ready" ? "Indexed for local search" : source.status}</span>
            </div>
            {source.origin === "images" && (
              <img
                className="mp-preview"
                src={`/__operator/memory/photos/${source.id}/image`}
                alt={source.title}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
            {source.url && (
              <a className="op-source-link" href={source.url} target="_blank" rel="noreferrer">
                <Link2 size={12} />
                {source.url}
                <ArrowUpRight size={12} />
              </a>
            )}
            {source.error && <Notice error>{source.error}</Notice>}
            {sourceError && (
              <Notice error>
                {sourceError}
                <button onClick={() => setSourceRetry((n) => n + 1)}>Retry full source</button>
              </Notice>
            )}
            {source.textTruncated && !sourceError && (
              <p className="op-muted" role="status">
                <Busy /> Opening the full source…
              </p>
            )}
            {failure && <Notice error>{failure}</Notice>}
            {edit ? (
              <form
                className="op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void update(source.id, { title: editTitle, text: editText });
                }}
              >
                <label>
                  Title
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </label>
                <label>
                  Source text
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    minLength={15}
                    required
                    style={{ minHeight: 230 }}
                  />
                </label>
                <button className="op-button primary">Save changes & reindex</button>
              </form>
            ) : (
              <div className="op-detail-text">
                {source.text || "No readable text yet. Add source text or retry the original link."}
              </div>
            )}
            <div className="op-detail-actions">
              {source.deletedAt ? (
                <button
                  className="op-button primary"
                  onClick={() => update(source.id, { action: "restore" })}
                >
                  Restore source
                </button>
              ) : (
                <>
                  <button
                    className="op-button primary"
                    disabled={
                      source.textTruncated ||
                      source.status !== "ready" ||
                      !brainEnabled(state, sourceOrigin(source))
                    }
                    title={
                      !brainEnabled(state, sourceOrigin(source))
                        ? "Enable this source type in Manage sources to chat with it."
                        : undefined
                    }
                    onClick={() => {
                      askOperator(
                        `Summarise “${source.title}” and suggest where it is useful.`,
                        `SELECTED MEMORY SOURCE [${source.title}] (id: ${source.id}):\n${source.text.slice(0, 16000)}`,
                        false,
                        undefined,
                        sourceOrigin(source),
                      );
                      setSelected(null);
                    }}
                  >
                    <MessageSquare size={13} /> Ask this source
                  </button>
                  <button
                    className="op-button"
                    disabled={!!source.textTruncated}
                    onClick={() => {
                      setEdit(!edit);
                      setEditTitle(source.title);
                      setEditText(source.text);
                    }}
                  >
                    Edit context
                  </button>
                  <button
                    className="op-button"
                    onClick={() => update(source.id, { pinned: !source.pinned })}
                  >
                    <Pin size={13} />
                    {source.pinned ? "Unpin" : "Pin"}
                  </button>
                  {source.status === "error" && source.url && (
                    <button
                      className="op-button"
                      onClick={() => update(source.id, { action: "retry" })}
                    >
                      Retry link
                    </button>
                  )}
                  <button
                    className="op-button danger"
                    onClick={() => update(source.id, { action: "trash" })}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                  <select
                    aria-label="Move to collection"
                    className="op-select"
                    style={{ width: 135, fontSize: 10 }}
                    value={source.collection}
                    onChange={(e) => update(source.id, { collection: e.target.value })}
                  >
                    {spaces.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
