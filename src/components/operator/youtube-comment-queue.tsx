import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ExternalLink, Heart, MoreVertical, Pause, Play, RefreshCw, Search, SlidersHorizontal, ThumbsDown, ThumbsUp, Trash2, Undo2, X, Youtube } from "lucide-react";
import { operatorRequest } from "@/lib/operator";
import { OUTBOX_KEY, cancelReply, enqueueReply, outboxFor, pauseOutbox, useOutbox, type OutboxItem } from "@/lib/reply-outbox";
import { Busy, Notice } from "./ui";

/**
 * YouTube comments, laid out like YouTube Studio's Community page: the
 * Comment / Content table, a Reply pill, the replies toggle, thumbs, the
 * creator heart, a ⋮ menu, checkboxes with bulk actions. Every row carries a
 * reply drafted in the owner's voice, already in the reply box. Reply puts it
 * in the paced outbox; the OS posts them one by one through the owner's own
 * YouTube sign-in with a once-only request record. Hearting is not in
 * YouTube's API, so the heart opens the comment on YouTube in a small window.
 */

export type YouTubeQueueReply = { id: string; author: string; authorAvatar?: string; text: string; publishedAt: string; fromSelf: boolean };
export type YouTubeQueueDraft = {
  commentId: string;
  videoId: string;
  videoTitle: string;
  author: string;
  authorAvatar?: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  replyCount?: number;
  replies?: YouTubeQueueReply[];
  kind?: "short" | "video";
  url: string;
  draft: string;
  generated?: string;
  slop?: { before: number; after: number; tells: string[]; changed: boolean; notes?: string };
  note?: string;
  status: "draft" | "sent" | "skipped" | "hearted" | "removed";
  clearedAt?: string;
  bannedAuthor?: boolean;
  seenAt?: string;
  check?: { verdict: "supported" | "contradicted" | "not_in_video" | "unavailable"; evidence?: string; at: string };
  generatedAt: string;
  editedAt?: string;
  sentAt?: string;
  sentContent?: string;
};
type Progress = { startedAt: string; done: number; total: number; stage: "voice" | "drafts" | "checks"; error?: string; finishedAt?: string };
export type YouTubeQueueStatus = {
  configured: boolean;
  channelId: string;
  oauthReady: boolean;
  connected: boolean;
  channelTitle?: string;
  channelAvatar?: string;
  channelHandle?: string;
  draftsConfigured: boolean;
  model: string;
  days: number;
  syncedAt?: string;
  syncing: boolean;
  lastError?: string;
  counts: { comments: number; waiting: number; unread: number; drafted: number; sent: number; checked: number; fixed: number; transcripts: number };
  progress?: Progress;
  voice?: { builtAt: string; updatedAt?: string; sources: { replies: number }; guide: string; examples: number; lessons: number; rules?: number };
  drafts: YouTubeQueueDraft[];
};

export const YOUTUBE_QUEUE_KEY = ["operator-youtube"];
export const YOUTUBE_STATUS_KEY = ["operator-youtube-status"];

export function useYouTubeStatus(enabled: boolean) {
  return useQuery<Omit<YouTubeQueueStatus, "drafts" | "voice">>({ queryKey: YOUTUBE_STATUS_KEY, queryFn: () => operatorRequest("/connections/youtube/status"), enabled, refetchInterval: 30000 });
}
/** "13 hours ago", the way Studio writes it. */
function ago(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return unit(days, "day");
  if (days < 30) return unit(Math.round(days / 7), "week");
  if (days < 365) return unit(Math.round(days / 30), "month");
  return unit(Math.round(days / 365), "year");
}
function initials(name: string) {
  return name.replace(/^@/, "").split(/[\s_.-]+/).filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?";
}
function Avatar({ name, avatar, size = 52 }: { name: string; avatar?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return avatar && !failed ? (
    <img className="yt-avatar" style={style} src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : (
    <span className="yt-avatar is-initials" style={style}>{initials(name)}</span>
  );
}
type Me = { title: string; handle?: string; avatar?: string };

function CommentRow({
  item, me, outbox, paused, drafting, canPost, reviewed, unseen, selected, fading, onSelect, onSeen, onSend, onCancel, onSkip, onRestore, onSave, onReviewed, onHeart, onRemove,
}: {
  item: YouTubeQueueDraft;
  me: Me;
  outbox?: OutboxItem;
  paused: boolean;
  drafting: boolean;
  canPost: boolean;
  reviewed: boolean;
  unseen: boolean;
  selected: boolean;
  fading: boolean;
  onSelect: (checked: boolean) => void;
  onSeen: () => void;
  onSend: (content: string) => void;
  onCancel: (id: string) => void;
  onSkip: () => void;
  onRestore: () => void;
  onSave: (content: string) => void;
  onReviewed: () => void;
  onHeart: () => void;
  onRemove: (banAuthor: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(item.draft);
  const [confirmRemove, setConfirmRemove] = useState<false | "comment" | "user">(false);
  const [removing, setRemoving] = useState(false);
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState(false);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const saved = useRef(item.draft);
  useEffect(() => {
    if (!focused.current && item.draft !== saved.current) { setText(item.draft); saved.current = item.draft; }
  }, [item.draft]);
  // On screen for a moment counts as read.
  useEffect(() => {
    if (!unseen || !root.current || typeof IntersectionObserver === "undefined") return;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) { timer = window.setTimeout(onSeen, 1500); } else window.clearTimeout(timer);
    }, { threshold: [0, 0.6] });
    observer.observe(root.current);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [unseen, onSeen]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setMenu(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const long = item.text.length > 320 || item.text.split("\n").length > 5;
  const live = outbox && (outbox.status === "queued" || outbox.status === "sending") ? outbox : undefined;
  const uncertain = outbox?.status === "uncertain" && !reviewed ? outbox : undefined;
  const failed = outbox?.status === "failed" && !reviewed ? outbox : undefined;
  const sentNow = item.status === "sent" || outbox?.status === "sent";
  const hearted = item.status === "hearted";
  const canSend = item.status === "draft" && !!text.trim() && !live && !uncertain && canPost;
  const replies = item.replies || [];
  const replyCount = Math.max(item.replyCount || 0, replies.length);
  const touch = () => { if (unseen) onSeen(); };
  const heart = () => {
    touch();
    // YouTube's API has no heart. The comment opens in a small window; one tap there.
    window.open(item.url, "yt-heart", "popup,width=640,height=780,noopener");
    onHeart();
  };
  const statusLabel = live ? (live.status === "sending" ? "Posting now" : paused ? "In the outbox, paused" : live.eta > 0 ? `Posts in about ${live.eta}s` : "Posting next")
    : !canPost ? "Connect YouTube to post replies"
    : uncertain ? "Check delivery before replying again"
    : item.editedAt ? "Edited by you"
    : item.check?.verdict === "supported" ? "Matches the video ✓"
    : item.check?.verdict === "contradicted" ? "Fixed from the video"
    : item.check?.verdict === "not_in_video" ? "Not in the video, check it"
    : item.check?.verdict === "unavailable" ? "No transcript to check"
    : item.slop?.changed ? "Drafted in your voice, de-slopped" : item.draft ? "Drafted in your voice" : drafting ? "Drafting…" : "";
  const youName = me.handle || me.title;
  const total = replyCount + (sentNow ? 1 : 0);
  return (
    <div ref={root} className={`yt-row is-${sentNow ? "sent" : item.status} ${live ? "is-queued" : ""} ${unseen ? "is-unseen" : ""} ${fading ? "is-fading" : ""} ${selected ? "is-selected" : ""}`} onClick={touch}>
      <label className="yt-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} disabled={item.status !== "draft" || sentNow || !!live} onChange={(e) => onSelect(e.target.checked)} />
      </label>
      <div className="yt-cell-comment">
        <Avatar name={item.author} avatar={item.authorAvatar} />
        <div className="yt-cbody">
          <div className="yt-meta">
            <span className="yt-name">{item.author}</span>
            <span className="yt-dot">•</span>
            <span className="yt-time">{ago(item.publishedAt)}</span>
            {item.kind === "short" && <span className="yt-tag">Short</span>}
            {unseen && <span className="yt-tag is-new">New</span>}
          </div>
          <p className={`yt-text ${long && !open ? "is-clamped" : ""}`}>{item.text}</p>
          {long && <button type="button" className="yt-more" onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Read more"}</button>}
          <div className="yt-actions">
            <button type="button" className="yt-btn" disabled={item.status !== "draft" || sentNow} onClick={() => box.current?.focus()}>Reply</button>
            <button type="button" className="yt-replies" disabled={!replies.length && !sentNow} onClick={() => { touch(); setThread((v) => !v); }} title={replyCount && !replies.length ? "Refresh to load these replies" : undefined}>
              {total} {total === 1 ? "reply" : "replies"} {thread ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <span className="yt-thumb" title={item.likeCount === 1 ? "1 like" : `${item.likeCount} likes`}><ThumbsUp size={20} />{item.likeCount ? <b>{item.likeCount.toLocaleString()}</b> : null}</span>
            <span className="yt-thumb is-down" title="Dislikes are private on YouTube"><ThumbsDown size={20} /></span>
            <button type="button" className={`yt-heart ${hearted ? "is-on" : ""}`} disabled={hearted || item.status === "removed"} title={hearted ? "Hearted on YouTube" : "Heart this comment. YouTube's API cannot do it from here, so it opens in a small window: one tap there and this row is marked hearted."} onClick={heart}>
              <Avatar name={me.title} avatar={me.avatar} size={24} />
              <Heart size={11} />
            </button>
            <span className="yt-menu-wrap">
              <button type="button" className="yt-iconbtn" aria-haspopup="menu" aria-expanded={menu} title="More" onClick={() => setMenu((v) => !v)}><MoreVertical size={20} /></button>
              {menu && (
                <div className="yt-menu" role="menu">
                  <a role="menuitem" href={item.url} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}><ExternalLink size={16} /> Open on YouTube</a>
                  {item.status === "draft" && !sentNow && <button type="button" role="menuitem" onClick={() => { setMenu(false); onSkip(); }}><X size={16} /> Skip</button>}
                  {item.status !== "removed" && canPost && <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(false); setConfirmRemove("comment"); }}><Trash2 size={16} /> Remove from video</button>}
                  {!item.bannedAuthor && canPost && <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(false); setConfirmRemove("user"); }}><Trash2 size={16} /> Remove user from channel</button>}
                </div>
              )}
            </span>
          </div>
          {thread && (replies.length > 0 || sentNow) && (
            <div className="yt-thread">
              {replies.map((r) => (
                <div key={r.id} className={`yt-reply ${r.fromSelf ? "is-mine" : ""}`}>
                  <Avatar name={r.author} avatar={r.authorAvatar} size={40} />
                  <div>
                    <div className="yt-meta">
                      <span className={`yt-name ${r.fromSelf ? "is-creator" : ""}`}>{r.author}</span>
                      <span className="yt-dot">•</span>
                      <span className="yt-time">{ago(r.publishedAt)}</span>
                    </div>
                    <p className="yt-text">{r.text}</p>
                  </div>
                </div>
              ))}
              {sentNow && (
                <div className="yt-reply is-mine">
                  <Avatar name={me.title} avatar={me.avatar} size={40} />
                  <div>
                    <div className="yt-meta">
                      <span className="yt-name is-creator">{youName}</span>
                      <span className="yt-dot">•</span>
                      <span className="yt-time">{ago(item.sentAt || outbox?.sentAt || new Date().toISOString())}</span>
                    </div>
                    <p className="yt-text">{item.sentContent || outbox?.content || item.draft}</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {sentNow ? (
            !thread && (
              <div className="yt-reply is-mine yt-posted">
                <Avatar name={me.title} avatar={me.avatar} size={40} />
                <div>
                  <div className="yt-meta">
                    <span className="yt-name is-creator">{youName}</span>
                    <span className="yt-dot">•</span>
                    <span className="yt-time">{ago(item.sentAt || outbox?.sentAt || new Date().toISOString())}</span>
                  </div>
                  <p className="yt-text">{item.sentContent || outbox?.content || item.draft}</p>
                </div>
              </div>
            )
          ) : hearted ? (
            <div className="yt-state"><Heart size={14} className="is-on" /> Hearted on YouTube. <button type="button" className="yt-link" onClick={onRestore}><Undo2 size={13} /> Back to the list</button></div>
          ) : confirmRemove === "user" ? (
            <div className="yt-state is-danger">
              <span>Hide {item.author} from your whole channel? This comment goes, and anything else they post is hidden automatically. Undo in YouTube Studio under Settings, Community, Hidden users.</span>
              <span className="yt-btns">
                <button type="button" className="yt-btn" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep them</button>
                <button type="button" className="yt-btn is-danger" disabled={removing} onClick={() => { setRemoving(true); void onRemove(true).finally(() => { setRemoving(false); setConfirmRemove(false); }); }}>
                  {removing ? <Busy /> : <Trash2 size={14} />} {removing ? "Removing…" : "Remove user"}
                </button>
              </span>
            </div>
          ) : item.status === "removed" ? (
            <div className="yt-state"><Trash2 size={14} /> {item.bannedAuthor ? `${item.author} is hidden from your channel. Undo in YouTube Studio under Settings, Community, Hidden users.` : "Removed from your video. Restore it in YouTube Studio if you change your mind."}</div>
          ) : item.status === "skipped" ? (
            <div className="yt-state">Skipped. <button type="button" className="yt-link" onClick={onRestore}><Undo2 size={13} /> Back to the list</button></div>
          ) : confirmRemove === "comment" ? (
            <div className="yt-state is-danger">
              <span>Hide this comment on your video? It stays hidden until you restore it in YouTube Studio.</span>
              <span className="yt-btns">
                <button type="button" className="yt-btn" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep it</button>
                <button type="button" className="yt-btn is-danger" disabled={removing} onClick={() => { setRemoving(true); void onRemove(false).finally(() => { setRemoving(false); setConfirmRemove(false); }); }}>
                  {removing ? <Busy /> : <Trash2 size={14} />} {removing ? "Removing…" : "Remove"}
                </button>
              </span>
            </div>
          ) : (
            <div className="yt-composer">
              <Avatar name={me.title} avatar={me.avatar} size={40} />
              <div className="yt-field">
                <textarea
                  ref={box}
                  id={`yt-draft-${item.commentId}`}
                  className="yt-input"
                  rows={1}
                  value={live ? live.content : text}
                  maxLength={1500}
                  disabled={!!live}
                  placeholder={drafting ? "Drafting in your voice…" : "Add a reply…"}
                  onFocus={() => { focused.current = true; touch(); }}
                  onBlur={() => { focused.current = false; if (text !== saved.current) { saved.current = text; onSave(text); } else if (item.draft !== saved.current) { saved.current = item.draft; setText(item.draft); } }}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) { e.preventDefault(); onSend(text.trim()); } }}
                />
                {item.note && !live && <p className="yt-note">{item.note}</p>}
                {failed && <div className="yt-alert" role="status"><strong>Reply was not posted.</strong> {failed.error || "YouTube declined this reply."} Edit it if you like, then press Reply again.</div>}
                {uncertain && (
                  <div className="yt-alert" role="status">
                    <strong>Delivery is unconfirmed.</strong> {uncertain.error} This reply will not be posted again automatically.{" "}
                    <a href={item.url} target="_blank" rel="noreferrer">Check the comment on YouTube</a>{" "}
                    <button type="button" className="yt-link" onClick={onReviewed}>I checked YouTube</button>
                  </div>
                )}
                <div className="yt-composer-foot">
                  <small className={`yt-check-label ${!live && item.check ? `is-${item.check.verdict}` : ""}`} title={item.check?.evidence ? `From the video: "${item.check.evidence}"` : undefined}>{statusLabel}</small>
                  <span className="yt-btns">
                    {live?.status === "queued" ? (
                      <button type="button" className="yt-btn" onClick={() => onCancel(live.id)}>Cancel</button>
                    ) : live?.status === "sending" ? (
                      <button type="button" className="yt-btn is-primary" disabled><Busy /> Posting…</button>
                    ) : (
                      <>
                        <button type="button" className="yt-btn is-text" onClick={onSkip}>Skip</button>
                        <button type="button" className="yt-btn is-primary" disabled={!canSend} onClick={() => onSend(text.trim())}>{failed ? "Reply again" : "Reply"}</button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="yt-cell-content">
        <a href={`https://www.youtube.com/watch?v=${item.videoId}`} target="_blank" rel="noreferrer" title={item.videoTitle}>
          <img src={`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
          <span>{item.videoTitle}</span>
        </a>
      </div>
    </div>
  );
}

type Filter = "waiting" | "unread" | "sent" | "hearted" | "skipped" | "removed";
type Kind = "all" | "short" | "video";
type Sort = "newest" | "oldest" | "likes";
const FILTER_LABEL: Record<Filter, string> = { waiting: "Unresponded", unread: "Unread", sent: "Responded", hearted: "Hearted", skipped: "Skipped", removed: "Removed" };

export function YouTubeCommentQueue() {
  const client = useQueryClient();
  const query = useQuery<YouTubeQueueStatus>({
    queryKey: YOUTUBE_QUEUE_KEY,
    queryFn: () => operatorRequest("/connections/youtube"),
    refetchInterval: (q) => (q.state.data?.progress && !q.state.data.progress.finishedAt) || q.state.data?.syncing ? 4000 : 120000,
    refetchOnWindowFocus: false,
  });
  const outbox = useOutbox(true);
  const [filter, setFilterState] = useState<Filter>("waiting");
  const [kind, setKind] = useState<Kind>(() => { try { return (localStorage.getItem("agentic-youtube-kind") as Kind) || "all"; } catch { return "all"; } });
  const [sort, setSort] = useState<Sort>("newest");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState("");
  const [showVoice, setShowVoice] = useState(false);
  const [connectUrl, setConnectUrl] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [seenHere, setSeenHere] = useState<Record<string, boolean>>({});
  const [fading, setFading] = useState<Record<string, boolean>>({});
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const pendingSeen = useRef<Set<string>>(new Set());
  const flushTimer = useRef(0);
  const toastTimer = useRef(0);
  const lastSent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!connectUrl || query.data?.connected) { if (query.data?.connected) setConnectUrl(""); return; }
    const timer = window.setInterval(() => void client.invalidateQueries({ queryKey: YOUTUBE_QUEUE_KEY }), 3000);
    return () => window.clearInterval(timer);
  }, [connectUrl, query.data?.connected, client]);
  useEffect(() => () => { window.clearTimeout(flushTimer.current); window.clearTimeout(toastTimer.current); }, []);
  // "Reply added", like Studio, every time the outbox confirms one.
  const sentCount = outbox.data?.counts.sent;
  useEffect(() => {
    if (sentCount === undefined) return;
    if (lastSent.current !== undefined && sentCount > lastSent.current) {
      setToast("Reply added");
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(""), 2600);
    }
    lastSent.current = sentCount;
  }, [sentCount]);
  const data = query.data;
  const drafts = data?.drafts || [];
  const me: Me = { title: data?.channelTitle || "You", handle: data?.channelHandle, avatar: data?.channelAvatar };
  const isUnseen = (d: YouTubeQueueDraft) => d.status === "draft" && !d.seenAt && !seenHere[d.commentId];
  const onTheWay = (d: YouTubeQueueDraft) => { const o = outboxFor(outbox.data, "youtube", d.commentId); return !!o && (o.status === "queued" || o.status === "sending" || o.status === "sent"); };
  useEffect(() => {
    const timers: number[] = [];
    for (const d of drafts) {
      if (d.status !== "draft" || gone[d.commentId] || fading[d.commentId]) continue;
      if (!onTheWay(d)) continue;
      setFading((old) => ({ ...old, [d.commentId]: true }));
      timers.push(window.setTimeout(() => setGone((old) => ({ ...old, [d.commentId]: true })), 900));
    }
    for (const d of drafts) { const o = outboxFor(outbox.data, "youtube", d.commentId); if (o && (o.status === "failed" || o.status === "uncertain") && (gone[d.commentId] || fading[d.commentId])) { setGone((old) => { const { [d.commentId]: _drop, ...rest } = old; return rest; }); setFading((old) => { const { [d.commentId]: _drop, ...rest } = old; return rest; }); } }
    return () => { for (const t of timers) window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbox.data, drafts]);
  const waiting = drafts.filter((d) => d.status === "draft" && !gone[d.commentId]);
  const unread = waiting.filter((d) => !d.seenAt);
  const sent = drafts.filter((d) => d.status === "sent" || outboxFor(outbox.data, "youtube", d.commentId)?.status === "sent");
  const skipped = drafts.filter((d) => d.status === "skipped");
  const hearted = drafts.filter((d) => d.status === "hearted");
  const removed = drafts.filter((d) => d.status === "removed");
  const byFilter = filter === "waiting" ? waiting : filter === "unread" ? unread : filter === "sent" ? sent : filter === "hearted" ? hearted : filter === "removed" ? removed : skipped;
  const byKind = kind === "all" ? byFilter : byFilter.filter((d) => (d.kind || "video") === kind);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = needle ? byKind.filter((d) => d.text.toLowerCase().includes(needle) || d.author.toLowerCase().includes(needle) || d.videoTitle.toLowerCase().includes(needle)) : byKind;
    return [...list].sort((a, b) => sort === "newest" ? b.publishedAt.localeCompare(a.publishedAt) : sort === "oldest" ? a.publishedAt.localeCompare(b.publishedAt) : b.likeCount - a.likeCount || b.publishedAt.localeCompare(a.publishedAt));
  }, [byKind, needle, sort]);
  const shortsCount = byFilter.filter((d) => d.kind === "short").length;
  const running = !!data?.progress && !data.progress.finishedAt;
  const sentToday = sent.filter((d) => (d.sentAt || outboxFor(outbox.data, "youtube", d.commentId)?.sentAt || "") > new Date(Date.now() - 86400000).toISOString()).length;
  const progress = data?.progress;
  const queuedHere = (outbox.data?.items || []).filter((i) => i.source === "youtube" && (i.status === "queued" || i.status === "sending"));
  const nextEta = queuedHere.length ? Math.min(...queuedHere.map((i) => i.eta)) : 0;
  const stillUnread = unread.filter((d) => !seenHere[d.commentId]).length;
  const selectedIds = visible.filter((d) => selected[d.commentId] && d.status === "draft" && !onTheWay(d)).map((d) => d.commentId);
  const setDrafts = (mutate: (items: YouTubeQueueDraft[]) => YouTubeQueueDraft[]) =>
    client.setQueryData<YouTubeQueueStatus>(YOUTUBE_QUEUE_KEY, (old) => (old ? { ...old, drafts: mutate(old.drafts) } : old));
  const refreshAll = () => { void client.invalidateQueries({ queryKey: YOUTUBE_QUEUE_KEY }); void client.invalidateQueries({ queryKey: YOUTUBE_STATUS_KEY }); };
  function setFilter(next: Filter) { if (next !== filter) { setSeenHere({}); setSelected({}); } setFilterState(next); }
  const pickKind = (next: Kind) => { setKind(next); try { localStorage.setItem("agentic-youtube-kind", next); } catch { /* Stays for this view. */ } };
  function markSeen(commentId: string) {
    setSeenHere((old) => (old[commentId] ? old : { ...old, [commentId]: true }));
    pendingSeen.current.add(commentId);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const ids = [...pendingSeen.current];
      pendingSeen.current.clear();
      if (!ids.length) return;
      void operatorRequest("/connections/youtube/drafts/seen", { commentIds: ids })
        .then(() => { const at = new Date().toISOString(); setDrafts((items) => items.map((d) => (ids.includes(d.commentId) && !d.seenAt ? { ...d, seenAt: at } : d))); })
        .catch(() => undefined);
    }, 1200);
  }
  async function act(label: string, path: string, body: unknown = {}, done?: (result: any) => void) {
    if (busy) return;
    setBusy(label);
    setFailure("");
    try { const result = await operatorRequest(path, body); done?.(result); refreshAll(); } catch (e) { setFailure((e as Error).message); } finally { setBusy(""); }
  }
  async function patch(commentId: string, body: { draft?: string; status?: "draft" | "skipped" | "hearted" }) {
    try {
      const item = await operatorRequest<YouTubeQueueDraft>("/connections/youtube/drafts/update", { commentId, ...body });
      setDrafts((items) => items.map((d) => (d.commentId === commentId ? { ...d, ...item } : d)));
    } catch (e) { setFailure((e as Error).message); }
  }
  async function send(item: YouTubeQueueDraft, content: string) {
    if (!content) return;
    setFailure("");
    try {
      setReviewed((old) => ({ ...old, [item.commentId]: false }));
      await enqueueReply({ source: "youtube", targetId: item.commentId, content, name: item.author });
      await client.invalidateQueries({ queryKey: OUTBOX_KEY });
    } catch (e) { setFailure(`${item.author}: ${(e as Error).message}`); }
  }
  async function remove(item: YouTubeQueueDraft, banAuthor = false) {
    setFailure("");
    try {
      const updated = await operatorRequest<YouTubeQueueDraft>("/connections/youtube/remove", { commentId: item.commentId, banAuthor });
      setDrafts((items) => items.map((d) => (d.commentId === item.commentId ? { ...d, ...updated } : banAuthor && d.status === "draft" && d.author === item.author ? { ...d, status: "removed", bannedAuthor: true } : d)));
    } catch (e) { setFailure(`${item.author}: ${(e as Error).message}`); }
  }
  async function cancel(id: string) {
    try { await cancelReply(id); await client.invalidateQueries({ queryKey: OUTBOX_KEY }); } catch (e) { setFailure((e as Error).message); }
  }
  async function togglePause() {
    try { const next = await pauseOutbox(!outbox.data?.paused); client.setQueryData(OUTBOX_KEY, next); } catch (e) { setFailure((e as Error).message); }
  }
  const currentText = (item: YouTubeQueueDraft) => (document.getElementById(`yt-draft-${item.commentId}`) as HTMLTextAreaElement | null)?.value.trim() || item.draft.trim();
  // Bulk reply is capped: YouTube allows about 200 replies a day, and one click should never spend them all.
  const BULK_MAX = 25;
  async function replySelected() {
    const items = visible.filter((d) => selectedIds.includes(d.commentId)).slice(0, BULK_MAX);
    for (const item of items) { const content = currentText(item); if (content) await send(item, content); }
    setSelected({});
  }
  async function skipSelected() {
    for (const id of selectedIds) await patch(id, { status: "skipped" });
    setSelected({});
  }
  const allChecked = visible.length > 0 && visible.every((d) => selected[d.commentId] || d.status !== "draft");
  return (
    <section className="yt" aria-label="YouTube comments">
      <div className="yt-head">
        <h1>Community</h1>
        <nav className="yt-tabs" aria-label="Community sections">
          <span className="is-active">Comments</span>
          <span className="is-off" title="Not in the OS yet">Viewer posts</span>
          <span className="is-off" title="Not in the OS yet">Mentions</span>
        </nav>
      </div>
      <div className="yt-filters">
        <SlidersHorizontal size={22} className="yt-filters-icon" />
        <label className="yt-chip">
          <span>Published</span>
          <select value={kind} onChange={(e) => pickKind(e.target.value as Kind)} aria-label="Video type">
            <option value="all">All videos ({byFilter.length})</option>
            <option value="short">Shorts ({shortsCount})</option>
            <option value="video">Long-form ({byFilter.length - shortsCount})</option>
          </select>
          <ChevronDown size={18} />
        </label>
        <label className="yt-chip">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="likes">Most likes</option>
          </select>
          <ChevronDown size={18} />
        </label>
        <label className={`yt-chip is-search ${searching || search ? "is-open" : ""}`}>
          <Search size={18} />
          {searching || search ? (
            <input autoFocus value={search} placeholder="Search comments" onChange={(e) => setSearch(e.target.value)} onBlur={() => { if (!search) setSearching(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setSearching(false); } }} />
          ) : (
            <button type="button" onClick={() => setSearching(true)}>Search</button>
          )}
          {search ? <button type="button" className="yt-chip-x" onClick={() => { setSearch(""); setSearching(false); }} aria-label="Clear search"><X size={16} /></button> : <ChevronDown size={18} />}
        </label>
        <label className="yt-chip is-status">
          <span>Response status:</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Response status">
            <option value="waiting">Unresponded ({waiting.length})</option>
            <option value="unread">Unread ({stillUnread})</option>
            <option value="sent">Responded ({sent.length})</option>
            <option value="hearted">Hearted ({hearted.length})</option>
            <option value="skipped">Skipped ({skipped.length})</option>
            <option value="removed">Removed ({removed.length})</option>
          </select>
          {filter !== "waiting" ? <button type="button" className="yt-chip-x" onClick={() => setFilter("waiting")} aria-label="Back to unresponded"><X size={16} /></button> : <ChevronDown size={18} />}
        </label>
        <span className="yt-filters-right">
          {(queuedHere.length > 0 || outbox.data?.paused) && (
            <button type="button" className={`yt-btn ${outbox.data?.paused ? "is-primary" : ""}`} onClick={() => void togglePause()}>
              {outbox.data?.paused ? <Play size={16} /> : <Pause size={16} />} {outbox.data?.paused ? "Resume posting" : `Pause posting (${queuedHere.length}${nextEta > 0 ? `, next in ${nextEta}s` : ""})`}
            </button>
          )}
          <button type="button" className="yt-btn" disabled={!!busy || data?.syncing || running || !data?.configured} onClick={() => void act("sync", "/connections/youtube/sync", { days: data?.days || 30 })}>
            {busy === "sync" || data?.syncing || running ? <Busy /> : <RefreshCw size={16} />} {busy === "sync" || data?.syncing ? "Refreshing…" : running ? (progress?.stage === "checks" ? "Checking…" : "Drafting…") : "Refresh"}
          </button>
        </span>
      </div>
      <p className="yt-sub">
        <b>{waiting.length.toLocaleString()}</b> unresponded · <b>{stillUnread}</b> unread · <b>{sentToday}</b> replied today
        {data?.counts.checked ? <> · <b>{data.counts.checked}</b> checked against the video{data.counts.fixed ? `, ${data.counts.fixed} fixed` : ""}</> : null}
        {data?.voice ? <> · drafts by {data.model.replace(/^.*\//, "")} in your voice from {data.voice.sources.replies} of your replies{data.voice.lessons ? ` and ${data.voice.lessons} edits` : ""} <button type="button" className="yt-link" onClick={() => setShowVoice((v) => !v)}>{showVoice ? "Hide" : "How it writes as you"}</button></> : null}
      </p>
      {running && progress && (
        <div className="yt-progress" role="status" aria-label={progress.stage}>
          <span style={{ width: `${progress.stage === "voice" ? 8 : Math.round((100 * progress.done) / Math.max(1, progress.total))}%` }} />
          <small>{progress.stage === "voice" ? "Learning your voice" : progress.stage === "checks" ? `Checking answers against the videos · ${progress.done} of ${progress.total}` : `Writing drafts · ${progress.done} of ${progress.total}`}</small>
        </div>
      )}
      {data && !data.connected && (
        <div className="yt-connect">
          <div>
            <strong>{data.oauthReady ? "Connect YouTube to post replies" : "Add your YouTube sign-in keys"}</strong>
            <p>
              {data.oauthReady
                ? "Reading comments works already. Posting a reply needs your own YouTube sign-in, once. Google opens in a new tab; choose the account that owns your channel and allow \"Manage your YouTube account\". The sign-in stays on this Mac."
                : "Add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET to ~/.config/agentic-os.env, then come back here."}
            </p>
            {connectUrl && <small>Waiting for Google… finish in the other tab, this page updates by itself.</small>}
          </div>
          <button type="button" className="yt-btn is-primary" disabled={!data.oauthReady || busy === "connect"} onClick={() => void act("connect", "/connections/youtube/connect", {}, (result: { url: string }) => { setConnectUrl(result.url); window.open(result.url, "_blank", "noopener"); })}>
            {busy === "connect" ? <Busy /> : <Youtube size={16} />} {connectUrl ? "Open Google again" : "Connect YouTube"}
          </button>
        </div>
      )}
      {showVoice && data?.voice && (
        <div className="yt-voice">
          <strong>How the queue writes as you on YouTube</strong>
          <p>{data.voice.guide}</p>
          <small>Built {ago(data.voice.builtAt)} from {data.voice.sources.replies} of your own comment replies. {data.voice.examples} real replies are shown to the model every time.{data.voice.lessons ? ` ${data.voice.lessons} of your edits are kept as lessons and folded into this guide every 5 edits.` : " Every draft you change before posting is kept as a lesson for the next run."}{data.voice.rules ? ` ${data.voice.rules} rules learned from your edits are read by every queue; see data/voice/rules.md.` : ""}</small>
        </div>
      )}
      {(failure || query.error?.message || progress?.error || data?.lastError) && <Notice error>{failure || query.error?.message || progress?.error || data?.lastError}</Notice>}
      {data && !data.configured && <Notice>Add <code>YOUTUBE_API_KEY</code> and <code>YOUTUBE_CHANNEL_ID</code> to <code>~/.config/agentic-os.env</code> to read comments.</Notice>}
      <div className="yt-table">
        <div className={`yt-row yt-row-head ${selectedIds.length ? "is-bulk" : ""}`}>
          <label className="yt-check">
            <input type="checkbox" checked={allChecked} disabled={!visible.length || (filter !== "waiting" && filter !== "unread")} onChange={(e) => { const next: Record<string, boolean> = {}; if (e.target.checked) for (const d of visible) if (d.status === "draft" && !onTheWay(d)) next[d.commentId] = true; setSelected(next); }} aria-label="Select all" />
          </label>
          {selectedIds.length ? (
            <div className="yt-bulk">
              <b>{selectedIds.length} selected</b>
              <button type="button" className="yt-btn is-primary" disabled={!data?.connected} title={selectedIds.length > BULK_MAX ? `Posts the first ${BULK_MAX}; select fewer to choose which` : undefined} onClick={() => void replySelected()}>Reply to {Math.min(selectedIds.length, BULK_MAX)}{selectedIds.length > BULK_MAX ? ` of ${selectedIds.length}` : ""}</button>
              <button type="button" className="yt-btn" onClick={() => void skipSelected()}>Skip all</button>
              <button type="button" className="yt-btn is-text" onClick={() => setSelected({})}>Clear</button>
            </div>
          ) : (
            <>
              <span className="yt-col">Comment</span>
              <span className="yt-col yt-col-content">Content</span>
            </>
          )}
        </div>
        {query.isLoading ? (
          <div className="yt-empty"><Busy /> Loading your comments…</div>
        ) : visible.length ? (
          visible.map((item) => (
            <CommentRow
              key={item.commentId}
              item={item}
              me={me}
              outbox={outboxFor(outbox.data, "youtube", item.commentId)}
              paused={!!outbox.data?.paused}
              drafting={running && !item.draft}
              canPost={!!data?.connected}
              reviewed={!!reviewed[item.commentId]}
              unseen={isUnseen(item)}
              selected={!!selected[item.commentId]}
              fading={!!fading[item.commentId]}
              onSelect={(checked) => setSelected((old) => ({ ...old, [item.commentId]: checked }))}
              onSeen={() => markSeen(item.commentId)}
              onSend={(content) => void send(item, content)}
              onCancel={(id) => void cancel(id)}
              onSkip={() => void patch(item.commentId, { status: "skipped" })}
              onRestore={() => void patch(item.commentId, { status: "draft" })}
              onSave={(content) => void patch(item.commentId, { draft: content })}
              onReviewed={() => setReviewed((old) => ({ ...old, [item.commentId]: true }))}
              onHeart={() => void patch(item.commentId, { status: "hearted" })}
              onRemove={(banAuthor) => remove(item, banAuthor)}
            />
          ))
        ) : (
          <div className="yt-empty">
            <Youtube size={28} />
            <h3>{needle ? "No comments match that." : kind !== "all" && byFilter.length ? (kind === "short" ? "No Shorts comments here." : "No long-form comments here.") : filter === "waiting" ? (data?.syncedAt ? (data.counts.waiting ? "Drafts are on their way." : "Every comment is answered.") : "No comments loaded yet") : filter === "unread" ? "You have read every comment." : `Nothing ${FILTER_LABEL[filter].toLowerCase()} yet`}</h3>
            <p>{data?.syncedAt ? (filter === "waiting" && !needle ? "They appear here as soon as they are written." : "Refresh pulls anything new.") : "Press Refresh to load the comments on your recent videos."}</p>
          </div>
        )}
      </div>
      <p className="yt-foot">Press Reply on any comment. The OS posts them one at a time, {outbox.data?.paceSeconds.youtube ?? 8} seconds apart, as {me.title}. Refresh pulls new comments, drafts them and checks answers against the video.</p>
      {toast && <div className="yt-toast" role="status">{toast}</div>}
    </section>
  );
}
