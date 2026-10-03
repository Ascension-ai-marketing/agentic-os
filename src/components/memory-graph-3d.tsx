import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Zap } from "lucide-react";
import { workspaces, skills, runs, memorySignals, memorySources } from "@/lib/mock-data";
import { useLiveData } from "@/lib/use-live-data";
import { MemoryGraphLoader } from "@/components/memory-graph-loader";

type ForceGraphModule = typeof import("react-force-graph-3d").default;
type ThreeModule = typeof import("three");
type UnrealBloomPassCtor =
  typeof import("three/examples/jsm/postprocessing/UnrealBloomPass.js").UnrealBloomPass;

export interface MemNode {
  id: string;
  name: string;
  kind: "hub" | "workspace" | "file" | "decision" | "session" | "skill" | "vector_store";
  workspaceId?: string;
  size?: string;
  updated?: string;
  status?: "healthy" | "stale" | "missing";
  freshness?: number;
  meta?: string;
  source?: string;
  origin?: string;
  categoryHub?: boolean;
  visualTransition?: { from: number; to: 0 | 1; at: number; duration: number };
  preview?: string;
  /** Where the record lives, when it can be opened outside the OS. */
  url?: string;
  vectorCount?: number;
  namespaces?: number | Array<{ name: string; vectorCount: number }>;
  dimension?: number;
  val: number;
  color: string;
}

export function memoryNodeOpacity(node: MemNode, now = performance.now()) {
  const fade = node.visualTransition;
  if (!fade) return 1;
  const progress = Math.min(1, Math.max(0, (now - fade.at) / fade.duration));
  const eased = progress * progress * (3 - 2 * progress);
  return fade.from + (fade.to - fade.from) * eased;
}

function setSourceOpacity(object: any, opacity: number) {
  if (object.userData.__sourceOpacity === opacity) return;
  object.userData.__sourceOpacity = opacity;
  object.visible = opacity > 0.001;
  object.traverse((child: any) => {
    if (!child.material) return;
    const fade = (material: any) => {
      if (material.userData.__sourceFadeOwner !== object.uuid) {
        material = material.clone();
        material.userData.__sourceFadeOwner = object.uuid;
        material.userData.__sourceBaseOpacity = material.opacity;
      }
      material.transparent = true;
      material.opacity = material.userData.__sourceBaseOpacity * opacity;
      material.depthWrite = false;
      return material;
    };
    child.material = Array.isArray(child.material)
      ? child.material.map(fade)
      : fade(child.material);
  });
}

export interface MemLink {
  source: string;
  target: string;
  kind: "core" | "file" | "decision" | "session" | "skill" | "cross";
}

const ACCENT = "#3ddc97";
const ACCENT2 = "#7be0c8";
const STALE = "#f5b14c";
const MISSING = "#ef5a5a";
const FILE_COL = "#8a93a3";
const WS_COL = "#e6ebf2";
const DEC_COL = "#a78bfa";
const SES_COL = "#60a5fa";
const SKILL_COL = "#f472b6";

function buildData(liveData?: any) {
  // Prefer real data from the aggregator if it produced a memory graph.
  const liveMemory = liveData?.memory;
  if (liveMemory?.nodes?.length && liveMemory?.links?.length) {
    return {
      nodes: liveMemory.nodes as MemNode[],
      links: liveMemory.links as MemLink[],
    };
  }

  const nodes: MemNode[] = [];
  const links: MemLink[] = [];

  nodes.push({
    id: "hub",
    name: "Memory Core",
    kind: "hub",
    val: 60,
    color: ACCENT,
    source: "all",
  });

  // Decision satellites around hub
  const decisions = [
    "use-claude-md-everywhere",
    "skills-as-units",
    "outputs-immutable",
    "memory-wrap-nightly",
  ];
  decisions.forEach((d) => {
    nodes.push({
      id: `dec-${d}`,
      name: d,
      kind: "decision",
      val: 8,
      color: DEC_COL,
      meta: "decision",
      source: "obsidian",
    });
    links.push({ source: "hub", target: `dec-${d}`, kind: "decision" });
  });

  workspaces.forEach((w, wi) => {
    const status: MemNode["status"] =
      w.claudeMdStatus === "missing" ? "missing" : w.memoryFreshness < 60 ? "stale" : "healthy";
    const wsColor = status === "missing" ? MISSING : status === "stale" ? STALE : WS_COL;
    // Half of workspaces are "Obsidian" buckets, half "Claude" buckets — visual diversity
    const wsSource = wi % 2 === 0 ? "obsidian" : "claude";

    nodes.push({
      id: `ws-${w.id}`,
      name: w.name,
      kind: "workspace",
      workspaceId: w.id,
      status,
      freshness: w.memoryFreshness,
      val: 22,
      color: wsColor,
      source: wsSource,
      updated: w.lastRun,
    });
    links.push({ source: "hub", target: `ws-${w.id}`, kind: "core" });

    w.memoryFiles.slice(0, 5).forEach((f, j) => {
      const id = `f-${w.id}-${j}`;
      nodes.push({
        id,
        name: f.name,
        kind: "file",
        workspaceId: w.id,
        size: f.size,
        updated: f.updated,
        val: 5,
        color: FILE_COL,
        source: wsSource,
        preview: f.name.endsWith(".md") ? "Agency means happen-to-life energy…" : undefined,
      });
      links.push({ source: `ws-${w.id}`, target: id, kind: "file" });
    });
  });

  // Pinecone vector_store nodes — large, brightly coloured, link to hub
  memorySources
    .filter((s) => s.kind === "vector")
    .forEach((s) => {
      nodes.push({
        id: `vs-${s.id}`,
        name: s.label,
        kind: "vector_store",
        val: 28,
        color: s.color,
        source: s.id,
        vectorCount: s.vectorCount,
        namespaces: s.namespaces,
        dimension: s.dimension,
      });
      links.push({ source: "hub", target: `vs-${s.id}`, kind: "core" });
    });

  // Sessions cluster — recent runs as nodes linking workspace + skill
  runs.slice(0, 10).forEach((r, i) => {
    const sid = `ses-${i}`;
    nodes.push({
      id: sid,
      name: r.id,
      kind: "session",
      workspaceId: workspaces.find((w) => w.name === r.workspace)?.id,
      meta: `${r.skill} · ${r.duration}`,
      val: 6,
      color: SES_COL,
    });
    const ws = workspaces.find((w) => w.name === r.workspace);
    if (ws) links.push({ source: `ws-${ws.id}`, target: sid, kind: "session" });
  });

  // Top skills as orbiters cross-linking workspaces they touch
  const topSkills = [...skills].sort((a, b) => b.uses - a.uses).slice(0, 6);
  topSkills.forEach((s) => {
    const sid = `sk-${s.name.replace(/\s+/g, "-").toLowerCase()}`;
    nodes.push({
      id: sid,
      name: s.name,
      kind: "skill",
      val: 9,
      color: SKILL_COL,
      meta: `${s.uses} uses`,
    });
    if (s.scope === "global") {
      // link to 2-3 workspaces
      workspaces
        .slice(0, 3)
        .forEach((w) => links.push({ source: sid, target: `ws-${w.id}`, kind: "skill" }));
    } else if (s.workspace) {
      links.push({ source: sid, target: `ws-${s.workspace}`, kind: "skill" });
    }
  });

  // Dense cross-workspace memory links — every workspace connects to ~3 others
  for (let i = 0; i < workspaces.length; i++) {
    for (let k = 1; k <= 3; k++) {
      const j = (i + k) % workspaces.length;
      if (i !== j) {
        links.push({
          source: `ws-${workspaces[i].id}`,
          target: `ws-${workspaces[j].id}`,
          kind: "cross",
        });
      }
    }
  }

  // Decisions cross-link to workspaces (knowledge influence)
  decisions.forEach((d, di) => {
    workspaces.forEach((w, wi) => {
      if ((wi + di) % 3 === 0) {
        links.push({ source: `dec-${d}`, target: `ws-${w.id}`, kind: "decision" });
      }
    });
  });

  // Sessions also reference decisions
  runs.slice(0, 10).forEach((_, i) => {
    const sid = `ses-${i}`;
    const d = decisions[i % decisions.length];
    links.push({ source: sid, target: `dec-${d}`, kind: "session" });
  });

  // Skills cross-pollinate — every skill links to 2 workspaces minimum
  topSkills.forEach((s, si) => {
    const sid = `sk-${s.name.replace(/\s+/g, "-").toLowerCase()}`;
    workspaces.forEach((w, wi) => {
      if ((wi + si) % 4 === 0) links.push({ source: sid, target: `ws-${w.id}`, kind: "skill" });
    });
  });

  // Skill-to-skill resonance
  for (let i = 0; i < topSkills.length - 1; i++) {
    const a = `sk-${topSkills[i].name.replace(/\s+/g, "-").toLowerCase()}`;
    const b = `sk-${topSkills[i + 1].name.replace(/\s+/g, "-").toLowerCase()}`;
    links.push({ source: a, target: b, kind: "skill" });
  }

  // File-to-file shared knowledge across workspaces (pick a few)
  const fileNodes = nodes.filter((n) => n.kind === "file");
  for (let i = 0; i < fileNodes.length; i += 4) {
    const a = fileNodes[i];
    const b = fileNodes[(i + 7) % fileNodes.length];
    if (a && b && a.workspaceId !== b.workspaceId) {
      links.push({ source: a.id, target: b.id, kind: "cross" });
    }
  }

  return { nodes, links };
}

// Spheres view: same semantic graph + extra "memory mote" sphere nodes that
// inherit real file names from live data so tooltips are still meaningful.
function buildSpheresData(extra = 140) {
  const base = buildData();
  const nodes: MemNode[] = [...base.nodes];
  const links: MemLink[] = [...base.links];
  const palette = [ACCENT, ACCENT2, WS_COL, FILE_COL, DEC_COL, SES_COL, SKILL_COL];
  const realFiles = base.nodes.filter(
    (n) => n.kind === "file" && n.name && !n.id.startsWith("mote-"),
  );
  const wsIds = base.nodes.filter((n) => n.kind === "workspace").map((n) => n.id);
  const anchorPool = wsIds.length ? wsIds : workspaces.map((w) => `ws-${w.id}`);
  for (let i = 0; i < extra; i++) {
    const id = `mote-${i}`;
    const color = palette[i % palette.length];
    const inherit = realFiles[i % Math.max(1, realFiles.length)];
    nodes.push({
      id,
      name: inherit?.name ?? "Memory thread",
      kind: "file",
      workspaceId: inherit?.workspaceId,
      source: inherit?.source,
      meta: inherit ? "ambient connection" : "ambient memory thread",
      val: 1.5 + Math.random() * 2,
      color,
    });
    const anchor = i % 9 === 0 ? "hub" : anchorPool[i % anchorPool.length];
    links.push({ source: anchor, target: id, kind: "file" });
    if (i % 17 === 0 && i > 0) {
      links.push({ source: `mote-${i - 1}`, target: id, kind: "cross" });
    }
  }
  return { nodes, links };
}

// Blend view: full structured graph + a sprinkle of motes (between Default and Spheres)
function buildBlendData() {
  return buildSpheresData(70);
}

// Random view: pure scatter, no semantic structure. Names borrowed from real
// memory if available so tooltips still make sense.
function buildRandomData() {
  const nodes: MemNode[] = [];
  const links: MemLink[] = [];
  const palette = [ACCENT, ACCENT2, WS_COL, FILE_COL, DEC_COL, SES_COL, SKILL_COL, STALE, MISSING];
  const realFiles = buildData().nodes.filter((n) => n.kind === "file" && n.name);
  const N = 380;
  for (let i = 0; i < N; i++) {
    const inherit = realFiles[i % Math.max(1, realFiles.length)];
    nodes.push({
      id: `r-${i}`,
      name: inherit?.name ?? "Memory thread",
      kind: "file",
      meta: "ambient memory thread",
      val: 1 + Math.random() * 6,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }
  for (let i = 0; i < N * 1.2; i++) {
    const a = Math.floor(Math.random() * N);
    let b = Math.floor(Math.random() * N);
    if (b === a) b = (b + 1) % N;
    links.push({ source: `r-${a}`, target: `r-${b}`, kind: "cross" });
  }
  return { nodes, links };
}

type ViewMode = "structured" | "blend" | "spheres" | "random";

export function MemoryGraph3D({
  onSelect,
  embedded = false,
  sourceFilter = "all",
  focusQuery = "",
  focusNodeId,
  onFocusPosition,
  focusNonce = 0,
  graphData,
  layout = "network",
  viewKey = "default",
  orbitEnabled,
  onOrbitChange,
  showTitles = false,
  compactHover = false,
  activeNodeIds = [],
  focusShift = 0,
}: {
  graphData?: { nodes: MemNode[]; links: MemLink[] };
  layout?: "network" | "sphere" | "neural";
  /** Refit for an intentional view change, rather than every background data refresh. */
  viewKey?: string;
  orbitEnabled?: boolean;
  onOrbitChange?: (enabled: boolean) => void;
  /** Readable record labels projected into the scene while exploring. */
  showTitles?: boolean;
  compactHover?: boolean;
  activeNodeIds?: string[];
  /** World units to slide the camera right when flying to focusNodeId. */
  focusShift?: number;
  onSelect: (node: MemNode) => void;
  embedded?: boolean;
  sourceFilter?: string;
  /** Voice/text "pull up my X" flies the camera to the matching cluster and
   *  makes those nodes glow. focusNonce bumps to re-trigger the same query. */
  focusQuery?: string;
  /** Exact record selection from a retrieved result, rather than a text search. */
  focusNodeId?: string;
  onFocusPosition?: (point: { x: number; y: number } | null) => void;
  focusNonce?: number;
}) {
  const [view, setView] = useState<ViewMode>("structured");
  const [focusedIds, setFocusedIds] = useState<Set<string>>(() => new Set());
  const focusedRef = useRef<Set<string>>(focusedIds);
  focusedRef.current = focusedIds;
  const focusProjection = useRef({ id: focusNodeId, onPosition: onFocusPosition });
  focusProjection.current = { id: focusNodeId, onPosition: onFocusPosition };
  const titleElements = useRef(new Map<string, HTMLButtonElement>());
  const showTitlesRef = useRef(showTitles);
  showTitlesRef.current = showTitles;
  const activeNodes = useRef(new Set<string>());
  activeNodes.current = new Set(activeNodeIds);

  const graphLd = useLiveData();
  const applicableLiveData = graphData ? null : graphLd;
  const stableGraph = useRef({
    layout: "",
    viewKey: "",
    nodes: new Map<string, any>(),
    links: new Map<string, MemLink>(),
  });

  const fullData = useMemo(() => {
    if (graphData) {
      // The sphere is a layout of the same records, not extra decorative memories.
      const ordered = graphData.nodes
        .filter((n) => n.kind !== "hub")
        .map((n) => n.id)
        .sort();
      const positions = new Map(
        ordered.map((id, index) => {
          const y = 1 - ((index + 0.5) / Math.max(1, ordered.length)) * 2;
          const angle = index * Math.PI * (3 - Math.sqrt(5));
          const ring = Math.sqrt(1 - y * y),
            radius = 215;
          return [
            id,
            {
              fx: Math.cos(angle) * ring * radius,
              fy: y * radius,
              fz: Math.sin(angle) * ring * radius,
            },
          ];
        }),
      );
      const clusters = new Map<string, MemNode[]>();
      for (const node of graphData.nodes) {
        if (node.kind === "hub") continue;
        const key = node.origin || node.source || "other";
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key)!.push(node);
      }
      const neuralPositions = new Map<string, { fx: number; fy: number; fz: number }>();
      const groups = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
      groups.forEach(([key, records], clusterIndex) => {
        const angle = -2.35 + clusterIndex * 2.39996;
        const distance = groups.length === 1 ? 80 : 210 + (clusterIndex % 3) * 28;
        const center = {
          x: Math.cos(angle) * distance * 1.28,
          y: Math.sin(angle) * distance * 0.8,
          z: Math.sin(clusterIndex * 1.9) * 105,
        };
        const members = records
          .filter((n) => !n.categoryHub)
          .sort((a, b) => a.id.localeCompare(b.id));
        records
          .filter((n) => n.categoryHub)
          .forEach((n) => neuralPositions.set(n.id, { fx: center.x, fy: center.y, fz: center.z }));
        members.forEach((n, index) => {
          let hash = 2166136261;
          for (const character of n.id)
            hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
          const theta = index * 2.39996,
            latitude = 1 - (2 * (index + 0.5)) / Math.max(1, members.length);
          const spread = 38 + Math.sqrt(members.length) * 7,
            radius = spread * (0.35 + 0.65 * ((hash % 997) / 997));
          const ring = Math.sqrt(1 - latitude * latitude);
          neuralPositions.set(n.id, {
            fx: center.x + Math.cos(theta) * ring * radius * 1.35,
            fy: center.y + latitude * radius,
            fz: center.z + Math.sin(theta) * ring * radius,
          });
        });
      });
      const cache = stableGraph.current;
      const reposition = cache.layout !== layout || cache.viewKey !== viewKey;
      const sourceTransition = !reposition && graphData.nodes.some((node) => node.visualTransition);
      cache.layout = layout;
      cache.viewKey = viewKey;
      const nodes = graphData.nodes.map((node) => {
        const existing = cache.nodes.get(node.id);
        const record = existing || { ...node };
        Object.assign(record, node, { visualTransition: node.visualTransition });
        if (reposition || !existing) {
          delete record.fx;
          delete record.fy;
          delete record.fz;
          if (layout === "sphere")
            Object.assign(
              record,
              node.kind === "hub" ? { fx: 0, fy: 0, fz: 0 } : positions.get(node.id),
            );
          if (layout === "neural")
            Object.assign(
              record,
              node.kind === "hub" ? { fx: 0, fy: 0, fz: 0 } : neuralPositions.get(node.id),
            );
        } else if (
          sourceTransition &&
          layout === "network" &&
          [record.x, record.y, record.z].every(Number.isFinite)
        ) {
          // A source switch preserves the settled network instead of reheating its layout.
          Object.assign(record, { fx: record.x, fy: record.y, fz: record.z });
        }
        cache.nodes.set(node.id, record);
        return record;
      });
      const links = graphData.links.map((link) => {
        const source = typeof link.source === "object" ? (link.source as any).id : link.source;
        const target = typeof link.target === "object" ? (link.target as any).id : link.target;
        const key = `${source}\0${target}`;
        const record = cache.links.get(key) || { ...link, source, target };
        record.kind = link.kind;
        cache.links.set(key, record);
        return record;
      });
      return { nodes, links };
    }
    if (view === "spheres") return buildSpheresData();
    if (view === "blend") return buildBlendData();
    if (view === "random") return buildRandomData();
    return buildData(applicableLiveData);
  }, [view, applicableLiveData, graphData, layout, viewKey]);
  const fgRef = useRef<any>(null);
  const [graphReady, setGraphReady] = useState(false);
  const graphMountRef = useMemo(
    () => ({
      get current() {
        return fgRef.current;
      },
      set current(instance: any) {
        fgRef.current = instance;
        setGraphReady(!!instance);
      },
    }),
    [],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  // Dev only: screen position of a record, so headless checks can click real nodes.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __brainGraph?: unknown }).__brainGraph = {
      nodes: () =>
        ((layoutDataRef.current?.nodes || []) as any[])
          .filter((n) => Number.isFinite(n.x))
          .map((n) => {
            const c = fgRef.current.graph2ScreenCoords(n.x, n.y, n.z);
            const r = wrapRef.current?.getBoundingClientRect();
            return { id: n.id, origin: n.origin, kind: n.kind, hub: !!(n.categoryHub || n.kind === "hub"), x: (r?.left || 0) + c.x, y: (r?.top || 0) + c.y };
          }),
    };
  });
  const orbitPauseUntilRef = useRef(0);
  const interactingRef = useRef(false);
  const hasGraphData = !!graphData;
  const [size, setSize] = useState({ w: 800, h: 640 });
  const overviewDistance = useRef(0);
  function fitMemoryGraph(duration = 800) {
    const fg = fgRef.current;
    if (!fg) return;
    const nodes = data.nodes.filter((n: any) => [n.x, n.y, n.z].every(Number.isFinite));
    if (!nodes.length) return;
    const bounds = ["x", "y", "z"].map((axis) => {
      const values = nodes.map((n: any) => n[axis]);
      return [Math.min(...values) - 30, Math.max(...values) + 30];
    });
    const [x, y, z] = bounds.map(([min, max]) => (min + max) / 2);
    const camera = fg.camera();
    const tan = Math.tan(((camera.fov || 50) * Math.PI) / 360);
    // Fit each point in perspective, rather than fitting empty corners of a cube.
    const distance =
      Math.max(
        100,
        ...nodes.map(
          (n: any) =>
            n.z -
            z +
            Math.max(
              (Math.abs(n.y - y) + 30) / tan,
              (Math.abs(n.x - x) + 30) / (tan * camera.aspect),
            ),
        ),
      ) * 1.08;
    overviewDistance.current = distance;
    orbitPauseUntilRef.current = performance.now() + duration + 100;
    fg.cameraPosition({ x, y, z: z + distance }, { x, y, z }, duration);
  }
  function zoomMemoryGraph(factor: number) {
    const fg = fgRef.current;
    if (!fg) return;
    const c = fg.cameraPosition(),
      target = fg.controls()?.target || { x: 0, y: 0, z: 0 };
    fg.cameraPosition(
      {
        x: target.x + (c.x - target.x) * factor,
        y: target.y + (c.y - target.y) * factor,
        z: target.z + (c.z - target.z) * factor,
      },
      target,
      500,
    );
  }
  const [Graph, setGraph] = useState<ForceGraphModule | null>(null);
  const [THREE, setThree] = useState<ThreeModule | null>(null);
  const [BloomPass, setBloomPass] = useState<UnrealBloomPassCtor | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hoverId;

  // Controls
  const [internalRotating, setInternalRotating] = useState(
    () =>
      !graphData ||
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const rotating = !reducedMotion && (orbitEnabled ?? internalRotating);
  const setRotating = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(rotating) : next;
    if (onOrbitChange) onOrbitChange(value);
    else setInternalRotating(value);
  };
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
    if (hasGraphData && graphReady && !focusQuery.trim()) {
      const timer = window.setTimeout(() => fitMemoryGraph(700), 180);
      return () => window.clearTimeout(timer);
    }
  }, [layout, viewKey, graphReady, focusQuery]);
  const [particles, setParticles] = useState(true);
  const [graphDensity, setGraphDensity] = useState<"all" | "essential">("all");
  const [linkOpacity, setLinkOpacity] = useState(0.7);
  const [density, setDensity] = useState<"lite" | "full">("full");

  const rotatingRef = useRef(rotating);
  rotatingRef.current = rotating;
  useEffect(() => {
    const release = () => {
      if (!interactingRef.current) return;
      interactingRef.current = false;
      orbitPauseUntilRef.current = Math.max(orbitPauseUntilRef.current, performance.now() + 1200);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      import("react-force-graph-3d"),
      import("three"),
      import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
    ]).then(([graphMod, threeMod, bloomMod]) => {
      if (!alive) return;
      setGraph(() => graphMod.default);
      setThree(threeMod);
      setBloomPass(() => bloomMod.UnrealBloomPass);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Filter links by density + by selected source category. Supports:
  //   "all"                        — no filter
  //   "obsidian" | "claude" | "pinecone"   — single category
  //   "multi:obsidian,pinecone"    — union of categories
  //   "" (empty)                   — show only the hub (zero categories selected)
  const data = useMemo(() => {
    let nodes = fullData.nodes;
    let links = fullData.links;
    if (sourceFilter && sourceFilter !== "all") {
      const allowedCats = sourceFilter.startsWith("multi:")
        ? new Set(sourceFilter.slice(6).split(",").filter(Boolean))
        : new Set([sourceFilter]);
      const matches = (n: MemNode): boolean => {
        if (allowedCats.has("pinecone") && (n.kind === "vector_store" || n.source === "pinecone"))
          return true;
        if (allowedCats.has("obsidian") && n.source === "obsidian") return true;
        if (allowedCats.has("claude") && n.source === "claude") return true;
        return false;
      };
      const allow = new Set<string>(["hub"]);
      nodes.forEach((n) => {
        if (n.id === "hub") return;
        if (matches(n)) allow.add(n.id);
      });
      nodes = nodes.filter((n) => allow.has(n.id));
      links = links.filter((l) => {
        const s = typeof l.source === "object" ? (l.source as any).id : l.source;
        const t = typeof l.target === "object" ? (l.target as any).id : l.target;
        return allow.has(s) && allow.has(t);
      });
    }
    if (graphData && graphDensity === "essential")
      links = links.filter(
        (l) =>
          l.kind === "core" ||
          l.kind === "cross" ||
          l.kind === "decision" ||
          !String(typeof l.source === "object" ? (l.source as any).id : l.source).startsWith(
            "origin:",
          ),
      );
    if (density === "full") return { nodes, links };
    const keep = new Set(["core", "file", "decision"]);
    return { nodes, links: links.filter((l) => keep.has(l.kind)) };
  }, [fullData, density, sourceFilter, graphDensity, graphData]);

  const layoutDataRef = useRef(data);
  layoutDataRef.current = data;

  // Build adjacency for hover highlighting
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    data.links.forEach((l) => {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    });
    return m;
  }, [data]);

  const isLit = (id: string) => {
    // While a focus set is active, only the matching cluster is lit.
    if (focusedIds.size > 0) return focusedIds.has(id);
    if (!hoverId) return true;
    if (id === hoverId) return true;
    return adjacency.get(hoverId)?.has(id) ?? false;
  };

  const isLitRef = useRef(isLit);
  isLitRef.current = isLit;

  // Voice/text focus: match nodes by name against the query, fly the camera to
  // their centroid, glow them, pause the orbit — then release after a beat.
  useEffect(() => {
    const fq = focusQuery.trim().toLowerCase();
    if (focusNonce <= 0 || !fgRef.current) return;
    if (!fq) {
      setFocusedIds(new Set());
      fitMemoryGraph(900);
      return;
    }
    const fg = fgRef.current;
    // "a | b | c" lights every alternative at once — the conversational console
    // sends the full set of sources an answer drew from as one focus.
    const terms = fq
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const matches = (data.nodes as any[]).filter((n) => {
      if (focusNodeId) return n.id === focusNodeId;
      const hay = `${n.name ?? ""} ${n.id ?? ""} ${(n.tags ?? []).join(" ")}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
    if (matches.length === 0) return;
    const ids = new Set<string>(matches.map((n) => String(n.id)));
    // A picked record stays lit together with the records it relates to.
    if (focusNodeId) for (const id of activeNodes.current) ids.add(id);
    setFocusedIds(ids);
    // Centroid of the matched nodes (positions exist once the layout settled).
    const positioned = matches.filter((n) => typeof (n.fx ?? n.x) === "number");
    const cx = positioned.reduce((a, n) => a + (n.fx ?? n.x), 0) / (positioned.length || 1);
    const cy = positioned.reduce((a, n) => a + (n.fy ?? n.y), 0) / (positioned.length || 1);
    const cz = positioned.reduce((a, n) => a + (n.fz ?? n.z), 0) / (positioned.length || 1);
    orbitPauseUntilRef.current = performance.now() + 7500;
    if (positioned.length) {
      // A single picked record keeps its neighbourhood in view, rather than filling the frame.
      const dist = focusNodeId ? 360 : 180;
      // Slide the view sideways so a picked record sits clear of a side panel.
      const shift = focusNodeId ? focusShift : 0;
      const sx = shift * 0.928,
        sz = shift * -0.371;
      try {
        fg.cameraPosition(
          { x: cx + dist * 0.4 + sx, y: cy + dist * 0.3, z: cz + dist + sz },
          { x: cx + sx, y: cy, z: cz + sz },
          reducedMotionRef.current ? 0 : 1400,
        );
      } catch {
        /* fg not ready */
      }
    }
    try {
      fg.refresh?.();
    } catch {
      /* restyle glow */
    }
    // Hold the focus glow ~7s, then release back to the full graph + orbit.
    if (focusNodeId) return;
    const release = window.setTimeout(() => {
      setFocusedIds(new Set());
      if (!graphData) setRotating(true);
      try {
        fgRef.current?.refresh?.();
      } catch {
        /* */
      }
    }, 7000);
    return () => window.clearTimeout(release);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusQuery, focusNodeId, graphReady, layout, size.w, size.h]);

  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const controls = fgRef.current.controls();
    const previous = controls.enablePan;
    // A pinned source badge stays over its exact camera target while orbiting.
    controls.enablePan = false;
    return () => { controls.enablePan = previous; };
  }, [focusNodeId, graphReady]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!graphData || focusQuery.trim()) return;
    const timer = window.setTimeout(() => fitMemoryGraph(650), 150);
    return () => window.clearTimeout(timer);
  }, [size.w, size.h, Graph, graphReady, focusQuery]);

  // Configure forces, lighting, and gentle camera orbit
  useEffect(() => {
    if (!graphReady || !fgRef.current || !THREE) return;
    const fg = fgRef.current;
    // Retina canvases otherwise multiply the cost of every bloom pass by four.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, graphData ? 1.25 : 1.5);
    fg.renderer().setPixelRatio(pixelRatio);
    fg.postProcessingComposer?.()?.setPixelRatio?.(pixelRatio);

    // Disable wheel-zoom in embedded mode so page scrolling isn't trapped
    if (embedded && !graphData) {
      try {
        const controls = fg.controls?.();
        if (controls) {
          controls.enableZoom = false;
          controls.enablePan = false;
        }
      } catch {}
    }

    // Custom forces — keep hub centered, push files outward
    try {
      const charge = fg.d3Force("charge");
      if (charge) charge.strength(-90);
      // Keep records without links in the visible network instead of letting
      // repulsion push them far away and shrink the useful clusters at fit.
      if (graphData)
        fg.d3Force("sourceContainment", (alpha: number) => {
          for (const node of layoutDataRef.current.nodes as any[]) {
            const distance = Math.hypot(node.x || 0, node.y || 0, node.z || 0);
            if (distance <= 300) continue;
            const pull = ((distance - 300) / distance) * alpha * 0.08;
            node.vx = (node.vx || 0) - node.x * pull;
            node.vy = (node.vy || 0) - node.y * pull;
            node.vz = (node.vz || 0) - node.z * pull;
          }
        });
      const linkF = fg.d3Force("link");
      if (linkF)
        linkF.distance((l: any) => {
          if (l.kind === "core") return 90;
          if (l.kind === "file") return 28;
          if (l.kind === "session") return 40;
          if (l.kind === "skill") return 110;
          if (l.kind === "decision") return 60;
          if (l.kind === "cross") return 140;
          return 60;
        });
    } catch {}

    // Add lights + starfield for depth
    const scene = fg.scene();
    if (!scene.userData.__memEnhanced) {
      scene.userData.__memEnhanced = true;
      scene.fog = new THREE.FogExp2(0x000000, graphData ? 0.0002 : 0.0022);

      const amb = new THREE.AmbientLight(0xffffff, 0.35);
      scene.add(amb);
      const key = new THREE.PointLight(0x3ddc97, 1.4, 1200);
      key.position.set(120, 180, 200);
      scene.add(key);
      const rim = new THREE.PointLight(0x60a5fa, 0.9, 1000);
      rim.position.set(-220, -120, -160);
      scene.add(rim);

      // Starfield
      const starGeom = new THREE.BufferGeometry();
      const N = 1200;
      const positions = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const r = 700 + Math.random() * 600;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
      }
      starGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const starMat = new THREE.PointsMaterial({
        color: 0xa9b4c2,
        size: 1.2,
        transparent: true,
        opacity: 0.55,
        sizeAttenuation: true,
        depthWrite: false,
      });
      const stars = new THREE.Points(starGeom, starMat);
      stars.userData.__stars = true;
      scene.add(stars);
    }

    // Real bloom glow via post-processing
    if (BloomPass && !scene.userData.__bloom && typeof fg.postProcessingComposer === "function") {
      try {
        const composer = fg.postProcessingComposer();
        const bloom = new BloomPass(
          new THREE.Vector2(size.w, size.h),
          graphData ? 0.3 : 0.7, // keep dense source clusters legible
          graphData ? 0.35 : 0.6, // radius
          graphData ? 0.8 : 0.35, // reserve the glow for bright hubs
        );
        composer.addPass(bloom);
        scene.userData.__bloom = bloom;
      } catch {}
    }

    // Slow auto-orbit + animations
    let raf = 0;
    let angle = 0;
    let lastTick = performance.now();
    let animationRunning: boolean | null = null;
    let lastLabels = 0;
    const projectedTitle = new THREE.Vector3();
    const tick = () => {
      if (!animationRunning) return;
      const now = performance.now();
      const elapsed = Math.min((now - lastTick) / 1000, 0.15);
      lastTick = now;
      if (showTitlesRef.current && now - lastLabels > 100) {
        lastLabels = now;
        const camera = fg.camera();
        const target = fg.controls()?.target || { x: 0, y: 0, z: 0 };
        const cameraDistance = Math.hypot(camera.position.x - target.x, camera.position.y - target.y, camera.position.z - target.z);
        const zoomed = overviewDistance.current > 0 && cameraDistance < overviewDistance.current * .82;
        const candidates = (layoutDataRef.current.nodes as any[]).flatMap(node => {
          if (![node.x, node.y, node.z].every(Number.isFinite) || memoryNodeOpacity(node, now) < .5) return [];
          projectedTitle.set(node.x, node.y, node.z).project(camera);
          if (projectedTitle.z < -1 || projectedTitle.z > 1) return [];
          const x = (projectedTitle.x + 1) * size.w / 2, y = (1 - projectedTitle.y) * size.h / 2;
          const distance = Math.hypot(node.x - camera.position.x, node.y - camera.position.y, node.z - camera.position.z);
          const major = node.categoryHub || node.kind === "hub";
          if (!major && !zoomed && node.id !== focusProjection.current.id) return [];
          if (x < 12 || x > size.w - 12 || y < 24 || y > size.h - 45 || (!major && distance > 650)) return [];
          return [{ node, x, y, distance, priority: node.id === focusProjection.current.id ? -2 : major ? -1 : distance }];
        }).sort((a,b) => a.priority - b.priority);
        const shown = new Set<string>(), boxes: Array<{x:number;y:number;w:number}> = [];
        for (const item of candidates) {
          if (shown.size >= (size.w < 500 ? 12 : 24)) break;
          const element = titleElements.current.get(item.node.id);
          if (!element) continue;
          const w = Math.min(190, Math.max(54, item.node.name.length * 5.6 + 18));
          const x = Math.max(w / 2 + 8, Math.min(size.w - w / 2 - 8, item.x));
          const y = item.y + 12;
          if (boxes.some(box => Math.abs(box.y - y) < 25 && Math.abs(box.x - x) < (box.w + w) / 2 + 4)) continue;
          boxes.push({x,y,w}); shown.add(item.node.id);
          element.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
          element.style.visibility = "visible";
        }
        for (const [id, element] of titleElements.current) if (!shown.has(id)) element.style.visibility = "hidden";
      }
      const projection = focusProjection.current;
      if (projection.id && projection.onPosition) {
        const node = stableGraph.current.nodes.get(projection.id);
        if (node && [node.x, node.y, node.z].every(Number.isFinite)) {
          const point = fg.graph2ScreenCoords(node.x, node.y, node.z);
          projection.onPosition(point.x >= 0 && point.x <= size.w && point.y >= 0 && point.y <= size.h ? point : null);
        } else projection.onPosition(null);
      }
      if (rotatingRef.current && !interactingRef.current && now >= orbitPauseUntilRef.current) {
        if (graphData) {
          const camera = fg.cameraPosition(),
            target = fg.controls()?.target || { x: 0, y: 0, z: 0 };
          const dx = camera.x - target.x,
            dz = camera.z - target.z,
            delta = elapsed * 0.055;
          fg.cameraPosition(
            {
              x: target.x + dx * Math.cos(delta) - dz * Math.sin(delta),
              y: camera.y,
              z: target.z + dx * Math.sin(delta) + dz * Math.cos(delta),
            },
            target,
          );
        } else {
          angle += elapsed * 0.04;
          fg.cameraPosition({
            x: 420 * Math.sin(angle),
            y: 80 + Math.sin(angle * 0.7) * 30,
            z: 420 * Math.cos(angle),
          });
        }
      }

      // Source switches animate retained objects, with no React updates per frame.
      for (const node of layoutDataRef.current.nodes as any[]) {
        const object = node.__threeObj;
        if (object && (activeNodes.current.has(node.id) || object.userData.__activePulse)) {
          const active = activeNodes.current.has(node.id);
          object.scale.setScalar(active ? 1.14 + (reducedMotionRef.current ? 0 : Math.sin(now * .004 + (node.index || 0) * .2) * .12) : 1);
          object.userData.__activePulse = active;
        }
        if (object && (node.visualTransition || object.userData.__sourceOpacity !== undefined))
          setSourceOpacity(object, memoryNodeOpacity(node, now));
      }
      for (const link of layoutDataRef.current.links as any[]) {
        const source =
          typeof link.source === "object"
            ? link.source
            : stableGraph.current.nodes.get(link.source);
        const target =
          typeof link.target === "object"
            ? link.target
            : stableGraph.current.nodes.get(link.target);
        const object = link.__lineObj;
        if (
          !object ||
          (!source?.visualTransition &&
            !target?.visualTransition &&
            object.userData.__sourceOpacity === undefined)
        )
          continue;
        const opacity = Math.min(
          source ? memoryNodeOpacity(source, now) : 1,
          target ? memoryNodeOpacity(target, now) : 1,
        );
        setSourceOpacity(object, opacity);
        if (link.__photonsObj) setSourceOpacity(link.__photonsObj, opacity);
      }

      // Pulse hub & rotate stars
      const t = performance.now() * 0.001;
      if (!reducedMotionRef.current)
        scene.children.forEach((obj: any) => {
          if (obj.userData.__stars) obj.rotation.y = t * 0.01;
          if (obj.userData.__pulse) {
            const s = 1 + Math.sin(t * 2) * 0.06;
            obj.scale.set(s, s, s);
          }
          if (obj.userData.__ring) {
            obj.rotation.z = t * 0.4;
          }
        });

      raf = requestAnimationFrame(tick);
    };
    const element = wrapRef.current;
    const bounds = element?.getBoundingClientRect();
    let inView =
      !!bounds &&
      bounds.bottom > 0 &&
      bounds.top < window.innerHeight &&
      bounds.right > 0 &&
      bounds.left < window.innerWidth;
    let coveredByVoice = !!document.querySelector('.voice-companion[role="dialog"]') && !element?.closest(".voice-companion");
    const updateAnimation = () => {
      const visible = !document.hidden && inView && !coveredByVoice;
      if (visible === animationRunning) return;
      animationRunning = visible;
      if (element) element.dataset.animationState = visible ? "running" : "paused";
      if (visible) {
        lastTick = performance.now();
        fg.resumeAnimation?.();
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
        fg.pauseAnimation?.();
      }
    };
    const voiceSurface = (event: Event) => {
      coveredByVoice = !!(event as CustomEvent<{open:boolean}>).detail?.open && !element?.closest(".voice-companion");
      updateAnimation();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updateAnimation();
    });
    if (element) observer.observe(element);
    document.addEventListener("visibilitychange", updateAnimation);
    window.addEventListener("voice:surface", voiceSurface);
    updateAnimation();
    return () => {
      animationRunning = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateAnimation);
      window.removeEventListener("voice:surface", voiceSurface);
    };
  }, [BloomPass, THREE, graphReady, size.h, size.w]);

  useEffect(() => {
    if (!fgRef.current || !THREE || !graphData) return;
    const scene = fgRef.current.scene();
    if (layout !== "sphere") return;
    const material = new THREE.LineBasicMaterial({
      color: 0x8ba8c5,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });
    const geometry = new THREE.WireframeGeometry(new THREE.SphereGeometry(215, 24, 12));
    const shell = new THREE.LineSegments(geometry, material);
    shell.userData.decorative = true;
    scene.add(shell);
    return () => {
      scene.remove(shell);
      geometry.dispose();
      material.dispose();
    };
  }, [THREE, graphReady, layout, hasGraphData]);

  const glowTexture = useMemo(() => {
    if (!THREE || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,.8)");
    gradient.addColorStop(0.2, "rgba(255,255,255,.35)");
    gradient.addColorStop(0.5, "rgba(255,255,255,.08)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }, [THREE]);
  useEffect(
    () => () => {
      glowTexture?.dispose();
    },
    [glowTexture],
  );
  useEffect(() => {
    const bloom = fgRef.current?.scene()?.userData.__bloom;
    if (bloom) {
      bloom.strength = layout === "neural" ? 0.4 : 0.3;
      bloom.radius = layout === "neural" ? 0.5 : 0.35;
      bloom.threshold = layout === "neural" ? 0.7 : 0.8;
    }
  }, [layout, THREE, Graph]);

  const neuralResources = useMemo(
    () =>
      THREE
        ? {
            geometry: new THREE.SphereGeometry(1, 14, 10),
            materials: new Map<string, import("three").MeshStandardMaterial>(),
            sprites: new Map<string, import("three").SpriteMaterial>(),
          }
        : null,
    [THREE],
  );
  useEffect(
    () => () => {
      neuralResources?.geometry.dispose();
      for (const material of neuralResources?.materials.values() || []) material.dispose();
      for (const material of neuralResources?.sprites.values() || []) material.dispose();
    },
    [neuralResources],
  );
  const buildNodeObject = useCallback(
    (n: any) => {
      if (!THREE) throw new Error("Graph renderer is not ready");

      const group = new THREE.Group();
      const lit = isLitRef.current(n.id);
      const focused = focusedRef.current.size > 0 && focusedRef.current.has(n.id);
      const opacity = lit ? 1 : 0.18;

      let r = 6;
      if (view === "random") {
        r = 2 + (n.val ?? 2) * 0.6;
      } else if (n.kind === "hub") r = layout === "neural" ? 13 : 26;
      else if (n.categoryHub) r = layout === "neural" ? 17 : 12;
      else if (n.kind === "vector_store") r = 17;
      else if (n.kind === "workspace")
        r = hasGraphData && layout === "neural" ? 6 : hasGraphData && layout === "sphere" ? 8 : 14;
      else if (n.kind === "skill")
        r = hasGraphData && layout === "neural" ? 3 : hasGraphData ? 4.5 : 10;
      else if (n.kind === "session")
        r = hasGraphData && layout === "neural" ? 3.4 : hasGraphData && layout === "sphere" ? 4.2 : 7;
      else if (n.kind === "decision") r = 9;
      else
        r =
          hasGraphData && layout === "neural"
            ? 2.8
            : hasGraphData && layout === "sphere"
              ? 3.8
              : view === "spheres"
                ? 2 + (n.val ?? 2) * 0.7
                : 5;

      const isMissing = n.status === "missing";
      const isStale = n.status === "stale";
      const baseEmissive =
        hasGraphData && layout === "neural"
          ? n.categoryHub || n.kind === "hub"
            ? 1.25
            : 0.65
          : hasGraphData
            ? n.kind === "hub"
              ? 1.2
              : n.kind === "workspace"
                ? 0.45
                : 0.28
            : n.kind === "hub"
              ? 2.4
              : n.kind === "vector_store"
                ? 2.1
                : isMissing
                  ? 2.2
                  : isStale
                    ? 1.2
                    : n.kind === "workspace"
                      ? 0.7
                      : 0.5;
      const materialKey = `${n.color}:${baseEmissive}:${focused}:${opacity}`;
      let mat = hasGraphData ? neuralResources?.materials.get(materialKey) : undefined;
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: n.color,
          emissive: n.color,
          // Focus-matched nodes flare brighter so the recalled cluster
          // reads as "lit up" the moment the camera arrives.
          emissiveIntensity: focused ? baseEmissive + (hasGraphData ? 0.9 : 2.2) : baseEmissive,
          roughness: 0.35,
          metalness: 0.1,
          transparent: true,
          opacity,
        });
        if (hasGraphData) neuralResources?.materials.set(materialKey, mat);
      }

      let geom: any;
      if (hasGraphData && neuralResources) geom = neuralResources.geometry;
      else if (view === "spheres" || view === "random") geom = new THREE.SphereGeometry(r, 20, 20);
      else if (n.kind === "decision") geom = new THREE.OctahedronGeometry(r, 0);
      else if (n.kind === "skill") geom = new THREE.IcosahedronGeometry(r, 0);
      else if (n.kind === "session") geom = new THREE.TetrahedronGeometry(r, 0);
      else geom = new THREE.SphereGeometry(r, 28, 28);

      const mesh = new THREE.Mesh(geom, mat);
      if (hasGraphData && neuralResources) mesh.scale.setScalar(r);
      group.add(mesh);
      if (hasGraphData && layout === "neural" && glowTexture) {
        const spriteOpacity = opacity * (n.categoryHub || n.kind === "hub" ? 0.5 : 0.2),
          spriteKey = `${n.color}:${spriteOpacity}`;
        let spriteMaterial = neuralResources?.sprites.get(spriteKey);
        if (!spriteMaterial) {
          spriteMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            color: n.color,
            transparent: true,
            opacity: spriteOpacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          neuralResources?.sprites.set(spriteKey, spriteMaterial);
        }
        const sprite = new THREE.Sprite(spriteMaterial);
        const scale = r * (n.categoryHub || n.kind === "hub" ? 6 : 5);
        sprite.scale.set(scale, scale, 1);
        group.add(sprite);
      }

      // Soft outer halo for vector store nodes
      if (n.kind === "vector_store") {
        const haloMat = new THREE.MeshBasicMaterial({
          color: n.color,
          transparent: true,
          opacity: 0.18 * opacity,
          side: THREE.BackSide,
        });
        const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.55, 24, 24), haloMat);
        group.add(halo);
      }

      if (n.kind === "hub" || n.kind === "vector_store") {
        group.userData.__pulse = true;
      }
      if (hasGraphData && layout === "sphere" && n.kind === "hub") {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.65, 24, 24),
          new THREE.MeshBasicMaterial({
            color: n.color,
            transparent: true,
            opacity: 0.08 * opacity,
            side: THREE.BackSide,
          }),
        );
        group.add(halo);
      }

      if (n.visualTransition) setSourceOpacity(group, memoryNodeOpacity(n));
      return group;
    },
    [THREE, neuralResources, glowTexture, layout, view, hasGraphData, hoverId, focusedIds],
  );
  const linkWidth = useCallback(
    (l: any) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (hoverIdRef.current && (sId === hoverIdRef.current || tId === hoverIdRef.current))
        return 1.6;
      if (focusNodeId && l.kind === "cross" && (sId === focusNodeId || tId === focusNodeId))
        return 1.4;
      return layout === "neural"
        ? l.kind === "core"
          ? 0.65
          : 0.16
        : l.kind === "core"
          ? 0.8
          : 0.4;
    },
    [layout, hoverId, focusNodeId],
  );
  return (
    <>
      <div
        ref={wrapRef}
        className={`w-full h-full min-h-[460px] relative ${graphData ? "" : "pr-7"}`}
        data-rendered-nodes={data.nodes.length}
        data-rendered-links={data.links.length}
        data-focused-node={focusNodeId || undefined}
        data-fading-nodes={data.nodes.filter((node) => node.visualTransition?.to === 0).length}
        style={{ height: "100%" }}
        onPointerDown={() => {
          if (graphData) interactingRef.current = true;
        }}
        onWheelCapture={(e) => {
          // Don't let the canvas trap page scroll — only zoom on Ctrl/Meta
          if (graphData) {
            orbitPauseUntilRef.current = performance.now() + 1500;
            return;
          }
          if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
        }}
      >
        {/* right-edge scroll gutter — lets the page scroll past the canvas */}
        <div aria-hidden className="absolute top-0 right-0 h-full w-7 z-20 pointer-events-none">
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 h-12 w-0.5 rounded-full bg-foreground/15" />
        </div>
        {Graph && THREE ? (
          <Graph
            ref={graphMountRef}
            width={size.w}
            height={size.h}
            graphData={data as any}
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            warmupTicks={graphData && layout !== "network" ? 1 : 60}
            cooldownTicks={graphData && layout !== "network" ? 1 : 150}
            onEngineStop={() => {
              if (graphData && !fitted.current && !focusQuery.trim()) {
                fitted.current = true;
                fitMemoryGraph(800);
              }
            }}
            nodeRelSize={6}
            nodeLabel={(n: any) => {
              const escape = (s: string) =>
                String(s).replace(
                  /[&<>"']/g,
                  (c) =>
                    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
                );
              if (compactHover) return `<div style="padding:7px 10px;border:1px solid #adcbd533;border-radius:8px;background:#101c28ed;color:#edf8ff;font:12px system-ui;max-width:260px">${escape(n.name)}</div>`;
              let cap = "MEMORY";
              let title = n.name;
              let line2 = "";
              let line3 = "";
              if (n.kind === "hub") {
                cap = "MEMORY CORE";
                line2 = "Shared index across every layer";
              } else if (n.kind === "workspace") {
                cap = "WORKSPACE";
                const files = data.nodes.filter(
                  (x: any) =>
                    x.kind === "file" &&
                    (n.workspaceId
                      ? x.workspaceId === n.workspaceId
                      : adjacency.get(n.id)?.has(x.id)),
                );
                const recent = files[0]?.updated ?? n.updated ?? "—";
                line2 = `${files.length} note${files.length === 1 ? "" : "s"} · last edited ${recent}`;
                if (n.path) line3 = n.path;
                else if (n.noIndex) line3 = "Suggested: add a MEMORY.md";
                else if (n.status === "missing") line3 = "No files on disk";
              } else if (n.kind === "file") {
                cap = "NOTE";
                line2 = `${n.size ?? "—"} · last edited ${n.updated ?? "—"}`;
                if (n.path) line3 = n.path;
                else if (n.preview) line3 = `“${n.preview}”`;
              } else if (n.kind === "vector_store") {
                cap = "PINECONE INDEX";
                const v = n.vectorCount ? n.vectorCount.toLocaleString() : "—";
                const nsCount = Array.isArray(n.namespaces)
                  ? n.namespaces.length
                  : (n.namespaces ?? "—");
                line2 = `${v} vectors · ${nsCount} namespaces`;
                line3 = `Pinecone · ${n.dimension ?? 1024}-dim cosine`;
              } else {
                cap = n.kind.toUpperCase();
                line2 = n.meta ?? "";
              }
              return `<div style="font:500 11px ui-sans-serif,system-ui;padding:9px 11px;background:rgba(11,14,19,0.94);border:1px solid #2a2f3a;border-radius:10px;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.5);max-width:280px">
            <div style="font-size:9px;letter-spacing:.18em;color:#8a93a3;margin-bottom:3px">${cap}</div>
            <div style="font-weight:600">${escape(title)}</div>
            ${line2 ? `<div style="color:#9aa3b0;margin-top:3px;font-size:10px">${escape(line2)}</div>` : ""}
            ${line3 ? `<div style="color:#c7cdd6;margin-top:3px;font-size:10px;font-style:italic">${escape(line3)}</div>` : ""}
          </div>`;
            }}
            nodeThreeObject={buildNodeObject}
            linkColor={(l: any) => {
              const sId = typeof l.source === "object" ? l.source.id : l.source;
              const tId = typeof l.target === "object" ? l.target.id : l.target;
              const active =
                hoverIdRef.current && (sId === hoverIdRef.current || tId === hoverIdRef.current);
              if (active) return "#c4ffee";
              // A picked record's links into other sources read in Jev pink.
              if (focusNodeId && l.kind === "cross" && (sId === focusNodeId || tId === focusNodeId))
                return "#F386A1";
              if (graphData && layout === "neural")
                return typeof l.target === "object" ? l.target.color : "#8acbbd";
              if (l.kind === "skill") return "rgba(244,114,182,0.35)";
              if (l.kind === "cross") return "rgba(123,224,200,0.35)";
              if (l.kind === "decision") return "rgba(167,139,250,0.35)";
              if (l.kind === "session") return "rgba(96,165,250,0.3)";
              if (l.kind === "core") return "rgba(61,220,151,0.5)";
              return "rgba(180,190,210,0.18)";
            }}
            linkWidth={linkWidth}
            linkOpacity={
              graphData && layout === "neural"
                ? linkOpacity * 0.45
                : graphData && layout === "sphere"
                  ? 0.36
                  : linkOpacity
            }
            linkDirectionalParticles={(l: any) => {
              if (!particles || reducedMotion) return 0;
              if (graphData && layout === "neural")
                return l.kind === "core" ? 3 : data.links.length > 1200 ? 0 : 1;
              if (l.kind === "core") return 3;
              if (l.kind === "session") return 2;
              if (l.kind === "skill") return 2;
              if (l.kind === "cross") return 2;
              // Sparse pulses on recorded file links make a real network visibly alive.
              // A stable subset keeps the full 1,200-node view inexpensive.
              if (graphData) {
                const id = typeof l.target === "object" ? l.target.id : String(l.target);
                const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
                return data.links.length < 400 || hash % 5 === 0 ? 1 : 0;
              }
              return 0;
            }}
            linkDirectionalParticleSpeed={(l: any) => (l.kind === "session" ? 0.006 : 0.0035)}
            linkDirectionalParticleColor={(l: any) =>
              graphData && layout === "neural"
                ? typeof l.target === "object"
                  ? l.target.color
                  : "#8affd0"
                : l.kind === "skill"
                  ? "#f472b6"
                  : l.kind === "session"
                    ? "#60a5fa"
                    : l.kind === "cross"
                      ? ACCENT2
                      : ACCENT
            }
            linkDirectionalParticleWidth={layout === "neural" ? 1.3 : 1.4}
            linkCurvature={(l: any) =>
              layout === "neural"
                ? l.kind === "core"
                  ? 0.34
                  : 0.17
                : l.kind === "cross"
                  ? 0.4
                  : l.kind === "skill"
                    ? 0.25
                    : 0
            }
            linkCurveRotation={(l: any) => {
              const id = typeof l.target === "object" ? l.target.id : String(l.target);
              return (id.charCodeAt(id.length - 1) || 0) * 0.31;
            }}
            onNodeHover={(n: any) => { if (compactHover) hoverIdRef.current = n?.id ?? null; else setHoverId(n?.id ?? null); }}
            onNodeClick={(n: any) => {
              if (n.visualTransition?.to !== 0) onSelect(n);
            }}
            enableNodeDrag={false}
          />
        ) : (
          <MemoryGraphLoader height={680} />
        )}

        {graphData && showTitles && (
          <div className="memory-scene-titles" aria-label="Memory titles">
            {data.nodes.map(node => <button
              key={node.id}
              ref={element => { if (element) titleElements.current.set(node.id, element); else titleElements.current.delete(node.id); }}
              className={node.categoryHub || node.kind === "hub" ? "is-module" : ""}
              style={{visibility:"hidden"}}
              title={node.name}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onSelect(node)}
            >{node.name}</button>)}
          </div>
        )}
        {graphData && (
          <div className="ar-graph-controls" onPointerDown={(e) => e.stopPropagation()}>
            <button
              aria-pressed={rotating}
              disabled={reducedMotion}
              title={
                reducedMotion
                  ? "Motion is off in your device accessibility settings"
                  : "Slowly orbit your memory network"
              }
              onClick={() => setRotating(!rotating)}
            >
              {rotating ? "Orbit on" : "Orbit off"}
            </button>
            <button
              aria-pressed={particles && !reducedMotion}
              disabled={reducedMotion}
              title={
                reducedMotion
                  ? "Motion is off in your device accessibility settings"
                  : "Animate the connections between memories"
              }
              onClick={() => setParticles(!particles)}
            >
              {particles && !reducedMotion ? "Flow on" : "Flow off"}
            </button>
            <label className="neural-link-density">
              <span>Links</span>
              <select
                aria-label="Memory link density"
                value={graphDensity}
                onChange={(e) => setGraphDensity(e.target.value as "all" | "essential")}
              >
                <option value="all">All</option>
                <option value="essential">Essential</option>
              </select>
            </label>

            <button
              onClick={() => {
                fitMemoryGraph(900);
              }}
            >
              Fit all
            </button>
            <button
              aria-label="Zoom in to memories"
              onClick={() => {
                orbitPauseUntilRef.current = performance.now() + 1200;
                zoomMemoryGraph(0.7);
              }}
            >
              +
            </button>
            <button
              aria-label="Zoom out of memories"
              onClick={() => {
                orbitPauseUntilRef.current = performance.now() + 1200;
                zoomMemoryGraph(1.4);
              }}
            >
              −
            </button>
          </div>
        )}
        {/* Legend overlay */}
        {!graphData && (
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg border border-border/70 bg-background/70 backdrop-blur px-3 py-2 text-[10px] text-muted-foreground">
            <LegendDot c={ACCENT} label="Memory Core" />
            <LegendDot c={WS_COL} label="Workspace" />
            <LegendDot c={FILE_COL} label="File" shape="sphere" />
            <LegendDot c={DEC_COL} label="Decision" shape="diamond" />
            <LegendDot c={SES_COL} label="Session" shape="tri" />
            <LegendDot c={SKILL_COL} label="Skill" shape="hex" />
          </div>
        )}
      </div>

      {/* Controls — sit BELOW the canvas */}
      {!embedded && (
        <div className="mt-3 rounded-xl border border-border bg-card shadow-sm p-3 text-[11px] text-muted-foreground">
          {/* Stack until xl — between lg and xl the fixed-width buttons+stats
              used to squeeze the flex-1 thumbnail selector into unreadable
              slivers with overlapping captions. */}
          <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-5">
            {/* Layout selector with thumbnails */}
            <div className="w-full max-w-[460px] xl:max-w-none xl:flex-1 xl:min-w-[280px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/80">
                  Layout
                </span>
                <span className="text-[9px] text-muted-foreground/60 capitalize">{view}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { key: "structured", label: "Macro", hint: "Semantic structure" },
                    { key: "blend", label: "Mid", hint: "Structure + density" },
                    { key: "spheres", label: "Micro", hint: "Every memory mote" },
                    { key: "random", label: "Full", hint: "Pure graph view" },
                  ] as { key: ViewMode; label: string; hint: string }[]
                ).map((v) => {
                  const active = view === v.key;
                  return (
                    <button
                      key={v.key}
                      onClick={() => setView(v.key)}
                      title={v.hint}
                      className={`group relative rounded-lg border p-1.5 transition-all ${
                        active
                          ? "border-foreground/50 bg-foreground/[0.06] text-foreground"
                          : "border-border/60 text-muted-foreground/70 hover:border-foreground/30 hover:bg-foreground/[0.03] hover:text-muted-foreground"
                      }`}
                    >
                      <ViewThumb kind={v.key} active={active} />
                      <div
                        className={`mt-1 text-[9px] uppercase tracking-wider text-center ${active ? "text-foreground" : ""}`}
                      >
                        {v.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="hidden xl:block w-px self-stretch bg-border/60" />

            {/* Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setParticles((p) => !p)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-colors ${
                  particles
                    ? "border-foreground/40 text-foreground bg-foreground/5"
                    : "border-border/60 hover:bg-foreground/5"
                }`}
                title="Toggle flow particles"
              >
                <Sparkles className="h-3 w-3" />
                <span className="text-[10px]">Flow</span>
              </button>
              <div className="flex rounded-md border border-border/60 overflow-hidden">
                <button
                  onClick={() => setDensity("lite")}
                  className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
                    density === "lite" ? "text-foreground bg-foreground/5" : "hover:bg-foreground/5"
                  }`}
                >
                  Lite
                </button>
                <button
                  onClick={() => setDensity("full")}
                  className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1 border-l border-border/60 ${
                    density === "full" ? "text-foreground bg-foreground/5" : "hover:bg-foreground/5"
                  }`}
                >
                  <Zap className="h-2.5 w-2.5" />
                  Full
                </button>
              </div>
            </div>

            {/* Stats + slider */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 xl:ml-auto">
              <div className="flex items-center gap-2 min-w-[140px] max-w-[220px] flex-1">
                <span className="text-[9px] uppercase tracking-wider opacity-70">Links</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={linkOpacity}
                  onChange={(e) => setLinkOpacity(parseFloat(e.target.value))}
                  className="flex-1 accent-foreground/60 h-px opacity-60 hover:opacity-100 transition-opacity"
                />
              </div>
              <div className="hidden md:flex gap-3 text-[10px] tabular-nums">
                <span>
                  <span className="text-muted-foreground/70">Nodes</span>{" "}
                  <span className="text-foreground">{data.nodes.length}</span>
                </span>
                <span>
                  <span className="text-muted-foreground/70">Edges</span>{" "}
                  <span className="text-foreground">{data.links.length}</span>
                </span>
                <span>
                  <span className="text-muted-foreground/70">Recall 7d</span>{" "}
                  <span className="text-foreground">{memorySignals.recalledThisWeek}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ViewThumb({ kind, active }: { kind: ViewMode; active: boolean }) {
  // Inactive thumbs inherit the button's text color so they stay visible in
  // BOTH themes — the old hardcoded pale gray vanished on the light card.
  const accent = active ? ACCENT : "currentColor";
  const glow = active ? `drop-shadow(0 0 4px ${ACCENT})` : "none";
  if (kind === "structured") {
    return (
      <svg viewBox="0 0 40 28" className="w-full h-7" style={{ filter: glow }}>
        <line x1="20" y1="14" x2="6" y2="6" stroke={accent} strokeWidth="0.5" opacity="0.6" />
        <line x1="20" y1="14" x2="34" y2="6" stroke={accent} strokeWidth="0.5" opacity="0.6" />
        <line x1="20" y1="14" x2="6" y2="22" stroke={accent} strokeWidth="0.5" opacity="0.6" />
        <line x1="20" y1="14" x2="34" y2="22" stroke={accent} strokeWidth="0.5" opacity="0.6" />
        <circle cx="20" cy="14" r="3.5" fill={accent} />
        <circle cx="6" cy="6" r="1.6" fill={accent} opacity="0.9" />
        <circle cx="34" cy="6" r="1.6" fill={accent} opacity="0.9" />
        <circle cx="6" cy="22" r="1.6" fill={accent} opacity="0.9" />
        <circle cx="34" cy="22" r="1.6" fill={accent} opacity="0.9" />
      </svg>
    );
  }
  if (kind === "spheres") {
    const dots = Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2;
      const r = 6 + (i % 3) * 3;
      return { x: 20 + Math.cos(a) * r, y: 14 + Math.sin(a) * r * 0.7, s: 0.9 + (i % 3) * 0.5 };
    });
    return (
      <svg viewBox="0 0 40 28" className="w-full h-7" style={{ filter: glow }}>
        <circle cx="20" cy="14" r="2.4" fill={accent} />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.s} fill={accent} opacity="0.85" />
        ))}
      </svg>
    );
  }
  if (kind === "blend") {
    // structured spokes + a few extra motes
    const motes = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = 9 + (i % 2) * 2;
      return { x: 20 + Math.cos(a) * r, y: 14 + Math.sin(a) * r * 0.7 };
    });
    return (
      <svg viewBox="0 0 40 28" className="w-full h-7" style={{ filter: glow }}>
        <line x1="20" y1="14" x2="6" y2="6" stroke={accent} strokeWidth="0.5" opacity="0.5" />
        <line x1="20" y1="14" x2="34" y2="6" stroke={accent} strokeWidth="0.5" opacity="0.5" />
        <line x1="20" y1="14" x2="6" y2="22" stroke={accent} strokeWidth="0.5" opacity="0.5" />
        <line x1="20" y1="14" x2="34" y2="22" stroke={accent} strokeWidth="0.5" opacity="0.5" />
        <circle cx="20" cy="14" r="3" fill={accent} />
        <circle cx="6" cy="6" r="1.4" fill={accent} opacity="0.9" />
        <circle cx="34" cy="6" r="1.4" fill={accent} opacity="0.9" />
        <circle cx="6" cy="22" r="1.4" fill={accent} opacity="0.9" />
        <circle cx="34" cy="22" r="1.4" fill={accent} opacity="0.9" />
        {motes.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r="0.8" fill={accent} opacity="0.7" />
        ))}
      </svg>
    );
  }
  // random
  const rnd = [
    [5, 6],
    [12, 19],
    [18, 8],
    [25, 22],
    [32, 11],
    [9, 14],
    [22, 16],
    [30, 4],
    [36, 19],
    [15, 24],
    [28, 14],
    [3, 18],
  ];
  return (
    <svg viewBox="0 0 40 28" className="w-full h-7" style={{ filter: glow }}>
      {rnd.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1 + (i % 3) * 0.5} fill={accent} opacity="0.85" />
      ))}
    </svg>
  );
}

function LegendDot({
  c,
  label,
  shape = "sphere",
}: {
  c: string;
  label: string;
  shape?: "sphere" | "diamond" | "tri" | "hex";
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5"
        style={{
          background: c,
          boxShadow: `0 0 8px ${c}`,
          borderRadius: shape === "sphere" ? "50%" : shape === "hex" ? "20%" : "2px",
          transform:
            shape === "diamond" ? "rotate(45deg)" : shape === "tri" ? "rotate(15deg)" : undefined,
        }}
      />
      {label}
    </span>
  );
}

export default MemoryGraph3D;
