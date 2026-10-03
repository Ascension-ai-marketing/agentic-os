import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  HardDrive,
  Image,
  MoreHorizontal,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import { memorySpaces, operatorRequest, useOperator } from "@/lib/operator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Busy } from "./ui";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { memorySaveFeedback, type MemorySaveReceipt } from "./memory-capture-feedback";
import "./memory-capture.css";

const SUPPORTED =
  /\.(pdf|txt|md|markdown|csv|json|html?|vtt|srt|eml|png|jpe?g|webp|heic|heif|tiff?|bmp)$/i;
const IMAGE = /\.(png|jpe?g|webp|heic|heif|tiff?|bmp)$/i;
type Attachment = {
  id: string;
  file: File;
  status: "pending" | "adding" | "added" | "error";
  error?: string;
};

export function MemoryCapture({
  collection,
  onAdded,
  onAdvanced,
  onOrganize,
}: {
  collection: string;
  onAdded: () => void;
  onAdvanced: () => void;
  onOrganize?: () => void;
}) {
  const { state, isLoading } = useOperator();
  const spaces = memorySpaces(state);
  const [destination, setDestination] = useState(collection);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedSource, setSavedSource] = useState<string>();
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<{
    path?: string;
    primary?: string;
    photos?: string;
    error?: string;
    pending?: boolean | number;
    conflicts?: number;
  }>();
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const restoredDestination = useRef(false);
  useEffect(() => setDestination(collection), [collection]);
  useEffect(() => {
    if (isLoading || restoredDestination.current) return;
    restoredDestination.current = true;
    try {
      const saved = localStorage.getItem("agentic.memory.capture-folder");
      if (saved && spaces.some((space) => space.id === saved)) setDestination(saved);
    } catch {
      /* Local storage is optional. */
    }
  }, [isLoading, spaces]);

  function addFiles(files: File[]) {
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      if (!SUPPORTED.test(file.name)) {
        rejected.push(`${file.name}: choose a document, image or email file.`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        rejected.push(`${file.name}: the limit is 5 MB per file.`);
        return false;
      }
      if (!file.size) {
        rejected.push(`${file.name} is empty.`);
        return false;
      }
      return true;
    });
    setAttachments((current) => {
      const existing = new Set(
        current.map((x) => `${x.file.name}:${x.file.size}:${x.file.lastModified}`),
      );
      return [
        ...current,
        ...accepted
          .filter((f) => !existing.has(`${f.name}:${f.size}:${f.lastModified}`))
          .map((file) => ({ id: crypto.randomUUID(), file, status: "pending" as const })),
      ];
    });
    setError(rejected.join(" "));
    setNotice("");
  }
  function patch(id: string, value: Partial<Attachment>) {
    setAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, ...value } : item)),
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    setSavedSource(undefined);
    const receipts: MemorySaveReceipt[] = [];
    let failed = 0;
    const message = text.trim();
    const isLink = /^https?:\/\/\S+$/i.test(message);
    if (message) {
      try {
        if (!isLink && message.length < 15)
          throw new Error("Add a little more context. Notes need at least 15 characters.");
        const result = await operatorRequest<MemorySaveReceipt>(
          "/memory",
          isLink
            ? { url: message, collection: destination }
            : {
                title: message.split("\n")[0].slice(0, 100),
                text: message,
                kind: "note",
                origin: "manual",
                collection: destination,
              },
        );
        receipts.push(result);
        setText("");
      } catch (e) {
        failed++;
        setError((e as Error).message);
      }
    }
    for (const item of attachments.filter((item) => item.status !== "added")) {
      patch(item.id, { status: "adding", error: undefined });
      try {
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        const result = await operatorRequest<MemorySaveReceipt>("/memory", {
          filename: item.file.name,
          base64: btoa(binary),
          collection: destination,
          kind: "document",
        });
        patch(item.id, { status: "added" });
        receipts.push(result);
      } catch (e) {
        failed++;
        patch(item.id, { status: "error", error: (e as Error).message });
      }
    }
    const feedback = memorySaveFeedback(receipts, spaces);
    if (feedback) {
      setNotice(feedback.notice);
      setSavedSource(feedback.sourceId);
      onAdded();
      if (feedback.added) window.dispatchEvent(new CustomEvent("memory:saved", { detail: { sourceId: feedback.sourceId } }));
    }
    if (failed && !message)
      setError("Some files could not be added. Your files are kept here so you can retry.");
    setBusy(false);
  }
  const pending = attachments.filter((item) => item.status !== "added").length;
  return (
    <section
      className={`memory-capture-v5 memory-capture-simple ${drag ? "is-dragging" : ""}`}
      aria-label="Add to your memory"
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) {
          dragDepth.current++;
          setDrag(true);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDrag(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDrag(false);
        if (!busy) addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <form className="mc5-composer" onSubmit={submit}>
        <div className="mc5-input">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setNotice("");
              setError("");
            }}
            disabled={busy}
            aria-label="New memory text or link"
            placeholder="Write a note, paste a link, or drop a file…"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
          />
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          disabled={busy}
          aria-label="Memory attachments"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.vtt,.srt,.eml,.png,.jpg,.jpeg,.webp,.heic,.heif,.tif,.tiff,.bmp"
          onChange={(e) => {
            addFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        {!!attachments.length && (
          <ul className="mc5-files" aria-label="Files to remember">
            {attachments.map((item) => (
              <li key={item.id} className={item.status}>
                {item.status === "adding" ? (
                  <Busy />
                ) : item.status === "added" ? (
                  <Check size={15} />
                ) : IMAGE.test(item.file.name) ? (
                  <Image size={15} />
                ) : (
                  <Paperclip size={15} />
                )}
                <span>
                  <strong>{item.file.name}</strong>
                  <small>
                    {item.error ||
                      (item.status === "added"
                        ? "Added to memory"
                        : item.status === "adding"
                          ? "Adding…"
                          : `${Math.ceil(item.file.size / 1024)} KB`)}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setAttachments((current) => current.filter((x) => x.id !== item.id))
                  }
                  aria-label={`Remove ${item.file.name} from upload list`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mc5-toolbar">
          <div className="mc5-toolbar-tools">
            <button
              type="button"
              className="mc5-attachment-button"
              disabled={busy}
              onClick={() => picker.current?.click()}
              aria-label="Attach files or photos"
              title="Attach files or photos, up to 5 MB each"
            >
              <Paperclip size={18} />
            </button>
            <label className="mc5-destination">
              <span>Save to</span>
              <select
                className="mc5-folder"
                aria-label="Memory destination"
                title="Save in this folder"
                value={destination}
                disabled={busy}
                onChange={(e) => {
                  setDestination(e.target.value);
                  try {
                    localStorage.setItem("agentic.memory.capture-folder", e.target.value);
                  } catch {
                    /* Local storage is optional. */
                  }
                }}
              >
                {spaces.map((space) => (
                  <option value={space.id} key={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="mc5-options-button"
                  aria-label="More memory options"
                  title="More memory options"
                  disabled={busy}
                >
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="mc5-options-menu">
                {onOrganize && (
                  <DropdownMenuItem onSelect={onOrganize}>
                    <Folder size={15} /> Manage folders
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onAdvanced}>
                  <Upload size={15} /> Advanced import
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button className="mc5-save-button" disabled={busy || (!text.trim() && !pending)}>
            {busy ? <Busy /> : <ArrowUp size={15} />} {busy ? "Saving…" : "Save memory"}
          </button>
        </div>
      </form>
      <Popover
        onOpenChange={(open) => {
          if (open)
            void operatorRequest<NonNullable<typeof storage>>("/memory/storage")
              .then(setStorage)
              .catch(() => setStorage({ error: "Storage path is temporarily unavailable." }));
        }}
      >
        <PopoverTrigger asChild><button type="button" className="mc5-storage-trigger"><HardDrive size={12} /> Saved on this Mac <ChevronDown size={12} /></button></PopoverTrigger>
        <PopoverContent align="start" sideOffset={10} className="mc5-storage-panel" aria-label="Memory storage location">
          <strong>Saved on this Mac</strong>
          <p>Your folders organise one local memory.</p>
          {storage?.path ? (
            <>
              <span>Local memory</span>
              <code>{storage.primary || storage.path}</code>
              {storage.photos && <><span>Photo originals</span><code>{storage.photos}</code></>}
              <span>Readable copies</span>
              <code>{storage.path}</code>
              {!!storage.pending && <p role="status">Readable copies are still updating.</p>}
              {!!storage.conflicts && (
                <p role="status">
                  Some readable copies were edited outside the app. Those edits are preserved.
                </p>
              )}
              {storage.error && <p role="alert">{storage.error}</p>}
            </>
          ) : (
            <p>{storage?.error || "Finding your storage…"}</p>
          )}
        </PopoverContent>
      </Popover>
      {error && (
        <p className="mc5-feedback error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mc5-feedback" role="status">
          <Check size={13} />
          {notice}
          {savedSource && (
            <Link to="/memory" search={{ source: savedSource }}>
              Open saved memory
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
