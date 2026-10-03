import { createFileRoute } from "@tanstack/react-router";
import { MemoryWorkspace } from "@/components/operator/memory-workspace";
export const Route = createFileRoute("/memory")({
  validateSearch: (search: Record<string, unknown>): { source?: string; focus?: string } => ({
    focus: typeof search.focus === "string" ? search.focus : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  head: () => ({ meta: [{ title: "Memory — Agentic OS" }] }),
  component: MemoryWorkspace,
});
