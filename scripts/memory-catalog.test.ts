import { expect, test } from "bun:test";
import { buildMemoryCatalog, memoryGraphWindow } from "../src/lib/memory-catalog";
import type { OperatorState } from "../src/lib/operator";
import type { MemNode } from "../src/components/memory-graph-3d";

test("Memory and Voice share actual saved titles and links without example or superseded records", () => {
  const state = {
    sources: [
      {
        id: "saved",
        title: "Launch plan",
        text: "Violet launch",
        origin: "manual",
        status: "ready",
      },
      {
        id: "old",
        title: "Old plan",
        text: "Old",
        origin: "manual",
        status: "ready",
        connector: { supersededAt: "2026-09-17" },
      },
    ],
    inbox: [],
    events: [],
    goals: { longTerm: "", quarter: "", week: "", metrics: [] },
  } as unknown as OperatorState;
  const result = buildMemoryCatalog(
    { isExample: true, memory: { nodes: [{ id: "fiction", kind: "file", name: "Fake memory" }] } },
    state,
  );
  expect(result.graph.nodes.find((node) => node.id === "saved")?.name).toBe("Launch plan");
  expect(result.graph.nodes.some((node) => ["old", "fiction"].includes(node.id))).toBe(false);
  expect(
    result.graph.links.some((link) => link.source === "origin:manual" && link.target === "saved"),
  ).toBe(true);
});

test("large voice graphs retain late source hubs and a selected memory beyond the rendering cap", () => {
  const nodes = Array.from(
    { length: 1500 },
    (_, i) =>
      ({ id: `file${i}`, name: `Memory ${i}`, kind: "file", val: 8, color: "#fff" }) as MemNode,
  );
  nodes.push({
    id: "origin:manual",
    name: "Your notes",
    kind: "workspace",
    categoryHub: true,
    val: 20,
    color: "#fff",
  });
  const graph = memoryGraphWindow(
    nodes,
    [{ source: "origin:manual", target: "file1499", kind: "file" }],
    ["file1499"],
  );
  expect(graph.nodes).toHaveLength(1200);
  expect(graph.nodes[0].id).toBe("origin:manual");
  expect(graph.nodes[1].id).toBe("file1499");
  expect(graph.links).toHaveLength(1);
});
