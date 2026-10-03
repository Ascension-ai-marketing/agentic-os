import { useQuery } from "@tanstack/react-query";
import { useLiveData } from "@/lib/use-live-data";
import { buildMemoryCatalog, memoryGraphWindow } from "@/lib/memory-catalog";
import { operatorRequest } from "@/lib/operator";
import { lazy, Suspense, useEffect, useMemo, useState, useRef } from "react";
import { ArrowUpRight, BrainCircuit, RotateCcw, X } from "lucide-react";
import { brainEnabled, sourceOrigin, BRAIN_SOURCES } from "@/lib/brain-sources";
import type { MemorySource, OperatorState } from "@/lib/operator";
import type { MemNode, MemLink } from "../memory-graph-3d";
import { SourceBrand } from "./source-brand";

const Graph = lazy(() => import("../memory-graph-3d").then((m) => ({ default: m.MemoryGraph3D })));
type Match = { id: string; title: string; excerpt?: string };
const colors = ["#8be6db", "#b1a0ef", "#9cceff", "#f0bda0", "#e7a7ce", "#c3e6af"];

function brand(source: MemorySource) {
  // The actual import provider decides the logo. A meeting isn't necessarily Granola.
  const id = source.connector?.provider || sourceOrigin(source);
  return {
    id,
    name: id === "granola" ? "Granola" : BRAIN_SOURCES.find((s) => s.id === id)?.name || id,
  };
}

export function JarvisMemoryStage({
  state,
  sources,
  query,
  paused,
  phase,
  onDiscuss,
  onOpenMemory,
  welcome = false,
  activity = "idle",
}: {
  state: OperatorState;
  sources: Match[];
  query: string;
  paused: boolean;
  phase: string;
  onDiscuss: (source: Match) => void;
  onOpenMemory: () => void;
  welcome?: boolean;
  activity?: string;
}) {
  const live = useLiveData();
  const context = useQuery<{ business: Parameters<typeof buildMemoryCatalog>[2] }>({
    queryKey: ["memory-graph-context"],
    queryFn: () => operatorRequest("/brain/context?view=graph"),
    staleTime: 15000,
  });
  const [selectedId, setSelectedId] = useState("");
  const [find, setFind] = useState("");
  const [orbit, setOrbit] = useState(true);
  const sourceBadge = useRef<HTMLDivElement>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [layout, setLayout] = useState<"sphere" | "neural" | "network">("sphere");
  const visible = useMemo(
    () =>
      state.sources.filter(
        (s) =>
          !s.deletedAt &&
          s.status === "ready" &&
          !s.connector?.supersededAt &&
          brainEnabled(state, sourceOrigin(s)),
      ),
    [state.sources, state.brainSources],
  );
  const matches = useMemo(
    () => sources.filter((match) => visible.some((s) => s.id === match.id)),
    [sources, visible],
  );
  const matchKey = matches.map((s) => s.id).join("|");
  useEffect(() => {
    if (query) {
      setSelectedId(matches[0]?.id || "");
      setFocusNonce((n) => n + 1);
    }
  }, [matchKey, query]);
  const selected = visible.find((s) => s.id === selectedId);
  const catalog = useMemo(
    () => buildMemoryCatalog(live, state, context.data?.business).graph,
    [live, state.sources, state.inbox, state.events, state.goals, context.data],
  );
  const allowedNodes = useMemo(
    () => catalog.nodes.filter((node) => !node.origin || brainEnabled(state, node.origin)),
    [catalog, state.brainSources],
  );
  const graph = useMemo(
    () =>
      memoryGraphWindow(allowedNodes, catalog.links, [
        ...matches.map((source) => source.id),
        selectedId,
      ]),
    [allowedNodes, catalog, matchKey, selectedId],
  );
  const pulseIds = useMemo(() => {
    if (["email", "meetings", "images"].includes(activity))
      return graph.nodes.filter((node) => node.origin === activity).map((node) => node.id);
    if (activity === "speaking" && matches.length) return matches.map((source) => source.id);
    if (activity === "memory")
      return matches.length
        ? matches.map((source) => source.id)
        : graph.nodes.filter((node) => node.categoryHub).map((node) => node.id);
    if (["listening", "speaking", "thinking", "build"].includes(activity))
      return graph.nodes.filter((node) => node.kind === "hub").map((node) => node.id);
    return [];
  }, [graph, activity, matchKey]);
  function select(id: string) {
    setSelectedId(id);
    setFocusNonce((n) => n + 1);
  }
  const selectedBrand = selected ? brand(selected) : null;
  const excerpt = selected && (matches.find((s) => s.id === selected.id)?.excerpt || selected.text);
  return (
    <section
      className="jarvis-memory-stage"
      aria-label="Jarvis memory network"
      data-focused={!!selected}
      data-paused={paused}
    >
      <div className="jarvis-network-label">
        <span>
          {phase && (
            <>
              <i />
              {phase}
            </>
          )}
        </span>
        <span>
          {allowedNodes.length > 1200
            ? `1,200 of ${allowedNodes.length.toLocaleString()} nodes`
            : `${allowedNodes.length.toLocaleString()} nodes`}
        </span>
      </div>
      <div className="jarvis-network-search">
        <input
          aria-label="Find a memory in Jarvis"
          placeholder="Find a memory…"
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
        {find.trim() && (
          <div className="jarvis-network-search-results">
            {allowedNodes
              .filter((source) => source.name.toLowerCase().includes(find.trim().toLowerCase()))
              .slice(0, 6)
              .map((source) => (
                <button
                  key={source.id}
                  onClick={() => {
                    select(source.id);
                    setFind("");
                  }}
                >
                  {source.name}
                </button>
              ))}
            {!allowedNodes.some((source) =>
              source.name.toLowerCase().includes(find.trim().toLowerCase()),
            ) && <span>No matching titles</span>}
          </div>
        )}
      </div>
      <div className="jarvis-network-canvas">
        {allowedNodes.length > 1 ? (
          <Suspense
            fallback={<div className="jarvis-network-loading">Bringing your world into focus…</div>}
          >
            <Graph
              embedded
              showTitles
              compactHover
              activeNodeIds={pulseIds}
              graphData={graph}
              layout={layout}
              viewKey={`jarvis:${layout}`}
              orbitEnabled={!paused && orbit}
              onOrbitChange={setOrbit}
              focusQuery={selectedId}
              focusNodeId={selectedId || undefined}
              onFocusPosition={(point) => {
                const badge = sourceBadge.current;
                if (!badge) return;
                badge.style.visibility = point ? "visible" : "hidden";
                if (point) {
                  badge.style.left = `${point.x}px`;
                  badge.style.top = `${point.y}px`;
                }
              }}
              focusNonce={focusNonce}
              onSelect={(node) => {
                select(node.id);
              }}
            />
          </Suspense>
        ) : (
          <div className="jarvis-network-empty">
            <BrainCircuit size={58} />
            <h2>Your world, connected.</h2>
            <p>Add a memory to bring it into view.</p>
            <button onClick={onOpenMemory}>
              Open Memory <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {selectedBrand && (
          <div
            ref={sourceBadge}
            className="jarvis-network-source-focus"
            aria-hidden="true"
            style={{ visibility: "hidden" }}
          >
            <SourceBrand
              id={selectedBrand.id === "meetings" ? "files" : selectedBrand.id}
              size={32}
            />
          </div>
        )}
      </div>
      <div className="jarvis-network-toolbar">
        <div className="jarvis-network-layout" aria-label="Memory layout">
          <button aria-pressed={layout === "sphere"} onClick={() => setLayout("sphere")}>
            Sphere
          </button>
          <button aria-pressed={layout === "neural"} onClick={() => setLayout("neural")}>
            Neural
          </button>
          <button aria-pressed={layout === "network"} onClick={() => setLayout("network")}>
            Network
          </button>
        </div>
        <button
          className="jarvis-network-reset"
          aria-label="Show whole memory network"
          onClick={() => select("")}
        >
          <RotateCcw size={13} />
          Reset view
        </button>
      </div>
      {selected && selectedBrand ? (
        <article className="jarvis-memory-focus" aria-label="Focused memory">
          <header>
            <SourceBrand
              id={selectedBrand.id === "meetings" ? "files" : selectedBrand.id}
              size={36}
            />
            <div>
              <span>{selectedBrand.name} · Saved memory</span>
              <h2>{selected.title}</h2>
            </div>
            <button aria-label="Close focused memory" onClick={() => select("")}>
              <X size={16} />
            </button>
          </header>
          <details>
            <summary>Read memory</summary>
            <p>{excerpt?.slice(0, 700) || "No text has been saved for this memory."}</p>
          </details>
          <footer>
            <span>Linked by source</span>
            <button onClick={() => onDiscuss({ id: selected.id, title: selected.title, excerpt })}>
              Ask Jarvis <ArrowUpRight size={14} />
            </button>
          </footer>
        </article>
      ) : query && !matches.length ? (
        <div className="jarvis-memory-no-match">
          No saved memories matched “{query}”. Try another phrase or connect a source in Memory.
        </div>
      ) : null}
      {query && matches.length > 1 && (
        <div className="jarvis-memory-matches" aria-label="Matching memories">
          {matches.map((s) => (
            <button key={s.id} aria-pressed={s.id === selectedId} onClick={() => select(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
      )}
      {!selectedId && !query && welcome && visible.length > 0 && (
        <div className="jarvis-network-invitation">
          <h2>Think out loud.</h2>
          <p>Your world. One conversation.</p>
        </div>
      )}
    </section>
  );
}
