import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, RefreshCw, Check, Loader2 } from "lucide-react";
import { openConnectionSignIn, operatorRequest, type McpStatus } from "@/lib/operator";
import { useBusinessWorkspace, type AudiencePlatform } from "@/lib/business-workspace";
import { AudienceLogo } from "./audience-panel";
import "./connections-polish.css";

type Provider = "mercury" | "stripe" | AudiencePlatform;
export function BusinessLogo({ provider }: { provider: Provider }) {
  if (provider !== "mercury" && provider !== "stripe")
    return (
      <span className="biz-connect-logo">
        <AudienceLogo platform={provider} />
      </span>
    );
  return (
    <img
      className={`biz-connect-logo is-${provider}`}
      src={`/business-sources/${provider}.svg`}
      alt={provider === "mercury" ? "Mercury" : "Stripe"}
      width={36}
      height={36}
    />
  );
}
export function openBusinessAccounts() {
  window.dispatchEvent(new CustomEvent("agentic:accounts", { detail: { group: "business" } }));
}
export function BusinessConnections() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "connections" || params.has("connections")) {
      const timer = window.setTimeout(openBusinessAccounts, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);
  return (
    <button
      type="button"
      className="biz-connect-accounts"
      onClick={openBusinessAccounts}
      aria-haspopup="dialog"
    >
      <span className="biz-connect-logo-row" aria-hidden="true">
        <BusinessLogo provider="mercury" />
        <BusinessLogo provider="youtube" />
        <BusinessLogo provider="instagram" />
      </span>
      <span>Connect accounts</span>
    </button>
  );
}

export function ConnectionsPanel() {
  const workspace = useBusinessWorkspace();
  const qc = useQueryClient();
  const [channelInput, setChannelInput] = useState("");
  const [editingChannel, setEditingChannel] = useState(false);
  const native = useQuery<{ mercury: { available: boolean } }>({
    queryKey: ["business-native-connections"],
    queryFn: () => operatorRequest("/business/native-connections"),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const mcp = useQuery<McpStatus>({
    queryKey: ["mcp-status"],
    queryFn: () => operatorRequest("/mcp/status"),
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const status = useQuery<{
    integrations: Array<{
      id: string;
      configured: boolean;
      keyConfigured?: boolean;
      channelId?: string;
    }>;
  }>({
    queryKey: ["business-integrations"],
    queryFn: () => operatorRequest("/business/integrations"),
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const youtube = status.data?.integrations.find((item) => item.id === "youtube");
  useEffect(() => {
    if (youtube?.channelId)
      setChannelInput((value) => value || `https://www.youtube.com/channel/${youtube.channelId}`);
  }, [youtube?.channelId]);
  const snapshots = workspace.data?.snapshots || [];
  const latest = (id: string) =>
    snapshots
      .filter((snapshot) => snapshot.platform === id)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const ready = (id: string) =>
    status.data?.integrations.some((item) => item.id === id && item.configured);
  const stamp = (value?: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : "";
  async function sync(provider: string) {
    setBusy(provider);
    setNotice("");
    setError("");
    try {
      await operatorRequest("/business/sync", { provider });
      await workspace.refresh();
      await status.refetch();
      if (provider === "youtube") {
        try {
          const content = await operatorRequest<{ videos: unknown[] }>(
            "/business/content/sync",
            {},
          );
          await qc.invalidateQueries({ queryKey: ["business-content"] });
          setNotice(`YouTube numbers and ${content.videos.length} recent videos updated.`);
        } catch (cause) {
          setNotice("YouTube numbers updated.");
          setError(`Recent videos could not refresh. ${(cause as Error).message}`);
        }
      } else setNotice("Numbers updated.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function connectYouTube() {
    if (!channelInput.trim() || busy) return;
    setBusy("youtube");
    setNotice("");
    setError("");
    try {
      const result = await operatorRequest<{
        channel: { id: string; title: string; url: string };
        numbersSynced: boolean;
        videosSynced: boolean;
        videoCount: number;
        warning?: string;
      }>("/business/youtube/channel", { channel: channelInput.trim() });
      await workspace.refresh();
      await status.refetch();
      await qc.invalidateQueries({ queryKey: ["business-content"] });
      setChannelInput(result.channel.url);
      setEditingChannel(false);
      setNotice(
        `${result.channel.title} connected.${result.numbersSynced ? " Numbers updated." : ""}${result.videosSynced ? ` ${result.videoCount} recent videos loaded.` : ""}`,
      );
      if (result.warning) setError(result.warning);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function refreshMercury() {
    if (busy) return;
    setBusy("mercury"); setError(""); setNotice("");
    try {
      const result = await operatorRequest<{ accounts: number }>("/business/mercury/sync", {});
      await workspace.refresh();
      setNotice(`${result.accounts} Mercury account balances refreshed.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  }
  async function connectMercury() {
    if (busy) return;
    setBusy("mercury-connection"); setError(""); setNotice("");
    try {
      await openConnectionSignIn("mercury");
      setNotice("Finish signing in to Mercury in the new tab, then come back here.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  }
  async function disconnectMercury() {
    if (busy) return;
    setBusy("mercury-connection"); setError(""); setNotice("");
    try {
      await operatorRequest("/mcp/disconnect", { provider: "mercury" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["mcp-status"] }), qc.invalidateQueries({ queryKey: ["business-native-connections"] })]);
      setNotice("Mercury disconnected.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  }
  const audienceLink = (platform: string, record = false) =>
    `/business?view=audience&platform=${platform}${record ? "&record=1" : ""}`;
  const readyCount = (status.data?.integrations.filter((item) => item.configured).length || 0) + Number(!!native.data?.mercury.available);
  return (
    <div className="biz-connections-body">
      <div className="biz-connections-summary">
        <span className={readyCount ? "ready" : ""}>
          {status.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </span>
        <div>
          <strong>
            {status.isPending
              ? "Finding your existing connections"
              : status.isError
                ? "Connection status unavailable"
                : readyCount
                  ? `${readyCount} connections ready to use`
                  : "Start with your everyday tools"}
          </strong>
          <p>
            {status.isError
              ? "Retry to check what’s available on this Mac."
              : "Use the accounts you already have. Add more whenever you need them."}
          </p>
        </div>
        {status.isError && (
          <button
            type="button"
            className="biz-provider-action"
            onClick={() => void status.refetch()}
          >
            Retry
          </button>
        )}
      </div>
      {error && (
        <p className="biz-connection-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="biz-connection-notice" role="status">
          <Check size={13} />
          {notice}
        </p>
      )}
      <section className="biz-provider-group" aria-label="Money accounts">
        <h3>Money</h3>
        <div className="biz-provider-list">
          <div className="biz-provider-row" aria-label="Mercury">
            <BusinessLogo provider="mercury" />
            <div className="biz-provider-identity">
              <strong>Mercury</strong>
              <span>
                {native.isPending ? "Checking Mercury…" : native.isError ? "Mercury couldn’t be checked" : native.data?.mercury.available
                  ? workspace.data?.finances ? `Balances saved · ${stamp(workspace.data.finances.recordedAt)}` : "Read your current account balances"
                  : "Connect Mercury to read balances and income"}
              </span>
            </div>
            <span className="biz-provider-status is-snapshot">{native.data?.mercury.available ? "Connected" : workspace.data?.finances ? "Saved snapshot" : "Not connected"}</span>
            <span className="biz-provider-actions">
              <button type="button" className="biz-provider-action" disabled={!!busy || mcp.isPending} onClick={() => void (mcp.data?.mercury.connected ? disconnectMercury() : connectMercury())}>
                {busy === "mercury-connection" && <Loader2 size={12} className="animate-spin" />}
                {mcp.data?.mercury.connected ? "Disconnect" : "Connect Mercury"}
              </button>
              {mcp.data?.mercury.connected && (
                <button type="button" className="biz-provider-action" disabled={!!busy || native.isFetching} onClick={() => native.data?.mercury.available ? void refreshMercury() : void native.refetch()}>
                  {busy === "mercury" || native.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {busy === "mercury" ? "Refreshing…" : native.data?.mercury.available ? "Refresh balances" : "Recheck"}
                </button>
              )}
            </span>
          </div>
          <div className="biz-provider-row" aria-label="Stripe">
            <BusinessLogo provider="stripe" />
            <div className="biz-provider-identity">
              <strong>Stripe</strong>
              <span>Payments and subscriptions</span>
            </div>
            <span className="biz-provider-status">Sync not available</span>
            <a
              className="biz-provider-action"
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noreferrer"
            >
              Open Stripe
              <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
      </section>
      <section className="biz-provider-group" aria-label="Audience accounts">
        <h3>Audience</h3>
        <div className="biz-provider-list">
          {(
            [
              {
                id: "youtube",
                name: "YouTube",
                description: "Channel totals and your latest videos",
              },
              { id: "linkedin", name: "LinkedIn", description: "Followers and growth history" },
              { id: "instagram", name: "Instagram", description: "Followers, views and activity" },
              { id: "tiktok", name: "TikTok", description: "Followers, views and activity" },
            ] as const
          ).map((source) => {
            const previous = latest(source.id),
              reusable = ready(source.id);
            return (
              <div className="biz-provider-entry" key={source.id}>
                <div className="biz-provider-row" aria-label={source.name}>
                  <BusinessLogo provider={source.id} />
                  <div className="biz-provider-identity">
                    <strong>{source.name}</strong>
                    <span>
                      {previous
                        ? `Last observation · ${stamp(previous.recordedAt)}`
                        : source.description}
                    </span>
                    {source.id === "youtube" && reusable && (
                      <button
                        type="button"
                        className="biz-youtube-edit"
                        onClick={() => setEditingChannel((value) => !value)}
                        aria-expanded={editingChannel}
                      >
                        {editingChannel ? "Cancel" : "Change channel"}
                      </button>
                    )}
                  </div>
                  <span
                    className={`biz-provider-status${reusable ? " is-ready" : previous ? " is-snapshot" : ""}`}
                  >
                    {reusable
                      ? "Ready to refresh"
                      : source.id === "youtube" && youtube?.keyConfigured
                        ? "Choose your channel"
                        : previous
                          ? "Imported history"
                          : "Not connected"}
                  </span>
                  {reusable ? (
                    <button
                      type="button"
                      className="biz-provider-action"
                      disabled={!!busy}
                      onClick={() => void sync(source.id)}
                    >
                      <RefreshCw size={12} className={busy === source.id ? "animate-spin" : ""} />
                      {busy === source.id ? "Refreshing…" : "Refresh"}
                    </button>
                  ) : (
                    source.id !== "youtube" && (
                      <a className="biz-provider-action" href={audienceLink(source.id, !previous)}>
                        {previous ? "View history" : "Add numbers"}
                        <ArrowUpRight size={12} />
                      </a>
                    )
                  )}
                </div>
                {source.id === "youtube" && (!reusable || editingChannel) && (
                  <form
                    className="biz-youtube-channel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connectYouTube();
                    }}
                  >
                    <label htmlFor="biz-youtube-channel-input">Your YouTube channel</label>
                    <p>
                      {youtube?.keyConfigured
                        ? "Your API connection is ready. Choose a channel to load its numbers and recent videos."
                        : "Add a YouTube API key in ~/.config/agentic-os.env, then check connections again. Your key stays on this Mac."}
                    </p>
                    <div>
                      <input
                        id="biz-youtube-channel-input"
                        value={channelInput}
                        onChange={(event) => setChannelInput(event.target.value)}
                        placeholder="youtube.com/@yourchannel"
                        maxLength={2048}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={!!busy}
                      />
                      <button
                        type="submit"
                        className="biz-provider-action"
                        disabled={!youtube?.keyConfigured || !channelInput.trim() || !!busy}
                      >
                        {busy === "youtube" ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            Loading channel…
                          </>
                        ) : (
                          "Connect & load videos"
                        )}
                      </button>
                    </div>
                    {!youtube?.keyConfigured && (
                      <button
                        className="biz-youtube-edit"
                        type="button"
                        disabled={status.isFetching}
                        onClick={() => void status.refetch()}
                      >
                        Check connections again
                      </button>
                    )}
                    {previous && (
                      <a className="biz-youtube-history" href={audienceLink(source.id)}>
                        View saved history <ArrowUpRight size={11} />
                      </a>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <details className="biz-assistant-imports">
        <summary>
          Already connected in Claude or ChatGPT?
          <ChevronDown size={13} />
        </summary>
        <p>
          Your assistant can bring dated snapshots into this workspace. YouTube can refresh
          directly here using the connection already configured on this Mac.
        </p>
        <p>
          Account sign-ins stay in the app where you connected them. CSV and manual imports are
          available for your other channels.
        </p>
      </details>
    </div>
  );
}
