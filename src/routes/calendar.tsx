import { createFileRoute } from "@tanstack/react-router";
import { CalendarWorkspace } from "@/components/operator/calendar-workspace";
export const Route = createFileRoute("/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Agentic OS" }] }),
  component: CalendarWorkspace,
});
