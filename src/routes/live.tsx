import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "@/components/jev/live-page";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live · Agentic OS" }] }),
  component: LivePage,
});
