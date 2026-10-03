import { useQuery } from "@tanstack/react-query";
import { jevFetch } from "@/lib/jev-client";
export function JevChatSavings() {
  const q = useQuery({ queryKey: ["jev-chat-savings"], queryFn: async () => (await jevFetch("/__jev/router-savings")).json(), refetchInterval: 5000 });
  const s = q.data;
  return <div className="px-4 py-2 text-xs text-muted-foreground" title="The last 5,000 routing calls and recorded worker turns. API price equivalents are estimates for subscription models. Cached input is compared at catalog input rates. No model changes during a conversation, so its prompt cache stays with the same model.">
    {s ? <>{s.calls} calls routed · ${s.costUsd.toFixed(5)} {s.costEstimated ? "estimated spend" : "reported cost"} · ${s.savedUsd.toFixed(5)} saved <span className="rounded border px-1">estimated</span>{!s.measuredTurns && " · waiting for worker usage"}</> : "Jev savings will appear after routing a new chat."}
  </div>;
}
