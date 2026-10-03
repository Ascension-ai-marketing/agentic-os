import { buildMemoryCatalog } from "@/lib/memory-catalog";
import "./memory-universe-v5.css";
import { BrainRings } from "@/components/brain/brain-rings";
import { BrainTimeline, type TimelineFocus } from "@/components/brain/brain-timeline";
import {
  MEMORY_FOCUS_EVENT,
  coverWindow,
  matchMemory,
  takePendingFocus,
  type MemoryFocusDetail,
  MEMORY_OPEN_EVENT,
} from "@/components/brain/brain-focus";
import { BrainRecordPanel, originalLink, type RelatedRecord } from "@/components/brain/brain-record-panel";
import { jevFetch } from "@/lib/jev-client";
import { BrainSourceLogo } from "@/components/brain/brain-source";
import { openConnectSources, useSourceLinks } from "@/components/brain/brain-connect";
import { BRAIN_SOURCES, brainEnabled, sourceOrigin, nodeOrigin } from "@/lib/brain-sources";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BrainCircuit,
  Globe2,
  Network,
  Orbit,
  CalendarRange,
  Maximize2,
  Search,
  X,
} from "lucide-react";
import {
  MemoryGraph3D,
  memoryNodeOpacity,
  type MemNode,
  type MemLink,
} from "@/components/memory-graph-3d";
import { useLiveData } from "@/lib/use-live-data";
import { COLLECTIONS, useOperator, askOperator, operatorRequest } from "@/lib/operator";
import type { AudienceSnapshot, BusinessWorkspace } from "@/lib/business-workspace";
const COLORS: Record<string, string> = {
  claude: "#f4ad67",
  codex: "#5d8bff",
  chatgpt: "#6febc0",
  meetings: "#b89bff",
  email: "#67c8ff",
  skills: "#f77fc8",
  hermes: "#d4e47b",
  openclaw: "#ff8e92",
  grokbot: "#d5e0f5",
  notion: "#d7dceb",
  obsidian: "#b292ff",
  images: "#87d8cd",
  files: "#8dbbff",
  manual: "#70d8ba",
  business: "#edc879",
  personal: "#ef9cb2",
  web: "#7cd3bc",
  agents: "#e2ba77",
  codebases: "#6fcacb",
};
const SOURCE_ORDER = [
  "business",
  "claude",
  "codex",
  "chatgpt",
  "email",
  "meetings",
  "skills",
  "hermes",
  "notion",
  "manual",
  "obsidian",
  "files",
  "images",
  "personal",
  "web",
  "agents",
  "codebases",
  "openclaw",
  "grokbot",
];
const LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT",
  email: "Email",
  meetings: "Meetings",
  skills: "Skills",
  hermes: "Hermes",
  manual: "Your notes",
  codebases: "Projects",
  web: "Web & video",
  files: "Documents",
  images: "Photos",
  business: "Info",
  personal: "Personal",
  obsidian: "Obsidian",
  grokbot: "Grok",
};
const ringLabel = (origin: string) => LABELS[origin] ?? origin.charAt(0).toUpperCase() + origin.slice(1);
type Detail = "macro" | "mid" | "micro" | "full";
const LIMITS: Record<Detail, number> = { macro: 90, mid: 180, micro: 450, full: 1200 };
const endpoint = (value: string | { id: string }): string =>
  typeof value === "object" ? value.id : value;
type GraphContext = {
  business:
    | null
    | (Pick<BusinessWorkspace, "profile" | "finances" | "progress"> & {
        audience: AudienceSnapshot[];
      });
};
const recordedDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date not recorded";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
type CortexGraph = { nodes: MemNode[]; links: MemLink[] };
const SOURCE_FADE_MS = 450;
/** Outgoing records are visual-only; the searchable graph already excludes them. */
function useSourceFade(desired: CortexGraph, enabled: Record<string, boolean> | undefined) {
  const [visible, setVisible] = useState(desired);
  const previous = useRef(desired);
  const didShowRecords = useRef(false);
  useLayoutEffect(() => {
    const now = performance.now();
    const before = previous.current;
    const old = new Map(before.nodes.map((node) => [node.id, node]));
    const hasRecords = desired.nodes.some((node) => node.kind !== "hub" && !node.categoryHub);
    const wanted = hasRecords ? desired : { nodes: [], links: [] };
    const incoming = new Set(wanted.nodes.map((node) => node.id));
    const nodes: MemNode[] = wanted.nodes.map((node) => {
      const prior = old.get(node.id);
      if (prior?.visualTransition?.to === 0)
        return {
          ...node,
          visualTransition: {
            from: memoryNodeOpacity(prior, now),
            to: 1,
            at: now,
            duration: SOURCE_FADE_MS,
          },
        };
      if (!prior && didShowRecords.current)
        return { ...node, visualTransition: { from: 0, to: 1, at: now, duration: SOURCE_FADE_MS } };
      return prior?.visualTransition?.to === 1
        ? { ...node, visualTransition: prior.visualTransition }
        : node;
    });
    for (const node of before.nodes) {
      if (incoming.has(node.id)) continue;
      if (hasRecords && (!node.origin || enabled?.[node.origin] !== false)) continue;
      const existing = node.visualTransition;
      if (existing?.to === 0 && now >= existing.at + existing.duration) continue;
      nodes.push({
        ...node,
        visualTransition:
          existing?.to === 0
            ? existing
            : {
                from: memoryNodeOpacity(node, now),
                to: 0,
                at: now,
                duration: SOURCE_FADE_MS,
              },
      });
    }
    const kept = new Set(nodes.map((node) => node.id));
    const links = [...wanted.links];
    const keys = new Set(links.map((link) => `${endpoint(link.source)}\0${endpoint(link.target)}`));
    for (const link of before.links) {
      const source = endpoint(link.source),
        target = endpoint(link.target),
        key = `${source}\0${target}`;
      if (kept.has(source) && kept.has(target) && !keys.has(key)) {
        links.push(link);
        keys.add(key);
      }
    }
    const next = { nodes, links };
    if (hasRecords) didShowRecords.current = true;
    previous.current = next;
    setVisible(next);
    const ending = nodes
      .filter((node) => node.visualTransition)
      .map((node) => node.visualTransition!.at + node.visualTransition!.duration);
    if (!ending.length) return;
    const timer = window.setTimeout(
      () => {
        const final = {
          nodes: wanted.nodes.map(({ visualTransition: _fade, ...node }) => node),
          links: wanted.links,
        };
        previous.current = final;
        setVisible(final);
      },
      Math.max(0, Math.max(...ending) - now) + 24,
    );
    return () => window.clearTimeout(timer);
  }, [desired, enabled]);
  return visible;
}
export function MemoryUniverse({ onSource }: { onSource: (id: string) => void }) {
  const live = useLiveData(),
    { state } = useOperator(),
    queryClient = useQueryClient();
  const sourceLinks = useSourceLinks();
  const [previewSources, setPreviewSources] = useState<Record<string, boolean> | null>(null);
  const effectiveState = useMemo(
    () => (previewSources ? { ...state, brainSources: previewSources } : state),
    [state, previewSources],
  );
  useEffect(() => {
    const preview = (event: Event) => {
      const sources = (event as CustomEvent<{ sources: Record<string, boolean> }>).detail?.sources;
      if (sources) setPreviewSources(sources);
    };
    window.addEventListener("memory:source-preview", preview);
    return () => window.removeEventListener("memory:source-preview", preview);
  }, []);
  useEffect(() => {
    if (
      previewSources &&
      Object.entries(previewSources).every(([id, enabled]) => brainEnabled(state, id) === enabled)
    )
      setPreviewSources(null);
  }, [state.brainSources, previewSources]);
  const context = useQuery<GraphContext>({
    queryKey: ["memory-graph-context"],
    queryFn: () => operatorRequest("/brain/context?view=graph"),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const lastBusiness = useRef<GraphContext["business"]>(null);
  if (context.data?.business) lastBusiness.current = context.data.business;
  const [orbitEnabled, setOrbitEnabled] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [layout, setLayout] = useState<"rings" | "timeline" | "neural" | "sphere" | "network">("rings"),
    [detail, setDetail] = useState<Detail>("mid"),
    [origin, setOrigin] = useState("all");
  const sceneRef = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState(""),
    [focus, setFocus] = useState(""),
    [nonce, setNonce] = useState(0),
    [selected, setSelected] = useState<MemNode | null>(null),
    [expanded, setExpanded] = useState(false),
    [sourceText, setSourceText] = useState(""),
    [error, setError] = useState("");
  const built = useMemo(() => buildMemoryCatalog(live, state, lastBusiness.current), [live, state.sources, state.inbox, state.events, state.goals, context.data]);
  // A background refresh never blanks the map: until new records arrive, the last map stays.
  const lastGood = useRef(built);
  if (built.graph.nodes.length > 1 || lastGood.current.graph.nodes.length <= 1) lastGood.current = built;
  const {
    graph: catalog,
    notes,
    counts,
    streams,
    daily,
    relations,
    relationKeys,
  } = built.graph.nodes.length > 1 ? built : lastGood.current;
  const [highlight, setHighlight] = useState<Set<string> | undefined>(undefined);
  const [timelineFocus, setTimelineFocus] = useState<TimelineFocus | undefined>(undefined);
  const [bigPanel, setBigPanel] = useState(false);
  const lastClick = useRef({ id: "", at: 0 });
  const selectedIdRef = useRef<string | undefined>(undefined);
  // The small panel appears a beat after a click, so the second click of a
  // double-click still lands on the record instead of on the panel.
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const relationLinks = useMemo(
    () =>
      [...relationKeys].map((key) => {
        const [source, target] = key.split("\u0000");
        return { source, target };
      }),
    [relationKeys],
  );
  const graph = useMemo(() => {
    const nodes = catalog.nodes.filter(
      (node) => !node.origin || brainEnabled(effectiveState, node.origin),
    );
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: catalog.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
    };
  }, [catalog, effectiveState.brainSources]);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of graph.links) {
      if (!map.has(l.source)) map.set(l.source, new Set());
      if (!map.has(l.target)) map.set(l.target, new Set());
      map.get(l.source)!.add(l.target);
      map.get(l.target)!.add(l.source);
    }
    return map;
  }, [graph]);
  const categories = useMemo(
    () =>
      SOURCE_ORDER.concat(
        BRAIN_SOURCES.map((s) => s.id).filter((id) => !SOURCE_ORDER.includes(id)),
      ).map((id) => ({
        id,
        name: LABELS[id] || BRAIN_SOURCES.find((s) => s.id === id)?.name || id,
        color: COLORS[id] || "#a3b4cb",
        count: counts[id] || 0,
        enabled: brainEnabled(effectiveState, id),
      })),
    [counts, effectiveState],
  );
  // Every switched-on source, so empty ones (Email, Meetings) still show a slot.
  const ringSources = useMemo(
    () => categories.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.count })),
    [categories],
  );
  const searched = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      graph.nodes
        .filter(
          (n) =>
            n.kind !== "hub" &&
            !n.categoryHub &&
            (origin === "all" || n.origin === origin) &&
            `${n.name} ${n.preview || ""}`.toLowerCase().includes(searched),
        )
        .slice(0, 30),
    [graph, searched, origin],
  );
  const { displayedGraph, eligible, linkTotal } = useMemo(() => {
    const scoped = catalog.nodes.filter(
      (n) => n.kind === "hub" || origin === "all" || n.origin === origin,
    );
    const candidates =
      detail === "macro"
        ? scoped.filter((n) => n.kind === "hub" || n.kind === "workspace" || n.kind === "decision")
        : scoped;
    const allowed = new Set(candidates.map((n) => n.id)),
      chosen = new Set<string>(),
      limit = LIMITS[detail];
    const take = (id: string) => {
      if (allowed.has(id) && chosen.size < limit) chosen.add(id);
    };
    if (selected) {
      take(selected.id);
      for (const id of adjacency.get(selected.id) || []) take(id);
    }
    for (const n of candidates) if (n.kind === "hub" || n.categoryHub) take(n.id);
    // Round-robin source buckets keep a large provider from hiding every other source.
    const buckets = new Map<string, string[]>();
    for (const n of candidates) {
      const key = n.origin || "core";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(n.id);
    }
    const lists = [...buckets.values()];
    let index = 0;
    while (chosen.size < Math.min(limit, candidates.length)) {
      let any = false;
      for (const list of lists)
        if (index < list.length) {
          take(list[index]);
          any = true;
        }
      if (!any) break;
      index++;
    }
    const included = new Set(graph.nodes.map((node) => node.id));
    const linked = graph.links.filter((l) => chosen.has(l.source) && chosen.has(l.target));
    const prioritized = selected
      ? [
          ...linked.filter((l) => l.source === selected.id || l.target === selected.id),
          ...linked.filter((l) => l.source !== selected.id && l.target !== selected.id),
        ]
      : linked;
    return {
      displayedGraph: {
        nodes: candidates.filter((n) => chosen.has(n.id) && included.has(n.id)),
        links: prioritized.slice(0, detail === "full" ? 3200 : detail === "micro" ? 1600 : 600),
      },
      eligible: candidates.filter((node) => included.has(node.id)).length,
      linkTotal: linked.length,
    };
  }, [graph, catalog, origin, detail, selected, adjacency]);
  const visualGraph = useSourceFade(displayedGraph, effectiveState.brainSources);
  // A record picked from search or a panel link may join the 3D scene a frame later;
  // refocus once it is there so the camera still flies to it.
  const focusedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || selected.categoryHub) {
      focusedOnce.current = null;
      return;
    }
    if (focusedOnce.current === selected.id) return;
    if (!visualGraph.nodes.some((n) => n.id === selected.id)) return;
    focusedOnce.current = selected.id;
    const frame = requestAnimationFrame(() => setNonce((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [visualGraph, selected]);
  const hasVisualRecords = visualGraph.nodes.some(
    (node) => node.kind !== "hub" && !node.categoryHub,
  );
  const reset = useCallback(() => {
    setSelected(null);
    setSourceText("");
    setError("");
    setFocus("");
    setNonce((n) => n + 1);
  }, []);
  const chooseOrigin = useCallback(
    (id: string) => {
      setOrigin(id);
      setQuery("");
      reset();
    },
    [reset],
  );
  const fly = useCallback(
    (node: MemNode) => {
      if (node.kind === "hub") {
        chooseOrigin("all");
        setDetail("full");
        return;
      }
      setQuery("");
      // A second click on the same record within a moment opens the full view.
      const now = performance.now();
      if (lastClick.current.id === node.id && now - lastClick.current.at < 450) setBigPanel(true);
      lastClick.current = { id: node.id, at: now };
      setSelected(node);
      if (node.categoryHub) {
        // A source group narrows the map to that source.
        setOrigin(node.origin || "all");
        setDetail("micro");
      } else {
        // A record keeps the whole map, so its links into other sources stay visible.
        setOrigin((current) => (current === "all" || current === node.origin ? current : "all"));
        setDetail((current) => (current === "macro" ? "mid" : current));
      }
      setFocus(node.name);
      setNonce((n) => n + 1);
      // Clicking the same record again (a double-click) keeps the text already loaded.
      if (selectedIdRef.current !== node.id) {
        setError("");
        setSourceText("");
      }
    },
    [chooseOrigin],
  );
  useEffect(() => {
    if (!selected) {
      setPanelFor(null);
      return;
    }
    if (bigPanel) {
      setPanelFor(selected.id);
      return;
    }
    const t = window.setTimeout(() => setPanelFor(selected.id), 320);
    return () => window.clearTimeout(t);
  }, [selected, bigPanel]);
  const showPanel = !!selected && (bigPanel || panelFor === selected.id);
  selectedIdRef.current = selected?.id;
  const openBig = useCallback(
    (node: MemNode) => {
      fly(node);
      setBigPanel(true);
    },
    [fly],
  );
  // The memory focus command: chat or voice points Memory at the records behind an answer.
  const applyFocus = useCallback(
    (detail: MemoryFocusDetail) => {
      const matches = matchMemory(graph.nodes, detail);
      setQuery("");
      setHighlight(matches.length ? new Set(matches.slice(0, 300).map((n) => n.id)) : undefined);
      if (detail.source && counts[detail.source]) setOrigin(detail.source);
      else setOrigin("all");
      const cover = coverWindow(matches, detail);
      if (cover) setTimelineFocus({ ...cover, nonce: Date.now() });
      setLayout(detail.view || (cover ? "timeline" : "rings"));
      const best = matches[0];
      if (best && (detail.open || matches.length === 1 || detail.recordIds?.length)) {
        setSelected(best);
        setFocus(best.name);
        setNonce((n) => n + 1);
        setBigPanel(!!detail.open);
        if (detail.openOriginal) void openOriginalOnMac(best);
      } else {
        setSelected(null);
        setBigPanel(false);
      }
    },
    [graph.nodes, counts],
  );
  // "Open it": show the record Memory has selected in the big panel, and open
  // its original on the Mac when it has one.
  const selectedRef = useRef<MemNode | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    const handle = () => {
      const node = selectedRef.current;
      if (!node) return;
      setBigPanel(true);
      void openOriginalOnMac(node);
    };
    window.addEventListener(MEMORY_OPEN_EVENT, handle);
    return () => window.removeEventListener(MEMORY_OPEN_EVENT, handle);
  }, []);
  const [pendingFocus, setPendingFocus] = useState<MemoryFocusDetail | undefined>(undefined);
  useEffect(() => {
    const handle = (event: Event) => {
      (window as unknown as { __agenticMemoryFocus?: unknown }).__agenticMemoryFocus = undefined;
      setPendingFocus({ ...(event as CustomEvent<MemoryFocusDetail>).detail });
    };
    window.addEventListener(MEMORY_FOCUS_EVENT, handle);
    const waiting = takePendingFocus();
    if (waiting) setPendingFocus(waiting);
    return () => window.removeEventListener(MEMORY_FOCUS_EVENT, handle);
  }, []);
  useEffect(() => {
    // Wait for the records, then apply once.
    if (!pendingFocus || graph.nodes.length <= 1) return;
    applyFocus(pendingFocus);
    setPendingFocus(undefined);
  }, [pendingFocus, graph.nodes.length, applyFocus]);
  const search = useRouterState({
    select: (s) => s.location.search as { source?: string; focus?: string },
  });
  useEffect(() => {
    if (search.source) {
      const n = nodeMap.get(search.source.replace(/^mapped:/, ""));
      if (n) fly(n);
    } else if (search.focus) {
      setQuery(search.focus);
      setFocus(search.focus);
      setNonce((n) => n + 1);
    }
  }, [search.source, search.focus, nodeMap, fly]);
  // Full text for saved records (Notion pages, imported notes) comes from the library itself.
  useEffect(() => {
    if (!selected || selected.source !== "library") return;
    const saved = state.sources.find((s) => s.id === selected.id) as
      | ((typeof state.sources)[number] & { textTruncated?: boolean })
      | undefined;
    if (saved?.text) setSourceText(saved.text);
    if (!saved?.textTruncated) return;
    const controller = new AbortController();
    fetch(`/__operator/memory/source-text?id=${encodeURIComponent(selected.id)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((r) => {
        if (r.text) setSourceText(r.text);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected, state.sources]);
  // A skill's full text is its SKILL.md on this Mac.
  useEffect(() => {
    if (!selected || selected.kind !== "skill") return;
    const controller = new AbortController();
    fetch(`/__operator/memory/skill-file?id=${encodeURIComponent(selected.id)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((r) => {
        if (r.text) setSourceText(r.text);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const original = notes.get(selected.id);
    if (!original) return;
    const controller = new AbortController();
    fetch(
      `/__memory_note?vault=${encodeURIComponent(original.vault)}&id=${encodeURIComponent(original.id)}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((r) => {
        if (!r.ok) throw new Error(r.error || "Source unavailable");
        setSourceText(r.content);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [selected, notes]);
  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => expandButton.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(sceneRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) || []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [expanded]);
  useEffect(() => {
    if (!selected) return;
    const latest = nodeMap.get(selected.id);
    if (!latest) reset();
    else if (
      latest.preview !== selected.preview ||
      latest.meta !== selected.meta ||
      latest.name !== selected.name ||
      latest.updated !== selected.updated
    ) {
      setSelected(latest);
      setSourceText("");
    }
  }, [nodeMap, selected, reset]);
  useEffect(() => {
    const update = (event: Event) => {
      const change = (event as CustomEvent<{ sourcesOnly?: boolean; ids?: string[] }>).detail;
      if (change?.sourcesOnly && !change.ids?.includes("business")) return;
      void queryClient.invalidateQueries({ queryKey: ["memory-graph-context"] });
    };
    window.addEventListener("operator:brain-change", update);
    return () => window.removeEventListener("operator:brain-change", update);
  }, [queryClient]);
  useEffect(() => {
    if (origin !== "all" && (!brainEnabled(effectiveState, origin) || !counts[origin])) {
      chooseOrigin("all");
      setDetail("full");
    }
  }, [origin, effectiveState, counts, chooseOrigin]);
  useEffect(() => {
    const clear = () => {
      chooseOrigin("all");
      setDetail("full");
    };
    window.addEventListener("memory:clear-selection", clear);
    return () => window.removeEventListener("memory:clear-selection", clear);
  }, [chooseOrigin]);
  useEffect(() => {
    const available =
      selected &&
      nodeMap.has(selected.id) &&
      brainEnabled(effectiveState, selected.origin || nodeOrigin(selected));
    window.dispatchEvent(
      new CustomEvent("memory:selection", {
        detail: available
          ? {
              id: selected.id,
              title: selected.name,
              origin: selected.origin || nodeOrigin(selected),
              text: (sourceText || selected.preview || selected.meta || "").slice(0, 4000),
            }
          : null,
      }),
    );
  }, [selected, sourceText, nodeMap, effectiveState]);
  const related: RelatedRecord[] = selected
    ? (relations.get(selected.id) || []).flatMap((r) => {
        const node = nodeMap.get(r.id);
        return node ? [{ node, reasons: r.reasons, score: r.score }] : [];
      })
    : [];
  const sameSource: MemNode[] = selected
    ? ([...(adjacency.get(selected.id) || [])]
        .map((id) => nodeMap.get(id))
        .filter(
          (n): n is MemNode =>
            !!n &&
            n.kind !== "hub" &&
            n.kind !== "workspace" &&
            !n.categoryHub &&
            !related.some((r) => r.node.id === n.id),
        ) as MemNode[])
    : [];
  const colorOf = (n: MemNode) => n.color || COLORS[n.origin || ""] || "#a3b4cb";
  // Main sources with nothing in them yet, and how to connect each.
  const missingSources = sourceLinks.links.filter(
    (l) => (l.state === "ready" || l.state === "needs") && !counts[l.id],
  );
  const activeCategory = categories.find((c) => c.id === origin);
  const includedCount = categories.filter((c) => c.enabled).length;
  const hasRecords = graph.nodes.some(
    (n) => n.kind !== "hub" && !n.categoryHub && (origin === "all" || n.origin === origin),
  );
  function closeInspector() {
    setBigPanel(false);
    reset();
  }
  return (
    <section
      ref={sceneRef}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? "Immersive memory network" : "Visual cortex"}
      className={`ar-universe neural-universe neural-wide ${expanded ? "is-expanded" : ""}`}
      data-layout={layout}
      data-scope={origin}
      data-panel={showPanel ? (bigPanel ? "large" : "open") : undefined}
    >
      <div className="ar-universe-top neural-header">
        <div className="cortex-visual-title">
          <span className="cortex-live-dot" />
          <h2>Visual cortex</h2>
        </div>
        <div className="neural-layout-switch" role="group" aria-label="Cortex layout">
          {(
            [
              { id: "rings", name: "Rings", Icon: Orbit },
              { id: "timeline", name: "Timeline", Icon: CalendarRange },
              { id: "neural", name: "Neural", Icon: BrainCircuit },
              { id: "sphere", name: "Sphere", Icon: Globe2 },
              { id: "network", name: "Network", Icon: Network },
            ] as const
          ).map(({ id, name, Icon }) => (
            <button key={id} aria-pressed={layout === id} onClick={() => setLayout(id)}>
              <Icon size={13} />
              {name}
            </button>
          ))}
        </div>
        <label className="op-search neural-header-search">
          <Search size={13} />
          <input
            aria-label="Find a memory node"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) fly(matches[0]);
            }}
            placeholder="Find a memory…"
          />
          {query && (
            <button aria-label="Clear memory search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </label>
        <span className="ar-graph-count">
          {(hasRecords ? graph.nodes.length : 0).toLocaleString()} nodes <i />
          {(hasRecords ? graph.links.length : 0).toLocaleString()} links
        </span>
        <button
          ref={expandButton}
          className="neural-immersive-button"
          aria-label={expanded ? "Exit immersive memory" : "Explore full-screen memory network"}
          title={
            expanded
              ? "Back to Memory · Escape"
              : "Enter the full network. Drag to explore and scroll to zoom."
          }
          onClick={() => {
            if (expanded) setExpanded(false);
            else {
              setLayout("network");
              setDetail("full");
              chooseOrigin("all");
              setQuery("");
              setExpanded(true);
            }
          }}
        >
          {expanded ? <X size={14} /> : <Maximize2 size={14} />}
          <span>{expanded ? "Back to Memory" : "Explore network"}</span>
        </button>
      </div>
      <div className="ar-universe-body">
        <div
          className="ar-universe-canvas"
          onDoubleClick={() => {
            // A double-click anywhere right after picking a record opens its full view,
            // even if the map moved under the second click.
            if (selected && !selected.categoryHub && performance.now() - lastClick.current.at < 700)
              setBigPanel(true);
          }}
        >
          {hasVisualRecords && layout === "rings" ? (
            <BrainRings
              nodes={graph.nodes}
              links={graph.links}
              order={SOURCE_ORDER}
              labelOf={ringLabel}
              focusOrigin={origin}
              query={query}
              onSelect={fly}
              sources={ringSources}
              relationKeys={relationKeys}
              selectedId={selected?.id}
              highlightIds={highlight}
              onOpen={openBig}
              streams={streams}
              onSource={(id) => {
                chooseOrigin(id);
                setDetail("micro");
              }}
            />
          ) : hasVisualRecords && layout === "timeline" ? (
            <BrainTimeline
              nodes={graph.nodes}
              sources={ringSources}
              labelOf={ringLabel}
              query={query}
              onSelect={fly}
              relations={relationLinks}
              selectedId={selected?.id}
              highlightIds={highlight}
              onOpen={openBig}
              streams={streams}
              daily={daily}
              focus={timelineFocus}
            />
          ) : hasVisualRecords ? (
            <MemoryGraph3D
              graphData={visualGraph}
              layout={layout === "rings" || layout === "timeline" ? "neural" : layout}
              viewKey={`${origin}:${detail}`}
              orbitEnabled={orbitEnabled}
              onOrbitChange={setOrbitEnabled}
              embedded
              onSelect={fly}
              focusQuery={focus}
              focusNodeId={selected && !selected.categoryHub ? selected.id : undefined}
              activeNodeIds={[...related.map((r) => r.node.id), ...(highlight ? [...highlight].slice(0, 120) : [])]}
              focusShift={selected ? 110 : 0}
              focusNonce={nonce}
            />
          ) : (
            <div className="neural-quiet-empty" role="status">
              <span className="neural-empty-symbol">
                <BrainCircuit size={28} strokeWidth={1} />
              </span>
              <h3>
                {includedCount === 0
                  ? "Switch on a source to explore"
                  : context.isPending
                    ? "Loading your memories"
                    : "Your memory starts here"}
              </h3>
              <p>
                {includedCount === 0
                  ? "Your memories are still saved. Switch on a source to explore them."
                  : "Connect an app or add a memory to start seeing connections."}
              </p>
            </div>
          )}
          <div className="neural-detail-bar">
            <div className="neural-detail-levels" role="group" aria-label="Memory detail level">
              {(["macro", "mid", "micro", "full"] as Detail[]).map((level) => (
                <button
                  key={level}
                  aria-pressed={detail === level}
                  disabled={!hasRecords}
                  title={
                    {
                      macro: "Source hubs and workspaces",
                      mid: "A balanced overview, up to 180 nodes",
                      micro: "Detail inside one source, up to 450 nodes",
                      full: "Full network, up to 1,200 nodes at once",
                    }[level]
                  }
                  onClick={() => {
                    setDetail(level);
                    setSelected(null);
                    setFocus("");
                    setNonce((n) => n + 1);
                    if (level === "full") setOrigin("all");
                    if (level === "micro" && origin === "all")
                      setOrigin([...categories].sort((a, b) => b.count - a.count)[0]?.id || "all");
                  }}
                >
                  <span className={`neural-detail-glyph ${level}`} aria-hidden />
                  <span>{level[0].toUpperCase() + level.slice(1)}</span>
                </button>
              ))}
            </div>
            {hasRecords && (
              <div className="neural-render-count">
                {displayedGraph.nodes.length.toLocaleString()}
                {displayedGraph.nodes.length < eligible
                  ? ` of ${eligible.toLocaleString()}`
                  : ""}{" "}
                shown{linkTotal > displayedGraph.links.length ? " · links limited" : ""}
                <small>
                  {displayedGraph.nodes.length < eligible
                    ? "Search to open any memory"
                    : "Drag to orbit · scroll to zoom"}
                </small>
              </div>
            )}
          </div>
          {!!highlight?.size && (
            <button
              className="brain-focus-chip"
              onClick={() => {
                setHighlight(undefined);
                setTimelineFocus(undefined);
                chooseOrigin("all");
              }}
              aria-label="Clear highlighted memories"
            >
              <b>{highlight.size.toLocaleString()}</b>
              {highlight.size === 1 ? "match" : "matches"}
              {origin !== "all" ? ` in ${ringLabel(origin)}` : ""}
              <span>Clear</span>
              <X size={11} />
            </button>
          )}
          {origin !== "all" && !highlight?.size && (
            <button
              className="neural-scope-chip"
              onClick={closeInspector}
              aria-label="Return to all sources"
            >
              <i style={{ background: activeCategory?.color }} />
              {activeCategory?.name || origin}
              <span>All sources</span>
              <X size={11} />
            </button>
          )}
          {selected && showPanel && bigPanel && (
            <button
              type="button"
              className="brain-full-backdrop"
              aria-label="Back to the map"
              onClick={() => setBigPanel(false)}
            />
          )}
          {selected && showPanel && (
            <BrainRecordPanel
              key={selected.id}
              large={bigPanel}
              onExpand={() => setBigPanel(true)}
              node={selected}
              related={related}
              sameSource={sameSource}
              text={sourceText}
              error={error}
              colorOf={colorOf}
              labelOf={ringLabel}
              onSelect={fly}
              onClose={closeInspector}
              onChat={() => {
                setExpanded(false);
                askOperator(
                  `What should I know about ${selected.name}?`,
                  `MEMORY SOURCE: ${selected.name}\n${(sourceText || selected.preview || selected.meta || "No source text available.").slice(0, 4000)}`,
                  true,
                  undefined,
                  selected.origin || nodeOrigin(selected),
                );
              }}
              onOpenSource={
                selected.source === "library"
                  ? () => {
                      setExpanded(false);
                      onSource(selected.id);
                    }
                  : undefined
              }
              dashboardLink={
                selected.source === "business-dashboard" ? (
                  <Link className="op-button" to="/business">
                    <ArrowUpRight size={13} />
                    Open dashboard
                  </Link>
                ) : undefined
              }
            />
          )}
          {hasVisualRecords && layout !== "rings" && layout !== "timeline" && !!missingSources.length && (
            <div className="brain-missing" data-scoped={origin !== "all" || undefined}>
              <span>Not connected yet</span>
              {missingSources.map((l) => (
                <button key={l.id} onClick={openConnectSources}>
                  <BrainSourceLogo origin={l.id} size={16} />
                  {l.name}
                </button>
              ))}
            </div>
          )}
          {searched && !selected && (
            <div className="neural-search-results" aria-label="Memory search results">
              <div className="neural-search-heading">
                <span>Matching memories</span>
                <small>{matches.length === 30 ? "30+" : matches.length}</small>
                <button aria-label="Close search results" onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              </div>
              {matches.map((n) => (
                <button className="ar-node-row" key={n.id} onClick={() => fly(n)}>
                  <i style={{ background: n.color }} />
                  <span>{n.name}</span>
                  <ArrowUpRight size={11} />
                </button>
              ))}
              {!matches.length && <p>No matching memories in this source.</p>}
            </div>
          )}
          {context.isError && brainEnabled(state, "business") && (
            <p className="neural-context-error" role="alert">
              Dashboard context unavailable.{" "}
              <button onClick={() => void context.refetch()}>Retry</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Opens a record's original (Obsidian, Gmail, Outlook, Notion) through the Mac, not a pop-up. */
async function openOriginalOnMac(node: MemNode) {
  const link = originalLink(node);
  if (!link) return false;
  try {
    await jevFetch("/__open_url", { method: "POST", body: JSON.stringify({ url: link.href }) });
    return true;
  } catch {
    return false;
  }
}
