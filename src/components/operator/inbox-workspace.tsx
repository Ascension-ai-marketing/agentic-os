import { PILES } from "@/lib/jev-inbox";
import { JevMailbox, SortAllButton } from "./jev-mailbox";
import { JevPileTag, JevSortBar, useJevInboxLabels } from "./jev-inbox-sort";
import { JevCard, JevMark } from "@/components/jev/jev-card";
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import "./inbox-refinements.css";
import "./inbox-white.css";
import {
  ArrowLeft,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Inbox,
  Mail,
  Plus,
  Search,
  FileText,
  Archive,
  RefreshCw,
  MessageSquare,
  SlidersHorizontal,
  MailOpen,
  Send,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  Tag,
  Star,
  Reply,
  Layers,
  X,
  Users,
  Hash,
} from "lucide-react";
import { useOperator, operatorRequest, askOperator, type InboxItem } from "@/lib/operator";
import { brainEnabled } from "@/lib/brain-sources";
import { INBOX_OPEN_KEY, inboxOpenRequest } from "@/lib/voice-email-review";
import { Busy, Modal, Notice } from "./ui";
import { AccountConnections, ProviderLogo, useAccounts, useNativeConnections } from "./account-connections";
import { InboxDailyBrief } from "./inbox-daily-brief";
import { MailArchivePanel } from "./mail-archive-panel";
import { YouTubeCommentQueue, useYouTubeStatus } from "./youtube-comment-queue";

type Message = InboxItem & {
  draftTo?: string;
  cc?: string[];
  bcc?: string[];
  draftCc?: string;
  draftBcc?: string;
  labelIds?: string[];
  remoteId?: string;
  threadId?: string;
  to?: string[];
  replyTo?: string;
  url?: string;
  starred?: boolean;
  remoteDraftId?: string;
};
type InboxAskResult = {
  id: string;
  source: InboxItem["source"];
  title: string;
  from: string;
  excerpt: string;
  threadId?: string;
  url?: string;
  receivedAt: string;
  direction?: "inbound" | "outbound";
  reason: string;
};
type InboxAskResponse = {
  question: string;
  answer: string;
  mode: "answer" | "search";
  results: InboxAskResult[];
  totalSearched: number;
  matchedCount: number;
  coverage: string;
  notice?: string;
  canSummarize?: boolean;
};
type InboxAskState = {
  question: string;
  busy: boolean;
  thinking: boolean;
  error: string;
  response?: InboxAskResponse;
};
type GmailLabel = {
  account?: string;
  id: string;
  name: string;
  type?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  color?: { backgroundColor?: string; textColor?: string };
};
type MailCapabilities = { modify?: boolean; send?: boolean; drafts?: boolean };
const NO_MESSAGES: InboxItem[] = [];
const providers = [
  { id: "all", label: "Overview" },
  { id: "gmail", label: "Gmail" },
  { id: "slack", label: "Slack" },
  { id: "outlook", label: "Outlook" },
  { id: "youtube", label: "YouTube" },
];
const categories = [
  { id: "needs-you", label: "Primary" },
  { id: "sponsors", label: "Opportunities" },
  { id: "waiting", label: "Waiting" },
  { id: "updates", label: "Updates" },
];
function SourceLogo({ source }: { source: string }) {
  if (source === "jev") return <span style={{ color: "var(--jev)", display: "inline-flex" }}><JevMark size={15} /></span>;
  return source === "all" ? (
    <Layers size={17} />
  ) : source === "youtube" ? (
    <img className="ar-provider-logo" src="/business-sources/youtube-symbol.svg" alt="YouTube" />
  ) : source === "capture" ? (
    <Mail size={16} />
  ) : (
    <ProviderLogo provider={source} />
  );
}
function isStarred(item: Message) {
  return item.starred ?? item.labelIds?.includes("STARRED") ?? false;
}
function sourceName(source: string) {
  return providers.find((p) => p.id === source)?.label || "Captured message";
}
function senderName(value: string) {
  return (
    value
      .replace(/\s*<[^>]+>\s*$/, "")
      .replace(/^\"|\"$/g, "")
      .trim() ||
    value ||
    "You"
  );
}
function messageDate(value: string) {
  const date = new Date(value),
    now = new Date();
  if (!Number.isFinite(date.getTime())) return "";
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}
function originalUrl(item: Message) {
  if (item.url && /^https:\/\//.test(item.url)) return item.url;
  if (item.source === "gmail")
    return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId || item.remoteId || item.id.replace(/^google[:_-]|^gmail[:_-]/, ""))}`;
  return item.source === "slack" ? "https://app.slack.com/" : "https://outlook.live.com/mail/";
}

const INBOX_DEMO_KEY = "agentic-os:inbox-demo";

export function InboxWorkspace() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(search).get("demo") === "1";
    let enabled = requested;
    try {
      enabled ||= localStorage.getItem(INBOX_DEMO_KEY) === "true";
      if (requested) localStorage.setItem(INBOX_DEMO_KEY, "true");
    } catch {
      // If the preference cannot be read, keep private mail off screen.
      enabled = true;
    }
    setDemo(enabled);
  }, [search]);
  // Do not mount the real inbox, archive, search or account UI before privacy resolves.
  if (demo === null) return <div className="op-page" aria-label="Loading inbox"><Busy /></div>;
  return demo ? <GmailDemoWorkspace onExit={() => {
    try { localStorage.removeItem(INBOX_DEMO_KEY); } catch { /* Keep the private view if storage fails. */ }
    window.location.assign("/inbox");
  }} /> : <LiveInboxWorkspace />;
}

function GmailDemoWorkspace({ onExit }: { onExit: () => void }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("agentic-inbox-theme");
      setTheme(saved === "light" || saved === "dark" ? saved : document.documentElement.classList.contains("dark") ? "dark" : "light");
    } catch { /* Keep the initial theme. */ }
  }, []);
  return <div className="op-page ar-mail-page ar-white-inbox" data-inbox-theme={theme} data-inbox-demo="true">
    <header className="ar-page-title">
      <div><span className="wi-eyebrow">YOUR CONVERSATIONS</span><h1>Inbox<span className="wi-title-dot" /></h1><p>A little more clarity. A lot less switching.</p></div>
      <div className="wi-page-actions">
        <SortAllButton />
        <InboxThemeControl theme={theme} onChange={(next) => {
          setTheme(next);
          try { localStorage.setItem("agentic-inbox-theme", next); } catch { /* Theme stays in this view. */ }
        }} />
      </div>
    </header>
    <div className="wi-mode-bar">
      <span className="wi-demo-badge">DEMO</span>
      <p>Your real emails are hidden. Fictional messages for your walkthrough.</p>
      <div><button onClick={onExit}>Show my real inbox</button></div>
    </div>
    <JevMailbox />
  </div>;
}

function LiveInboxWorkspace() {
  const { state, refresh, error } = useOperator(),
    accounts = useAccounts();
  const nativeAccounts = useNativeConnections();
  const nativeReady = (nativeAccounts.data?.providers || []).filter(a => a.enabled && a.available);
  const [openedBodies, setOpenedBodies] = useState<Record<string, InboxItem>>({});
  const [inboxTheme, setInboxTheme] = useState<"light" | "dark" | null>(null),
    [globalDark, setGlobalDark] = useState(false);
  const [overviewAsk, setOverviewAsk] = useState<InboxAskState>({
    question: "",
    busy: false,
    thinking: false,
    error: "",
  });
  const overviewAskLock = useRef(false);
  const overviewAskRequest = useRef<{ sequence: number; controller?: AbortController }>({
    sequence: 0,
  });
  useEffect(() => () => overviewAskRequest.current.controller?.abort(), []);
  function stopOverviewAnswer() {
    overviewAskRequest.current.sequence += 1;
    overviewAskRequest.current.controller?.abort();
    overviewAskLock.current = false;
  }
  const inboxQuestionScope = JSON.stringify([brainEnabled(state, "email"), state.settings.inboxAccounts || {}]);
  const previousQuestionScope = useRef(inboxQuestionScope);
  useEffect(() => {
    if (previousQuestionScope.current === inboxQuestionScope) return;
    previousQuestionScope.current = inboxQuestionScope;
    stopOverviewAnswer();
    setOverviewAsk((old) => ({ ...old, response: undefined, busy: false, thinking: false, error: "" }));
  }, [inboxQuestionScope]);
  async function askOverview() {
    const question = overviewAsk.question.trim();
    if (!question || question.length > 600 || overviewAskLock.current) return;
    let model: { backend: "deepseek" | "local"; provider: string; name: string } | undefined;
    try {
      const selectedModel = JSON.parse(localStorage.getItem("os-oracle-brain-model") || "null");
      if (["deepseek", "local"].includes(selectedModel?.backend) &&
          typeof selectedModel.provider === "string" && typeof selectedModel.name === "string")
        model = { backend: selectedModel.backend, provider: selectedModel.provider, name: selectedModel.name };
    } catch {}
    stopOverviewAnswer();
    const sequence = overviewAskRequest.current.sequence;
    const controller = new AbortController();
    overviewAskRequest.current.controller = controller;
    overviewAskLock.current = true;
    setOverviewAsk((old) => ({
      ...old,
      question,
      busy: true,
      thinking: false,
      error: "",
      response: undefined,
    }));
    let found: InboxAskResponse | undefined;
    async function request(summarize: boolean) {
      const tokenResponse = await fetch("/__token", { signal: controller.signal });
      const { token } = await tokenResponse.json();
      const response = await fetch("/__operator/inbox/ask", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
        body: JSON.stringify({ question, summarize, model }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The inbox search could not be completed.");
      if (
        !Array.isArray(result.results) ||
        typeof result.answer !== "string" ||
        !["answer", "search"].includes(result.mode)
      )
        throw new Error("The search result could not be read. Please try your question again.");
      return result as InboxAskResponse;
    }
    try {
      found = await request(false);
      if (sequence !== overviewAskRequest.current.sequence) return;
      overviewAskLock.current = false;
      setOverviewAsk((old) => ({
        ...old,
        response: found,
        busy: false,
        thinking: found?.canSummarize === true,
        error: "",
      }));
      if (found.canSummarize) {
        const response = await request(true);
        if (sequence !== overviewAskRequest.current.sequence) return;
        setOverviewAsk((old) => ({ ...old, response, thinking: false }));
      }
    } catch (e) {
      if (sequence !== overviewAskRequest.current.sequence || controller.signal.aborted) return;
      setOverviewAsk((old) => ({
        ...old,
        error: found
          ? "Your matches are ready, but the answer could not be generated. You can open the conversations below or try again."
          : (e as Error).message,
      }));
    } finally {
      if (sequence === overviewAskRequest.current.sequence) {
        overviewAskLock.current = false;
        setOverviewAsk((old) => ({ ...old, busy: false, thinking: false }));
      }
    }
  }
  useEffect(() => {
    try {
      const preference = localStorage.getItem("agentic-inbox-theme");
      if (preference === "light" || preference === "dark") setInboxTheme(preference);
    } catch {}
    const update = () => setGlobalDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  function chooseInboxTheme(theme: "light" | "dark") {
    setInboxTheme(theme);
    try {
      localStorage.setItem("agentic-inbox-theme", theme);
    } catch {}
  }
  const effectiveTheme = inboxTheme || (globalDark ? "dark" : "light");
  const [provider, setProvider] = useState("all"),
    [folder, setFolder] = useState("inbox"),
    [category, setCategory] = useState("all"),
    [jevPile, setJevPile] = useState("all"),
    [label, setLabel] = useState(""),
    [labelAccount, setLabelAccount] = useState("");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [replyTo, setReplyTo] = useState(""),
    [replyCc, setReplyCc] = useState(""),
    [replyBcc, setReplyBcc] = useState(""),
    [showCc, setShowCc] = useState(false),
    [showBcc, setShowBcc] = useState(false),
    [replyOpen, setReplyOpen] = useState(false);
  const [sourceModes, setSourceModes] = useState<Record<string, "preview" | "live">>({});
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [add, setAdd] = useState(false),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [failure, setFailure] = useState(""),
    [savingView, setSavingView] = useState(false);
  const sendAttempts = useRef<
    Record<string, { requestId: string; to: string; cc: string; bcc: string; body: string }>
  >({});
  const [pendingView, setPendingView] = useState<Partial<typeof state.settings>>({});
  const youtubeStatus = useYouTubeStatus(provider === "youtube" || provider === "all");
  const previewAvailable = ["slack", "outlook"].includes(provider);
  const sourceConnected =
    provider === "youtube"
      ? true
      : nativeReady.some(a => a.id === provider) || !!accounts.data?.accounts.find((a) => a.id === provider && a.connected);
  const hasSourceMessages = state.inbox.some((message) => message.source === provider);
  const isPreview =
    previewAvailable &&
    (sourceModes[provider] || (sourceConnected || hasSourceMessages ? "live" : "preview")) ===
      "preview";
  const viewSettings = { ...state.settings, ...pendingView };
  const visibleAccounts: Record<string, boolean> = {
    gmail: true,
    outlook: true,
    capture: true,
    slack: true,
    ...viewSettings.inboxAccounts,
  };
  const autoRead = viewSettings.inboxAutoRead !== false,
    showAccounts = viewSettings.inboxShowAccounts === true,
    showCategories = viewSettings.inboxShowCategories !== false;
  const emailEnabled = brainEnabled(state, "email");
  const allMessages = state.inbox as Message[];
  const enabledMessages = allMessages.filter((i) => visibleAccounts[i.source] !== false);
  const visibleInbox = enabledMessages.filter((i) => provider === "all" || i.source === provider);
  const selectedItem = enabledMessages.find((i) => i.id === selected);
  const openedBody = selectedItem && openedBodies[selectedItem.id];
  const item = selectedItem && openedBody ? {
    ...selectedItem,
    body: openedBody.body,
    bodyStatus: openedBody.bodyStatus,
    bodyTruncated: openedBody.bodyTruncated,
    to: openedBody.to || selectedItem.to,
    cc: openedBody.cc || selectedItem.cc,
    bcc: openedBody.bcc || selectedItem.bcc,
    replyTo: openedBody.replyTo || selectedItem.replyTo,
  } : selectedItem;
  useEffect(() => {
    if (!selectedItem || selectedItem.bodyStatus !== "metadata" || openedBodies[selectedItem.id]) return;
    let cancelled = false;
    operatorRequest<{ item: InboxItem }>(`/mail-archive/message?id=${encodeURIComponent(selectedItem.id)}`)
      .then(({ item }) => { if (!cancelled) setOpenedBodies(old => ({ ...Object.fromEntries(Object.entries(old).slice(-19)), [item.id]: item })); })
      .catch(error => { if (!cancelled) setFailure((error as Error).message); });
    return () => { cancelled = true; };
  }, [selectedItem?.id, selectedItem?.bodyStatus]);
  const hiddenCount = allMessages.length - enabledMessages.length;
  const gmailLabels = (state as unknown as { gmailLabels?: GmailLabel[] }).gmailLabels || [];
  const userLabels = gmailLabels.filter((l) => l.type === "user" || !/^[A-Z_]+$/.test(l.id));
  const connected =
    accounts.data?.accounts.filter(
      (a) => a.connected && ["google", "outlook", "slack"].includes(a.id),
    ) || [];
  function capability(message: Message): MailCapabilities {
    const account = accounts.data?.accounts.find(
      (a) => a.id === (message.source === "gmail" ? "google" : message.source),
    );
    return message.source === "gmail" &&
      account?.connected &&
      !!message.account &&
      account.email?.toLowerCase() === message.account.toLowerCase()
      ? account.capabilities || {}
      : {};
  }
  function matchesFolder(i: Message, key: string) {
    if (key === "all") return true;
    if (key === "starred") return isStarred(i);
    if (key === "drafts") return !!i.draft || i.labelIds?.includes("DRAFT");
    if (key === "sent") return i.labelIds?.includes("SENT");
    if (key === "archive")
      return (
        (i.status === "done" ||
          (i.source === "gmail" && i.labelIds && !i.labelIds.includes("INBOX"))) &&
        !i.labelIds?.some((l) => ["TRASH", "SPAM", "SENT", "DRAFT"].includes(l))
      );
    return (
      i.status === "open" &&
      !i.labelIds?.some((l) => ["TRASH", "SPAM", "DRAFT", "SENT"].includes(l)) &&
      (i.source !== "gmail" || !i.labelIds || i.labelIds.includes("INBOX"))
    );
  }
  const jevSortable = provider === "gmail" || provider === "outlook";
  const jevSort = useJevInboxLabels(jevSortable ? visibleInbox.filter((i) => matchesFolder(i, "inbox")) : NO_MESSAGES);
  const items = visibleInbox
    .filter(
      (i) =>
        (!jevSortable || jevPile === "all" || jevSort.byId.get(i.id)?.category === jevPile) &&
        (label
          ? i.labelIds?.includes(label) && (!labelAccount || i.account === labelAccount)
          : matchesFolder(i, folder)) &&
        (category === "all" || i.category === category) &&
        `${i.from} ${i.subject} ${i.body}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const canSend = item ? capability(item).send === true : false;
  const canDraft = item ? capability(item).drafts === true : false;
  const uncertainSend = item?.gmailSendState === "uncertain";
  const briefInbox = visibleInbox.filter((i) => matchesFolder(i, "inbox"));
  const folderLabelId =
    label ||
    (
      { inbox: "INBOX", starred: "STARRED", sent: "SENT", drafts: "DRAFT" } as Record<
        string,
        string
      >
    )[folder];
  const mailboxCount =
    provider === "gmail" ||
    (provider === "all" && (!!label || visibleInbox.every((i) => i.source === "gmail")))
      ? gmailLabels
          .filter((l) => l.id === folderLabelId && (!labelAccount || l.account === labelAccount))
          .reduce<
            number | undefined
          >((total, l) => (l.messagesTotal == null ? total : (total || 0) + l.messagesTotal), undefined)
      : undefined;
  const canModify = item ? capability(item).modify === true : false;
  const activeSource = accounts.data?.accounts.find((a) =>
    provider === "all"
      ? a.id === "google" && a.connected
      : a.id === (provider === "gmail" ? "google" : provider),
  );
  const snapshot = state.inboxImports
    ?.filter((s) => provider === "all" || s.provider === provider)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  const activeNative = nativeReady.find(a => provider === "all" || a.id === provider);
  const sourceState = activeSource?.connected
    ? activeSource.lastSync
      ? `Updated ${new Date(activeSource.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : "Connected · refresh to load"
    : activeNative?.error
      ? "Refresh needs attention"
    : activeNative?.lastSync
      ? `Refreshed through Codex · ${new Date(activeNative.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : snapshot
      ? "Saved snapshot"
      : provider === "all"
        ? `${enabledMessages.length} saved conversations`
        : "Not connected";
  async function mutate(data: unknown, message: string) {
    setBusy(true);
    setFailure("");
    try {
      await operatorRequest("/inbox", data);
      await refresh();
      if (message) setNotice(message);
      return true;
    } catch (e) {
      setFailure((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function messageAction(
    message: Message,
    action: "read" | "unread" | "archive" | "restore" | "star" | "unstar",
  ) {
    const remote = capability(message).modify === true;
    const data =
      action === "read" || action === "unread"
        ? { read: action === "read" }
        : action === "archive" || action === "restore"
          ? { status: action === "archive" ? "done" : "open" }
          : { starred: action === "star" };
    if (remote) {
      setBusy(true);
      setFailure("");
      try {
        await operatorRequest("/connections/gmail/action", { id: message.id, action });
        await refresh();
        setNotice("Updated in Gmail.");
        return true;
      } catch (e) {
        setFailure((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    }
    return mutate(
      { id: message.id, ...data },
      `${action === "read" ? "Marked read" : action === "unread" ? "Marked unread" : action === "archive" ? "Archived" : action === "restore" ? "Moved to inbox" : action === "star" ? "Starred" : "Star removed"}${remote ? ` in ${sourceName(message.source)}` : " in this workspace"}.`,
    );
  }
  function openMessage(message: Message, markRead = true) {
    setSelected(message.id);
    setDraft(message.draft || (message.labelIds?.includes("DRAFT") ? message.body : ""));
    setReplyTo(
      message.draftTo ||
        (message.labelIds?.includes("DRAFT")
          ? message.to?.join(", ") || ""
          : message.replyTo || message.from.match(/<([^>]+)>/)?.[1] || message.from),
    );
    const cc =
      message.draftCc ?? (message.labelIds?.includes("DRAFT") ? message.cc?.join(", ") || "" : "");
    const bcc =
      message.draftBcc ??
      (message.labelIds?.includes("DRAFT") ? message.bcc?.join(", ") || "" : "");
    setReplyCc(cc);
    setReplyBcc(bcc);
    setShowCc(!!cc);
    setShowBcc(!!bcc);
    setReplyOpen(!!message.draft || !!message.labelIds?.includes("DRAFT"));
    setFailure("");
    if (markRead && autoRead && message.read !== true) void messageAction(message, "read");
  }
  useEffect(() => {
    const openRequestedMessage = (value: unknown) => {
      const request = inboxOpenRequest(value);
      if (!request) return;
      const message = state.inbox.find((entry) => entry.id === request.id);
      if (!message || !["gmail", "outlook"].includes(message.source)) return;
      setProvider(message.source);
      setFolder(message.draft ? "drafts" : "all");
      setCategory("all");
      setQuery("");
      setLabel("");
      setLabelAccount("");
      openMessage(message, false);
      setReplyOpen(true);
      try { sessionStorage.removeItem(INBOX_OPEN_KEY); } catch { /* Optional handoff storage. */ }
    };
    const onOpen = (event: Event) => openRequestedMessage((event as CustomEvent).detail);
    window.addEventListener("operator:inbox-open", onOpen);
    try {
      const pending = sessionStorage.getItem(INBOX_OPEN_KEY);
      if (pending) {
        const request = inboxOpenRequest(JSON.parse(pending));
        if (request) openRequestedMessage(request);
        else sessionStorage.removeItem(INBOX_OPEN_KEY);
      }
    } catch { /* Browser storage can be disabled. The live event still works. */ }
    return () => window.removeEventListener("operator:inbox-open", onOpen);
  }, [state.inbox]);
  async function changeView(patch: Partial<typeof state.settings>) {
    setSavingView(true);
    setPendingView(patch);
    setFailure("");
    try {
      await operatorRequest("/settings", patch);
      await refresh();
      if (patch.inboxAccounts) setSelected(null);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setPendingView({});
      setSavingView(false);
    }
  }
  function askEmail(prompt: string) {
    if (!emailEnabled || !item || !prompt.trim()) return;
    askOperator(
      prompt.trim(),
      JSON.stringify({
        id: item.id,
        from: item.from,
        subject: item.subject,
        body: item.body,
        receivedAt: item.receivedAt,
        source: item.source,
        draft: item.draft,
      }),
      true,
      undefined,
      "email",
    );
  }
  async function sync(automatic = false) {
    const targets = connected.filter(
      (a) =>
        (!automatic || a.id === "google") &&
        (provider === "all" || a.id === (provider === "gmail" ? "google" : provider)),
    );
    const native = nativeReady.filter(a => (provider === "all" || a.id === provider) && !targets.some(d => (d.id === "google" ? "gmail" : d.id) === a.id));
    if (!targets.length && !native.length) return;
    setBusy(true);
    setFailure("");
    try {
      let total = 0,
        limited = false;
      for (const a of targets) {
        const result = await operatorRequest("/connections/sync", { provider: a.id });
        total += result.messages || 0;
        limited ||= result.limited === true;
      }
      if (native.length) {
        const result = await operatorRequest<{ messages: number; results: Array<{ ok: boolean; error?: string }> }>("/native-connections/sync", { providers: native.map(a => a.id) });
        total += result.messages; limited = true;
        const errors = result.results.filter(r => !r.ok).map(r => r.error).join(" ");
        if (errors) setFailure(errors);
        await nativeAccounts.refetch();
      }
      await refresh();
      await accounts.refetch();
      if (!automatic)
        setNotice(
          `Updated ${total} messages.${limited ? " More history is available in the source app." : ""}`,
        );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveReply(action: "draft" | "send") {
    if (!item || !draft.trim()) return;
    if (action === "draft" && !canDraft) {
      await mutate(
        { id: item.id, draft, draftTo: replyTo, draftCc: replyCc, draftBcc: replyBcc },
        "Draft saved locally. Nothing was sent.",
      );
      return;
    }
    if ((action === "send" && (!canSend || uncertainSend)) || !replyTo.trim()) return;
    const previous = sendAttempts.current[item.id];
    const attempt =
      previous &&
      previous.to === replyTo &&
      previous.cc === replyCc &&
      previous.bcc === replyBcc &&
      previous.body === draft
        ? previous
        : { requestId: crypto.randomUUID(), to: replyTo, cc: replyCc, bcc: replyBcc, body: draft };
    if (action === "send") sendAttempts.current[item.id] = attempt;
    setBusy(true);
    setFailure("");
    try {
      const result = await operatorRequest("/connections/gmail/action", {
        id: item.id,
        action,
        to: replyTo,
        cc: replyCc,
        bcc: replyBcc,
        body: draft,
        ...(action === "send" ? { requestId: attempt.requestId } : {}),
      });
      await refresh();
      if (result.uncertain) {
        setFailure(
          result.message ||
            "Gmail has not confirmed delivery. Check Sent in Gmail before another attempt.",
        );
        return;
      }
      if (action === "send") {
        setDraft("");
        setNotice("Reply sent with Gmail.");
      } else setNotice("Draft saved in Gmail.");
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!connected.some((a) => a.id === "google") && !nativeReady.length) return;
    const timer = window.setInterval(() => {
      if (!busy && document.visibilityState === "visible") void sync(true);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [provider, busy, connected.map((a) => `${a.id}:${a.email}`).join("|"), nativeReady.map(a => a.id).join("|")]);
  const nativeOpened = useRef("");
  useEffect(() => {
    const key = nativeReady.map(a => a.id).join("|");
    if (key && nativeOpened.current !== key && !busy) { nativeOpened.current = key; if (nativeReady.some(a => !a.lastSync || Date.now() - Date.parse(a.lastSync) > 60000)) void sync(true); }
  }, [nativeReady.map(a => a.id).join("|"), busy]);
  function beginReply(all = false) {
    if (!item) return;
    if (all) {
      const own = (item.account || "").toLowerCase();
      const getAddress = (value: string) => (value.match(/<([^>]+)>/)?.[1] || value).trim();
      const recipient = getAddress(item.replyTo || item.from);
      const copied = [...(item.to || []), ...(item.cc || [])]
        .map(getAddress)
        .filter(
          (value, index, array) =>
            value &&
            value.toLowerCase() !== own &&
            value.toLowerCase() !== recipient.toLowerCase() &&
            array.findIndex((v) => v.toLowerCase() === value.toLowerCase()) === index,
        );
      setReplyTo(recipient);
      setReplyCc(copied.join(", "));
      setShowCc(copied.length > 0);
      setReplyBcc("");
      setShowBcc(false);
    }
    if (!all && !item.labelIds?.includes("DRAFT")) {
      setReplyTo(item.replyTo || item.from.match(/<([^>]+)>/)?.[1] || item.from);
      setReplyCc("");
      setReplyBcc("");
      setShowCc(false);
      setShowBcc(false);
    }
    setReplyOpen(true);
    window.setTimeout(() => {
      replyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      replyRef.current?.focus({ preventScroll: true });
    }, 50);
  }
  function selectFolder(value: string) {
    setFolder(value);
    setLabel("");
    setLabelAccount("");
    setCategory("all");
    setSelected(null);
  }
  const folderItems = [
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "starred", label: "Starred", icon: Star },
    { id: "sent", label: "Sent", icon: Send },
    { id: "drafts", label: "Drafts", icon: FileText },
    { id: "archive", label: "Archive", icon: Archive },
    { id: "all", label: "All messages", icon: Layers },
  ];
  const selectedLabels =
    item?.labelIds
      ?.map((id) =>
        gmailLabels.find((l) => l.id === id && (!l.account || l.account === item?.account)),
      )
      .filter((l): l is GmailLabel => !!l && l.type !== "system") || [];
  return (
    <div className="op-page ar-mail-page ar-white-inbox" data-inbox-theme={effectiveTheme}>
      <header className="ar-page-title">
        <div>
          <span className="wi-eyebrow">YOUR CONVERSATIONS</span>
          <h1>
            Inbox
            <span className="wi-title-dot" />
          </h1>
          <p>A little more clarity. A lot less switching.</p>
        </div>
        <div className="wi-page-actions">
          <InboxThemeControl theme={effectiveTheme} onChange={chooseInboxTheme} />
          <SortAllButton onBeforeSort={() => setProvider("all")} />
          <button className="op-button" onClick={() => window.location.assign("/inbox?demo=1")}>Hide emails for demo</button>
          <AccountConnections compact messages />
        </div>
      </header>
      {(failure || error) && <Notice error>{failure || error?.message}</Notice>}
      <MailArchivePanel />
      {notice && (
        <Notice>
          {notice}
          <button onClick={() => setNotice("")}>Dismiss</button>
        </Notice>
      )}
      <nav className="wi-provider-tabs" aria-label="Message sources">
        {providers.map((p) => {
          const count =
            p.id === "all"
              ? 0
              : p.id === "youtube"
                ? (youtubeStatus.data?.counts.waiting ?? 0)
                : enabledMessages.filter((i) => i.source === p.id && i.status === "open" && !i.read).length;
          return (
            <button
              key={p.id}
              className={provider === p.id ? "active" : ""}
              aria-pressed={provider === p.id}
              onClick={() => {
                setProvider(p.id);
                setNotice("");
                setFailure("");
                selectFolder("inbox");
              }}
            >
              <SourceLogo source={p.id} />
              <span>{p.label}</span>
              {count > 0 && <small>{count.toLocaleString()}</small>}
            </button>
          );
        })}
      </nav>
      {previewAvailable && (
        <div className="wi-mode-bar">
          <span className={isPreview ? "wi-demo-badge" : "wi-live-badge"}>
            {isPreview
              ? "DEMO"
              : sourceConnected
                ? "CONNECTED"
                : hasSourceMessages
                  ? "SAVED MESSAGES"
                  : "NOT CONNECTED"}
          </span>
          <p>
            {isPreview
              ? "A fictional workspace to try the experience. Demo replies stay in this browser."
              : activeNative
                  ? "Recent messages through Codex · refreshes each minute while this page is visible. Open the original to reply."
                : hasSourceMessages
                  ? "Your saved conversations. Use the original app for the latest messages."
                  : "Your connected account and saved messages. No sample conversations."}
          </p>
          <div>
            <button
              aria-pressed={isPreview}
              onClick={() => setSourceModes({ ...sourceModes, [provider]: "preview" })}
            >
              Try demo
            </button>
            <button
              aria-pressed={!isPreview}
              onClick={() => setSourceModes({ ...sourceModes, [provider]: "live" })}
            >
              {sourceConnected ? "View account" : "View saved"}
            </button>
          </div>
        </div>
      )}
      {provider === "all" ? (
        <>
        <InboxOverview
          messages={enabledMessages}
          accounts={accounts.data?.accounts || []}
          nativeAccounts={nativeReady}
          ask={overviewAsk}
          onQuestion={(question) => {
            stopOverviewAnswer();
            setOverviewAsk((old) => ({ ...old, question, busy: false, thinking: false }));
          }}
          onAsk={() => void askOverview()}
          onResetAsk={() => {
            stopOverviewAnswer();
            setOverviewAsk({ question: "", busy: false, thinking: false, error: "" });
          }}
          onResult={(result) => {
            const message = enabledMessages.find((m) => m.id === result.id);
            if (!message) {
              setOverviewAsk((old) => ({
                ...old,
                error:
                  "This message is no longer in the loaded inbox. Refresh its source to open it here.",
              }));
              return;
            }
            setProvider(message.source);
            setSourceModes((old) => ({ ...old, [message.source]: "live" }));
            openMessage(message);
          }}
          onSource={(id) => {
            setProvider(id);
            selectFolder("inbox");
          }}
          onMessage={(message) => {
            setProvider(message.source);
            setSourceModes((old) => ({ ...old, [message.source]: "live" }));
            openMessage(message);
          }}
        />
        <JevMailbox compact />
        </>
      ) : isPreview ? (
        <ProviderPreview key={provider} provider={provider as "slack" | "outlook"} />
      ) : provider === "youtube" ? (
        <YouTubeCommentQueue />
      ) : (
        <>
          <details className="wi-brief">
            <summary>
              <span className="wi-brief-icon">
                <MessageSquare size={14} />
              </span>
              <strong>Your daily brief</strong>
              <span>
                {enabledMessages.filter((i) => matchesFolder(i, "inbox") && i.read !== true).length}{" "}
                unread in your workspace
              </span>
              <ChevronDown size={15} />
            </summary>
            <InboxDailyBrief
              state={state}
              inbox={briefInbox}
              accounts={accounts.data?.accounts || []}
              onSelect={openMessage}
            />
          </details>
          <div className="ar-mail-shell wi-shell">
            <aside className="ar-mail-folders wi-folders">
              <button className="wi-capture" onClick={() => setAdd(true)}>
                <Plus size={19} />
                <span>Capture message</span>
              </button>
              <nav aria-label="Mail folders">
                {folderItems.map((f) => (
                  <button
                    key={f.id}
                    className={folder === f.id && !label ? "active" : ""}
                    onClick={() => selectFolder(f.id)}
                  >
                    <f.icon size={16} />
                    <span>{f.label}</span>
                    <small>{visibleInbox.filter((i) => matchesFolder(i, f.id)).length || ""}</small>
                  </button>
                ))}
              </nav>
              {(provider === "all" || provider === "gmail") && (
                <div className="wi-labels">
                  <div className="wi-label-heading">
                    Labels <span>{userLabels.length || ""}</span>
                  </div>
                  {userLabels.length ? (
                    userLabels.map((l) => {
                      const loaded = visibleInbox.filter(
                        (i) =>
                          i.labelIds?.includes(l.id) && (!l.account || i.account === l.account),
                      ).length;
                      return (
                        <button
                          key={`${l.account || ""}:${l.id}`}
                          className={
                            label === l.id && labelAccount === (l.account || "") ? "active" : ""
                          }
                          title={`${l.name}${l.account ? ` · ${l.account}` : ""}${l.messagesTotal != null ? ` · ${l.messagesTotal} in Gmail` : ""} · ${loaded} loaded here`}
                          onClick={() => {
                            setLabel(l.id);
                            setLabelAccount(l.account || "");
                            setCategory("all");
                            setSelected(null);
                          }}
                        >
                          <Tag size={14} style={{ color: l.color?.backgroundColor || "#828b9d" }} />
                          <span>{l.name}</span>
                          <small>{loaded || ""}</small>
                        </button>
                      );
                    })
                  ) : (
                    <p>
                      Your Gmail labels will appear here after importing or connecting your account.
                    </p>
                  )}
                </div>
              )}
              {showAccounts && (
                <div className="wi-account-detail">
                  <small>ACCOUNTS</small>
                  {providers
                    .filter((p) => p.id !== "all")
                    .map((p) => (
                      <div key={p.id}>
                        <SourceLogo source={p.id} />
                        <span>
                          {p.label}
                          <small>
                            {accounts.data?.accounts.find(
                              (a) => a.id === (p.id === "gmail" ? "google" : p.id),
                            )?.connected
                              ? "Connected"
                              : state.inboxImports?.some((s) => s.provider === p.id)
                                ? "Saved snapshot"
                                : "Not connected"}
                          </small>
                        </span>
                      </div>
                    ))}
                </div>
              )}
              <div className="wi-folder-note">
                <span
                  className={`wi-status-dot ${activeSource?.connected ? "is-connected" : ""}`}
                />
                <span>
                  {sourceState}
                  <small>Folder counts show loaded messages.</small>
                </span>
              </div>
            </aside>
            <section className="ar-mail-content wi-content">
              <div className="ar-mail-search wi-search">
                <label>
                  <Search size={19} />
                  <input
                    aria-label="Search inbox"
                    placeholder={
                      provider === "all"
                        ? "Search all conversations"
                        : `Search ${sourceName(provider)}`
                    }
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                  />
                  {query && (
                    <button aria-label="Clear search" onClick={() => setQuery("")}>
                      <X size={14} />
                    </button>
                  )}
                </label>
                <button
                  className="op-icon-button"
                  disabled={
                    busy ||
                    !nativeReady.some(a => provider === "all" || a.id === provider) && !connected.some(
                      (a) =>
                        provider === "all" || a.id === (provider === "gmail" ? "google" : provider),
                    )
                  }
                  aria-label="Sync inbox"
                  title="Refresh connected accounts"
                  onClick={() => void sync()}
                >
                  <RefreshCw size={16} className={busy ? "wi-spinning" : ""} />
                </button>
                <details className="ar-mail-view">
                  <summary>
                    <SlidersHorizontal size={15} />
                    <span>View</span>
                  </summary>
                  <div className="ar-mail-view-panel">
                    <h3>Show messages from</h3>
                    {[
                      ["gmail", "Gmail"],
                      ["outlook", "Outlook"],
                      ["slack", "Slack"],
                      ["capture", "Captured messages"],
                    ].map(([id, name]) => (
                      <label key={id}>
                        <span>
                          <SourceLogo source={id} />
                          {name}
                        </span>
                        <input
                          type="checkbox"
                          aria-label={`Show ${name}`}
                          checked={visibleAccounts[id]}
                          disabled={savingView}
                          onChange={(e) =>
                            void changeView({
                              inboxAccounts: {
                                ...visibleAccounts,
                                [id]: e.target.checked,
                              } as typeof state.settings.inboxAccounts,
                            })
                          }
                        />
                      </label>
                    ))}
                    <hr />
                    {[
                      ["inboxShowAccounts", "Show account details", showAccounts],
                      ["inboxShowCategories", "Show categories", showCategories],
                      ["inboxAutoRead", "Mark read when opened", autoRead],
                    ].map(([key, name, checked]) => (
                      <label key={String(key)}>
                        <span>{name}</span>
                        <input
                          type="checkbox"
                          aria-label={String(name)}
                          checked={!!checked}
                          disabled={savingView}
                          onChange={(e) => void changeView({ [String(key)]: e.target.checked })}
                        />
                      </label>
                    ))}
                    <p>
                      Account filters change this view. Memory controls what chat can use. Snapshot
                      actions stay in this workspace; connected Gmail actions require write access.
                    </p>
                  </div>
                </details>
              </div>
              {!item ? (
                <>
                  <div className="wi-list-toolbar">
                    <strong>
                      {label
                        ? gmailLabels.find(
                            (l) => l.id === label && (!labelAccount || l.account === labelAccount),
                          )?.name
                        : folderItems.find((f) => f.id === folder)?.label}
                    </strong>
                    <span>
                      {items.length} loaded
                      {mailboxCount != null ? ` · ${mailboxCount.toLocaleString()} in Gmail` : ""}
                    </span>
                  </div>
                  {jevSortable && folder === "inbox" && !label && <JevSortBar state={jevSort} pile={jevPile} setPile={setJevPile} />}
                  {showCategories && !label && folder === "inbox" && (
                    <div className="ar-mail-categories wi-categories">
                      {[{ id: "all", label: "All" }, ...categories].map((c) => (
                        <button
                          key={c.id}
                          className={category === c.id ? "active" : ""}
                          onClick={() => setCategory(c.id)}
                        >
                          {c.label}
                          {category === c.id && <span />}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="ar-mail-rows wi-rows">
                    {items.length ? (
                      items.map((i) => (
                        <div
                          key={i.id}
                          className={`wi-row ${i.read === true ? "is-read" : "is-unread"}`}
                        >
                          <button
                            className={`wi-row-star ${isStarred(i) ? "is-starred" : ""}`}
                            aria-label={`${isStarred(i) ? "Unstar" : "Star"} ${i.subject}`}
                            disabled={busy}
                            onClick={() => void messageAction(i, isStarred(i) ? "unstar" : "star")}
                          >
                            <Star size={16} />
                          </button>
                          <button
                            className="wi-row-main"
                            aria-label={`${i.read === true ? "" : "Unread. "}${i.from || "You"}: ${i.subject}`}
                            onClick={() => openMessage(i)}
                          >
                            <span className="wi-row-sender">
                              {provider === "all" && <SourceLogo source={i.source} />}
                              <span>{senderName(i.from)}</span>
                            </span>
                            <span className="wi-row-copy">
                              <strong>{i.subject || "(No subject)"}</strong>
                              <span className="wi-row-preview">
                                {" "}
                                — {i.body.replace(/\s+/g, " ")}
                              </span>
                              {i.draft && <b>Draft</b>}
                            </span>
                            {jevSortable && <JevPileTag label={jevSort.byId.get(i.id)} />}
                            <time>{messageDate(i.receivedAt)}</time>
                          </button>
                          <div className="wi-row-actions">
                            <button
                              aria-label={`${i.read === true ? "Mark unread" : "Mark read"}: ${i.subject}`}
                              title={i.read === true ? "Mark unread" : "Mark read"}
                              disabled={busy}
                              onClick={() =>
                                void messageAction(i, i.read === true ? "unread" : "read")
                              }
                            >
                              {i.read === true ? <Mail size={16} /> : <MailOpen size={16} />}
                            </button>
                            <button
                              aria-label={`${i.status === "done" ? "Restore" : "Archive"}: ${i.subject}`}
                              title={i.status === "done" ? "Move to inbox" : "Archive"}
                              disabled={busy}
                              onClick={() =>
                                void messageAction(i, i.status === "done" ? "restore" : "archive")
                              }
                            >
                              {i.status === "done" ? <Inbox size={16} /> : <Archive size={16} />}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="ar-mail-empty wi-empty">
                        <div className="wi-empty-icon">
                          <SourceLogo source={provider} />
                        </div>
                        <h2>
                          {query
                            ? "No matching conversations"
                            : label
                              ? "No loaded messages with this label"
                              : provider !== "all" && !visibleInbox.length
                                ? `Bring ${sourceName(provider)} into the conversation.`
                                : folder === "inbox"
                                  ? "A little breathing room."
                                  : `No ${folder === "archive" ? "archived messages" : folder === "all" ? "messages" : folder} here yet.`}
                        </h2>
                        <p>
                          {query
                            ? "Try a sender, subject or phrase."
                            : label
                              ? "Labels are from Gmail. This view shows the messages currently loaded in your workspace."
                              : !visibleInbox.length
                                  ? "Connect an account or capture a message. Your conversations will stay together here."
                                  : "Messages you move to this view will appear here."}
                        </p>
                        {!visibleInbox.length && (
                          <AccountConnections
                            compact
                            messages
                            only={
                              provider === "all"
                                ? undefined
                                : provider === "gmail"
                                  ? "google"
                                  : provider
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {hiddenCount > 0 && (
                    <p className="ar-mail-hidden-count">
                      {hiddenCount} message{hiddenCount === 1 ? "" : "s"} hidden by View settings.
                    </p>
                  )}
                  <div className="wi-bottom-status">
                    <span className="wi-status-dot" />
                    {connected.some((a) => a.id === "google" && ["all", "gmail"].includes(provider))
                      ? `Connected Gmail refreshes every 60 seconds while this page is visible. ${activeSource?.lastSync ? `Last updated ${new Date(activeSource.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : "Use refresh to check your accounts now."}`
                      : activeNative
                        ? `Recent messages refresh through Codex every 60 seconds while this page is visible. ${activeNative.lastSync ? `Updated ${new Date(activeNative.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : ""}`
                      : snapshot
                        ? `Saved snapshot · ${new Date(snapshot.importedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · Connect for refresh and remote actions`
                        : "Original conversations stay in their source apps."}
                  </div>
                </>
              ) : (
                <div className="wi-reader-wrap">
                  <div className="ar-mail-reader wi-reader">
                    <div className="ar-reader-tools wi-reader-tools">
                      <button
                        className="op-icon-button"
                        aria-label="Back to messages"
                        onClick={() => setSelected(null)}
                      >
                        <ArrowLeft size={18} />
                      </button>
                      <span className="wi-tool-divider" />
                      <button
                        className="op-icon-button"
                        aria-label={item.status === "done" ? "Restore message" : "Archive message"}
                        title={item.status === "done" ? "Move to inbox" : "Archive"}
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await messageAction(
                              item,
                              item.status === "done" ? "restore" : "archive",
                            )
                          )
                            setSelected(null);
                        }}
                      >
                        <Archive size={17} />
                      </button>
                      <button
                        className="op-icon-button"
                        disabled={busy}
                        aria-label={item.read === true ? "Mark unread" : "Mark read"}
                        title={item.read === true ? "Mark unread" : "Mark read"}
                        onClick={() =>
                          void messageAction(item, item.read === true ? "unread" : "read")
                        }
                      >
                        {item.read === true ? <Mail size={17} /> : <MailOpen size={17} />}
                      </button>
                      <span className="wi-reader-write-status">
                        {canModify
                          ? `${sourceName(item.source)} sync enabled`
                          : "Changes saved in this workspace"}
                      </span>
                      {item.source !== "capture" && (
                        <a
                          href={originalUrl(item)}
                          className="wi-original"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {sourceName(item.source)}
                          <ArrowUpRight size={13} />
                        </a>
                      )}
                    </div>
                    <div className="wi-reader-heading">
                      <h2>{item.subject || "(No subject)"}</h2>
                      {selectedLabels.length > 0 && (
                        <div className="wi-reader-labels">
                          {selectedLabels.map((l) => (
                            <span
                              key={l.id}
                              style={{
                                background: l.color?.backgroundColor,
                                color: l.color?.textColor,
                              }}
                            >
                              {l.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="ar-reader-byline wi-byline">
                      <span className="op-message-avatar">
                        {senderName(item.from).slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{senderName(item.from)}</strong>
                        {item.from.includes("<") && (
                          <span className="wi-sender-email">
                            {item.from.match(/<([^>]+)>/)?.[1]}
                          </span>
                        )}
                        <small>
                          {item.to ? `to ${item.to.join(", ")}` : `via ${sourceName(item.source)}`}{" "}
                          <ChevronDown size={10} />
                        </small>
                      </div>
                      <time>
                        {new Date(item.receivedAt).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    {jevSort.byId.get(item.id) && (
                      <details className="wi-jev-proof">
                        <summary>Why Jev put this in {PILES[jevSort.byId.get(item.id)!.category].name}</summary>
                        <JevCard decision={jevSort.byId.get(item.id)!.decision} optionLabels={Object.fromEntries(Object.entries(PILES).map(([k, v]) => [k, v.name]))} />
                      </details>
                    )}
                    <div className="op-detail-text wi-message-body">{item.body}</div>
                    <div className="wi-next-step">
                      <span className="wi-next-step-icon">
                        <MessageSquare size={15} />
                      </span>
                      <div>
                        <strong>A little context</strong>
                        <p>
                          {item.triageReason ||
                            "Ask for a summary, check the context, or draft your next move."}
                        </p>
                      </div>
                      <button
                        disabled={!emailEnabled}
                        onClick={() =>
                          askEmail(
                            "Summarise this message and suggest the next step, using relevant enabled memory. Do not send anything.",
                          )
                        }
                      >
                        Think with me <ChevronRight size={13} />
                      </button>
                    </div>
                    <div className="wi-reply-actions">
                      <button className="wi-main-reply" onClick={() => beginReply(false)}>
                        <Reply size={17} />
                        Reply
                      </button>
                      <button onClick={() => beginReply(true)}>
                        <Users size={16} />
                        Reply all
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await operatorRequest("/memory", {
                              title: item.subject,
                              text: `From: ${item.from}\n\n${item.body}`,
                              collection: "business",
                              kind: "note",
                              origin: "email",
                            });
                            await refresh();
                            setNotice("Saved to memory.");
                          } catch (e) {
                            setFailure((e as Error).message);
                          }
                        }}
                      >
                        <BookmarkPlus size={16} />
                        Save to Memory
                      </button>
                      <span>
                        {canSend ? "Connected to Gmail" : item.source === "gmail" ? "Draft here, authorize Gmail to send" : `Draft here, reply in ${sourceName(item.source)}`}
                      </span>
                    </div>
                    {replyOpen && (
                      <form
                        className="wi-reply"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveReply("draft");
                        }}
                      >
                        <div className="wi-reply-heading">
                          <Reply size={16} />
                          <strong>Your reply</strong>
                          <span>
                            {canSend
                              ? `Send with ${sourceName(item.source)}`
                              : "Local draft"}
                          </span>
                        </div>
                        <label className="wi-reply-to">
                          <span>To</span>
                          <input
                            aria-label="Reply recipient"
                            value={replyTo}
                            onChange={(e) => setReplyTo(e.target.value)}
                            placeholder="Recipient"
                          />
                          <button
                            type="button"
                            aria-pressed={showCc || !!replyCc}
                            onClick={() => setShowCc(!showCc)}
                          >
                            Cc
                          </button>
                          <button
                            type="button"
                            aria-pressed={showBcc || !!replyBcc}
                            onClick={() => setShowBcc(!showBcc)}
                          >
                            Bcc
                          </button>
                        </label>
                        {(showCc || !!replyCc) && (
                          <label className="wi-reply-to">
                            <span>Cc</span>
                            <input
                              aria-label="Reply Cc"
                              value={replyCc}
                              onChange={(e) => setReplyCc(e.target.value)}
                              placeholder="Add recipients"
                            />
                          </label>
                        )}
                        {(showBcc || !!replyBcc) && (
                          <label className="wi-reply-to">
                            <span>Bcc</span>
                            <input
                              aria-label="Reply Bcc"
                              value={replyBcc}
                              onChange={(e) => setReplyBcc(e.target.value)}
                              placeholder="Add hidden recipients"
                            />
                          </label>
                        )}
                        <textarea
                          ref={replyRef}
                          aria-label="Reply message"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Write your reply…"
                        />
                        <div className="wi-reply-footer">
                          <button
                            className="wi-help-reply"
                            type="button"
                            disabled={!emailEnabled}
                            onClick={() =>
                              askEmail(
                                "Draft a useful, concise reply to this message with my context. Do not send it.",
                              )
                            }
                          >
                            <MessageSquare size={14} />
                            Help me reply
                          </button>
                          <button
                            type="submit"
                            className="op-button"
                            disabled={busy || !draft.trim() || (canDraft && !replyTo.trim())}
                          >
                            {busy ? <Busy /> : <Check size={14} />}Save draft
                          </button>
                          <button
                            type="button"
                            className="wi-send"
                            disabled={
                              busy || !canSend || !draft.trim() || !replyTo.trim() || uncertainSend
                            }
                            title={
                              uncertainSend
                                ? "Check Gmail Sent before another attempt"
                                : canSend
                                  ? `Send this reply to ${replyTo}`
                                  : "Connect a sending-enabled account to send from here"
                            }
                            onClick={() => void saveReply("send")}
                          >
                            <Send size={14} />
                            Send
                          </button>
                        </div>
                        {uncertainSend ? (
                          <p className="wi-send-note wi-send-uncertain">
                            Delivery is unconfirmed. Your reply is saved.{" "}
                            <a
                              href="https://mail.google.com/mail/u/0/#sent"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Check Gmail Sent
                            </a>{" "}
                            before sending another copy.
                          </p>
                        ) : !canSend ? (
                          <p className="wi-send-note">
                            You can prepare replies here. Sending needs an account with send access.
                          </p>
                        ) : (
                          <p className="wi-send-note">
                            Send delivers this reply to the recipient above using your connected
                            Gmail account.
                          </p>
                        )}
                      </form>
                    )}
                  </div>
                  <aside className="wi-context-panel">
                    <span className="wi-context-eyebrow">CONNECTED CONTEXT</span>
                    <h3>See the bigger picture.</h3>
                    <p>
                      Ask about this conversation alongside the sources you’ve enabled in Memory.
                    </p>
                    <div className="wi-context-item">
                      <SourceLogo source={item.source} />
                      <span>
                        This conversation
                        <small>
                          {sourceName(item.source)} ·{" "}
                          {item.read === true ? "Read here" : "Unread here"}
                        </small>
                      </span>
                    </div>
                    <a className="wi-context-item" href="/memory">
                      <Layers size={18} />
                      <span>
                        Your memory<small>Manage enabled sources</small>
                      </span>
                      <ArrowUpRight size={12} />
                    </a>
                    <button
                      className="wi-remember"
                      onClick={async () => {
                        try {
                          await operatorRequest("/memory", {
                            title: item.subject,
                            text: `From: ${item.from}\n\n${item.body}`,
                            collection: "business",
                            kind: "note",
                            origin: "email",
                          });
                          await refresh();
                          setNotice("Saved to memory.");
                        } catch (e) {
                          setFailure((e as Error).message);
                        }
                      }}
                    >
                      <BookmarkPlus size={14} />
                      Save to Memory
                    </button>
                    <div className="wi-context-prompts">
                      {[
                        "What needs my attention?",
                        "What should I reply?",
                        "Find related context",
                      ].map((p) => (
                        <button key={p} disabled={!emailEnabled} onClick={() => askEmail(p)}>
                          {p}
                          <ChevronRight size={12} />
                        </button>
                      ))}
                    </div>
                  </aside>
                </div>
              )}
            </section>
          </div>
        </>
      )}
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Capture a message"
        description="Save an email, DM or follow-up in your workspace."
      >
        <form
          className="op-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate({ subject, body, from }, "Message captured.")) {
              setAdd(false);
              setSubject("");
              setBody("");
              setFrom("");
            }
          }}
        >
          <label>
            From or source
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="A person or company"
            />
          </label>
          <label>
            Subject
            <input required value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Message
            <textarea required value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {failure && <Notice error>{failure}</Notice>}
          <button className="op-button primary" disabled={busy}>
            {busy ? <Busy /> : <Plus size={14} />}Capture message
          </button>
        </form>
      </Modal>
    </div>
  );
}

function InboxOverview({
  messages,
  accounts,
  nativeAccounts,
  onSource,
  onMessage,
  ask,
  onQuestion,
  onAsk,
  onResetAsk,
  onResult,
}: {
  messages: Message[];
  accounts: { id: string; connected: boolean }[];
  nativeAccounts: { id: string; lastSync?: string; error?: string }[];
  onSource: (id: string) => void;
  onMessage: (message: Message) => void;
  ask: InboxAskState;
  onQuestion: (question: string) => void;
  onAsk: () => void;
  onResetAsk: () => void;
  onResult: (result: InboxAskResult) => void;
}) {
  const sources = providers.filter((p) => p.id !== "all" && p.id !== "jev" && p.id !== "youtube");
  const candidates = messages
    .filter((m) => {
      if (
        m.status === "done" ||
        m.labelIds?.some((id) => ["DRAFT", "SENT", "TRASH", "SPAM"].includes(id))
      )
        return false;
      if (m.source === "gmail" && m.labelIds && !m.labelIds.includes("INBOX")) return false;
      return (
        !!m.draft ||
        m.category === "needs-you" ||
        m.category === "sponsors" ||
        m.category === "waiting"
      );
    })
    .sort(
      (a, b) =>
        Number(!!b.draft) - Number(!!a.draft) ||
        Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
    );
  const grouped = sources.map((source) => {
    const loaded = messages.filter((m) => m.source === source.id);
    const native = nativeAccounts.find((account) => account.id === source.id);
    const connected = !!accounts.find(
      (a) => a.id === (source.id === "gmail" ? "google" : source.id) && a.connected,
    );
    const count = loaded.length;
    const review: Message[] = candidates.filter((m) => m.source === source.id).slice(0, 2);
    return { ...source, connected, native, count, review };
  });
  const review = grouped.flatMap((source) => source.review);
  function nextStep(message: Message) {
    if (message.draft) return "Review your draft reply";
    if (message.category === "sponsors") return "Review opportunity";
    if (message.category === "waiting") return "Check the follow-up";
    return "Review and decide";
  }
  return (
    <section className="wi-overview" aria-label="Inbox overview">
      <header className="wi-overview-heading">
        <div>
          <h2>Your conversations, at a glance.</h2>
          <p>Choose a source, or pick up a conversation that needs a closer look.</p>
        </div>
      </header>
      <div className="wi-overview-sources">
        {grouped.map((source) => (
          <button
            key={source.id}
            className="wi-overview-source"
            onClick={() => onSource(source.id)}
          >
            <span className="wi-overview-source-top">
              <SourceLogo source={source.id} />
              <strong>{source.label}</strong>
              <ArrowUpRight size={15} />
            </span>
            <span className="wi-overview-source-count">
              {source.count ? source.count.toLocaleString() : "—"}
              <small>{source.count ? "messages loaded" : "No messages loaded"}</small>
            </span>
            <span className="wi-overview-source-status">
              <i className={source.connected || source.native && !source.native.error ? "connected" : ""} />
              {source.connected ? "Connected" : source.native ? source.native.error ? "Refresh needs attention" : "Read through Codex" : source.count ? "Saved messages" : "Not connected"}
              <ChevronRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <div className="wi-overview-review">
        <header>
          <div>
            <h3>Worth a look</h3>
            <p>Draft replies, flagged conversations and opportunities.</p>
          </div>
          <span>From your loaded conversations</span>
        </header>
        <div className="wi-overview-ask">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAsk();
            }}
            aria-label="Ask Worth a look"
          >
            <MessageSquare size={18} />
            <input
              aria-label="Question about your inbox"
              placeholder="What needs my reply? Ask about a person, topic or conversation…"
              maxLength={600}
              value={ask.question}
              disabled={ask.busy}
              onChange={(e) => onQuestion(e.target.value)}
            />
            <button
              type="submit"
              aria-label={ask.busy ? "Finding conversations" : "Ask about your inbox"}
              disabled={ask.busy || !ask.question.trim()}
            >
              {ask.busy ? <Busy /> : <ArrowUpRight size={17} />}
              <span>{ask.busy ? "Finding…" : "Ask"}</span>
            </button>
          </form>
          {ask.busy ? (
            <p className="wi-ask-pending" role="status">
              Finding relevant conversations in your loaded inbox…
            </p>
          ) : (
            <p className="wi-ask-hint">
              Find the context. Open the conversation. Reply right here.
            </p>
          )}
          {ask.error && (
            <div className="wi-ask-error" role="alert">
              <p>{ask.error}</p>
              <button disabled={ask.busy || !ask.question.trim()} onClick={onAsk}>
                Try again
                <RefreshCw size={12} />
              </button>
            </div>
          )}
        </div>
        {ask.response && !ask.busy ? (
          <div className="wi-ask-results" aria-label="Inbox question results">
            <header>
              <div>
                <span>
                  {ask.response.mode === "answer"
                    ? "ANSWER FROM YOUR CONVERSATIONS"
                    : "CONVERSATION SEARCH"}
                </span>
                <h4>{ask.response.question}</h4>
              </div>
              <button aria-label="Clear question results" onClick={onResetAsk}>
                <X size={15} />
              </button>
            </header>
            {ask.thinking && (
              <p className="wi-ask-thinking" role="status">
                <Busy />
                Thinking about these conversations…
              </p>
            )}
            {ask.response.answer && <p className="wi-ask-answer">{ask.response.answer}</p>}
            {ask.response.notice && <p className="wi-ask-notice">{ask.response.notice}</p>}
            {ask.response.results.length ? (
              <div className="wi-ask-source-list">
                {ask.response.results.map((result) => (
                  <article className="wi-ask-source" key={`${result.source}:${result.id}`}>
                    <div className="wi-ask-source-heading">
                      <span className="wi-overview-item-logo">
                        <SourceLogo source={result.source} />
                      </span>
                      <div>
                        <strong>{senderName(result.from)}</strong>
                        <small>
                          {sourceName(result.source)} · {messageDate(result.receivedAt)}
                          {result.direction === "outbound" ? " · Sent by you" : ""}
                        </small>
                      </div>
                    </div>
                    <h5>{result.title}</h5>
                    <blockquote>
                      {result.excerpt || "Open this conversation to read its contents."}
                    </blockquote>
                    <footer>
                      <span>{result.reason}</span>
                      <button onClick={() => onResult(result)}>
                        Read &amp; reply
                        <Reply size={14} />
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="wi-ask-no-results">
                <Search size={22} />
                <h5>No matching conversations in the loaded inbox.</h5>
                <p>
                  Try a person’s name or a more specific topic, or refresh the source to load recent
                  messages.
                </p>
              </div>
            )}
            <div className="wi-ask-coverage">
              <span>
                {ask.response.results.length < ask.response.matchedCount
                  ? `Showing ${ask.response.results.length} of ${ask.response.matchedCount.toLocaleString()} matches`
                  : `${ask.response.matchedCount.toLocaleString()} ${ask.response.matchedCount === 1 ? "match" : "matches"}`}{" "}
                · {ask.response.totalSearched.toLocaleString()} searched
              </span>
              <p>{ask.response.coverage}</p>
            </div>
          </div>
        ) : !ask.busy && review.length ? (
          <div className="wi-overview-items">
            {review.map((message) => (
              <button
                key={message.id}
                className="wi-overview-item"
                onClick={() => onMessage(message)}
              >
                <span className="wi-overview-item-logo">
                  <SourceLogo source={message.source} />
                </span>
                <span className="wi-overview-item-copy">
                  <span>
                    <strong>{senderName(message.from)}</strong>
                    <small>
                      {sourceName(message.source)} · {messageDate(message.receivedAt)}
                    </small>
                  </span>
                  <b>{message.subject}</b>
                  <p>{message.body || "Open the conversation to review its contents."}</p>
                </span>
                <span className="wi-overview-next">
                  {nextStep(message)}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
          </div>
        ) : !ask.busy && !ask.response ? (
          <div className="wi-overview-clear">
            <Check size={25} />
            <h4>No conversations flagged here.</h4>
            <p>
              Open a source above to browse your messages. This overview reflects what has been
              loaded.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InboxThemeControl({
  theme,
  onChange,
}: {
  theme: "light" | "dark";
  onChange: (theme: "light" | "dark") => void;
}) {
  return (
    <button
      type="button"
      className="wi-theme-control"
      aria-label={theme === "dark" ? "Switch Inbox to light" : "Switch Inbox to dark"}
      title="Inbox appearance only"
      onClick={() => onChange(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      <span>{theme === "dark" ? "Light inbox" : "Dark inbox"}</span>
    </button>
  );
}

type PreviewMessage = { id: string; name: string; body: string; time: string; mine?: boolean };
type PreviewThread = {
  id: string;
  name: string;
  title: string;
  initials: string;
  color: string;
  action: string;
  context: string;
  channel?: boolean;
  unread: boolean;
  archived?: boolean;
  messages: PreviewMessage[];
};
const PREVIEW_THREADS: Record<"slack" | "outlook", PreviewThread[]> = {
  slack: [
    {
      id: "launch",
      name: "launch-team",
      title: "Thursday launch",
      initials: "#",
      color: "violet",
      channel: true,
      unread: true,
      action: "Approve the launch headline so the team can schedule the announcement.",
      context:
        "This example team has finished the page and email. The headline is the last decision before scheduling.",
      messages: [
        {
          id: "s1",
          name: "Lena Brooks",
          time: "09:42",
          body: "Morning team! The launch page and welcome email are ready for the final check.",
        },
        {
          id: "s2",
          name: "Noah Ellis",
          time: "09:45",
          body: "I’ve attached the final headline options in the project. My vote is ‘Make room for your best work.’",
        },
        {
          id: "s3",
          name: "Lena Brooks",
          time: "09:48",
          body: "Could you give us the green light on the headline? Then I can schedule everything for Thursday.",
        },
      ],
    },
    {
      id: "design",
      name: "design-review",
      title: "A calmer first impression",
      initials: "#",
      color: "blue",
      channel: true,
      unread: false,
      action: "Choose one of the two onboarding directions.",
      context:
        "The example design team has prepared two directions. Both use the same feature set.",
      messages: [
        {
          id: "s4",
          name: "Theo James",
          time: "08:30",
          body: "I’ve simplified the first screen. There are now just two decisions instead of five.",
        },
        {
          id: "s5",
          name: "Lena Brooks",
          time: "08:34",
          body: "The quieter version feels much easier to use. Let’s walk through it in our next review.",
        },
      ],
    },
    {
      id: "maya",
      name: "Maya Turner",
      title: "A quick handover",
      initials: "MT",
      color: "rose",
      unread: true,
      action: "Confirm the owner of Friday’s customer handover.",
      context: "Maya is handing off an example customer project before taking Friday off.",
      messages: [
        {
          id: "s6",
          name: "Maya Turner",
          time: "Yesterday",
          body: "Hey! I’m away Friday. Would you be able to cover the 15-minute customer handover? The notes are all ready.",
        },
      ],
    },
  ],
  outlook: [
    {
      id: "proposal",
      name: "Elena Wright",
      title: "Partnership proposal — your thoughts?",
      initials: "EW",
      color: "blue",
      unread: true,
      action: "Review the proposed scope and confirm whether the dates work.",
      context:
        "This fictional partnership is at the proposal stage. The sender needs a scope decision before preparing an agreement.",
      messages: [
        {
          id: "o1",
          name: "Elena Wright",
          time: "10:24",
          body: "Hi,\n\nThanks for the conversation yesterday. I’ve put together the partnership outline based on the three outcomes we discussed.\n\nThe proposed start is the first week of next month, with a short review after the initial two weeks. Does that timing work for you?\n\nIf the scope looks right, I can prepare the agreement this afternoon.\n\nBest,\nElena",
        },
      ],
    },
    {
      id: "workshop",
      name: "Daniel Park",
      title: "Workshop agenda for next week",
      initials: "DP",
      color: "mint",
      unread: false,
      action: "Add your preferred topic before the agenda is finalised.",
      context: "The fictional workshop covers customer discovery, automation and delivery.",
      messages: [
        {
          id: "o2",
          name: "Daniel Park",
          time: "09:10",
          body: "Hello,\n\nHere’s the draft agenda for our workshop next week. We have time for one additional topic.\n\nIs there anything you’d particularly like the group to work through?\n\nThanks,\nDaniel",
        },
      ],
    },
    {
      id: "recap",
      name: "Mira Chen",
      title: "Notes from our planning session",
      initials: "MC",
      color: "violet",
      unread: false,
      action: "No immediate reply needed. Keep the decisions for the next planning session.",
      context: "This is an example recap with three decisions and a follow-up date.",
      messages: [
        {
          id: "o3",
          name: "Mira Chen",
          time: "Yesterday",
          body: "Hi,\n\nA short recap of today’s planning session:\n\n1. Start with the onboarding experience.\n2. Keep the first release focused.\n3. Review customer feedback together next Friday.\n\nLet me know if I missed anything.\n\nMira",
        },
      ],
    },
  ],
};

/** Standalone fictional previews. Never passed to operatorRequest, shared memory or assistant context. */
function ProviderPreview({ provider }: { provider: "gmail" | "slack" | "outlook" }) {
  const isEmail = provider === "gmail" || provider === "outlook";
  const seed = PREVIEW_THREADS[provider === "gmail" ? "outlook" : provider];
  const key = `aos-inbox-demo-v1:${provider}`;
  const [threads, setThreads] = useState<PreviewThread[]>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || "null");
      if (
        Array.isArray(stored) &&
        stored.length === seed.length &&
        stored.every(
          (t: PreviewThread) =>
            seed.some((s) => s.id === t.id) &&
            typeof t.unread === "boolean" &&
            Array.isArray(t.messages) &&
            t.messages.every((m) => typeof m.body === "string" && typeof m.name === "string"),
        )
      )
        return stored;
    } catch {}
    return structuredClone(seed);
  });
  const [selected, setSelected] = useState(threads[0].id),
    [text, setText] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [context, setContext] = useState(false),
    [folder, setFolder] = useState("inbox"),
    [writing, setWriting] = useState(!isEmail),
    [ccOpen, setCcOpen] = useState(false),
    [bccOpen, setBccOpen] = useState(false),
    [cc, setCc] = useState(""),
    [bcc, setBcc] = useState("");
  const visible = threads.filter(
    (t) =>
      (!isEmail || (folder === "archive" ? t.archived : !t.archived)) &&
      `${t.name} ${t.title} ${t.messages.map((message) => message.body).join(" ")}`.toLowerCase().includes(search.toLowerCase()),
  );
  const thread = visible.find((t) => t.id === selected) || visible[0];
  const lastMessage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(threads));
    } catch {}
  }, [key, threads]);
  function choose(id: string) {
    setSelected(id);
    setText("");
    setContext(false);
    setWriting(!isEmail);
    setStatus("");
    setThreads((old) => old.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }
  function send() {
    if (!thread || !text.trim()) return;
    const message: PreviewMessage = {
      id: crypto.randomUUID(),
      name: "You",
      body: text.trim(),
      time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      mine: true,
    };
    setThreads((old) =>
      old.map((t) =>
        t.id === thread.id ? { ...t, unread: false, messages: [...t.messages, message] } : t,
      ),
    );
    setText("");
    setStatus("Demo reply added. Nothing was sent.");
    window.setTimeout(
      () => lastMessage.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      50,
    );
  }
  return (
    <section
      className={`wi-preview wi-preview-${provider} ${provider === "gmail" ? "wi-preview-outlook" : ""}`}
      aria-label={`${sourceName(provider)} demo workspace`}
    >
      {isEmail && (
        <div className="wi-outlook-command">
          <SourceLogo source={provider} />
          <strong>{sourceName(provider)}</strong>
          <span>Demo mailbox</span>
          <button
            onClick={() => {
              if (thread) setWriting(true);
            }}
          >
            <Mail size={15} />
            Reply
          </button>
          <button
            disabled={!thread}
            onClick={() => {
              if (thread) {
                setThreads((old) =>
                  old.map((t) => (t.id === thread.id ? { ...t, archived: !t.archived } : t)),
                );
                setStatus("Moved in this demo only.");
              }
            }}
          >
            <Archive size={15} />
            {folder === "archive" ? "Restore" : "Archive"}
          </button>
        </div>
      )}
      <div className="wi-preview-layout">
        <aside className="wi-preview-rail">
          {provider === "slack" ? (
            <>
              <div className="wi-slack-workspace">
                <strong>Northstar Studio</strong>
                <ChevronDown size={15} />
                <small>Fictional team workspace</small>
              </div>
              <div className="wi-preview-home">
                <MessageSquare size={16} />
                Conversations
              </div>
              <span className="wi-preview-group">Channels</span>
              {threads
                .filter((t) => t.channel)
                .map((t) => (
                  <button
                    key={t.id}
                    className={thread?.id === t.id ? "active" : ""}
                    onClick={() => choose(t.id)}
                  >
                    <Hash size={15} />
                    <span>{t.name}</span>
                    {t.unread && <i />}
                  </button>
                ))}
              <span className="wi-preview-group">Direct messages</span>
              {threads
                .filter((t) => !t.channel)
                .map((t) => (
                  <button
                    key={t.id}
                    className={thread?.id === t.id ? "active" : ""}
                    onClick={() => choose(t.id)}
                  >
                    <span className={`wi-preview-avatar ${t.color}`}>{t.initials}</span>
                    <span>{t.name}</span>
                    {t.unread && <i />}
                  </button>
                ))}
            </>
          ) : (
            <>
              <small>FAVOURITES</small>
              <button
                className={folder === "inbox" ? "active" : ""}
                onClick={() => setFolder("inbox")}
              >
                <Inbox size={16} />
                Inbox<span>{threads.filter((t) => !t.archived).length}</span>
              </button>
              <button
                className={folder === "archive" ? "active" : ""}
                onClick={() => setFolder("archive")}
              >
                <Archive size={16} />
                Archive<span>{threads.filter((t) => t.archived).length || ""}</span>
              </button>
              <div className="wi-preview-rail-note">
                Your example mailbox.
                <br />
                All changes are local to this demo.
              </div>
            </>
          )}
        </aside>
        {provider !== "slack" && (
          <aside className="wi-preview-conversations">
            <header>
              <h2>{folder === "archive" ? "Archive" : "Inbox"}</h2>
              <small>
                {provider === "gmail" ? "Primary" : "Focused"} <span>{provider === "gmail" ? "Updates" : "Other"}</span>
              </small>
            </header>
            <label className="wi-preview-search">
              <Search size={15} />
              <input
                aria-label={`Search ${sourceName(provider)} demo`}
                placeholder="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div>
              {visible.map((t) => (
                <button
                  className={`wi-preview-conversation ${thread?.id === t.id ? "active" : ""}`}
                  key={t.id}
                  onClick={() => choose(t.id)}
                >
                  <span className={`wi-preview-avatar ${t.color}`}>{t.initials}</span>
                  <span>
                    <strong>{t.name}</strong>
                    {isEmail && <b>{t.title}</b>}
                    <small>{t.messages.at(-1)?.body.replace(/\s+/g, " ")}</small>
                  </span>
                  {t.unread && <i />}
                </button>
              ))}
            </div>
          </aside>
        )}
        {thread ? (
          <div className="wi-preview-thread">
            <header className="wi-preview-thread-heading">
              <div>
                {provider === "slack" ? (
                  <h2>
                    {thread.channel ? (
                      <Hash size={21} />
                    ) : (
                      <span className={`wi-preview-avatar ${thread.color}`}>{thread.initials}</span>
                    )}
                    {thread.name}
                  </h2>
                ) : (
                  <h2>{thread.title}</h2>
                )}
                <p>
                  {provider === "slack"
                    ? thread.channel
                      ? "Launch plans and decisions from your team."
                      : "Direct message · fictional teammate"
                    : "Example email · fictional sender"}
                </p>
              </div>
              <button
                aria-label={thread.unread ? "Mark read in demo" : "Mark unread in demo"}
                title={thread.unread ? "Mark read in demo" : "Mark unread in demo"}
                onClick={() =>
                  setThreads((old) =>
                    old.map((t) => (t.id === thread.id ? { ...t, unread: !t.unread } : t)),
                  )
                }
              >
                {thread.unread ? <MailOpen size={17} /> : <Mail size={17} />}
              </button>
            </header>
            <div className="wi-preview-next-step">
              <span>EXAMPLE NEXT STEP</span>
              <p>{thread.action}</p>
              <button onClick={() => setContext(!context)} aria-expanded={context}>
                {context ? "Hide context" : "Why this matters"}
                <ChevronDown size={12} />
              </button>
              {context && <div>{thread.context}</div>}
            </div>
            <div className="wi-preview-transcript" role="log" aria-label="Demo conversation">
              <span className="wi-preview-day">Demo conversation</span>
              {thread.messages.map((m) => (
                <article key={m.id} className={`wi-preview-message ${m.mine ? "mine" : ""}`}>
                  {isEmail ? (
                    <div className="wi-outlook-message-sender">
                      <span className={`wi-preview-avatar ${m.mine ? "blue" : thread.color}`}>
                        {m.mine ? "YO" : thread.initials}
                      </span>
                      <strong>
                        {m.name}
                        <small>
                          {m.mine
                            ? "to fictional recipient"
                            : `${thread.name.toLowerCase().replace(/\s/g, ".")}@example.test`}
                        </small>
                      </strong>
                      <time>{m.time}</time>
                    </div>
                  ) : provider === "slack" ? (
                    <span className={`wi-preview-avatar ${m.mine ? "blue" : thread.color}`}>
                      {m.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                  ) : null}
                  <div>
                    {provider === "slack" && (
                      <header>
                        <strong>{m.name}</strong>
                        <time>{m.time}</time>
                      </header>
                    )}
                    <p>{m.body}</p>
                  </div>
                </article>
              ))}
              <div ref={lastMessage} />
            </div>
            {isEmail && !writing ? (
              <div className="wi-demo-reply-actions">
                <button onClick={() => setWriting(true)}>
                  <Reply size={16} />
                  Reply
                </button>
                <button
                  onClick={() => {
                    setWriting(true);
                    setCcOpen(true);
                  }}
                >
                  <Users size={16} />
                  Reply all
                </button>
              </div>
            ) : (
              <form
                className={`wi-preview-compose ${isEmail ? "is-email" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                {isEmail && (
                  <>
                    <div className="wi-demo-recipients">
                      <Reply size={16} />
                      <span>To {thread.name.toLowerCase().replace(/\s/g, ".")}@example.test</span>
                      <button type="button" onClick={() => setCcOpen(!ccOpen)}>
                        Cc
                      </button>
                      <button type="button" onClick={() => setBccOpen(!bccOpen)}>
                        Bcc
                      </button>
                    </div>
                    {ccOpen && (
                      <label className="wi-demo-recipients">
                        Cc
                        <input
                          aria-label="Demo Cc"
                          value={cc}
                          onChange={(e) => setCc(e.target.value)}
                          placeholder="Fictional recipients"
                        />
                      </label>
                    )}
                    {bccOpen && (
                      <label className="wi-demo-recipients">
                        Bcc
                        <input
                          aria-label="Demo Bcc"
                          value={bcc}
                          onChange={(e) => setBcc(e.target.value)}
                          placeholder="Fictional recipients"
                        />
                      </label>
                    )}
                  </>
                )}
                <textarea
                  aria-label={`Reply in ${sourceName(provider)} demo`}
                  placeholder={
                    provider === "slack"
                      ? `Message ${thread.channel ? "# " : ""}${thread.name}…`
                      : "Write your reply…"
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <footer>
                  <span>{status || "Demo only · replies are not sent"}</span>
                  <button type="submit" disabled={!text.trim()}>
                    <Send size={15} />
                    <span>Send demo reply</span>
                  </button>
                </footer>
              </form>
            )}
          </div>
        ) : (
          <div className="wi-preview-no-results">
            <Mail size={28} />
            <h3>No conversations here</h3>
            <p>Choose a different folder or search.</p>
          </div>
        )}
      </div>
    </section>
  );
}
