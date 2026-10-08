import { createFileRoute } from "@tanstack/react-router";
import { Workbench } from "@/components/jev/workbench";

export const Route = createFileRoute("/agents/workbench")({
  head: () => ({ meta: [{ title: "Workbench · Agentic OS" }] }),
  component: Workbench,
});
