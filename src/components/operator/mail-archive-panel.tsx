import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import { operatorRequest, type InboxItem } from "@/lib/operator";
import { Modal, Notice } from "./ui";
import { ProviderLogo, AccountConnections } from "./account-connections";
import "./mail-archive-panel.css";

type Status = {
  total: number;
  storage: string;
  fullBodies: number;
  metadata: number;
  cache: { count: number; bytes: number; budgetBytes: number; ttlDays: number };
  accounts: {
    provider: string;
    account: string;
    count: number;
    status: string;
    enumerated: number;
    error?: string;
  }[];
};
type Results = { items: InboxItem[]; total: number; hasMore: boolean; bounded?: boolean };
export function MailArchivePanel() {
  const [open, setOpen] = useState(false),
    [input, setInput] = useState(""),
    [query, setQuery] = useState("");
  const [provider, setProvider] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState("");
  const [syncError, setSyncError] = useState(""), [syncBusy, setSyncBusy] = useState(false);
  const [searchMode, setSearchMode] = useState<"local" | "live">("local"), [liveQuery, setLiveQuery] = useState("");
  const status = useQuery<Status>({
    queryKey: ["mail-archive-status"],
    queryFn: () => operatorRequest("/mail-archive/status"),
    refetchInterval: (q) =>
      q.state.data?.accounts.some((a) => a.status === "importing") ? 5000 : 30000,
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [input]);
  const localResult = useQuery<Results>({
    queryKey: ["mail-archive", query, provider, offset, status.data?.total],
    queryFn: () =>
      operatorRequest(
        `/mail-archive/search?${new URLSearchParams({ q: query, provider, offset: String(offset), limit: "30" })}`,
      ),
    enabled: open && searchMode === "local",
  });
  const liveResult = useQuery<Results>({
    queryKey: ["mail-provider-search", provider, liveQuery],
    queryFn: () => operatorRequest("/mail-archive/provider-search", { provider, query: liveQuery, limit: 30 }),
    enabled: open && searchMode === "live" && !!provider && !!liveQuery,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const result = searchMode === "live" ? liveResult : localResult;
  const message = useQuery<{ item: InboxItem }>({
    queryKey: ["archived-message", selected],
    queryFn: () => operatorRequest(`/mail-archive/message?id=${encodeURIComponent(selected)}`),
    enabled: open && !!selected,
    retry: false,
  });
  const importing = status.data?.accounts.some((account) => account.status === "importing"),
    item = message.data?.item;
  const incomplete = status.data?.accounts.some(account => account.status !== "complete");
  const blocked = status.data?.accounts.some(account => account.status === "needs-attention");
  async function control(account: Pick<Status["accounts"][number], "provider" | "status">) {
    setSyncBusy(true); setSyncError("");
    try { await operatorRequest(account.status === "importing" ? "/mail-archive/pause" : "/mail-archive/sync", { provider: account.provider }); await status.refetch(); }
    catch (error) { setSyncError((error as Error).message); }
    finally { await status.refetch(); setSyncBusy(false); }
  }
  return (
    <>
      <button className="ma-archive-launch" onClick={() => setOpen(true)}>
        <span className="ma-archive-logos">
          <ProviderLogo provider="google" />
          <ProviderLogo provider="outlook" />
        </span>
        <span>
          Email library
          <small>
            {status.data?.total.toLocaleString() || "0"} emails indexed locally
            {importing ? " · indexing" : blocked ? " · index needs attention" : incomplete ? " · index incomplete" : ""}
          </small>
        </span>
        <Search size={17} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Your email library"
        description="Search saved mail or your provider. New email bodies load when you open them."
      >
        <div className="ma-library">
          <div className="ma-library-status">
            <Database size={15} />
            <span>
              {status.data?.total.toLocaleString() || "0"} emails
              {importing ? " · indexing metadata" : blocked ? " · index needs attention" : incomplete ? " · index incomplete" : ""}
            </span>
            <details>
              <summary>Storage</summary>
              <p>
                {status.data?.fullBodies?.toLocaleString() || "0"} existing full emails preserved. {status.data?.metadata?.toLocaleString() || "0"} metadata entries. New indexing saves headers and snippets.
              </p>
              <p>{status.data?.cache?.count || "0"} recently opened bodies cached ({((status.data?.cache?.bytes || 0) / 1048576).toFixed(1)} MB / 100 MB). Cache expires after seven days. Attachments are not downloaded. Existing full emails are outside this cache budget.</p>
              {status.data?.accounts.map((account) => (
                <p key={account.provider + account.account}>
                  {account.account}: {account.count.toLocaleString()} saved
                  {account.status === "complete"
                    ? " · index complete at last run"
                    : account.error
                      ? ` · ${account.error}`
                      : account.status === "paused" ? " · paused" : " · indexing"}
                </p>
              ))}
            </details>
          </div>
          <div className="ma-import-controls"><span>Index headers and snippets from a connected account. Bodies stay with your provider until opened.</span><div>{["gmail", "outlook"].map(provider => { const account = status.data?.accounts.find(account => account.provider === provider && account.status === "importing") || { provider, status: "paused" }; return <button disabled={syncBusy} key={provider} onClick={() => void control(account)}><ProviderLogo provider={provider}/>{account.status === "importing" ? "Pause index" : `Index ${provider === "gmail" ? "Gmail" : "Outlook"}`}</button>; })}<AccountConnections compact messages/></div></div>
          {status.error && <Notice error>{status.error.message}</Notice>}
          {syncError && <Notice error>{syncError}</Notice>}
          {selected ? (
            <div className="ma-message">
              <button className="ma-back" onClick={() => setSelected("")}>
                <ArrowLeft size={16} /> All mail
              </button>
              {message.isLoading ? (
                <p role="status">Opening email…</p>
              ) : message.error ? (
                <Notice error>{message.error.message}</Notice>
              ) : (
                item && (
                  <>
                    <div className="ma-message-heading">
                      <ProviderLogo provider={item.source} />
                      <h3>{item.subject}</h3>
                    </div>
                    <p className="ma-message-from">
                      {item.from}
                      <br />
                      {new Date(item.receivedAt).toLocaleString()}
                    </p>
                    {item.url && /^https:\/\//.test(item.url) && (
                      <a className="ma-original" href={item.url} target="_blank" rel="noreferrer">
                        Open original <ArrowUpRight size={14} />
                      </a>
                    )}
                    <div className="ma-message-body">{item.body}</div>
                    <p className="op-form-help">{item.bodyStatus === "cached" ? "Fetched on demand. This cached body expires after seven days." : "Preserved from your existing local archive."}</p>
                  </>
                )
              )}
            </div>
          ) : (
            <>
              <div className="ma-filters" aria-label="Mail search source">
                <button aria-pressed={searchMode === "local"} onClick={() => { setSearchMode("local"); setOffset(0); }}>Saved mail</button>
                <button aria-pressed={searchMode === "live"} onClick={() => { setSearchMode("live"); setProvider(provider || "gmail"); setOffset(0); }}>Search provider</button>
              </div>
              <div className="ma-search">
                <Search size={18} />
                <input
                  aria-label={searchMode === "live" ? "Search your email provider" : "Search saved emails"}
                  placeholder={searchMode === "live" ? "Search Gmail or Outlook…" : "Find a person, idea or conversation…"}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => { if (searchMode === "live" && event.key === "Enter" && input.trim()) { if (liveQuery === input.trim()) void liveResult.refetch(); else setLiveQuery(input.trim()); } }}
                />
                {searchMode === "live" && <button disabled={!input.trim() || result.isFetching} onClick={() => { if (liveQuery === input.trim()) void liveResult.refetch(); else setLiveQuery(input.trim()); }}>Search</button>}
              </div>
              <p className="op-form-help">{searchMode === "live" ? "Up to 30 provider matches per search. Narrow the query for more results. This is not an exhaustive mailbox search result or semantic search." : "Searches preserved full emails and indexed snippets. Use provider search for mail that is not saved here."}</p>
              <div className="ma-filters">
                {[
                  ["", "All mail"],
                  ["gmail", "Gmail"],
                  ["outlook", "Outlook"],
                ].filter(([value]) => searchMode === "local" || value).map(([value, name]) => (
                  <button
                    key={value}
                    aria-pressed={provider === value}
                    onClick={() => {
                      setProvider(value);
                      setOffset(0);
                      setLiveQuery("");
                    }}
                  >
                    {value && <ProviderLogo provider={value} />} {name}
                  </button>
                ))}
                <span>{result.data?.total.toLocaleString() || "0"} results</span>
              </div>
              {result.error && <Notice error>{result.error.message}</Notice>}
              <div className="ma-results" aria-busy={result.isFetching}>
                {result.isLoading ? (
                  <p role="status">Searching your mail…</p>
                ) : result.data?.items.length ? (
                  result.data.items.map((email) => (
                    <button
                      className="ma-result"
                      key={email.id}
                      onClick={() => setSelected(email.id)}
                    >
                      <ProviderLogo provider={email.source} />
                      <span>
                        <strong>{email.subject}</strong>
                        <small>{email.from} · {email.bodyStatus === "metadata" ? "Snippet" : "Saved full email"}</small>
                        <p>{email.body.slice(0, 140)}</p>
                      </span>
                      <time>
                        {new Date(email.receivedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </time>
                    </button>
                  ))
                ) : (
                  <p className="ma-empty">
                    {searchMode === "live" && !liveQuery ? "Enter a query and search your connected provider." : input
                      ? "No matches yet. Try another word or name."
                      : "Indexed emails will appear here."}
                  </p>
                )}
              </div>
              {searchMode === "local" && <div className="ma-pagination">
                <span>
                  {result.data?.total
                    ? `${offset + 1}–${offset + result.data.items.length} of ${result.data.total.toLocaleString()}`
                    : ""}
                </span>
                <button
                  aria-label="Previous page"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 30))}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Next page"
                  disabled={!result.data?.hasMore}
                  onClick={() => setOffset(offset + 30)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
