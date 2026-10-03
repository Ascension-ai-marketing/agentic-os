import { useQuery } from "@tanstack/react-query";
import { operatorRequest } from "@/lib/operator";

/** Client view of the paced reply outbox. One click puts one reply in; the OS sends them one by one. */
export type OutboxSource = "youtube";
export type OutboxItem = {
  id: string;
  source: OutboxSource;
  targetId: string;
  name: string;
  content: string;
  queuedAt: string;
  status: "queued" | "sending" | "sent" | "failed" | "uncertain" | "cancelled";
  attempts: number;
  notBefore?: string;
  error?: string;
  sentAt?: string;
  finishedAt?: string;
  messageId?: string;
  eta: number;
};
export type OutboxStatus = {
  paused: boolean;
  paceSeconds: Record<OutboxSource, number>;
  lastSentAt: Partial<Record<OutboxSource, string>>;
  counts: { queued: number; sending: number; sent: number; failed: number; uncertain: number };
  items: OutboxItem[];
};
export const OUTBOX_KEY = ["operator-outbox"];

export function useOutbox(enabled = true) {
  return useQuery<OutboxStatus>({
    queryKey: OUTBOX_KEY,
    queryFn: () => operatorRequest("/connections/outbox"),
    enabled,
    refetchInterval: (query) => (query.state.data?.counts.queued || query.state.data?.counts.sending ? 1500 : 12000),
  });
}
/** The latest live or finished outbox entry for one conversation or comment. */
export function outboxFor(status: OutboxStatus | undefined, source: OutboxSource, targetId: string): OutboxItem | undefined {
  return (status?.items || [])
    .filter((i) => i.source === source && i.targetId === targetId && i.status !== "cancelled")
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
}
export function enqueueReply(body: { source: OutboxSource; targetId: string; content: string; name: string }) {
  return operatorRequest<OutboxItem>("/connections/outbox/enqueue", body);
}
export function cancelReply(id: string) {
  return operatorRequest<OutboxItem>("/connections/outbox/cancel", { id });
}
export function pauseOutbox(paused: boolean) {
  return operatorRequest<OutboxStatus>("/connections/outbox/pause", { paused });
}
