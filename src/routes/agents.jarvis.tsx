import { createFileRoute } from "@tanstack/react-router";
import { CeoInbox } from "@/components/jev/ceo-inbox";

export const Route = createFileRoute("/agents/jarvis")({
  head: () => ({ meta: [{ title: "Jarvis · Agentic OS" }] }),
  component: CeoInbox,
});
