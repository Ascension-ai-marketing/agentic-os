import { businessDemoSettings } from "./business-demo-settings";
import { privateAdvisorStatus, runPrivateAdvisor } from "./private-advisor";
import { mailArchive } from "./mail-archive";
import { createMailSync } from "./mail-sync";
import { mailProvider } from "./mail-provider";
import { createPhotoIndex } from "./photo-index";
import { extractChatAttachment } from "./chat-attachments";
import { workspaceProfile } from "./workspace-profile";
import { privacyPaneAction, setupDiscovery } from "./setup-discovery";
import { openAIVoice } from "./openai-voice";
import { connectedGranolaNotes } from "./granola-connected";
import { connectedNotionPages } from "./notion-connected";
import { granolaApi } from "./granola-api";
import { agentJobs } from "./agent-jobs";
import { ceoRoutes } from "./ceo-routes";
import { wakeAssets } from "./wake-assets";
import { voiceLocalImages } from "./voice-local-images";
import { voiceImages } from "./voice-images";
import { voiceRecentCreations } from "./voice-recent-creations";
import { voiceRecentEmails } from "./voice-recent-emails";
import { voiceMemory } from "./voice-memory";
import { conversationStore, ConversationConflict } from "./conversations";
import { voiceCompanion } from "./voice-companion";
import { memoryApps, type ImportedParts } from "./memory-apps";
import { memoryVault } from "./memory-vault";
import { memoryPhotos, readMemoryPhoto, saveMemoryPhoto } from "./memory-photos";
import { readBrainPreferences, writeBrainPreferences } from "./brain-preferences";
import { businessMemoryDocuments, businessEvidence } from "./business-memory";
import { memorySpaces } from "../src/lib/operator";
import {
  localMemoryFiles,
  readLocalMemories,
  imageFile,
  imageOCRAvailable,
  readImageOnCPU,
  fetchNotionPage,
  emailText,
} from "./memory-imports";
import {
  BRAIN_SOURCES,
  brainEnabled,
  sourceOrigin,
  nodeOrigin,
  brainContext,
} from "../src/lib/brain-sources";
import { accountConnections } from "./account-connections";
import { nativeConnectionDiscovery } from "./native-connection-discovery";
import { mailBackfill } from "./mail-backfill";
import { readSkillFile } from "./skill-file";
import { memoryConnectAll } from "./memory-connect-all";
import { chatgptTarget, extractChatgptExport, findChatgptExportZip, importUploadedExport } from "./chatgpt-export";
import { nativeInboxSync } from "./native-inbox-sync";
import { nativeCalendarSync } from "./native-calendar-sync";
import { nativeBusinessSync } from "./native-business-sync";
import { youtubeComments as createYouTubeComments } from "./youtube-comments";
import { replyOutbox as createReplyOutbox } from "./reply-outbox";
import { voiceRules as createVoiceRules } from "./voice-rules";
import { importInboxSnapshot } from "./inbox-imports";
import { inboxQuestions } from "./inbox-questions";
import { inboxQuestionModelAvailable, generateInboxQuestionAnswer } from "./inbox-question-model";
import { businessWorkspace } from "./business-workspace";
import { businessGoalContext } from "../src/lib/business-goal-context";
import { appDisplayName, chatAppFocus, chatTimeWindow, closestRecordLabel, recordActivityRange, recordApp, recordMatchesApp, sameDayDistance, type ChatAppFocus, type ChatTimeWindow } from "../src/lib/chat-retrieval-routing";
import { isOperatorSelfPath, isOperatorSelfTranscript } from "../src/lib/memory-self-filter";
import { discoverBusinessIntegrations, syncBusinessIntegration, configureYouTubeChannel } from "./business-integrations";
import { businessContent } from "./business-content";
import { competitorWatch } from "./competitor-watch";
import { briefModelSettings, businessBrief, checkedBriefModelKey } from "./business-brief";
import { generateBusinessBrief } from "./business-brief-generation";
import { businessToday, cityFromTimeZone } from "./business-today";
import { findMemoryFiles, allowedMemoryFile } from "./local-memory-search";
import { basename } from "node:path";
import { assistantCatalog, runAssistant } from "./assistant-adapters";
import type { Plugin } from "vite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import ical from "node-ical";
import type { OperatorState, MemorySource, InboxItem, CalendarEvent } from "../src/lib/operator";

const runFile = promisify(execFile);
const LIMIT = 8 * 1024 * 1024;
const now = () => new Date().toISOString();
const text = (v: unknown, max = 1000000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const digest = (s: string) => createHash("sha256").update(s.trim()).digest("hex");
const id = () => randomUUID();
export function privateAddress(ip: string): boolean {
  if (ip.includes(":")) return /^(::|fe[89ab]|f[cd]|2001:db8)/i.test(ip);
  const p = ip.split(".").map(Number);
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}
export async function fetchPublic(
  raw: string,
  redirects = 0,
): Promise<{ body: string; url: string; type: string }> {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["443", "80"].includes(url.port))
  )
    throw new Error("Use a public HTTP or HTTPS article URL.");
  if (/localhost|\.local$|\.internal$/i.test(url.hostname))
    throw new Error("Private network addresses cannot be imported.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new Error("Private network addresses cannot be imported.");
  const address = addresses[0];
  return new Promise((accept, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        headers: {
          "User-Agent": "OperatorOS/1.0 ArticleReader",
          Accept: "text/html,text/plain,application/json",
        },
        lookup: ((_hostname: any, options: any, callback: any) =>
          options?.all
            ? callback(null, [address])
            : callback(null, address.address, address.family)) as any,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          if (redirects >= 4) return reject(new Error("This link redirected too many times."));
          fetchPublic(new URL(response.headers.location, url).href, redirects + 1).then(
            accept,
            reject,
          );
          return;
        }
        if (!response.statusCode || response.statusCode >= 400) {
          response.resume();
          reject(
            new Error(`The source returned HTTP ${response.statusCode}. Paste its text instead.`),
          );
          return;
        }
        const type = response.headers["content-type"] || "";
        if (!/text\/|json|xml/.test(type)) {
          response.resume();
          reject(new Error("Download this document and use Upload file to import it."));
          return;
        }
        let body = "",
          size = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          size += Buffer.byteLength(chunk);
          if (size > LIMIT) request.destroy(new Error("This page is too large to import."));
          else body += chunk;
        });
        response.on("end", () => accept({ body, type, url: url.href }));
        response.on("error", reject);
      },
    );
    request.setTimeout(20000, () =>
      request.destroy(new Error("The source timed out. Paste its text or try again.")),
    );
    request.on("error", reject);
    request.end();
  });
}
export function articleText(html: string, url: string) {
  const { document } = parseHTML(html);
  document
    .querySelectorAll("script,style,nav,footer,header,noscript,svg")
    .forEach((n) => n.remove());
  const article = new Readability(document as any).parse();
  const title = article?.title || document.title || new URL(url).hostname;
  const content =
    article?.textContent ||
    document.querySelector("main,article")?.textContent ||
    document.body?.textContent ||
    "";
  return {
    title,
    text: content
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim()
      .slice(0, 600000),
  };
}
/** One /search hit. `appMatch` is false only when the question named another app.
 * `recent` marks the named app's records from the last 7 days when no window was set. */
export type MemorySearchHit = {
  inWindow: boolean;
  appMatch: boolean;
  sameDay: boolean;
  recent: boolean;
  id: string;
  title: string;
  collection: string;
  origin: string;
  /** The memory app the record came from (codex, claude, gmail…), or null for notes. */
  app: string | null;
  /** When the underlying activity happened, from the sync stamp or a dated name. */
  activityAt?: string;
  connector?: { provider: string };
  url?: string;
  image?: MemorySource["image"];
  imageUrl?: string;
  thumbnailUrl?: string;
  extraction?: MemorySource["extraction"];
  score: number;
  excerpt: string;
  updatedAt: string;
};
export type MemorySearch = {
  results: MemorySearchHit[];
  /** Apps the question named; their records rank first and other apps' records are dropped once one matches. */
  focus: ChatAppFocus[];
  /** The nearest same-day record when the named window holds none, e.g. "12:31 Codex session". */
  closest?: { id: string; title: string; label: string };
  /** Ready records per memory app across the whole library, for the "Checked" line. */
  appRecords: Record<string, number>;
};
const RECENT_WINDOW = 7 * 24 * 60 * 60 * 1000;
// Words that describe asking an app rather than a topic. A question made only of
// these and app names ("How about Claude?", "what did I say to Codex") is about the
// app's recent activity, so its last 7 days rank first. Any other word ("Hermes
// design", "invoice") makes it a topic search where recency is only a tiebreak.
const GENERIC_TERMS = new Set([
  "how", "did", "do", "does", "say", "said", "tell", "told", "talk", "talked", "ask", "asked", "work", "worked", "working",
  "use", "used", "using", "session", "sessions", "conversation", "conversations", "chat", "chats", "recent", "recently",
  "latest", "last", "earlier", "today", "yesterday", "morning", "afternoon", "evening", "tonight", "week", "time", "times",
  "same", "thing", "things", "just", "now", "then", "also", "again", "there", "here", "was", "were", "been", "has", "had",
  "any", "all", "some", "something", "anything", "which", "who", "why", "one", "ones", "stuff", "memory", "memories",
  "record", "records", "in", "on", "at", "to", "of", "me", "my", "you", "we", "us", "it", "its", "those", "these", "them",
  "they", "bro", "hey", "hi", "hello",
  "codex", "claude", "hermes", "gmail", "outlook", "slack", "notion", "granola", "obsidian", "chatgpt",
]);
/** Keyword search over ready sources. A dated question ranks records from that
 * window first, then the nearest same-day records; a named app ranks its own
 * records first, and without a window its records from the last 7 days come
 * before older ones. Among equal scores dated records beat undated ones and
 * newer activity beats older. The OS's own check and runtime transcripts never appear.
 * `options.focus` carries a follow-up's inherited app; `options.now` fixes the clock for tests. */
export function searchMemory(
  sources: MemorySource[],
  query: string,
  collection?: string,
  window?: ChatTimeWindow | null,
  options: { focus?: ChatAppFocus[]; now?: number } = {},
): MemorySearch {
  const lower = query.toLowerCase();
  const now = options.now ?? Date.now();
  // A token with punctuation ("rollout-2026-09-18T12-31") is a phrase: the exact
  // title match must beat records that merely repeat its digits.
  const phrases = [...new Set(lower.split(/\s+/).filter((p) => p.length >= 6 && /[^\p{L}\p{N}]/u.test(p)))];
  const focus = options.focus?.length ? options.focus : chatAppFocus(query);
  const terms = [...new Set(lower.match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(
    (t) =>
      ![
        "what",
        "when",
        "where",
        "does",
        "this",
        "that",
        "with",
        "have",
        "from",
        "about",
        "your",
        "please",
        "the",
        "and",
        "for",
        "are",
        "can",
        "our",
      ].includes(t),
  );
  const library = sources.filter(
    (s) =>
      !s.deletedAt &&
      s.status === "ready" &&
      (!collection || s.collection === collection) &&
      !isOperatorSelfPath(s.connector?.path) &&
      !isOperatorSelfTranscript(s.text),
  );
  const appRecords: Record<string, number> = {};
  for (const s of library) {
    const app = recordApp(s);
    if (app) appRecords[app] = (appRecords[app] || 0) + 1;
  }
  const aboutApp = focus.length > 0 && !window && terms.every((t) => GENERIC_TERMS.has(t));
  const ranked = library
    .map((s) => {
      const title = s.title.toLowerCase(), body = s.text.toLowerCase(), hay = `${title} ${body}`;
      const score =
        terms.reduce((n, t) => n + (title.includes(t) ? 6 : 0) + Math.min(8, hay.split(t).length - 1), 0) +
        phrases.reduce((n, p) => n + (title.includes(p) ? 40 : hay.includes(p) ? 14 : 0), 0);
      const at = Math.max(0, [...phrases, ...terms].map((t) => body.indexOf(t)).find((n) => n >= 0) ?? 0);
      const range = recordActivityRange(s);
      const distance = window && range ? sameDayDistance(range, window) : null;
      const inWindow = distance === 0;
      const appMatch = !focus.length || focus.some((app) => recordMatchesApp(s, app.id));
      // Without a window, a named app's records from the last 7 days answer before its older ones.
      const recent = !window && focus.length > 0 && appMatch && !!range && now - range.end <= RECENT_WINDOW && range.start <= now + RECENT_WINDOW;
      const hit: MemorySearchHit = {
        inWindow,
        appMatch,
        sameDay: distance !== null,
        recent,
        id: s.id,
        title: s.title,
        collection: s.collection,
        origin: sourceOrigin(s),
        app: recordApp(s),
        ...(range ? { activityAt: new Date(range.start).toISOString() } : {}),
        ...(s.connector ? { connector: { provider: s.connector.provider } } : {}),
        url: s.url,
        ...(s.image ? { image: s.image, imageUrl: s.image.url, thumbnailUrl: s.image.thumbnailUrl, extraction: s.extraction } : {}),
        score: score + (inWindow ? 12 : 0),
        excerpt: s.text.slice(Math.max(0, at - 100), at + 1600),
        updatedAt: s.updatedAt,
      };
      return { hit, range, distance: distance === null ? Number.MAX_SAFE_INTEGER : distance, activity: range ? range.end : Number.NEGATIVE_INFINITY };
    })
    .filter((s) => !terms.length || s.hit.score > 0 || s.hit.sameDay || (aboutApp && s.hit.recent));
  // Records from the named app answer the question; other apps' records only stand in when it has none.
  const candidates = focus.length && ranked.some((s) => s.hit.appMatch) ? ranked.filter((s) => s.hit.appMatch) : ranked;
  candidates.sort(
    (a, b) =>
      Number(b.hit.inWindow) - Number(a.hit.inWindow) ||
      a.distance - b.distance ||
      (aboutApp ? Number(b.hit.recent) - Number(a.hit.recent) : 0) ||
      b.hit.score - a.hit.score ||
      Number(!!b.range) - Number(!!a.range) ||
      b.activity - a.activity ||
      b.hit.updatedAt.localeCompare(a.hit.updatedAt),
  );
  const nearest = window && !candidates.some((s) => s.hit.inWindow) ? candidates.find((s) => s.hit.sameDay) : undefined;
  return {
    results: candidates.slice(0, 8).map((s) => s.hit),
    focus,
    ...(nearest && nearest.range ? { closest: { id: nearest.hit.id, title: nearest.hit.title, label: closestRecordLabel(nearest.hit, nearest.range) } } : {}),
    appRecords,
  };
}
/** The ranked hits alone. */
export function searchSources(sources: MemorySource[], query: string, collection?: string, window?: ChatTimeWindow | null, options?: { focus?: ChatAppFocus[]; now?: number }) {
  return searchMemory(sources, query, collection, window, options).results;
}

/** Inbox sources this workspace reads. */
const INBOX_SOURCES = new Set<string>(["capture", "gmail", "outlook", "slack"]);

export function operatorPlugin({
  root,
  token,
  modelKey = () => "",
  memoryHome,
}: {
  root: string;
  token: string;
  modelKey?: () => string;
  memoryHome?: string;
}): Plugin {
  const directory = resolve(root, ".operator-data");
  const file = join(directory, "workspace.json");
  const blank = (): OperatorState => ({
    version: 1,
    goals: { longTerm: "", quarter: "", week: "", metrics: [] },
    hiddenMemoryTitles: [],
    sources: [],
    inbox: [],
    events: [],
    settings: { mission: false, openclaw: false, news: true },
  });
  const load = (): OperatorState => {
    let state = blank();
    try {
      if (existsSync(file)) state = { ...state, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      throw new Error("The workspace file could not be read. Your records were left untouched.");
    }
    // Messages saved from a source this workspace does not read are ignored, so an older file still opens cleanly.
    const known = (source: unknown) => typeof source !== "string" || INBOX_SOURCES.has(source);
    if (Array.isArray(state.inbox)) state.inbox = state.inbox.filter((item) => known(item?.source));
    if (Array.isArray(state.inboxImports)) state.inboxImports = state.inboxImports.filter((item) => known(item?.provider));
    if (state.settings?.inboxAccounts) state.settings.inboxAccounts = Object.fromEntries(Object.entries(state.settings.inboxAccounts).filter(([source]) => INBOX_SOURCES.has(source))) as typeof state.settings.inboxAccounts;
    return { ...state, ...readBrainPreferences(root, state) };
  };
  const vault = memoryVault(root);
  // Records from a source this edition does not read are hidden, not deleted:
  // every save puts them back, so an older workspace file never loses history.
  const hiddenRecords = () => {
    try {
      const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      const unknown = (source: unknown) => typeof source === "string" && !INBOX_SOURCES.has(source);
      return {
        inbox: Array.isArray(raw.inbox) ? raw.inbox.filter((item: any) => unknown(item?.source)) : [],
        inboxImports: Array.isArray(raw.inboxImports) ? raw.inboxImports.filter((item: any) => unknown(item?.provider)) : [],
        inboxAccounts: raw.settings?.inboxAccounts ? Object.fromEntries(Object.entries(raw.settings.inboxAccounts).filter(([source]) => unknown(source))) : {},
      };
    } catch {
      return { inbox: [], inboxImports: [], inboxAccounts: {} };
    }
  };
  const save = (state: OperatorState) => {
    const hidden = hiddenRecords();
    const current: any = { ...state, ...readBrainPreferences(root, state) };
    if (hidden.inbox.length) current.inbox = [...(current.inbox ?? []), ...hidden.inbox];
    if (hidden.inboxImports.length) current.inboxImports = [...(current.inboxImports ?? []), ...hidden.inboxImports];
    if (Object.keys(hidden.inboxAccounts).length) current.settings = { ...current.settings, inboxAccounts: { ...hidden.inboxAccounts, ...(current.settings?.inboxAccounts ?? {}) } };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(current, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
    readBrainPreferences(root, current);
    vault.schedule(current.sources);
  };
  const accounts = accountConnections(root, load, save, { homeDir: memoryHome });
  const existingConnections = nativeConnectionDiscovery(root, { homeDir: memoryHome });
  // The rule book the reply queue learns from: every edit before sending teaches it.
  const voiceRuleBook = createVoiceRules(root, { homeDir: memoryHome });
  const youtubeQueue = createYouTubeComments(root, { homeDir: memoryHome, rules: voiceRuleBook });
  // Paced outbox: every entry comes from one click on one card; the worker
  // only spaces the sends out and records what each sender confirmed.
  const outbox = createReplyOutbox(root, {
    youtube: async item => {
      try { youtubeQueue.recordEdit(item.targetId, item.content); } catch { /* Lessons are a bonus. */ }
      const result = await youtubeQueue.reply({ commentId: item.targetId, content: item.content, requestId: item.id });
      return { status: result.status, error: result.error, retryable: result.retryable, messageId: result.replyId };
    },
  }, {
    resolvePending: item => {
      const records = youtubeQueue.status().sendRequests;
      const record = records.find(r => r.requestId === item.id);
      return record ? (record.status === "pending" ? "uncertain" : record.status) : "failed";
    },
  });
  outbox.start();
  const inboxAsk = inboxQuestions({
    load,
    archive: (question) => {
      const results = archive.search(question, 200);
      const status = archive.stats();
      return { items: results.items, total: status.total, fullBodies: status.fullBodies, metadata: status.metadata, matched: results.total, importing: status.accounts.some(account => account.status !== "complete") };
    },
    available: (model) => inboxQuestionModelAvailable(root, modelKey(), model),
    generate: (prompt, model, signal) => generateInboxQuestionAnswer(root, modelKey(), prompt, model, signal),
  });
  const conversations = conversationStore(root);
  const archive = mailArchive(root);
  const nativeInbox = nativeInboxSync(root, { load, save, archive });
  const nativeCalendar = nativeCalendarSync(root, { load, save });
  const nativeBusiness = nativeBusinessSync(root);
  let mailSync: ReturnType<typeof createMailSync> | undefined;
  const getMailSync = () => mailSync ??= createMailSync({ root, archive, identity: accounts.mailIdentity, request: accounts.readMail });
  const providerMail = mailProvider({ archive, identity: accounts.mailIdentity, request: accounts.readMail });
  const recentVoiceMail = voiceRecentEmails({
    load, nativeInbox, providerMail,
    directAccounts: async () => {
      const status = await accounts.handle("/connections", "GET", {}, undefined) as { accounts: Array<{ id: string; connected: boolean; email?: string }> };
      return status.accounts.flatMap(account => account.connected && account.email && ["google", "outlook"].includes(account.id)
        ? [{ provider: account.id === "google" ? "gmail" as const : "outlook" as const, account: account.email }] : []);
    },
  });
  const recentVoiceCreations = voiceRecentCreations({ allowed: () => brainEnabled(load(), "images") });
  const companionVoice = voiceCompanion(root);
  const openaiVoice = openAIVoice(root);
  // Runtime only: a production build must never touch or interrupt live task history.
  let nativeTasks: ReturnType<typeof agentJobs> | undefined;
  const memoryImages = voiceImages(root, load);
  const localVoiceImages = voiceLocalImages({allowed:()=>brainEnabled(load(), "images")});
  const photos = memoryPhotos(root, memoryHome);
  let photoAccess: { stamp: string; sources: Map<string, { origin: string; deleted: boolean }> } | undefined;
  const canReadSavedPhoto = (sourceId: string) => {
    const st = existsSync(file) ? statSync(file) : undefined;
    const stamp = st ? `${st.ino}:${st.size}:${st.mtimeMs}` : "empty";
    if (photoAccess?.stamp !== stamp) photoAccess = { stamp, sources: new Map(load().sources.map(s => [s.id, { origin: sourceOrigin(s), deleted: !!s.deletedAt }])) };
    const source = photoAccess.sources.get(sourceId);
    return source && !source.deleted && brainEnabled(readBrainPreferences(root), source.origin);
  };
  const business = businessWorkspace(root);
  const personalProfile = workspaceProfile(root);
  const contentStudio = businessContent(root);
  const competitorStudio = competitorWatch(root);
  const morningBrief = businessBrief(root);
  // The assistant the operator chose for the brief; only a catalog key and label are kept.
  const briefModel = briefModelSettings(root);
  const businessDemo = businessDemoSettings(root);
  // Saved balances or any dated audience observation count as live data. Demo
  // numbers only appear while nothing real has been connected.
  const hasLiveBusinessData = (workspace = business.read()) => Boolean(workspace.finances?.accounts?.length) || (workspace.snapshots || []).length > 0;
  const demoState = () => { const live = hasLiveBusinessData(), requested = businessDemo.read().enabled; return { enabled: requested && !live, requested, liveData: live }; };
  const demoActive = () => demoState().enabled;
  // Real records switch the demo flag off so a stale flag can never resurface later.
  const demoOffForLiveData = () => { if (businessDemo.read().enabled && hasLiveBusinessData()) businessDemo.save(false); };
  const displayedBrief = () => demoActive() ? businessBrief(root, "demo") : morningBrief;
  let briefGenerating = false, briefGeneratingSince = "";
  const businessSyncing = new Set<string>();
  const notionFile = join(directory, "notion.json");
  const notionToken = () =>
    existsSync(notionFile) ? JSON.parse(readFileSync(notionFile, "utf8")).token || "" : "";
  const collectionOf = (value: string, state = load()) =>
    memorySpaces(state).some((s) => s.id === value) ? value : "business";
  const sourceExcerpts = (state: OperatorState) => ({
    ...state,
    sources: state.sources.map((s) => s.text.length > 2000 ? { ...s, text: s.text.slice(0, 2000), textTruncated: true } : s),
  });
  type ReadySourceInput = {
    id?: string;
    title: string;
    text: string;
    origin: string;
    collection: string;
    replaceCollection?: boolean;
    url?: string;
    connector?: MemorySource["connector"];
    image?: MemorySource["image"];
    extraction?: MemorySource["extraction"];
    filename?: string;
  };
  function importReadyBatch(inputs: ReadySourceInput[]) {
    const state = load();
    let changed = false;
    const results = inputs.map((input) => {
      if (input.collection && !memorySpaces(state).some((s) => s.id === input.collection)) throw new Error("Choose an existing memory space.");
      if (input.text.trim().length < 15)
        throw new Error("This source does not contain enough readable text.");
      const hash = digest(input.text + (input.image ? "\nimage:" + input.image.sha256 : "")), existing = state.sources.find(
        (s) =>
          (input.connector
            ? s.connector?.provider === input.connector.provider &&
              s.connector?.itemId === input.connector.itemId
            : !s.deletedAt && s.origin === input.origin && s.hash === hash),
      );
    if (existing?.deletedAt && !existing.connector?.supersededAt) return { source: existing, skipped: true };
    const targetCollection = collectionOf(input.collection, state);
    if (existing && !existing.deletedAt && existing.hash === hash && (!input.replaceCollection || existing.collection === targetCollection)) {
      // Identical text re-read by a newer reader still refreshes the activity stamp
      // and path, so dated questions can find records saved before stamps existed.
      const stamp = input.connector, current = existing.connector;
      if (stamp && current && ((stamp.activityAt && stamp.activityAt !== current.activityAt) || (stamp.path && stamp.path !== current.path))) {
        existing.connector = { ...current, ...stamp };
        changed = true;
      }
      return { source: existing, unchanged: true };
    }
    const source: MemorySource = {
      ...(existing || {}),
      id: existing?.id || input.id || id(),
      title: text(input.title, 200),
      text: text(input.text, 600000),
      kind: "document",
      origin: input.origin,
      collection: input.replaceCollection ? targetCollection : existing?.collection || targetCollection,
      url: input.url,
      connector: input.connector,
      ...(input.image ? { image: input.image, extraction: input.extraction, filename: input.filename } : {}),
      deletedAt: undefined,
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      status: "ready",
      error: undefined,
      pinned: existing?.pinned || false,
      words: input.text.trim().split(/\s+/).length,
      hash,
    };
    state.sources = [source, ...state.sources.filter((s) => s.id !== source.id)];
    changed = true;
    return { source, updated: !!existing };
    });
    if (changed) save(state);
    return results;
  }
  function importReady(input: ReadySourceInput) { return importReadyBatch([input])[0]; }
  const photoIndex = createPhotoIndex({ root, home: memoryHome, key: modelKey, importSource: importReady, validCollection: value => memorySpaces(load()).some(space => space.id === value) });
  function reconcileImportedParts(items: ImportedParts[]) {
    const state = load();
    let changed = false;
    for (const item of items) {
      for (const source of state.sources) {
        const c = source.connector;
        if (!c || c.provider !== item.provider || source.deletedAt) continue;
        const prefix = item.itemId + ":part:", suffix = c.itemId.slice(prefix.length);
        const part = c.itemId === item.itemId ? 0 : c.itemId.startsWith(prefix) && /^\d+$/.test(suffix) ? Number(suffix) : -1;
        if (part >= 0 && (part >= item.parts || (item.keepParts && !item.keepParts.includes(part)))) {
          source.deletedAt = now();
          c.supersededAt = source.deletedAt;
          changed = true;
        }
      }
    }
    if (changed) save(state);
  }
  function syncBusinessMemory(workspace = business.read()) {
    const inputs: ReadySourceInput[] = [], completed: ImportedParts[] = [];
    for (const doc of businessMemoryDocuments(workspace)) {
      for (let n = 0; n < doc.text.length; n += 180000) {
        let part = doc.text.slice(n, n + 180000);
        if (part.trim().length < 15) part = "Observation continued:\n" + part;
        inputs.push({ title: doc.title + (n ? ` · part ${n / 180000 + 1}` : ""), text: part, collection: "business", origin: "business",
          connector: { provider: "business-dashboard", itemId: doc.id + (n ? `:part:${n / 180000}` : ""), syncedAt: now() } });
      }
      completed.push({ provider: "business-dashboard", itemId: doc.id, parts: Math.ceil(doc.text.length / 180000) });
    }
    const results: ReturnType<typeof importReadyBatch> = [];
    for (let i = 0; i < inputs.length; i += 8) results.push(...importReadyBatch(inputs.slice(i, i + 8)));
    reconcileImportedParts(completed);
    return { added: results.filter((r) => !r.updated && !r.unchanged && !r.skipped).length, updated: results.filter((r) => r.updated).length, unchanged: results.filter((r) => r.unchanged).length, skipped: results.filter((r) => r.skipped).length };
  }
  const granola = granolaApi(root);
  const voiceRecall = voiceMemory({
    load,
    recentMeetings: async () => {
      let connected = false;
      try { connected = (await nativeBusiness.status()).granola.available; } catch { /* Direct API credentials remain an independent connection. */ }
      if (connected) return { ...await connectedGranolaNotes(root, undefined, Date.now(), 30), scope: "Your Granola meetings from the last 30 days" };
      if (granola.configured()) return { ...await granola.notes(), scope: "The first page of up to 20 Granola notes" };
      throw new Error("Granola is not available through your current connection. Reconnect it in Memory.");
    },
  });
  const apps = memoryApps({
    root, home: memoryHome, importSource: importReady, importSources: importReadyBatch,
    reconcileSources: reconcileImportedParts,
    validCollection: (value) => memorySpaces(load()).some((s) => s.id === value),
    notionConfigured: () => !!notionToken(),
    granolaConnection: async (force) => {
      try { if ((await nativeBusiness.status(force)).granola.available) return "codex"; } catch { /* Direct API remains an independent option. */ }
      return granola.configured() ? "api" : undefined;
    },
    granolaNotes: async (cursor, method) => method === "codex" ? connectedGranolaNotes(root) : granola.notes(cursor),
    notionConnection: async (force) => {
      try { if ((await nativeBusiness.status(force)).notion?.available) return "codex"; } catch { /* A page import remains an independent option. */ }
      return undefined;
    },
    notionPages: () => connectedNotionPages(root),
    sourceEnabled: origin => brainEnabled(readBrainPreferences(root), origin),
    syncInfo: () => syncBusinessMemory(),
    accountStatus: async () => ({
      ...(await accounts.handle("/connections", "GET", {}, {})),
      snapshots: { gmail: load().inbox.filter((i) => i.source === "gmail").length, outlook: load().inbox.filter((i) => i.source === "outlook").length },
    }),
    syncAccount: async (provider) => {
      const status = await accounts.handle("/connections", "GET", {}, {});
      if (!("accounts" in status) || !(status.accounts || []).find((a: any) => a.id === provider)?.connected) {
        throw new Error("These saved messages are snapshots. Connect this account in Connections for provider sync.");
      }
      const result = await accounts.handle("/connections/sync", "POST", { provider }, {});
      if (!("messages" in result) || !("events" in result) || typeof result.messages !== "number" || typeof result.events !== "number") throw new Error("Provider did not report a completed sync.");
      return { messages: result.messages, events: result.events };
    },
    mailDocuments: (provider) => load().inbox.filter((i) => i.source === provider).map((i) => ({ id: i.id, title: i.subject, text: `From: ${i.from}\nDate: ${i.receivedAt}\nSubject: ${i.subject}\n\n${i.body}` })),
    afterSyncAll: () => connectAll.start(),
  });
  // A year of mail history, headers and snippets only, through the Codex mail connections.
  const mailHistory = mailBackfill(root, { archive });
  const userHome = memoryHome || homedir();
  const connectAll = memoryConnectAll(root, {
    native: { status: () => nativeInbox.status(), sync: (providers, replace) => nativeInbox.sync(providers, replace) },
    backfill: mailHistory,
    apps,
    calendar: {
      status: () => nativeCalendar.status(),
      sync: (input?: { timeMin?: string; timeMax?: string }) => nativeCalendar.sync({ enable: true, ...input }),
    },
    chatgpt: {
      find: () => findChatgptExportZip(userHome),
      extract: (zip) => extractChatgptExport(zip, userHome),
      target: () => chatgptTarget(userHome),
    },
  });
  const jobs = new Set<string>();
  const updateSource = (sourceId: string, patch: Partial<MemorySource>) => {
    const state = load(),
      source = state.sources.find((s) => s.id === sourceId);
    if (!source || source.deletedAt || source.status !== "indexing") return;
    Object.assign(source, patch, { updatedAt: now() });
    save(state);
  };
  async function ingest(source: MemorySource, input: any) {
    jobs.add(source.id);
    let temporary: string | undefined;
    try {
      let content = source.text,
        title = source.title;
      if (input.base64) {
        const bytes = Buffer.from(input.base64, "base64");
        if (bytes.length > 5 * 1024 * 1024) throw new Error("Files must be under 5 MB.");
        if (imageFile(source.filename || "")) {
          const metadata = saveMemoryPhoto(root, source.id, bytes, "upload");
          updateSource(source.id, { image: metadata });
          content = await readImageOnCPU(root, join(directory, "uploads", source.id + ".image"));
          if (content.length < 15)
            throw new Error(
              "No readable text found in this image. Add a written description; local OCR reads text, not scenes.",
            );
        } else if (/\.eml$/i.test(source.filename || "")) {
          content = emailText(
            bytes.toString("utf8"),
            (html) => articleText(html, "https://email.local").text,
          );
        } else if (/\.pdf$/i.test(source.filename || "")) {
          temporary = mkdtempSync(join(tmpdir(), "operator-pdf-"));
          const pdf = join(temporary, "document.pdf");
          writeFileSync(pdf, bytes);
          const result = await runFile("pdftotext", ["-layout", pdf, "-"], {
            timeout: 25000,
            maxBuffer: LIMIT,
          });
          content = result.stdout;
        } else {
          if (!/\.(txt|md|markdown|csv|json|html|htm|vtt|srt)$/i.test(source.filename || ""))
            throw new Error("Upload a PDF, text, Markdown, CSV, JSON, HTML or transcript file.");
          content = bytes.toString("utf8");
          if (/\.html?$/i.test(source.filename || ""))
            content = articleText(content, "https://document.local").text;
        }
      } else if (
        source.extraction === "local-ocr" &&
        !content &&
        existsSync(join(directory, "uploads", source.id + ".image"))
      ) {
        content = await readImageOnCPU(root, join(directory, "uploads", source.id + ".image"));
      } else if (source.url && !content) {
        const url = new URL(source.url);
        if (/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) {
          const videoId =
            url.hostname === "youtu.be"
              ? url.pathname.slice(1)
              : url.searchParams.get("v") || url.pathname.split("/").pop();
          if (!videoId || !/^[\w-]{11}$/.test(videoId))
            throw new Error("Use a link to one YouTube video.");
          temporary = mkdtempSync(join(tmpdir(), "operator-youtube-"));
          try {
            await runFile(
              "yt-dlp",
              [
                "--no-playlist",
                "--skip-download",
                "--write-info-json",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                "en.*",
                "--sub-format",
                "vtt",
                "-o",
                join(temporary, "video.%(ext)s"),
                `https://www.youtube.com/watch?v=${videoId}`,
              ],
              { timeout: 75000, maxBuffer: 1024 * 1024 },
            );
          } catch {
            throw new Error(
              "YouTube did not provide a transcript. Paste the transcript here or upload a VTT file.",
            );
          }
          const captions = readdirSync(temporary).find((n) => n.endsWith(".vtt"));
          if (!captions)
            throw new Error("No transcript was available. Paste or upload a transcript.");
          const lines = readFileSync(join(temporary, captions), "utf8")
            .split("\n")
            .filter((l) => l.trim() && !/^(WEBVTT|Kind:|Language:|NOTE|\d+$|\d\d:)/.test(l))
            .map((l) => l.replace(/<[^>]*>/g, "").trim());
          content = [...new Set(lines)].join("\n");
          const metadata = join(temporary, "video.info.json");
          if (existsSync(metadata))
            title = JSON.parse(readFileSync(metadata, "utf8")).title || title;
        } else {
          const page = await fetchPublic(source.url);
          const extracted = page.type.includes("html")
            ? articleText(page.body, page.url)
            : { title, text: page.body };
          content = extracted.text;
          if (!input.title) title = extracted.title;
        }
      }
      content = text(content, 600000);
      if (content.length < 15)
        throw new Error("There isn't enough readable text to index. Add a note or transcript.");
      updateSource(source.id, {
        text: content,
        title,
        status: "ready",
        error: undefined,
        words: content.split(/\s+/).length,
        hash: source.hash,
      });
    } catch (error) {
      updateSource(source.id, { status: "error", error: (error as Error).message });
    } finally {
      jobs.delete(source.id);
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    }
  }
  let newsCache: { at: number; data: any } | undefined;
  // Weather follows the operator's own city, then their time zone; a fresh copy asks for nothing.
  const today = businessToday({ city: () => {
    const profile = personalProfile.read() as { city?: string; timeZone?: string };
    const own = typeof profile.city === "string" ? profile.city.trim().slice(0, 80) : "";
    if (own) return { name: own, source: "profile" };
    const derived = cityFromTimeZone(profile.timeZone);
    return derived ? { name: derived, source: "timezone" } : undefined;
  } });
  return {
    name: "operator-workspace",
    configureServer(server) {
      nativeTasks = agentJobs(root);
      const ceo = ceoRoutes({ root, jobs: () => nativeTasks!.list().jobs,
        goals: () => (brainEnabled(load(), "business") ? businessGoalContext(business.read()).goals : null) });
      apps.startTimer();
      getMailSync();
      server.httpServer?.once("close", () => { apps.stop(); vault.stop(); photoIndex.close(); mailSync?.close(); existingConnections.close(); nativeTasks?.close(); });
      // The "Hey Jarvis" listener's model and runtime files, from the installed packages.
      server.middlewares.use("/__wake", wakeAssets(root));
      server.middlewares.use("/__operator", async (req, res, next) => {
        const send = (value: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(value));
        };
        try {
          if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || ""))
            return send({ error: "Local access only" }, 403);
          const host = req.headers.host || "";
          if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host))
            return send({ error: "Local host required" }, 403);
          const ownOrigin = `http://${host}`;
          const callbackUrl = new URL(req.url || "/", ownOrigin);
          if (
            (req.method || "GET") === "GET" &&
            /^\/connections\/callback\/(google|outlook)$/.test(callbackUrl.pathname)
          ) {
            return await accounts.callback(callbackUrl.pathname, callbackUrl, req, res);
          }
          if (req.headers.origin && req.headers.origin !== ownOrigin)
            return send({ error: "Unknown origin" }, 403);
          if (req.headers["sec-fetch-site"] === "cross-site")
            return send({ error: "Cross-site request blocked" }, 403);
          const url = new URL(req.url || "/", "http://localhost"),
            path = url.pathname,
            method = req.method || "GET";
          if (method !== "GET" && req.headers["x-claude-os-token"] !== token)
            return send({ error: "Refresh this page and try again." }, 403);
          // A ChatGPT export chosen in the app streams straight to disk; it can be gigabytes.
          if (path === "/memory/chatgpt/upload" && method === "POST") {
            const name = url.searchParams.get("name") || "export.zip";
            if (!/\.(zip|json)$/i.test(name)) return send({ error: "Choose the ChatGPT export zip or conversations.json." }, 400);
            const result = await importUploadedExport(join(root, ".operator-data"), userHome, req, name);
            await apps.list(true).catch(() => undefined);
            try { apps.configure("chatgpt", { enabled: true, autoSync: true }); apps.start("chatgpt", { catchUp: true }); } catch { /* the file is in place; Refresh all imports it */ }
            return send({ ok: true, ...result }, 202);
          }
          let body: any = {};
          if (method !== "GET") {
            if (!req.headers["content-type"]?.includes("application/json"))
              return send({ error: "JSON required" }, 415);
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > (/^\/memory\/apps\/(chatgpt|granola)\/import$/.test(path) ? 64 * 1024 * 1024 : LIMIT)) throw new Error("The upload is too large.");
              chunks.push(Buffer.from(chunk));
            }
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          }
          if (path === "/agent-jobs" && method === "GET") return send(nativeTasks!.list());
          if (path === "/agent-jobs/status" && method === "GET") return send(await nativeTasks!.status());
          if (path === "/agent-jobs" && method === "POST") return send(nativeTasks!.create(body), 202);
          if (path === "/agent-jobs/check" && method === "POST") return send(nativeTasks!.create(body, true), 202);
          if (path === "/agent-jobs/respond" && method === "POST") return send(nativeTasks!.respond(body));
          if (path === "/agent-jobs/cancel" && method === "POST") return send(nativeTasks!.cancel(body));
          if (path === "/agent-jobs/continue" && method === "POST") return send(nativeTasks!.continue(body), 202);
          if (path === "/ceo" || path.startsWith("/ceo/")) return send(await ceo.handle(path, method, body));
          if (path === "/connections/youtube" || path.startsWith("/connections/youtube/")) return send(await youtubeQueue.handle(path, method, body));
          if (path === "/connections/outbox" || path.startsWith("/connections/outbox/")) return send(await outbox.handle(path, method, body));
          if (path.startsWith("/connections"))
            return send(await accounts.handle(path, method, body, res));
          if (path.startsWith("/voice/")) {
            res.setHeader("Cache-Control", "no-store");
            if (path === "/voice/memory/read" && method === "POST") return send(voiceRecall.read(body.id, body.query));
            if (path === "/voice/recent-meetings" && method === "POST") return send(await voiceRecall.meetings(body.query || ""));
            if (path === "/voice/recent-emails" && method === "POST") return send(await recentVoiceMail.recent());
            if (path === "/voice/recent-creations" && method === "POST") return send(recentVoiceCreations.list());
            if (path.startsWith("/voice/creations/") && method === "GET") {
              try {
                const image = recentVoiceCreations.image(decodeURIComponent(path.slice("/voice/creations/".length)));
                res.setHeader("Content-Type", image.mimeType); res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Content-Length", image.bytes.length); res.end(image.bytes); return;
              } catch { return send({ error: "This creation is no longer available." }, 404); }
            }
            if (path === "/voice/local-images/search" && method === "POST") return send(await localVoiceImages.search(body.query));
            if (path.startsWith("/voice/local-images/") && method === "GET") {
              try {
                const image = localVoiceImages.image(decodeURIComponent(path.slice("/voice/local-images/".length)));
                res.setHeader("Content-Type", image.mimeType); res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Content-Length", image.bytes.length); res.end(image.bytes); return;
              } catch { return send({error:"Image not available."}, 404); }
            }
            if (path === "/voice/images" && method === "GET") return send(memoryImages.list());
            if (path.startsWith("/voice/images/") && method === "GET") {
              try {
                const image = memoryImages.image(decodeURIComponent(path.slice("/voice/images/".length)));
                res.setHeader("Content-Type", image.mimeType); res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Content-Length", image.bytes.length); res.end(image.bytes); return;
              } catch { return send({ error: "Image not available." }, 404); }
            }
            if (path === "/voice/openai/status" && method === "GET") return send(openaiVoice.status());
            if (path.startsWith("/voice/openai/") && method === "POST") return send(await openaiVoice.handle(path, body));
            if (path === "/voice/status" && method === "GET") return send(companionVoice.status());
            if (path === "/voice/setup" && method === "GET") return send(companionVoice.setup());
            if (method === "POST") return send(await companionVoice.handle(path, body));
          }
          if (method === "GET" && path === "/private-advisor") return send(privateAdvisorStatus(root));
          if (method === "GET" && path === "/models")
            return send(await assistantCatalog(root, modelKey(), { refresh: url.searchParams.get("refresh") === "1" }));
          if (path === "/conversations" && method === "GET")
            return send({ conversations: conversations.list() });
          if (path === "/conversations" && method === "POST")
            return send({ conversation: conversations.save(body) });
          const conversationMatch = path.match(/^\/conversations\/([\w-]+)$/);
          // Delete: POST {action:"delete"} (older clients sent DELETE).
          if (conversationMatch && ((method === "POST" && body.action === "delete") || method === "DELETE"))
            return send(conversations.remove(conversationMatch[1]));
          if (path === "/memory/connect-all" && method === "GET") return send(await connectAll.status());
          if (path === "/memory/connect-all" && method === "POST") return send(await connectAll.start({ user: true }), 202);
          if (path === "/memory/mail-history" && method === "GET") return send(mailHistory.status());
          if (path === "/memory/source-text" && method === "GET") {
            // The full text of one saved record; the workspace state carries only the first 2,000 characters.
            const found = load().sources.find((s) => s.id === url.searchParams.get("id") && !s.deletedAt);
            if (!found) return send({ error: "This memory is no longer saved." }, 404);
            return send({ id: found.id, text: found.text.slice(0, 400000), truncated: found.text.length > 400000 });
          }
          if (path === "/memory/skill-file" && method === "GET") {
            try { return send(readSkillFile(userHome, url.searchParams.get("id") || "")); }
            catch (error) { return send({ error: (error as Error).message }, 404); }
          }
          if (path === "/memory/chatgpt/find" && method === "GET") return send({ export: findChatgptExportZip(userHome) || null });
          if (path === "/memory/chatgpt/extract" && method === "POST") {
            const zip = findChatgptExportZip(userHome);
            if (!zip) return send({ error: "No ChatGPT export zip in Downloads yet. When the email from OpenAI arrives, download the zip, then try again." }, 404);
            const result = await extractChatgptExport(zip.path, userHome);
            await apps.list(true).catch(() => undefined);
            try { apps.configure("chatgpt", { enabled: true, autoSync: true }); apps.start("chatgpt", { catchUp: true }); } catch { /* the file is in place; Refresh all imports it */ }
            return send({ ok: true, ...result }, 202);
          }
          if (path === "/memory/apps" && method === "GET") return send(await apps.list(url.searchParams.get("refresh") === "1"));
          if (path === "/memory/apps/sync-all" && method === "POST") return send(await apps.syncAll(), 202);
          if (path === "/memory/apps/refresh-settings" && method === "POST") return send(apps.configureRefresh(body));
          const appMatch = path.match(/^\/memory\/apps\/([a-z]+)(?:\/(sync|import))?$/);
          if (appMatch && method === "POST") {
            if (appMatch[2] === "sync") return send(apps.start(appMatch[1], { catchUp: true }), 202);
            if (appMatch[2] === "import") return send(await apps.importExport(appMatch[1], body), 202);
            return send(apps.configure(appMatch[1], body));
          }
          if (path === "/memory/spaces" && method === "POST") {
            const state = load(), name = text(body.name, 61);
            if (name.length < 2 || name.length > 60) throw new Error("Name your space using 2–60 characters.");
            if (memorySpaces(state).some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error("A space with that name already exists.");
            const space = { id: "space-" + id(), name, color: /^#[a-f0-9]{6}$/i.test(body.color || "") ? body.color : "#c8afe9", description: text(body.description, 200), icon: text(body.icon, 40) || undefined };
            state.memorySpaces = [...(state.memorySpaces || []), space];save(state);return send({ space, spaces: memorySpaces(state) }, 201);
          }
          if (path === "/memory/search" && method === "GET") {
            const state = load(), terms = text(url.searchParams.get("q"), 500).toLowerCase().split(/\s+/).filter(Boolean), collection = url.searchParams.get("collection"), trash = url.searchParams.get("trash") === "1";
            if (collection && collection !== "all" && !memorySpaces(state).some((s) => s.id === collection)) throw new Error("Choose an existing memory space.");
            const found = state.sources.filter((s) => !!s.deletedAt === trash && (!collection || collection === "all" || s.collection === collection) && terms.every((term) => (s.title + " " + s.text).toLowerCase().includes(term)));
            return send({ ids: found.map((s) => s.id), total: found.length });
          }
          if (path === "/memory/connectors" && method === "GET")
            return send({
              connectors: ["codex", "claude"].map((provider) => {
                const listed = localMemoryFiles(provider, memoryHome);
                return {
                  id: provider,
                  name: provider === "codex" ? "Codex" : "Claude",
                  available: listed.files.length > 0,
                  count: listed.files.length,
                  truncated: listed.truncated,
                };
              }),
              notion: { configured: !!notionToken() },
              imageOCR: {
                available: imageOCRAvailable(),
                engine: "Apple Vision · CPU text recognition",
              },
            });
          if (path === "/memory/local" && method === "GET") {
            const result = localMemoryFiles(url.searchParams.get("provider") || "", memoryHome);
            return send({ ...result, files: result.files.map(({ absolute, ...file }) => file) });
          }
          if (path === "/memory/import-local" && method === "POST") {
            const files = readLocalMemories(body.provider, body.ids, memoryHome);
            if (files.some((f) => f.text.trim().length < 15))
              throw new Error("A selected file has no readable memory text. Choose another file.");
            if (files.reduce((sum, f) => sum + f.text.length, 0) > 8000000)
              throw new Error("This batch is too large. Import fewer memory files at a time.");
            const results = files.map((f) =>
              importReady({
                title: f.title,
                text: f.text,
                origin: body.provider,
                collection: body.collection,
                connector: {
                  provider: body.provider,
                  itemId: f.id,
                  path: f.path,
                  syncedAt: now(),
                },
              }),
            );
            return send({
              added: results.filter((r) => !r.unchanged && !r.updated && !r.skipped).length,
              updated: results.filter((r) => r.updated).length,
              unchanged: results.filter((r) => r.unchanged).length,
              skipped: results.filter((r) => r.skipped).length,
              sources: results.map((r) => r.source),
            });
          }
          if (path === "/memory/granola-config" && method === "GET") return send(granola.status());
          if (path === "/memory/granola-config" && method === "POST") return send(await granola.configure(body.apiKey));
          if (path === "/memory/notion-config" && method === "POST") {
            const value = text(body.token, 1000);
            if (value && (!/^[A-Za-z0-9_-]+$/.test(value) || value.length < 20))
              throw new Error("Enter a valid Notion integration token.");
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            const tmp = notionFile + "." + id();
            writeFileSync(tmp, JSON.stringify({ token: value }), { mode: 0o600 });
            renameSync(tmp, notionFile);
            return send({ configured: !!value });
          }
          if (path === "/memory/import-notion" && method === "POST") {
            const token = notionToken();
            if (!token) throw new Error("Connect Notion with an integration token first.");
            const page = await fetchNotionPage(token, text(body.url, 2000));
            return send(
              importReady({
                title: page.title,
                text: page.text,
                url: page.url,
                origin: "notion",
                collection: body.collection,
                connector: { provider: "notion", itemId: page.id, syncedAt: now() },
              }),
            );
          }
          if (method === "POST" && (path === "/chat" || path === "/private-advisor/chat")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-store");
            res.flushHeaders();
            const controller = new AbortController();
            res.on("close", () => controller.abort());
            const emit = (event: string, data: string) => {
              if (!res.destroyed)
                res.write(
                  `event: ${event}\n${data
                    .split("\n")
                    .map((l) => `data: ${l}`)
                    .join("\n")}\n\n`,
                );
            };
            try {
              if (path === "/private-advisor/chat")
                await runPrivateAdvisor(root, body, controller.signal, part => emit("chunk", part));
              else await runAssistant(root, body, modelKey(), controller.signal, (part) =>
                emit("chunk", part),
              );
              emit("done", "");
            } catch (e) {
              emit("error", (e as Error).message);
            }
            res.end();
            return;
          }
          if (method === "GET" && path === "/profile") return send(personalProfile.read());
          if (method === "GET" && path === "/setup/discovery") return send(setupDiscovery(root, memoryHome));
          if (method === "POST" && path === "/setup/open-privacy") {
            // Opens the macOS Files and Folders privacy pane so the operator can allow Documents. No settings are changed here.
            // Windows reads the user's own Documents without a prompt, so nothing opens there and the caller gets a hint instead of an error.
            const privacy = privacyPaneAction();
            if (privacy.kind === "unsupported") throw new Error(privacy.message);
            if (privacy.kind === "not-needed") return send({ opened: false, hint: privacy.hint });
            const { spawn } = await import("node:child_process");
            spawn("open", [privacy.target], { stdio: "ignore", detached: true }).unref();
            return send({ opened: true });
          }
          if (method === "GET" && path === "/setup/connections") return send(await existingConnections.read(callbackUrl.searchParams.get("refresh") === "1"));
          if (method === "GET" && path === "/native-connections") return send(await nativeInbox.status());
          if (method === "GET" && path === "/calendar/native") return send(await nativeCalendar.status());
          if (method === "POST" && path === "/calendar/native/sync") return send(await nativeCalendar.sync(body));
          if (method === "POST" && path === "/calendar/native/disconnect") return send(nativeCalendar.disable());
          if (method === "POST" && path === "/native-connections/sync") return send(await nativeInbox.sync(body.providers, body.replaceSelection === true));
          if (method === "POST" && path === "/profile") {
            // Check the memory destination before committing profile changes.
            // A corrupt workspace must not produce a half-successful save.
            load();
            const profile = personalProfile.update(body);
            if (["name", "role", "about", "responsePreferences", "timeZone", "hourlyRate", "currency", "publicProfiles"].some(key => body[key] !== undefined)) {
              const content = [["Name", profile.name], ["Role", profile.role], ["About", profile.about], ["Response preferences", profile.responsePreferences], ["Timezone", profile.timeZone], ["Hourly value", profile.hourlyRate === null ? "" : `${profile.currency} ${profile.hourlyRate}`], ...(profile.publicProfiles || []).map(link => [link.label, `${link.url}${link.source ? ` (Source: ${link.source.title})` : ""}`])].filter(([,value]) => value).map(([label,value]) => `${label}: ${value}`).join("\n");
              importReady({ title: "Your personal profile", text: `Your personal profile\n${content}`, origin: "personal", collection: "personal", connector: { provider: "workspace-profile", itemId: "profile", syncedAt: now() } });
            }
            return send(profile);
          }
          if (method === "GET" && path === "/mail-archive/status") { getMailSync(); return send(archive.stats()); }
          if (method === "GET" && path === "/mail-archive/sync") return send(getMailSync().status());
          if (method === "POST" && path === "/mail-archive/sync") return send(await getMailSync().start(body.provider));
          if (method === "POST" && path === "/mail-archive/pause") return send(getMailSync().pause(body.provider));
          if (method === "POST" && path === "/mail-archive/provider-search") return send(await providerMail.search(body.provider, body.query, body.limit));
          if (method === "GET" && path === "/mail-archive/search") {
            const result = archive.search((url.searchParams.get("q") || "").slice(0,600), Number(url.searchParams.get("limit")) || 50, Number(url.searchParams.get("offset")) || 0, url.searchParams.get("provider") || "");
            return send({ ...result, items: result.items.map(item => ({ ...item, body: item.body.slice(0,6000), bodyTruncated: item.body.length > 6000 })) });
          }
          if (method === "GET" && path === "/mail-archive/message") {
            const id = url.searchParams.get("id") || "", saved = archive.get(id);
            const item = saved && nativeInbox.owns(saved.source, saved.account || "") ? await nativeInbox.message(id) : await providerMail.message(id);
            return item ? send({ item }) : send({ error: "That archived email was not found." },404);
          }
          if (path === "/chat/attachments" && method === "POST") return send({ attachment: await extractChatAttachment(root, body) });
          if (method === "GET" && path === "/state") {
            const state = load();
            let changed = false;
            for (const s of state.sources)
              if (s.status === "indexing" && !jobs.has(s.id)) {
                s.status = "error";
                s.error = "Import interrupted by a restart. Retry this source.";
                changed = true;
              }
            if (changed) save(state);
            return send(sourceExcerpts(state));
          }
          if (method === "GET" && path === "/brain/context") {
            if (url.searchParams.get("view") === "graph") {
              if (!brainEnabled(readBrainPreferences(root), "business")) return send({ business: null });
              const workspace = business.read(), { personalPriorities, preferredName, quarterGoal: legacyQuarterGoal, ...profile } = workspace.profile;
              const latest = new Map();
              for (const snapshot of workspace.snapshots) latest.set(snapshot.platform, snapshot);
              return send({ business: { profile, audience: [...latest.values()], finances: workspace.finances,
                progress: businessGoalContext(workspace).progress } });
            }
            const state = load(), workspace = business.read();
            const { personalPriorities, preferredName, quarterGoal: legacyQuarterGoal, ...profile } = workspace.profile;
            const latest = new Map();
            for (const snapshot of workspace.snapshots) latest.set(snapshot.platform, snapshot);
            return send({ ...sourceExcerpts(brainContext(state)),
              goals: brainEnabled(state, "business") ? businessGoalContext(workspace).goals : { longTerm: "", quarter: "", month: "", week: "", metrics: [] },
              business: brainEnabled(state, "business") ? { evidence: businessEvidence(workspace), profile, audience: [...latest.values()], finances: workspace.finances, progress: businessGoalContext(workspace).progress, content: (() => { const c = contentStudio.read(); return { recordedAt: c.recordedAt, sampling: c.sampling, insights: c.insights, videos: c.videos.map((v: any) => ({ id: v.id, title: v.title, publishedAt: v.publishedAt, url: v.url, views: v.views, commentCount: v.commentCount })) }; })() } : null,
              mailArchive: brainEnabled(state, "email") ? archive.stats() : null,
              personalProfile: brainEnabled(state, "personal") ? (({ avatar, onboardingStep, onboardingFlowVersion, onboardingCompletedAt, updatedAt, ...context }) => ({ personalPriorities, preferredName: updatedAt ? context.name : preferredName, ...context }))(personalProfile.read()) : null,
            });
          }
          if (method === "GET" && path === "/business/demo") return send(demoState());
          if (method === "POST" && path === "/business/demo") { businessDemo.save(body.enabled); return send(demoState()); }
          if (method === "GET" && path === "/business/brief/status") return send({ generating: briefGenerating, ...(briefGenerating && briefGeneratingSince ? { since: briefGeneratingSince } : {}), demo: demoActive(), model: briefModel.read().model });
          if (method === "GET" && path === "/business") return send(business.read());
          if (method === "GET" && path === "/business/today") return send(await today.read());
          if (method === "GET" && path === "/business/brief") return send(displayedBrief().read());
          if (method === "GET" && path === "/business/brief/context") return send(morningBrief.collect());
          if (method === "GET" && path === "/business/brief/archive") {
            const report = displayedBrief().get(new URL(req.url || "/", "http://localhost").searchParams.get("id") || "");
            if (!report) throw new Error("That saved brief was not found.");
            return send(report);
          }
          if (method === "POST" && path === "/business/brief") return send(morningBrief.save(body));
          if (method === "POST" && path === "/business/brief/actions") return send(displayedBrief().setAction(body));
          if (method === "POST" && path === "/business/brief/schedule") return send(morningBrief.configureSchedule(body));
          if (method === "POST" && path === "/business/brief/refresh") {
            if (briefGenerating) throw new Error("A brief is already being prepared. Give it a moment, then reopen the report.");
            // An explicit choice must exist in the current catalog and is remembered for later
            // briefs, including the scheduled morning run. A remembered choice that has since
            // disappeared from the catalog falls back to the default lane instead of failing.
            const requestedModel = body.model === undefined || body.model === null ? undefined : checkedBriefModelKey(body.model);
            briefGenerating = true; briefGeneratingSince = now();
            try {
              const catalog = requestedModel ? await assistantCatalog(root, modelKey()) : undefined;
              const model = requestedModel && catalog ? briefModel.choose(requestedModel, catalog).key : briefModel.read().model?.key;
              return send(await generateBusinessBrief(root, modelKey(), body.timezone, undefined, { mode: demoActive() ? "demo" : "live", baseUrl: `http://127.0.0.1:${req.socket.localPort}`, token, model, catalog }));
            }
            finally { briefGenerating = false; briefGeneratingSince = ""; }
          }
          if (method === "GET" && path === "/business/content") return send(contentStudio.read());
          if (method === "POST" && path === "/business/content/sync") return send(await contentStudio.sync());
          if (method === "GET" && path === "/business/competitors") return send(competitorStudio.read());
          if (method === "POST" && path === "/business/competitors/sync") return send(await competitorStudio.sync(body.inputs));
          if (method === "POST" && path === "/business/progress") return send(business.progress(body));
          if (method === "GET" && path === "/business/integrations") return send({ integrations: discoverBusinessIntegrations() });
          if (method === "GET" && path === "/business/native-connections") return send(await nativeBusiness.status(url.searchParams.get("refresh") === "1"));
          if (method === "GET" && path === "/business/mercury/preview") return send(await nativeBusiness.balances());
          if (method === "POST" && path === "/business/mercury/sync") {
            if (businessSyncing.has("mercury")) throw new Error("Mercury is already refreshing.");
            businessSyncing.add("mercury");
            try {
              const snapshot = await nativeBusiness.financeSnapshot();
              const result = business.importFinances(snapshot);
              demoOffForLiveData(); syncBusinessMemory(result);
              return send({ accounts: result.finances.accounts.length, recordedAt: result.finances.recordedAt, monthlyIncome: result.finances.monthlyIncome ?? null, ...(snapshot.monthlyIncomeError ? { monthlyIncomeError: snapshot.monthlyIncomeError } : {}) });
            }
            finally { businessSyncing.delete("mercury"); }
          }
          if (method === "POST" && path === "/business/youtube/channel") {
            if (businessSyncing.has("youtube")) throw new Error("YouTube is already refreshing.");
            businessSyncing.add("youtube");
            try {
              const channel = await configureYouTubeChannel(body.channel);
              let numbersSynced = false, videosSynced = false, videoCount = 0;
              const warnings: string[] = [];
              try { const result = business.importSnapshots(await syncBusinessIntegration("youtube")); demoOffForLiveData(); syncBusinessMemory(result); numbersSynced = true; }
              catch (error) { warnings.push((error as Error).message); }
              try { const content = await contentStudio.sync(); videoCount = content.videos.length; videosSynced = true; }
              catch (error) { warnings.push((error as Error).message); }
              return send({ channel, numbersSynced, videosSynced, videoCount, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
            } finally { businessSyncing.delete("youtube"); }
          }
          if (method === "POST" && path === "/business/sync") {
            if (body.provider !== "youtube") throw new Error("Choose a supported account to refresh.");
            if (businessSyncing.has(body.provider)) throw new Error("This account is already refreshing.");
            businessSyncing.add(body.provider);
            try { const result = business.importSnapshots(await syncBusinessIntegration(body.provider)); demoOffForLiveData(); syncBusinessMemory(result); return send(result); }
            finally { businessSyncing.delete(body.provider); }
          }
          if (method === "POST" && path === "/business") {
            const result = business.update(body);
            if (body.profile) {
              if (typeof body.profile.quarterGoal === "string") {
                const state = load(); state.goals.quarter = result.profile.quarterGoal; save(state);
              }
              for (const origin of ["business", "personal"]) {
                const keys = origin === "business" ? ["businessName", "whatYouDo", "whoYouHelp", "quarterGoal", "longTermDirection"] : ["preferredName", "personalPriorities"];
                if (!keys.some((key) => typeof body.profile[key] === "string")) continue;
                const content = keys.filter((key) => result.profile[key]).map((key) => `${key}: ${result.profile[key]}`).join("\n");
                if (content.length >= 15) importReady({
                  title: origin === "business" ? "Your business profile" : "Your personal priorities",
                  text: content, origin, collection: origin,
                  connector: { provider: "business-setup", itemId: origin, syncedAt: now() },
                });
                else {
                  const state = load();
                  for (const s of state.sources) if (s.connector?.provider === "business-setup" && s.connector?.itemId === origin && !s.deletedAt) s.deletedAt = now();
                  save(state);
                }
              }
            }
            return send(result);
          }
          if (method === "POST" && path === "/business/snapshots") { const result = business.importSnapshots(body); demoOffForLiveData(); syncBusinessMemory(result); return send(result); }
          if (method === "POST" && path === "/business/finances") { const result = business.importFinances(body); demoOffForLiveData(); syncBusinessMemory(result); return send(result); }
          if (method === "POST" && path === "/memory/business/sync") return send(syncBusinessMemory());
          if (method === "GET" && path === "/memory/storage") return send(vault.status());
          if (method === "POST" && path === "/memory/storage/export") return send(await vault.export(() => load().sources));
          if (method === "GET" && path === "/memory/photo-index/status") return send(await photoIndex.status());
          if (method === "POST" && path === "/memory/photo-index/preview") return send(await photoIndex.preview(body));
          if (method === "POST" && path === "/memory/photo-index/uploads") return send(await photoIndex.upload(body));
          if (method === "POST" && path === "/memory/photo-index/jobs") return send(await photoIndex.start(body));
          const photoControl = path.match(/^\/memory\/photo-index\/jobs\/([^/]+)\/(pause|resume)$/);
          if (method === "POST" && photoControl) return send(await photoIndex.control(photoControl[1], photoControl[2]));
          if (method === "GET" && path === "/memory/photos") {
            const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 48);
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 96) throw new Error("Choose a valid photo page.");
            return send(photos.catalog(url.searchParams.get("q") || "", offset, limit, load().sources));
          }
          if (method === "POST" && path === "/memory/photos/import") {
            const state = load();
            if (body.collection && !memorySpaces(state).some(s => s.id === body.collection)) throw new Error("Choose an existing memory space.");
            const selected = photos.selected(body.ids), inputs: ReadySourceInput[] = [];
            let skipped = 0;
            for (const entry of selected) {
              const existing = state.sources.find(s => s.connector?.provider === "design-photos" && s.connector.itemId === entry.id);
              if (existing?.deletedAt) { skipped++; continue; }
              inputs.push({ ...photos.prepare(entry, existing?.id || id()), collection: collectionOf(body.collection || "content", state) });
            }
            const results = importReadyBatch(inputs);
            return send({ added: results.filter(r => !r.updated && !r.unchanged && !r.skipped).length, updated: results.filter(r => r.updated).length, unchanged: results.filter(r => r.unchanged).length, skipped: skipped + results.filter(r => r.skipped).length, sources: sourceExcerpts({ ...state, sources: results.map(r => r.source) }).sources });
          }
          const photoDesign = path.match(/^\/memory\/photos\/design\/([a-f0-9]{64})\/image$/);
          const photoSaved = path.match(/^\/memory\/photos\/([\w-]+)\/(image|thumbnail)$/);
          if (method === "GET" && (photoDesign || photoSaved)) {
            try {
              if (photoSaved) {
                if (!canReadSavedPhoto(photoSaved[1])) return send({ error: "Photo not available." }, 404);
              }
              const image = photoDesign ? photos.image(photoDesign[1]) : await readMemoryPhoto(root, photoSaved![1], photoSaved![2] === "thumbnail");
              if (photoSaved && !canReadSavedPhoto(photoSaved[1])) return send({ error: "Photo not available." }, 404);
              res.setHeader("Content-Type", image.mimeType); res.setHeader("Content-Length", image.bytes.length);
              res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Cache-Control", "no-store");
              res.end(image.bytes); return;
            } catch { return send({ error: "Photo not available." }, 404); }
          }
          if (method === "GET" && path === "/brain/sources") return send(readBrainPreferences(root));
          if (method === "POST" && path === "/brain/sources") {
            const ids: unknown[] = body.ids === undefined ? [body.id] : body.ids;
            if (!Array.isArray(ids) || !ids.length || ids.length > BRAIN_SOURCES.length ||
              (body.ids !== undefined && body.id !== undefined) || new Set(ids).size !== ids.length ||
              ids.some((id) => typeof id !== "string" || !BRAIN_SOURCES.some((s) => s.id === id)) ||
              typeof body.enabled !== "boolean")
              throw new Error("Choose a valid brain source and toggle state.");
            const state = readBrainPreferences(root);
            const changed = (ids as string[]).filter((id) => brainEnabled(state, id) !== body.enabled);
            if (changed.length) {
              state.brainSources = { ...state.brainSources, ...Object.fromEntries(changed.map((id) => [id, body.enabled])) };
              state.brainRevision = (state.brainRevision || 0) + 1;
              writeBrainPreferences(root, state);
            }
            return send({ ok: true, changed: changed.length > 0, ...state });
          }
          if (method === "GET" && path === "/files")
            return send({
              files: await findMemoryFiles(
                url.searchParams.get("q") || "",
                load().hiddenMemoryTitles,
              ),
            });
          if (method === "GET" && path === "/search") {
            const workspace = load();
            if (url.searchParams.get("recent") === "1") return send({ results: workspace.sources.filter(s => !s.deletedAt && !s.connector?.supersededAt && s.status === "ready" && brainEnabled(workspace, sourceOrigin(s))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5).map(s => ({ id: s.id, title: s.title, excerpt: s.text.slice(0,1200), origin: sourceOrigin(s), createdAt: s.createdAt, collection: s.collection })) });
            const library = workspace.sources.filter((s) =>
                brainEnabled(workspace, sourceOrigin(s)),
              ),
              snapshot = resolve(root, "src/data/live-data.json");
            if (existsSync(snapshot)) {
              const live = JSON.parse(filterWorkspaceMemory(readFileSync(snapshot, "utf8"), root));
              if (!live.isExample)
                for (const g of brainEnabled(workspace, "obsidian")
                  ? live.memory?.knowledge?.graphs || []
                  : [])
                  for (const n of g.notes || [])
                    if (n.excerpt)
                      library.push({
                        id: `note:${g.vault}:${n.id}`,
                        title: n.title,
                        text: n.excerpt,
                        collection: "existing",
                        status: "ready",
                        updatedAt: live.generatedAt || "",
                        kind: "note",
                        pinned: false,
                        hash: "",
                        words: 0,
                        createdAt: "",
                      });
            }
            if (existsSync(snapshot)) {
              const live = JSON.parse(filterWorkspaceMemory(readFileSync(snapshot, "utf8"), root));
              const metadata = (recordId: string, title: string, content: string, origin: string) =>
                library.push({
                  id: recordId,
                  title,
                  text: content,
                  origin,
                  collection: "existing",
                  kind: "note",
                  status: "ready",
                  updatedAt: live.generatedAt || "",
                  createdAt: "",
                  pinned: false,
                  hash: "",
                  words: 0,
                });
              if (!live.isExample) {
                for (const n of live.memory?.nodes || [])
                  if (
                    n.kind !== "hub" &&
                    n.source &&
                    brainEnabled(workspace, nodeOrigin(n)) &&
                    n.source !== "obsidian"
                  )
                    metadata(
                      `mapped:${n.id}`,
                      n.name,
                      `Mapped source metadata only; the file contents have not been loaded. Source: ${nodeOrigin(n)}. ${n.meta || ""}. ${n.name}`,
                      nodeOrigin(n),
                    );
                if (brainEnabled(workspace, "skills"))
                  for (const skill of live.skills?.active || [])
                    metadata(
                      `skill:${skill.name}`,
                      skill.name,
                      `Available skill metadata only: ${skill.name}. Uses in the past week: ${skill.uses7d || 0}. Instructions are not loaded here.`,
                      "skills",
                    );
                if (brainEnabled(workspace, "agents") && live.hermes?.installed)
                  metadata(
                    "agent:hermes",
                    "Hermes agent",
                    "Hermes is installed. This entry describes availability only; its private memory is not imported.",
                    "agents",
                  );
              }
            }
            const addContext = (id: string, title: string, body: string, origin: string) =>
              library.push({
                id,
                title,
                text: body,
                origin,
                collection: "existing",
                kind: "note",
                status: "ready",
                updatedAt: now(),
                createdAt: "",
                pinned: false,
                hash: "",
                words: 0,
              });
            if (brainEnabled(workspace, "email"))
              for (const m of workspace.inbox)
                addContext(`inbox:${m.id}`, m.subject, `From: ${m.from}\n${m.body}`, "email");
            if (brainEnabled(workspace, "meetings"))
              for (const e of workspace.events)
                addContext(
                  `event:${e.id}`,
                  e.title,
                  `${e.start}\n${e.notes}\n${e.actions.map((a) => a.text).join("\n")}`,
                  "meetings",
                );
            const query = url.searchParams.get("q") || "";
            // A follow-up passes the window and app it inherited from the previous question.
            const from = Number(url.searchParams.get("from")), to = Number(url.searchParams.get("to")), label = url.searchParams.get("label") || "";
            const window = from > 0 && to > from && label ? { label: label.slice(0, 120), start: from, end: to } : chatTimeWindow(query);
            const apps = (url.searchParams.get("apps") || "").split(",").map((id) => id.trim().toLowerCase()).filter((id) => /^[a-z]{2,20}$/.test(id)).map((id) => ({ id, name: appDisplayName(id) }));
            return send({
              ...searchMemory(library, query, url.searchParams.get("collection") || undefined, window, { focus: apps.length ? apps : undefined }),
              window,
            });
          }
          if (method === "GET" && path === "/news") {
            if (!newsCache || Date.now() - newsCache.at > 10 * 60 * 1000) {
              const response = await fetch(
                "https://ask-jack-api-production.up.railway.app/api/news?limit=16&sources=rundown&days=3",
                { signal: AbortSignal.timeout(15000) },
              );
              if (!response.ok)
                throw new Error("AI with Jack's news feed is unavailable. Try again shortly.");
              const data = await response.json();
              if (!Array.isArray(data.articles))
                throw new Error("The news feed returned an unexpected response.");
              newsCache = {
                at: Date.now(),
                data: { articles: data.articles, fetchedAt: now(), source: "aiwithjack.com" },
              };
            }
            return send(newsCache.data);
          }
          if (method === "POST" && path === "/goals") {
            const state = load();
            if (!Array.isArray(body.metrics) || body.metrics.length > 5)
              throw new Error("Choose up to five core metrics.");
            state.goals = {
              longTerm: text(body.longTerm, 3000),
              quarter: text(body.quarter, 3000),
              week: text(body.week, 3000),
              metrics: body.metrics.map((m: any) => {
                if (
                  !["leading", "lagging"].includes(m.kind) ||
                  !text(m.label, 120) ||
                  !Number.isFinite(m.value) ||
                  !Number.isFinite(m.target) ||
                  m.target <= 0
                )
                  throw new Error("Each metric needs a name, a number and a positive target.");
                return {
                  id: text(m.id, 100) || id(),
                  label: text(m.label, 120),
                  kind: m.kind,
                  value: m.value,
                  target: m.target,
                  unit: text(m.unit, 30),
                };
              }),
            };
            save(state);
            const updatedBusiness = business.update({ profile: { quarterGoal: state.goals.quarter } });
            const profileText = ["businessName", "whatYouDo", "whoYouHelp", "quarterGoal", "longTermDirection"].filter((key) => updatedBusiness.profile[key]).map((key) => `${key}: ${updatedBusiness.profile[key]}`).join("\n");
            if (profileText.length >= 15) importReady({ title: "Your business profile", text: profileText, origin: "business", collection: "business", connector: { provider: "business-setup", itemId: "business", syncedAt: now() } });
            else {
              const current = load();
              for (const source of current.sources) if (source.connector?.provider === "business-setup" && source.connector.itemId === "business" && !source.deletedAt) source.deletedAt = now();
              save(current);
            }
            return send(state.goals);
          }
          if (method === "POST" && path === "/memory/hide-existing") {
            const state = load();
            const title = text(body.title, 500).toLowerCase();
            if (!title) throw new Error("Choose a source title.");
            state.hiddenMemoryTitles = [...new Set([...state.hiddenMemoryTitles, title])];
            save(state);
            return send({ ok: true });
          }
          if (method === "POST" && path === "/settings") {
            const state = load();
            for (const key of [
              "mission",
              "openclaw",
              "news",
              "inboxAutoRead",
              "inboxShowAccounts",
              "inboxShowCategories",
            ] as const)
              if (typeof body[key] === "boolean") state.settings[key] = body[key];
            if (body.inboxAccounts && typeof body.inboxAccounts === "object") {
              const enabled = {
                gmail: true,
                outlook: true,
                capture: true,
                slack: true,
                ...state.settings.inboxAccounts,
              };
              for (const provider of ["gmail", "outlook", "capture", "slack"] as const)
                if (typeof body.inboxAccounts[provider] === "boolean")
                  enabled[provider] = body.inboxAccounts[provider];
              state.settings.inboxAccounts = enabled;
            }
            save(state);
            return send(state.settings);
          }
          if (method === "POST" && path === "/memory") {
            if (body.localFileId) {
              const path = allowedMemoryFile(
                Buffer.from(text(body.localFileId, 4000), "base64url").toString(),
                load().hiddenMemoryTitles,
              );
              body = {
                ...body,
                filename: basename(path),
                base64: readFileSync(path).toString("base64"),
              };
            }

            const state = load(),
              urlValue = text(body.url, 2000);
            if (urlValue && !/^https?:\/\//i.test(urlValue))
              throw new Error("Enter an HTTP or HTTPS source URL.");
            const content = text(body.text, 600000);
            if (!urlValue && !body.base64 && content.length < 15)
              throw new Error("Add at least 15 characters of source text.");
            const hash = digest(urlValue || body.base64 || content);
            const duplicate = state.sources.find(
              (s) => !s.deletedAt && (s.hash === hash || (!!urlValue && s.url === urlValue)),
            );
            if (duplicate) return send({ source: duplicate, duplicate: true });
            if (body.collection && !memorySpaces(state).some((s) => s.id === body.collection)) throw new Error("Choose an existing memory space.");
            const collection = collectionOf(body.collection, state);
            const kind =
              body.kind && ["note", "article", "video", "document", "meeting"].includes(body.kind)
                ? body.kind
                : urlValue
                  ? /youtu/.test(urlValue)
                    ? "video"
                    : "article"
                  : body.filename
                    ? "document"
                    : "note";
            const source: MemorySource = {
              id: id(),
              title:
                text(body.title, 200) ||
                text(body.filename, 200) ||
                (urlValue ? new URL(urlValue).hostname : "Untitled note"),
              kind,
              extraction: imageFile(body.filename || "") ? "local-ocr" : undefined,
              origin: BRAIN_SOURCES.some((s) => s.id === body.origin)
                ? body.origin
                : imageFile(body.filename || "")
                  ? "images"
                  : /\.eml$/i.test(body.filename || "")
                    ? "email"
                    : kind === "meeting"
                      ? "meetings"
                      : kind === "article" || kind === "video"
                        ? "web"
                        : kind === "document"
                          ? "files"
                          : "manual",
              collection,
              text: content,
              url: urlValue || undefined,
              filename: text(body.filename, 200) || undefined,
              createdAt: now(),
              updatedAt: now(),
              status: "indexing",
              pinned: false,
              words: 0,
              hash,
            };
            state.sources.unshift(source);
            save(state);
            void ingest(source, body);
            return send({ source }, 201);
          }
          const memoryMatch = path.match(/^\/memory\/([\w-]+)$/);
          if (memoryMatch && method === "GET") {
            const source = load().sources.find((s) => s.id === memoryMatch[1]);
            return source ? send({ source }) : send({ error: "Source not found" }, 404);
          }
          if (memoryMatch && method === "POST") {
            const state = load(),
              source = state.sources.find((s) => s.id === memoryMatch[1]);
            if (!source) return send({ error: "Source not found" }, 404);
            if (body.action === "trash" || body.action === "restore") {
              source.deletedAt = body.action === "trash" ? now() : undefined;
              if (source.connector) source.connector.supersededAt = undefined;
            }
            else if (body.action === "retry") {
              if (jobs.has(source.id)) return send({ source });
              source.status = "indexing";
              source.error = undefined;
              save(state);
              void ingest(source, {});
              return send({ source });
            } else {
              if (typeof body.title === "string")
                source.title = text(body.title, 200) || source.title;
              if (typeof body.text === "string") {
                source.text = text(body.text, 600000);
                if (source.text.length < 15)
                  throw new Error("Add at least 15 characters of source text.");
                source.status = "ready";
                source.error = undefined;
                source.words = source.text.split(/\s+/).length;
                source.hash = digest(source.text);
              }
              if (typeof body.pinned === "boolean") source.pinned = body.pinned;
              if (body.collection !== undefined) {
                if (!memorySpaces(state).some((s) => s.id === body.collection)) throw new Error("Choose an existing memory space.");
                source.collection = body.collection;
              }
            }
            source.updatedAt = now();
            save(state);
            return send({ source });
          }
          if (path === "/inbox/ask" && method === "POST") {
            const controller = new AbortController();
            const closed = () => { if (!res.writableEnded) controller.abort(); };
            res.once("close", closed);
            try { return send(await inboxAsk.ask(body, controller.signal)); }
            finally { res.removeListener("close", closed); }
          }
          if (path === "/inbox/import" && method === "POST") {
            const state = load();
            const result = importInboxSnapshot(state, body);
            save(state);
            return send(result);
          }
          if (path === "/inbox" && method === "POST") {
            const state = load();
            const existing = body.id ? state.inbox.find((x) => x.id === body.id) : undefined;
            if (body.id && !existing) return send({ error: "Message not found" }, 404);
            if (existing) {
              if (typeof body.starred === "boolean") existing.starred = body.starred;
              if (typeof body.read === "boolean") {
                existing.read = body.read;
                existing.readOverride = true;
              }
              if (["open", "done"].includes(body.status)) existing.status = body.status;
              if (typeof body.draft === "string") existing.draft = text(body.draft, 100000);
              if (typeof body.draftTo === "string") existing.draftTo = text(body.draftTo, 4000);
              if (typeof body.draftCc === "string") existing.draftCc = text(body.draftCc, 4000);
              if (typeof body.draftBcc === "string") existing.draftBcc = text(body.draftBcc, 4000);
              if (["needs-you", "sponsors", "waiting", "updates"].includes(body.category))
                existing.category = body.category;
            } else {
              if (!text(body.subject) || !text(body.body))
                throw new Error("Add a subject and message.");
              state.inbox.unshift({
                id: id(),
                from: text(body.from, 300) || "Quick capture",
                subject: text(body.subject, 250),
                body: text(body.body, 100000),
                receivedAt: now(),
                category: ["needs-you", "sponsors", "waiting", "updates"].includes(body.category)
                  ? body.category
                  : "needs-you",
                status: "open",
                source: "capture",
                read: false,
              });
            }
            save(state);
            return send({ ok: true });
          }
          if (path === "/calendar" && method === "POST") {
            const state = load();
            let event = state.events.find((e) => e.id === body.id);
            if (body.action === "delete") {
              state.events = state.events.filter((e) => e.id !== body.id);
              save(state);
              return send({ ok: true });
            }
            if (body.id && !event) return send({ error: "Event not found" }, 404);
            if (event) {
              if (typeof body.notes === "string") event.notes = text(body.notes);
              if (Array.isArray(body.actions))
                event.actions = body.actions.slice(0, 100).map((a: any) => ({
                  id: text(a.id, 50) || id(),
                  text: text(a.text, 1000),
                  done: a.done === true,
                }));
            } else {
              const start = new Date(body.start),
                end = new Date(body.end);
              if (
                !text(body.title) ||
                !Number.isFinite(+start) ||
                !Number.isFinite(+end) ||
                end <= start
              )
                throw new Error("Add a title and an end time after the start.");
              event = {
                id: id(),
                title: text(body.title, 250),
                start: start.toISOString(),
                end: end.toISOString(),
                allDay: body.allDay === true,
                location: text(body.location, 1000),
                attendees: text(body.attendees, 2000),
                notes: text(body.notes),
                source: "local",
                actions: [],
              };
              state.events.push(event);
            }
            save(state);
            return send({ event });
          }
          if (path === "/calendar/import" && method === "POST") {
            const raw = text(body.ics, 1000000);
            if (!raw.includes("BEGIN:VCALENDAR")) throw new Error("Choose an .ics calendar file.");
            const parsed = ical.sync.parseICS(raw),
              state = load();
            const rangeStart = body.timeMin
              ? new Date(body.timeMin)
              : new Date(Date.now() - 90 * 86400000);
            const rangeEnd = body.timeMax
              ? new Date(body.timeMax)
              : new Date(Date.now() + 365 * 86400000);
            if (
              !Number.isFinite(+rangeStart) ||
              !Number.isFinite(+rangeEnd) ||
              rangeStart >= rangeEnd ||
              +rangeEnd - +rangeStart > 740 * 86400000
            )
              throw new Error("Choose a recurrence range of up to two years.");
            const imported: CalendarEvent[] = [],
              recurringUids = new Set<string>(),
              cancelledUids = new Set<string>();
            let added = 0,
              updated = 0,
              recurring = 0;
            const dateOnly = (date: Date & { tz?: string }) => {
              const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: date.tz || "UTC",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).formatToParts(date);
              const part = (type: string) => parts.find((p) => p.type === type)?.value;
              return `${part("year")}-${part("month")}-${part("day")}T00:00:00`;
            };
            for (const entry of Object.values(parsed) as any[]) {
              if (entry.type !== "VEVENT" || !entry.uid) continue;
              if (entry.status === "CANCELLED") {
                cancelledUids.add(entry.uid);
                continue;
              }
              if (!entry.start) continue;
              const recurrence = !!entry.rrule;
              if (recurrence) {
                recurring++;
                recurringUids.add(entry.uid);
                const rule = entry.rrule.options;
                if (rule.freq >= 4 && (!rule.count || rule.count > 5000))
                  throw new Error(
                    "This calendar repeats more frequently than daily. Export individual occurrences or limit the series to 5,000 events.",
                  );
              }
              const instances = ical.expandRecurringEvent(entry, {
                from: recurrence ? rangeStart : new Date(+entry.start - 1),
                to: recurrence ? rangeEnd : new Date(+entry.end || +entry.start + 86400000),
                includeOverrides: true,
                excludeExdates: true,
                expandOngoing: true,
              });
              for (const instance of instances) {
                if (instance.event.status === "CANCELLED") continue;
                const originalDate =
                  instance.isOverride && instance.event.recurrenceid
                    ? instance.event.recurrenceid
                    : instance.start;
                const sourceUid = recurrence
                  ? `${entry.uid}::${new Date(originalDate).toISOString()}`
                  : entry.uid;
                const old = state.events.find(
                  (e) => e.source === "ics" && e.sourceUid === sourceUid,
                );
                imported.push({
                  id: old?.id || id(),
                  title:
                    text(
                      typeof instance.summary === "object"
                        ? instance.summary?.val
                        : instance.summary,
                      250,
                    ) || "Calendar event",
                  start: instance.isFullDay
                    ? dateOnly(instance.start)
                    : instance.start.toISOString(),
                  end: instance.isFullDay ? dateOnly(instance.end) : instance.end.toISOString(),
                  allDay: instance.isFullDay,
                  location: text(instance.event.location, 1000),
                  notes: old?.notes || text(instance.event.description),
                  actions: old?.actions || [],
                  source: "ics",
                  sourceUid,
                  importedAt: now(),
                });
                if (old) updated++;
                else added++;
                if (imported.length > 10000)
                  throw new Error(
                    "This calendar contains more than 10,000 occurrences. Import a shorter date range.",
                  );
              }
            }
            const importedIds = new Set(imported.map((event) => event.id));
            state.events = [
              ...state.events.filter((event) => {
                if (importedIds.has(event.id)) return false;
                if (event.source !== "ics" || !event.sourceUid) return true;
                if (
                  [...cancelledUids].some(
                    (uid) => event.sourceUid === uid || event.sourceUid!.startsWith(uid + "::"),
                  )
                )
                  return false;
                const matchesSeries = [...recurringUids].some((uid) =>
                  event.sourceUid!.startsWith(uid + "::"),
                );
                if (
                  matchesSeries &&
                  Date.parse(event.start) < +rangeEnd &&
                  Date.parse(event.end) > +rangeStart
                )
                  return false;
                return true;
              }),
              ...imported,
            ];
            save(state);
            return send({
              added,
              updated,
              recurring,
              timeMin: rangeStart.toISOString(),
              timeMax: rangeEnd.toISOString(),
              message: recurring
                ? `${recurring} recurring series expanded, including exceptions, from ${rangeStart.toISOString().slice(0, 10)} to ${rangeEnd.toISOString().slice(0, 10)}.`
                : "Calendar snapshot saved; re-import to refresh.",
            });
          }
          return send({ error: "Unknown workspace endpoint" }, 404);
        } catch (error) {
          return send(
            { error: (error as Error).message || "The request failed." },
            error instanceof ConversationConflict ? 409 : 400,
          );
        }
      });
    },
    closeBundle() { apps.stop(); vault.stop(); photoIndex.close(); mailSync?.close(); existingConnections.close(); nativeTasks?.close(); archive.close(); },
  };
}

// Exclusions belong to this workspace, never to the original vault files.
export function filterWorkspaceMemory(raw: string, root: string) {
  const file = resolve(root, ".operator-data/workspace.json");
  if (!existsSync(file)) return raw;
  const hidden = new Set<string>(
    (JSON.parse(readFileSync(file, "utf8")).hiddenMemoryTitles || []).map((x: string) =>
      x.toLowerCase(),
    ),
  );
  if (!hidden.size) return raw;
  const d = JSON.parse(raw),
    m = d.memory;
  if (!m) return raw;
  const match = (n: any) =>
    [n.id, n.name, n.title].some((x) => hidden.has(String(x || "").toLowerCase()));
  m.nodes = (m.nodes || []).filter((n: any) => !match(n));
  const ids = new Set(m.nodes.map((n: any) => n.id));
  m.links = (m.links || []).filter((l: any) => ids.has(l.source) && ids.has(l.target));
  for (const g of m.knowledge?.graphs || []) {
    g.notes = (g.notes || []).filter((n: any) => !match(n));
    const keep = new Set(g.notes.map((n: any) => n.id));
    g.links = (g.links || []).filter((l: any) => keep.has(l.s) && keep.has(l.t));
  }
  return JSON.stringify(d);
}
