import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
function ChatWorkspace() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) host.current.dataset.ready = "true";
    window.dispatchEvent(new Event("argentic:chat-host"));
    return () => {
      window.dispatchEvent(new Event("argentic:chat-close"));
    };
  }, []);
  return (
    <div
      ref={host}
      id="argentic-chat-host"
      className="ar-chat-workspace-host"
      aria-label="Chat workspace"
    />
  );
}
export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Chat | Agentic OS" }] }),
  component: ChatWorkspace,
});
