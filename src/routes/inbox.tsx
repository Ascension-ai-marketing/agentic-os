import { createFileRoute } from "@tanstack/react-router";
import { InboxWorkspace } from "@/components/operator/inbox-workspace";
export const Route = createFileRoute("/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Agentic OS" }] }),
  component: InboxWorkspace,
});
