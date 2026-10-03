import { useEffect, useRef, useState } from "react";
import codexLogo from "@/assets/logos/codex.png";
import claudeLogo from "@/assets/logo-claude.svg";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  FileText,
  FolderSearch,
  Import,
  KeyRound,
  Search,
} from "lucide-react";
import { memorySpaces, useOperator, humanDate, operatorRequest } from "@/lib/operator";
import { Busy, Notice } from "./ui";

export interface MemoryConnectors {
  connectors: Array<{ id: "codex" | "claude"; name: string; available: boolean; count: number }>;
  notion: { configured: boolean };
  imageOCR: { available: boolean; engine: string };
}
export function useMemoryConnectors(enabled = true) {
  return useQuery<MemoryConnectors>({
    queryKey: ["memory-connectors"],
    queryFn: () => operatorRequest("/memory/connectors"),
    enabled,
    staleTime: 30000,
    retry: false,
  });
}
type LocalFile = { id: string; title: string; path: string; bytes: number; updatedAt: string };
export function MemoryImports({
  mode,
  initialProvider,
  collection,
  onCollectionChange,
  onImported,
  onExportUpload,
}: {
  mode: "local" | "notion";
  initialProvider?: "codex" | "claude";
  collection: string;
  onCollectionChange: (collection: string) => void;
  onImported: (message: string) => void;
  onExportUpload: () => void;
}) {
  const status = useMemoryConnectors();
  const [provider, setProvider] = useState<"codex" | "claude">(initialProvider || "codex");
  const [files, setFiles] = useState<LocalFile[] | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [truncated, setTruncated] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [token, setToken] = useState(""),
    [notionUrl, setNotionUrl] = useState(""),
    [changeToken, setChangeToken] = useState(false),
    [savedConnection, setSavedConnection] = useState(false);
  const scanVersion = useRef(0);
  useEffect(() => {
    setProvider(initialProvider || "codex");
    setFiles(null);
    setSelected([]);
    setQuery("");
    setError("");
    scanVersion.current++;
  }, [initialProvider]);
  useEffect(() => {
    setError("");
  }, [mode]);
  const connector = status.data?.connectors.find((c) => c.id === provider);
  const shown = (files || []).filter((f) =>
    `${f.title} ${f.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const configured = savedConnection || status.data?.notion.configured;
  async function scan() {
    const version = ++scanVersion.current;
    setBusy("scan");
    setError("");
    try {
      const result = await operatorRequest<{ files: LocalFile[]; truncated: boolean }>(
        `/memory/local?provider=${provider}`,
      );
      if (version !== scanVersion.current) return;
      setFiles(result.files);
      setSelected([]);
      setQuery("");
      setTruncated(result.truncated);
    } catch (e) {
      if (version === scanVersion.current) setError((e as Error).message);
    } finally {
      if (version === scanVersion.current) setBusy("");
    }
  }
  async function importLocal() {
    setBusy("import");
    setError("");
    try {
      const result = await operatorRequest<{ added: number; updated: number; unchanged: number }>(
        "/memory/import-local",
        { provider, ids: selected, collection },
      );
      onImported(
        [
          result.added ? `${result.added} ${result.added === 1 ? "memory" : "memories"} added` : "",
          result.updated ? `${result.updated} updated` : "",
          result.unchanged ? `${result.unchanged} already current` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "These memories are already current.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="cortex-imports">
      {status.error && (
        <Notice error>
          {status.error.message}
          <button type="button" onClick={() => void status.refetch()}>
            Retry connection check
          </button>
        </Notice>
      )}
      {mode === "local" ? (
        <>
          <div className="cortex-import-heading">
            <div>
              <h3>Bring in your agent memory</h3>
              <p>Choose the files you want this workspace to remember.</p>
            </div>
            <FolderSearch size={22} />
          </div>
          <div className="cortex-agent-options" role="group" aria-label="Local memory provider">
            {(["codex", "claude"] as const).map((id) => {
              const item = status.data?.connectors.find((c) => c.id === id);
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={provider === id}
                  disabled={!!busy}
                  onClick={() => {
                    setProvider(id);
                    setFiles(null);
                    setSelected([]);
                    setQuery("");
                    setError("");
                    scanVersion.current++;
                  }}
                >
                  <span className={`cortex-agent-symbol ${id}`}>
                    <img src={id === "codex" ? codexLogo : claudeLogo} alt="" />
                  </span>
                  <span>
                    <strong>
                      {item?.name || (id === "codex" ? "Codex memory" : "Claude memory")}
                    </strong>
                    <small>
                      {!status.data
                        ? status.isLoading
                          ? "Checking this Mac…"
                          : "Connection status unavailable"
                        : item?.available
                          ? `${item.count} ${item.count === 1 ? "file" : "files"} found on this Mac`
                          : "No memory files found on this Mac"}
                    </small>
                  </span>
                  {provider === id && <Check size={15} />}
                </button>
              );
            })}
          </div>
          <div className="cortex-scan-line">
            <p>Scanning lists file names and locations. Only files you select are imported.</p>
            <button
              type="button"
              className="op-button"
              onClick={() => void scan()}
              disabled={!!busy || !connector?.available}
            >
              {busy === "scan" ? <Busy /> : <Search size={14} />}
              {files ? "Scan again" : "Scan memories"}
            </button>
          </div>
          {files && (
            <section className="cortex-local-picker" aria-label="Choose memory files">
              <div className="cortex-local-toolbar">
                <label className="op-search">
                  <Search size={13} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a memory file…"
                    aria-label="Filter local memory files"
                  />
                </label>
                <button
                  type="button"
                  className="op-text-link"
                  disabled={!!busy || !shown.length}
                  onClick={() =>
                    setSelected((current) =>
                      shown.every((f) => current.includes(f.id))
                        ? current.filter((id) => !shown.some((f) => f.id === id))
                        : [...new Set([...current, ...shown.map((f) => f.id)])],
                    )
                  }
                >
                  {shown.length > 0 && shown.every((f) => selected.includes(f.id))
                    ? "Deselect visible"
                    : "Select visible"}
                </button>
              </div>
              <div className="cortex-local-files">
                {shown.map((file) => (
                  <label key={file.id} className="cortex-local-file">
                    <input
                      type="checkbox"
                      checked={selected.includes(file.id)}
                      disabled={!!busy}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked
                            ? [...current, file.id]
                            : current.filter((id) => id !== file.id),
                        )
                      }
                      aria-label={`Import ${file.title}`}
                    />
                    <FileText size={16} />
                    <span>
                      <strong>{file.title}</strong>
                      <small title={file.path}>{file.path}</small>
                    </span>
                    <span className="cortex-file-meta">
                      {file.bytes < 1024
                        ? `${file.bytes} B`
                        : `${Math.round(file.bytes / 1024)} KB`}
                      {file.updatedAt && <small>{humanDate(file.updatedAt)}</small>}
                    </span>
                  </label>
                ))}
                {!shown.length && (
                  <p className="cortex-import-empty">
                    {files.length
                      ? "No files match this search."
                      : `No ${provider === "codex" ? "Codex" : "Claude"} memory files were found.`}
                  </p>
                )}
              </div>
              {truncated && (
                <p className="op-form-help">
                  This scan shows a limited selection. Other files may exist outside the scanned
                  folders.
                </p>
              )}
              <div className="cortex-import-footer">
                <CollectionField value={collection} onChange={onCollectionChange} />
                <button
                  type="button"
                  className="op-button primary"
                  onClick={() => void importLocal()}
                  disabled={!!busy || !selected.length}
                >
                  {busy === "import" ? <Busy /> : <Import size={14} />}Import{" "}
                  {selected.length || "selected"} {selected.length === 1 ? "memory" : "memories"}
                </button>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="cortex-import-heading">
            <div>
              <h3>Remember a Notion page</h3>
              <p>Import the page text into a knowledge space.</p>
            </div>
            <span className="cortex-notion-mark" aria-label="Notion">
              N
            </span>
          </div>
          {configured && !changeToken ? (
            <div className="cortex-notion-connected">
              <Check size={14} />
              <span>Integration token saved</span>
              <button type="button" className="op-text-link" onClick={() => setChangeToken(true)}>
                Update connection
              </button>
            </div>
          ) : (
            <form
              className="cortex-notion-connect"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy("connect");
                setError("");
                try {
                  const result = await operatorRequest<{ configured: boolean }>(
                    "/memory/notion-config",
                    { token },
                  );
                  if (!result.configured)
                    throw new Error("The Notion connection could not be saved.");
                  setToken("");
                  setSavedConnection(true);
                  setChangeToken(false);
                  void status.refetch();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy("");
                }
              }}
            >
              <p>
                Create a Notion integration, then share the page with it using the page’s
                Connections menu.
              </p>
              <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
                Open Notion integrations <ArrowUpRight size={12} />
              </a>
              <label>
                Integration token
                <input
                  aria-label="Notion integration token"
                  type="password"
                  value={token}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="Paste your Notion integration token"
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
              </label>
              <div>
                <button className="op-button" disabled={!!busy || !token.trim()}>
                  {busy === "connect" ? <Busy /> : <KeyRound size={13} />}Save connection
                </button>
                {changeToken && (
                  <button
                    type="button"
                    className="op-text-link"
                    onClick={() => {
                      setChangeToken(false);
                      setToken("");
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
          <form
            className="cortex-notion-import"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("notion");
              setError("");
              try {
                const result = await operatorRequest<{
                  source?: { title?: string };
                  updated?: boolean;
                  unchanged?: boolean;
                }>("/memory/import-notion", { url: notionUrl, collection });
                const name = result.source?.title ? `“${result.source.title}”` : "Notion page";
                onImported(
                  result.unchanged
                    ? `${name} is already current.`
                    : result.updated
                      ? `${name} refreshed in memory.`
                      : `${name} added to memory.`,
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <label>
              Notion page URL
              <input
                type="url"
                aria-label="Notion page URL"
                placeholder="https://www.notion.so/…"
                value={notionUrl}
                onChange={(e) => setNotionUrl(e.target.value)}
                required
                disabled={!!busy}
              />
            </label>
            <p className="op-form-help">
              The page must be shared with your integration. Imports are snapshots; import it again
              to refresh its text.
            </p>
            <div className="cortex-import-footer">
              <CollectionField value={collection} onChange={onCollectionChange} />
              <button
                className="op-button primary"
                disabled={!!busy || !configured || !notionUrl.trim()}
              >
                {busy === "notion" ? <Busy /> : <Import size={14} />}Import page
              </button>
            </div>
          </form>
          <button
            type="button"
            className="op-text-link cortex-notion-export"
            onClick={onExportUpload}
          >
            Have an export? Upload a Markdown or HTML file
          </button>
        </>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
function CollectionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { state } = useOperator();
  const spaces = memorySpaces(state);
  return (
    <label className="cortex-collection-field">
      Knowledge space
      <select
        aria-label="Import knowledge space"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {spaces.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
