import { useEffect, useState } from "react";
import "./account-connection-access.css";
import { useQuery } from "@tanstack/react-query";
import { Plug, RefreshCw, ArrowUpRight, ChevronLeft } from "lucide-react";
import gmailLogo from "@/assets/logos/gmail.svg";
import calendarLogo from "@/assets/logos/googlecalendar.svg";
import { askOperator, operatorRequest, useOperator } from "@/lib/operator";
import { Notice, Busy } from "./ui";
import { NativeCalendarConnection } from "./native-calendar-connection";
export type NativeConnection = { id: string; name: string; available: boolean; enabled?: boolean; account?: string; workspace?: string; lastSync?: string; count?: number; error?: string };
export function useNativeConnections() {
  return useQuery<{ providers: NativeConnection[]; error?: string; readOnly: boolean }>({ queryKey: ["native-connections"], queryFn: () => operatorRequest("/native-connections"), retry: false, staleTime: 60000, refetchOnWindowFocus: false });
}
export function ExistingConnectionsPanel() {
  const discovery = useNativeConnections();
  const { refresh } = useOperator();
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = discovery.data?.providers || [];
  const chosen = selected ?? providers.filter(p => p.enabled).map(p => p.id);
  async function sync() {
    setBusy(true); setNotice("");
    try {
      const result = await operatorRequest<{ messages: number; results: Array<{ provider: string; ok: boolean; error?: string }> }>("/native-connections/sync", { providers: chosen, replaceSelection: true });
      const errors = result.results.filter(r => !r.ok).map(r => r.error).join(" ");
      setNotice(chosen.length ? `${result.messages} recent messages refreshed.${errors ? ` ${errors}` : ""}` : "Selection saved. Automatic refresh is off.");
      await refresh(); await discovery.refetch();
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="ar-existing-connections" aria-label="Connected accounts">
    <header className="ar-existing-heading"><div><h3>Your connected accounts</h3><p>Bring recent messages into your OS.</p></div></header>
    {discovery.isPending ? <p role="status"><Busy/> Finding your accounts…</p> : <div className="ar-existing-apps ar-existing-selection">{providers.map(app => <label className={chosen.includes(app.id) ? "is-selected" : ""} key={app.id}><input type="checkbox" checked={chosen.includes(app.id)} disabled={busy || !app.available && !app.enabled} onChange={e => setSelected(e.target.checked ? [...chosen, app.id] : chosen.filter(id => id !== app.id))}/><ProviderLogo provider={app.id}/><span><strong>{app.name}{app.workspace ? ` · ${app.workspace}` : ""}</strong><small>{app.available ? app.lastSync ? `Refreshed ${new Date(app.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${app.count || 0} recent messages` : "Ready" : "Sign in below to use here"}</small>{app.account && <small>{app.account}</small>}</span></label>)}</div>}
    <div className="ar-existing-actions"><button type="button" className="op-button" disabled={busy || discovery.isPending || !chosen.length && selected === null} onClick={() => void sync()}>{busy ? "Refreshing messages…" : chosen.length ? "Refresh selected accounts" : "Save selection"}</button><button type="button" className="op-text-link" disabled={discovery.isFetching || busy} onClick={() => void discovery.refetch()}>Check connections</button></div>
    <p className="ar-existing-footnote">Recent mail and Slack messages refresh when you open Inbox and each minute while it is visible. Open the original message to reply.</p>
    <NativeCalendarConnection />
    <details className="ar-native-details"><summary>Claude and other connections</summary><p>Claude can use its own connected tools in Chat. Inbox refresh uses the accounts you sign in to below.</p></details>
    {discovery.data?.error && <Notice>{discovery.data.error}</Notice>}
    {discovery.error && <Notice>{discovery.error.message}</Notice>}
    {providers.filter(app => app.error).map(app => <Notice key={app.id}>{app.name}: {app.error}</Notice>)}
    {notice && <Notice>{notice}</Notice>}
  </section>;
}
export function ProviderLogo({ provider }: { provider: string }) {
  return provider === "slack" ? (
    <svg className="ar-provider-logo" role="img" aria-label="Slack" viewBox="0 0 24 24">
      <g fill="#36c5f0">
        <rect x="2" y="8" width="9" height="4" rx="2" />
        <rect x="7" y="2" width="4" height="5" rx="2" />
      </g>
      <g fill="#2eb67d">
        <rect x="12" y="2" width="4" height="9" rx="2" />
        <rect x="17" y="7" width="5" height="4" rx="2" />
      </g>
      <g fill="#ecb22e">
        <rect x="13" y="12" width="9" height="4" rx="2" />
        <rect x="13" y="17" width="4" height="5" rx="2" />
      </g>
      <g fill="#e01e5a">
        <rect x="8" y="13" width="4" height="9" rx="2" />
        <rect x="2" y="13" width="5" height="4" rx="2" />
      </g>
    </svg>
  ) : provider === "google" || provider === "gmail" ? (
    <img className="ar-provider-logo" src={gmailLogo} alt="Gmail" />
  ) : provider === "calendar" ? (
    <img className="ar-provider-logo" src={calendarLogo} alt="Google Calendar" />
  ) : provider === "cal" ? (
    <span className="ar-cal-logo">Cal.</span>
  ) : (
    <svg className="ar-provider-logo" role="img" aria-label="Outlook" viewBox="0 0 32 32">
      <rect x="11" y="3" width="19" height="25" rx="3" fill="#1490df" />
      <path d="M11 13h19v15H11z" fill="#0078d4" />
      <path d="m11 13 10 8 9-8" fill="#50b6ed" />
      <rect x="1" y="8" width="17" height="18" rx="2" fill="#0364b8" />
      <text
        x="9.5"
        y="21"
        textAnchor="middle"
        fill="white"
        fontSize="13"
        fontFamily="Arial"
        fontWeight="bold"
      >
        O
      </text>
    </svg>
  );
}
export type AccountStatus = {
  capabilities?: { modify: boolean; send: boolean; drafts: boolean; labels: boolean; calendarCreate?: boolean };
  id: string;
  configured: boolean;
  connected: boolean;
  calendarAccess?: "granted" | "missing" | "unknown" | "disconnected";
  email?: string;
  lastSync?: string;
  channel?: string;
  error?: string;
  redirectUri: string;
  detectedWorkspaces?: Array<{ id: string; name: string; url: string }>;
  calendarCoverage?: {
    timeMin: string;
    timeMax: string;
    syncedAt: string;
    calendarCount: number;
    eventCount: number;
    calendars: Array<{ id: string; name: string }>;
    complete: boolean;
  };
};
export function useAccounts() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return useQuery<{
    accounts: AccountStatus[];
    eventTypes: any[];
    schedules: any[];
    calUsername?: string;
  }>({
    queryKey: ["operator-accounts"],
    enabled: ready,
    queryFn: () => operatorRequest("/connections"),
    refetchInterval: 30000,
  });
}
const names: Record<string, string> = {
  google: "Gmail & Google Calendar",
  outlook: "Outlook & Calendar",
  cal: "Cal.com",
  slack: "Slack",
};
type AccountConnectionsProps = {
  financial?: boolean;
  compact?: boolean;
  only?: string;
  label?: string;
  messages?: boolean;
  calendarOnly?: boolean;
};
let openedConnectionQuery = "";
function openAccountHub(group: "work" | "business") {
  window.dispatchEvent(new CustomEvent("agentic:accounts", { detail: { group } }));
}
/** All entry points open the one account hub mounted by the application shell. */
export function AccountConnections({
  financial = false,
  compact = false,
  only,
  label,
  messages = false,
  calendarOnly = false,
}: AccountConnectionsProps) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connections") && !params.has("connected")) return;
    const key = window.location.pathname + window.location.search;
    const timer = window.setTimeout(() => {
      if (openedConnectionQuery === key) return;
      openedConnectionQuery = key;
      openAccountHub(params.has("connected") ? "work" : financial ? "business" : "work");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [financial]);
  const buttonLabel =
    label || (only === "cal" ? "Connect Cal.com" : compact ? "Connect accounts" : "Connections");
  return (
    <button
      type="button"
      className={compact ? "ar-account-compact" : "op-button"}
      aria-label={buttonLabel}
      onClick={() => openAccountHub(financial ? "business" : "work")}
    >
      {compact ? (
        <>
          <ProviderLogo provider={calendarOnly ? "calendar" : "google"} />
          <ProviderLogo provider="outlook" />
          {messages && <ProviderLogo provider="slack" />}
        </>
      ) : (
        <Plug size={14} />
      )}
      <span>{buttonLabel}</span>
    </button>
  );
}
/** Inline work account settings. The global account hub owns its dialog and navigation. */
export function WorkAccountConnectionsPanel({
  guided = false,
  providers,
  onAssistantHelp,
  directProvider,
  onBack,
}: {
  guided?: boolean;
  providers?: string[];
  onAssistantHelp?: () => void;
  directProvider?: string;
  onBack?: () => void;
} = {}) {
  const [setup, setSetup] = useState(""),
    [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [channel, setChannel] = useState(""),
    [slackWorkspace, setSlackWorkspace] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [mailAccess, setMailAccess] = useState(!guided);
  const { data, refetch } = useAccounts(),
    { state, refresh } = useOperator();
  const snapshotFor = (provider: string) =>
    state.inboxImports
      ?.filter((s) => s.provider === (provider === "google" ? "gmail" : provider))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  const slackHints = data?.accounts.find((a) => a.id === "slack")?.detectedWorkspaces || [];
  const selectedSlack = slackHints.find((workspace) => workspace.id === slackWorkspace);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("connected"))
      setNotice("Account authorized. Choose Sync to bring in recent mail and events.");
    if (url.searchParams.has("connected") || url.searchParams.has("connections")) {
      url.searchParams.delete("connected");
      url.searchParams.delete("connections");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);
  async function action(path: string, provider: string, extra: any = {}) {
    if (path === "start" && ["google", "outlook"].includes(provider)) {
      const uri = data?.accounts.find((a) => a.id === provider)?.redirectUri;
      if (uri && window.location.origin !== new URL(uri).origin) {
        window.location.assign(`${new URL(uri).origin}/inbox?connections=1`);
        return true;
      }
    }
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const r = await operatorRequest("/connections/" + path, { provider, ...extra });
      await refetch();
      await refresh();
      if (r.url) window.location.assign(r.url);
      if (path === "sync")
        setNotice(
          `Updated ${r.messages} messages${provider === "slack" ? "" : ` and ${r.events} events`}.${r.calendarWarning ? ` ${r.calendarWarning}` : ""}${r.limited ? (provider === "slack" ? " Showing the latest 15 Slack messages from the past week." : " More messages are available in the source account.") : ""}`,
        );
      if (path === "configure") {
        setSetup("");
        setSecret("");
        setClientId("");
        if (provider !== "cal" && provider !== "slack") {
          const start = await operatorRequest("/connections/start", {
            provider,
            ...(provider === "google" && mailAccess ? { access: "mail" } : {}),
          });
          window.location.assign(start.url);
        }
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  function connect(a: AccountStatus) {
    // OAuth state cookies must use the same loopback host as the registered callback.
    const callbackOrigin = new URL(a.redirectUri).origin;
    if (a.id !== "cal" && a.id !== "slack" && window.location.origin !== callbackOrigin) {
      window.location.assign(`${callbackOrigin}/inbox?connections=1`);
      return;
    }
    setSetup(a.id);
    setClientId("");
    setSecret("");
    setChannel(a.channel || "");
    setSlackWorkspace(a.detectedWorkspaces?.[0]?.id || "");
    setAdvanced(a.id !== "slack");
  }
  if (directProvider) {
    const account = data?.accounts.find((item) => item.id === directProvider);
    const google = directProvider === "google";
    const oauth = ["google", "outlook"].includes(directProvider);
    const configured = !!account?.configured;
    const connected = !!account?.connected;
    const importClient = async (file?: File) => {
      if (!file) return;
      setError("");
      try {
        if (file.size > 128 * 1024)
          throw new Error("Choose the small OAuth client JSON file downloaded from Google Cloud.");
        const parsed = JSON.parse(await file.text());
        const client = parsed.web;
        if (!client?.client_id || !client?.client_secret)
          throw new Error("Choose a Web application OAuth client file from Google Cloud.");
        if (account?.redirectUri && !client.redirect_uris?.includes(account.redirectUri))
          throw new Error(
            `Add the callback address shown below to this Google client, then download its JSON again.`,
          );
        setClientId(client.client_id);
        setSecret(client.client_secret);
        setNotice("Connection file ready. Continue to Google to choose your account.");
      } catch (error) {
        setClientId("");
        setSecret("");
        setError(
          error instanceof SyntaxError
            ? "This is not a valid Google connection JSON file."
            : (error as Error).message,
        );
      }
    };
    return (
      <section
        className="ar-work-account-panel ar-account-direct"
        aria-label={`${names[directProvider]} connection`}
      >
        <ExistingConnectionsPanel />
        <button type="button" className="op-text-link" onClick={onBack}>
          <ChevronLeft size={13} /> Back to sources
        </button>
        <div className="ar-direct-heading">
          <ProviderLogo provider={directProvider} />
          <div>
            <h3>{names[directProvider]}</h3>
            <p>
              {connected
                ? account.email || "Connected"
                : configured
                  ? "Ready to sign in"
                  : oauth
                    ? "One-time connection setup"
                    : "Connect your account"}
            </p>
          </div>
        </div>
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {!data ? (
          <p className="op-form-help">
            <Busy /> Checking connection…
          </p>
        ) : connected ? (
          <>
            <p className="op-form-help">
              {account.lastSync
                ? `Last updated ${new Date(account.lastSync).toLocaleString()}.`
                : "Your account is connected. Sync to bring in the data you have allowed."}
            </p>
            {oauth && account.calendarAccess !== "granted" && <p className="op-form-help">{account.calendarAccess === "missing" ? "Calendar access is missing. Reconnect and allow calendar access." : "Calendar access has not been verified."}</p>}
            <div className="ar-direct-actions">
              {oauth && account.calendarAccess !== "granted" && <button className="op-button" disabled={!!busy} onClick={() => void action("start", directProvider)}>Reconnect calendar</button>}
              <button
                className="op-button primary"
                disabled={!!busy}
                onClick={() => void action("sync", directProvider)}
              >
                {busy ? <Busy /> : <RefreshCw size={14} />} Sync now
              </button>
              <button
                className="op-text-link"
                disabled={!!busy}
                onClick={() => void action("disconnect", directProvider)}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : configured && oauth ? (
          <>
            <p className="op-form-help">
              Sign in to choose the account whose email and calendar you want in memory.
            </p>
            <button
              className="op-button primary"
              disabled={!!busy}
              onClick={() => void action("start", directProvider)}
            >
              {busy ? <Busy /> : <Plug size={14} />} Sign in with {google ? "Google" : "Microsoft"}
            </button>
          </>
        ) : (
          <form
            className="op-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action(
                "configure",
                directProvider,
                oauth ? { clientId, clientSecret: secret } : { apiKey: secret },
              );
            }}
          >
            {oauth ? (
              <>
                <p className="op-form-help">
                  This local copy needs a {google ? "Google" : "Microsoft"} app connection before
                  you can sign in. Set it up once; your account can then sync from here.
                </p>
                {google && (
                  <label
                    className="ar-client-drop"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void importClient(event.dataTransfer.files[0]);
                    }}
                  >
                    <span>
                      {clientId && secret
                        ? "Connection file added"
                        : "Drop your Google connection file"}
                    </span>
                    <small>
                      {clientId && secret
                        ? "Ready to sign in"
                        : "OAuth client JSON · or click to choose"}
                    </small>
                    <input
                      type="file"
                      accept=".json,application/json"
                      aria-label="Google connection file"
                      onChange={(event) => {
                        void importClient(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
                <details className="ar-client-instructions">
                  <summary>
                    {google ? "Create a connection file" : "Create a Microsoft connection"}
                  </summary>
                  <ol>
                    <li>
                      Open{" "}
                      <a
                        href={
                          google
                            ? "https://console.cloud.google.com/auth/clients"
                            : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {google ? "Google Cloud" : "Microsoft Entra"} <ArrowUpRight size={11} />
                      </a>{" "}
                      and create an OAuth app with a Web callback.
                    </li>
                    <li>
                      Register this callback address:
                      <code className="ar-redirect-uri">{account?.redirectUri}</code>
                    </li>
                    <li>
                      {google
                        ? "Enable the Gmail and Google Calendar APIs, complete the consent setup, and download the client JSON."
                        : "Allow personal and work accounts. Grant User.Read, Mail.Read and Calendars.Read. Copy your Application (client) ID and client secret."}
                    </li>
                  </ol>
                </details>
                {google ? (
                  <details className="ar-client-instructions">
                    <summary>Enter connection details manually</summary>
                    <label>
                      Client ID
                      <input
                        value={clientId}
                        onChange={(event) => setClientId(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Client secret
                      <input
                        type="password"
                        value={secret}
                        onChange={(event) => setSecret(event.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                  </details>
                ) : (
                  <>
                    <label>
                      Client ID
                      <input
                        required
                        value={clientId}
                        onChange={(event) => setClientId(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Client secret (if configured)
                      <input
                        type="password"
                        value={secret}
                        onChange={(event) => setSecret(event.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="op-form-help">
                  Create an API key in{" "}
                  <a
                    href="https://app.cal.com/settings/developer/api-keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Cal.com settings
                  </a>
                  , then add it here.
                </p>
                <label>
                  API key
                  <input
                    required
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            <button
              className="op-button primary"
              disabled={!!busy || (oauth ? !clientId || (google && !secret) : !secret)}
            >
              {busy ? <Busy /> : <Plug size={14} />}{" "}
              {oauth ? `Continue to ${google ? "Google" : "Microsoft"}` : "Connect Cal.com"}
            </button>
            <p className="op-form-help ar-direct-private">Connection details stay on this Mac.</p>
          </form>
        )}
      </section>
    );
  }
  return (
    <section className="ar-work-account-panel" aria-label="Work account connections">
      <ExistingConnectionsPanel />
      <p className="op-form-help">Sign in to the accounts you want synced inside this workspace.</p>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {setup ? (
        <form
          className="op-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              "configure",
              setup,
              setup === "slack"
                ? { apiKey: secret, channel }
                : setup === "cal"
                  ? { apiKey: secret }
                  : { clientId, clientSecret: secret },
            );
          }}
        >
          <button type="button" className="op-text-link" onClick={() => setSetup("")}>
            <ChevronLeft size={13} />
            All connections
          </button>
          <h3>Set up {names[setup]}</h3>
          {setup === "google" && (
            <label className="ar-mail-access-choice">
              <input
                type="checkbox"
                checked={mailAccess}
                onChange={(e) => setMailAccess(e.target.checked)}
              />
              <span>Enable replies, drafts, labels and read/unread changes in Gmail</span>
            </label>
          )}
          {guided && !advanced && ["google", "outlook"].includes(setup) && (
            <div className="ar-guided-connection">
              <ProviderLogo provider={setup} />
              <p className="op-form-help">
                {data?.accounts.find((a) => a.id === setup)?.configured
                  ? "Your connection is ready. Sign in and choose the account you want to use."
                  : `This copy of Agentic OS needs a ${setup === "google" ? "Google" : "Microsoft"} connection set up once before you can sign in. Your email and calendar will then refresh here.`}
              </p>
              {data?.accounts.find((a) => a.id === setup)?.configured ? (
                <button
                  type="button"
                  className="op-button primary"
                  disabled={!!busy}
                  onClick={() =>
                    void action(
                      "start",
                      setup,
                      setup === "google" && mailAccess ? { access: "mail" } : {},
                    )
                  }
                >
                  {busy ? <Busy /> : <Plug size={14} />} Sign in with{" "}
                  {setup === "google" ? "Google" : "Microsoft"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="op-button primary"
                    onClick={() => {
                      onAssistantHelp?.();
                      askOperator(
                        `Help me set up ${names[setup]} for memory in my local Agentic OS. Check whether the OS already has a usable provider configuration. If not, guide me through creating it, one step at a time. I want email and calendar reading for memory. Use the account setup form for credentials, never ask me to paste secrets into chat. I will complete the provider sign-in and consent.`,
                        "The user clicked Guide me through setup in Memory. This starts setup guidance in the shared assistant. Do not claim the account is connected unless the local connections API confirms it.",
                        true,
                      );
                    }}
                  >
                    Guide me through setup
                  </button>
                  <button type="button" className="op-text-link" onClick={() => setAdvanced(true)}>
                    I have the connection details <ArrowUpRight size={12} />
                  </button>
                </>
              )}
              {snapshotFor(setup) && (
                <p className="op-form-help">
                  {snapshotFor(setup)!.count} messages are already saved. Live updates begin after
                  sign-in.
                </p>
              )}
            </div>
          )}
          {!guided && !advanced && (
            <>
              <p className="op-form-help">
                {setup === "slack"
                  ? "Slack connects here with a Slack token and reads recent messages from the channels you choose. A saved Slack workspace name alone does not authorize access."
                  : "Sign in here to bring this account's recent messages into your OS. Claude can still use its own connected tools in Chat."}
              </p>
              {setup === "slack" && slackHints.length > 0 && (
                <>
                  <label>
                    Workspace detected on this Mac
                    <select
                      value={slackWorkspace}
                      onChange={(event) => setSlackWorkspace(event.target.value)}
                    >
                      {slackHints.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="op-form-help">
                    Detected in Slack. This does not authorize access to your messages.
                  </p>
                  {selectedSlack && (
                    <a
                      className="op-text-link"
                      href={selectedSlack.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {selectedSlack.name} <ArrowUpRight size={12} />
                    </a>
                  )}
                </>
              )}
              {snapshotFor(setup) && (
                <Notice>
                  {snapshotFor(setup)!.count} messages imported on{" "}
                  {new Date(snapshotFor(setup)!.importedAt).toLocaleString()}. This is a saved
                  snapshot. Enable the account above to refresh recent messages.
                </Notice>
              )}
              <p className="op-form-help">Select your accounts above to refresh recent messages. Sign in to each account below first.</p>
              {["google", "outlook"].includes(setup) &&
                data?.accounts.find((a) => a.id === setup)?.configured && (
                  <button
                    type="button"
                    className="op-button"
                    disabled={!!busy}
                    onClick={() =>
                      void action(
                        "start",
                        setup,
                        setup === "google" && mailAccess ? { access: "mail" } : {},
                      )
                    }
                  >
                    {setup === "google" && mailAccess
                      ? "Connect Gmail with replies & labels"
                      : "Sign in to configured account"}
                  </button>
                )}
              <button type="button" className="op-text-link" onClick={() => setAdvanced(true)}>
                {setup === "slack" ? "Connect with a Slack token" : "Set up direct sign-in"}{" "}
                <ArrowUpRight size={12} />
              </button>
            </>
          )}
          {advanced && (
            <>
              {setup === "slack" ? (
                <>
                  <p className="op-form-help">
                    Connect one channel with a Slack app token. Messages stay read-only in Slack.
                  </p>
                  <a
                    className="op-text-link"
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open your Slack apps <ArrowUpRight size={12} />
                  </a>
                  <p className="op-form-help">
                    Allow channels:history, or groups:history for a private channel. Install the app
                    and invite it to that channel. Then copy its OAuth token and the channel ID from
                    Slack.
                  </p>
                  <label>
                    Channel ID
                    <input
                      required
                      value={channel}
                      onChange={(e) => setChannel(e.target.value)}
                      placeholder="C0123456789"
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : setup === "cal" ? (
                <>
                  <p className="op-form-help">
                    Create an API key in your Cal.com account. It stays on this Mac.
                  </p>
                  <a
                    className="op-text-link"
                    href="https://app.cal.com/settings/developer/api-keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Cal.com API keys <ArrowUpRight size={12} />
                  </a>
                </>
              ) : (
                <>
                  <p className="op-form-help">
                    This local app needs an OAuth client before the first sign-in. Register this
                    redirect URL in {setup === "google" ? "Google Cloud" : "Microsoft Entra"}:
                  </p>
                  <code className="ar-redirect-uri">
                    {data?.accounts.find((a) => a.id === setup)?.redirectUri}
                  </code>
                  <a
                    className="op-text-link"
                    href={
                      setup === "google"
                        ? "https://console.cloud.google.com/auth/clients"
                        : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open {setup === "google" ? "Google Cloud" : "Microsoft Entra"}{" "}
                    <ArrowUpRight size={12} />
                  </a>
                  <p className="op-form-help">
                    {setup === "google"
                      ? "Choose Web application and enable the Gmail and Google Calendar APIs."
                      : "Choose a Web redirect. Allow personal and work accounts. Grant User.Read, Mail.Read and Calendars.Read."}
                  </p>
                  <label>
                    Client ID
                    <input
                      required
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              <label>
                {setup === "slack"
                  ? "Slack OAuth token"
                  : setup === "cal"
                    ? "API key"
                    : `Client secret${setup === "outlook" ? " (if configured)" : ""}`}
                <input
                  type="password"
                  required={setup !== "outlook"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button className="op-button primary" disabled={!!busy}>
                {busy ? <Busy /> : <Plug size={14} />}{" "}
                {setup === "slack"
                  ? "Connect Slack"
                  : setup === "cal"
                    ? "Connect Cal.com"
                    : "Save and sign in"}
              </button>
            </>
          )}
        </form>
      ) : (
        <div className="ar-accounts-list">
          {(data?.accounts || [])
            .filter((a) => (providers || ["google", "outlook", "slack", "cal"]).includes(a.id))
            .map((a) => (
              <div className="ar-account-card" key={a.id}>
                <ProviderLogo provider={a.id} />
                <div>
                  <strong>{names[a.id]}</strong>
                  <small>
                    {a.connected
                      ? a.email
                      : snapshotFor(a.id)
                        ? `Snapshot · ${snapshotFor(a.id)!.count} messages`
                        : a.configured
                          ? "Ready to sign in"
                          : "Not connected"}
                  </small>
                  {a.lastSync && <small>Updated {new Date(a.lastSync).toLocaleString()}</small>}
                  {a.connected && ["google", "outlook"].includes(a.id) && <small>{a.calendarAccess === "granted" ? "Calendar access granted" : a.calendarAccess === "missing" ? "Calendar access missing" : "Calendar access unverified"}</small>}
                  {!a.connected && snapshotFor(a.id) && (
                    <small>
                      Imported {new Date(snapshotFor(a.id)!.importedAt).toLocaleString()} ·{" "}
                      saved copy
                    </small>
                  )}
                  {a.error && <small className="ar-account-error">{a.error}</small>}
                </div>
                {a.connected ? (
                  <>
                    {["google", "outlook"].includes(a.id) && a.calendarAccess !== "granted" && <button className="op-button" disabled={!!busy} onClick={() => void action("start", a.id)}>Reconnect calendar</button>}
                    {["google", "outlook"].includes(a.id) && !a.capabilities?.calendarCreate && <button className="op-button" disabled={!!busy} onClick={() => void action("start", a.id, { access: "calendar" })}>Enable calendar bookings</button>}
                    {a.id === "google" && !a.capabilities?.modify && (
                      <button
                        className="op-button"
                        disabled={!!busy}
                        onClick={() => void action("start", "google", { access: "mail" })}
                      >
                        Enable mail actions
                      </button>
                    )}
                    <button
                      className="op-button"
                      disabled={!!busy}
                      onClick={() => void action("sync", a.id)}
                    >
                      {busy === a.id ? <Busy /> : <RefreshCw size={13} />}Sync
                    </button>
                    <button
                      className="op-text-link"
                      disabled={!!busy}
                      onClick={() => void action("disconnect", a.id)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="op-button"
                    disabled={!!busy}
                    onClick={() => {
                      if (guided && a.configured && ["google", "outlook"].includes(a.id))
                        void action("start", a.id);
                      else connect(a);
                    }}
                  >
                    {busy === a.id ? <Busy /> : <Plug size={13} />}
                    {guided
                      ? a.configured
                        ? "Sign in"
                        : "Set up"
                      : snapshotFor(a.id)
                        ? "Options"
                        : "Connect"}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
      {!setup && !guided && (
        <p className="op-form-help">
          Gmail imports recent mail, drafts and labels. Mail actions work after you authorize them
          in Google. Outlook and Slack imports are read-only. Calendar connections bring in events across your calendars. Enabled
          accounts refresh each minute while Inbox is visible.
        </p>
      )}
    </section>
  );
}
