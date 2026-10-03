import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BrainCircuit,
  ImagePlus,
  ArrowUpRight,
  Upload,
  X,
  MessageSquare,
  ArrowLeft,
  Settings2,
  ChevronDown,
} from "lucide-react";
import type { BusinessWorkspace } from "@/lib/business-workspace";
import { brainEnabled, sourceOrigin } from "@/lib/brain-sources";
import { operatorRequest, type OperatorState, type MemorySource } from "@/lib/operator";
import type { MemNode, MemLink } from "../memory-graph-3d";
const Graph = lazy(() => import("../memory-graph-3d").then((m) => ({ default: m.MemoryGraph3D })));
export type VisualView = "memory" | "calendar" | "business" | "inbox" | "images";
export type LocalVoiceImage = {
  id: string;
  filename: string;
  folder: string;
  title: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
};
export type VoiceImage = { name: string; url: string; width?: number; height?: number };
export type VoiceSource = { id: string; title: string; excerpt?: string };
const COLORS: Record<string, string> = {
  business: "#d5b787",
  content: "#aa9ddd",
  projects: "#8dd8ca",
  personal: "#d796b1",
};
function memoryLabel(title: string) {
  const match = title.match(/^(.*?)\s*[·—]\s*rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return title;
  const date = new Date(Date.UTC(Number(match[2]), Number(match[3]) - 1, Number(match[4])));
  return `${match[1]} conversation · ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}
export function VoiceVisuals({
  state,
  view,
  onClose,
  sources,
  focus,
  image,
  onImage,
  onRemoveImage,
  onDiscussImage,
  onDiscussSource,
  onNavigate,
  onOpenMessage,
  emailIds,
  active,
  cloudImages,
  busy,
  localImages,
  localNote,
  localSearchBusy,
  onLocalSearch,
  onLocalPreview,
}: {
  localImages: LocalVoiceImage[];
  localNote: string;
  localSearchBusy: boolean;
  onLocalSearch: (query: string) => void;
  onLocalPreview: (id: string) => void;
  state: OperatorState;
  view: VisualView;
  onClose: () => void;
  sources: VoiceSource[];
  focus: string;
  image: VoiceImage | null;
  onImage: (file: File) => void;
  onRemoveImage: () => void;
  onDiscussImage: () => void;
  onDiscussSource: (source: VoiceSource) => void;
  onNavigate: (path: string) => void;
  onOpenMessage: (id: string) => void;
  emailIds: string[] | null;
  active: boolean;
  cloudImages: boolean;
  busy: boolean;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const [layout, setLayout] = useState<"neural" | "network">("neural"),
    [selected, setSelected] = useState<MemorySource | null>(null);
  const visible = useMemo(
    () => state.sources.filter((s) => !s.deletedAt && brainEnabled(state, sourceOrigin(s))),
    [state],
  );
  const context = useQuery({
    queryKey: ["voice-visual-context", state.brainRevision],
    queryFn: () =>
      operatorRequest<OperatorState & { business?: BusinessWorkspace }>("/brain/context"),
    staleTime: 15000,
    enabled: view === "business",
  });
  const images = useQuery<{
    images: Array<{
      id: string;
      title: string;
      filename: string;
      mimeType: string;
      updatedAt: string;
    }>;
  }>({
    queryKey: ["voice-memory-images", state.brainRevision, state.sources.length],
    queryFn: () => operatorRequest("/voice/images"),
    enabled: view === "images",
    staleTime: 10000,
  });
  const graph = useMemo(() => {
    const match = new Set(sources.map((s) => s.id));
    const ordered = [...visible]
      .sort(
        (a, b) =>
          Number(match.has(b.id)) - Number(match.has(a.id)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, 240);
    const nodes: MemNode[] = [
        { id: "voice-memory-core", name: "Your memory", kind: "hub", val: 28, color: "#b8eddf" },
      ],
      links: MemLink[] = [];
    const groups = new Set<string>();
    for (const s of ordered) {
      const collection = s.collection || "personal",
        color = COLORS[collection] || "#8bbcd8",
        group = `voice-space:${collection}`;
      if (!groups.has(group)) {
        groups.add(group);
        nodes.push({
          id: group,
          name: collection.charAt(0).toUpperCase() + collection.slice(1),
          kind: "workspace",
          origin: collection,
          color,
          val: 16,
          categoryHub: true,
        });
        links.push({ source: "voice-memory-core", target: group, kind: "core" });
      }
      nodes.push({
        id: s.id,
        name: memoryLabel(s.title),
        kind: "file",
        origin: sourceOrigin(s),
        color: match.has(s.id) ? "#fbddac" : color,
        val: match.has(s.id) ? 8 : 3,
        preview: s.text?.slice(0, 300),
      });
      links.push({ source: group, target: s.id, kind: "file" });
    }
    return { nodes, links };
  }, [visible, sources]);
  const selectedSafe = selected && visible.find((s) => s.id === selected.id);
  const title = {
    memory: "Memory",
    calendar: "Calendar",
    inbox: "Inbox",
    business: "Business",
    images: "Images",
  }[view];
  const upcoming = brainEnabled(state, "meetings")
    ? state.events
        .filter((e) => new Date(e.end) >= new Date())
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 6)
    : [];
  const messages = brainEnabled(state, "email")
    ? state.inbox
        .filter((m) => (emailIds ? emailIds.includes(m.id) : m.status === "open"))
        .sort((a, b) =>
          emailIds
            ? emailIds.indexOf(a.id) - emailIds.indexOf(b.id)
            : Number(b.category === "needs-you") - Number(a.category === "needs-you"),
        )
        .slice(0, emailIds ? 10 : 4)
    : [];
  return (
    <section className="vv-workspace" aria-label="Conversation visual workspace">
      <header className="vv-heading">
        <button className="vv-back" onClick={onClose} aria-label="Back to conversation">
          <ArrowLeft size={14} />
          Back
        </button>
        <h2>{title}</h2>
        <button
          title="Open this section"
          aria-label="Open visual section"
          onClick={() =>
            onNavigate(
              view === "images"
                ? "/memory"
                : view === "business"
                  ? "/business"
                  : view === "calendar"
                    ? "/calendar"
                    : view === "inbox"
                      ? "/inbox"
                      : "/memory",
            )
          }
        >
          <ArrowUpRight size={17} />
        </button>
      </header>
      {view === "memory" && (
        <>
          <div className="vv-graph">
            {visible.length ? (
              <Suspense
                fallback={<div className="vv-empty">Bringing your memories into focus…</div>}
              >
                <Graph
                  embedded
                  layout={layout}
                  graphData={graph}
                  focusQuery={focus}
                  onSelect={(node) => {
                    const memory = visible.find((s) => s.id === node.id);
                    if (memory) setSelected(memory);
                  }}
                />
              </Suspense>
            ) : (
              <div className="vv-empty">
                <BrainCircuit size={36} />
                <h3>Your next thought starts here.</h3>
                <p>Add a memory or enable a source to see its connections.</p>
                <button onClick={() => onNavigate("/memory")}>
                  Open Memory <ArrowUpRight size={13} />
                </button>
              </div>
            )}
            <details className="vv-display">
              <summary>
                <Settings2 size={12} />
                View
              </summary>
              <div>
                <button aria-pressed={layout === "neural"} onClick={() => setLayout("neural")}>
                  Neural
                </button>
                <button aria-pressed={layout === "network"} onClick={() => setLayout("network")}>
                  Network
                </button>
              </div>
            </details>
          </div>
          {selectedSafe ? (
            <div className="vv-memory-detail">
              <button
                className="vv-detail-close"
                aria-label="Close memory detail"
                onClick={() => setSelected(null)}
              >
                <X size={14} />
              </button>
              <span className="vc-eyebrow">{selectedSafe.collection} · MEMORY</span>
              <h3>{memoryLabel(selectedSafe.title)}</h3>
              <p>{selectedSafe.text?.slice(0, 900) || "No text saved for this source."}</p>
              <button
                className="vv-text-action"
                disabled={busy}
                onClick={() => onDiscussSource(selectedSafe)}
              >
                <MessageSquare size={13} />
                Discuss this memory
              </button>
            </div>
          ) : (
            <details className="vv-memory-sources">
              <summary>
                {sources.length
                  ? `${sources.length} matching memories`
                  : `${visible.length.toLocaleString()} memories`}
                <ChevronDown size={12} />
              </summary>
              <div className="vv-sources">
                <div>
                  {(sources.length
                    ? sources
                    : visible
                        .slice()
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                        .slice(0, 3)
                  )
                    .slice(0, 3)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          const item = visible.find((m) => m.id === s.id);
                          if (item) setSelected(item);
                          else onDiscussSource(s);
                        }}
                      >
                        <span className="vv-card-dot" />
                        <span title={s.title}>{memoryLabel(s.title)}</span>
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                </div>
              </div>
            </details>
          )}
        </>
      )}
      {(view === "calendar" || view === "inbox") && (
        <div className="vv-today">
          {view === "calendar" && (
            <>
              <div className="vv-date">
                <strong>{new Date().toLocaleDateString("en-GB", { day: "2-digit" })}</strong>
                <span>
                  {new Date().toLocaleDateString("en-GB", { weekday: "long", month: "long" })}
                  <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
                </span>
              </div>
              <div className="vv-schedule">
                <span className="vc-eyebrow">UPCOMING · SAVED CALENDAR</span>
                {upcoming.length ? (
                  upcoming.map((e) => (
                    <button key={e.id} onClick={() => onNavigate("/calendar")}>
                      <time>
                        {new Date(e.start).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                        <b>
                          {new Date(e.start).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </b>
                      </time>
                      <span>
                        <strong>{e.title}</strong>
                        <small>{e.location || e.source + " calendar"}</small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <p className="vv-empty-line">
                    {brainEnabled(state, "meetings")
                      ? "No upcoming events saved. Connect a calendar to bring your schedule here."
                      : "Calendar is excluded from AI context."}
                  </p>
                )}
              </div>
            </>
          )}
          {view === "inbox" && (
            <>
              <div className="vv-inbox-intro">
                <h3>{emailIds ? "Search results" : "From your inbox"}</h3>
                <p>
                  {emailIds
                    ? "Saved emails matching your request."
                    : "Open a conversation to review and reply."}
                </p>
              </div>
              <div className="vv-inbox">
                <span className="vc-eyebrow">FROM YOUR CONVERSATIONS · SAVED MESSAGES</span>
                {messages.length ? (
                  messages.map((m) => (
                    <button key={m.id} onClick={() => onOpenMessage(m.id)}>
                      <span className="vv-avatar">{m.from.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{m.subject}</strong>
                        <small>{m.from}</small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <p className="vv-empty-line">
                    {brainEnabled(state, "email")
                      ? emailIds
                        ? "No saved emails match this search."
                        : "No open messages in your workspace."
                      : "Messages are excluded from AI context."}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {view === "business" && (
        <div className="vv-business">
          {!brainEnabled(state, "business") ? (
            <div className="vv-empty">Business context is switched off.</div>
          ) : context.isPending ? (
            <div className="vv-empty">Reading your business context…</div>
          ) : context.error ? (
            <div className="vv-empty">Business context could not load. Try again.</div>
          ) : (
            <>
              <h3>{context.data?.business?.profile?.businessName || "Your business"}</h3>
              <p>
                {context.data?.business?.profile?.whatYouDo ||
                  "Add your business profile on the dashboard."}
              </p>
              <div className="vv-business-cards">
                {(context.data?.business?.finances?.accounts || []).slice(0, 4).map((a, i) => (
                  <article key={i}>
                    <span>{a.name}</span>
                    <strong>
                      {a.currency && /^[A-Z]{3}$/.test(a.currency)
                        ? new Intl.NumberFormat("en-GB", {
                            style: "currency",
                            currency: a.currency,
                            maximumFractionDigits: 0,
                          }).format(a.balance)
                        : Number(a.balance).toLocaleString()}
                    </strong>
                    <small>Recorded account balance</small>
                  </article>
                ))}
              </div>
              <span className="vc-eyebrow">YOUR FOCUS</span>
              {(context.data?.business?.progress?.goals || []).slice(0, 4).map((g) => (
                <div className="vv-goal" key={g.id}>
                  <i />
                  <span>{g.title}</span>
                  <small>{g.horizon}</small>
                </div>
              ))}
              {!context.data?.business?.progress?.goals?.length && (
                <p className="vv-empty-line">
                  {context.data?.goals?.week ||
                    context.data?.business?.profile?.quarterGoal ||
                    "Set your priorities in Business to bring them here."}
                </p>
              )}
              <button className="vv-text-action" onClick={() => onNavigate("/business")}>
                Open your dashboard <ArrowUpRight size={13} />
              </button>
            </>
          )}
        </div>
      )}
      {view === "images" && (
        <div
          className="vv-images"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) onImage(e.dataTransfer.files[0]);
          }}
        >
          <div className="jarvis-local-search">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onLocalSearch(localQuery);
              }}
            >
              <input
                aria-label="Find local images"
                placeholder="Find an image by filename…"
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                disabled={!brainEnabled(state, "images")}
              />
              <button disabled={localSearchBusy || !brainEnabled(state, "images")}>
                {localSearchBusy ? "Finding…" : "Find"}
              </button>
            </form>
            <p>
              {!brainEnabled(state, "images")
                ? "Enable Images in your memory sources to search this Mac."
                : localNote ||
                  "Desktop · Downloads · Pictures. Search by filename, or leave blank for recent images."}
            </p>
          </div>
          {!!localImages.length && (
            <div className="jarvis-local-results">
              {localImages.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onLocalPreview(item.id)}
                  aria-label={`Preview ${item.filename}`}
                >
                  <img
                    loading="lazy"
                    src={`/__operator/voice/local-images/${encodeURIComponent(item.id)}`}
                    alt={item.filename}
                  />
                  <strong>{item.filename}</strong>
                  <small>{item.folder}</small>
                </button>
              ))}
            </div>
          )}
          {image ? (
            <div className="vv-image-preview">
              <img src={image.url} alt={image.name} />
              <div>
                <span>{image.name}</span>
                <button onClick={onRemoveImage} aria-label="Remove image">
                  <X size={14} />
                </button>
              </div>
              <button
                disabled={!active || !cloudImages || busy}
                className="vv-discuss-image"
                onClick={onDiscussImage}
              >
                <AudioLinesIcon />
                Discuss this image
              </button>
              <p>
                {active && cloudImages
                  ? "Shares this image with OpenAI when you choose Discuss."
                  : "Start an OpenAI voice conversation to discuss this image."}
              </p>
            </div>
          ) : (
            <label className="vv-dropzone">
              <span>
                <ImagePlus size={28} />
              </span>
              <h3>Show me what you’re thinking.</h3>
              <p>
                Drop an image, screenshot or reference.
                <br />
                We can look at it together.
              </p>
              <b>
                <Upload size={13} />
                Choose an image
              </b>
              <small>PNG, JPEG or WebP · up to 12 MB</small>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Add image to conversation"
                onChange={(e) => {
                  if (e.target.files?.[0]) onImage(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {!!images.data?.images.length && (
            <div className="vv-image-library">
              <span className="vc-eyebrow">IMAGES IN YOUR MEMORY</span>
              <div>
                {images.data.images.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          `/__operator/voice/images/${encodeURIComponent(item.id)}`,
                        );
                        if (!response.ok) throw new Error();
                        const blob = await response.blob();
                        onImage(new File([blob], item.filename, { type: blob.type }));
                      } catch {
                        /* permissions may have changed; refresh gallery */ void images.refetch();
                      }
                    }}
                  >
                    <img
                      src={`/__operator/voice/images/${encodeURIComponent(item.id)}`}
                      alt={item.title}
                      loading="lazy"
                    />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function AudioLinesIcon() {
  return <MessageSquare size={14} />;
}
