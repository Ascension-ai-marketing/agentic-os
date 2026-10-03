// "Sort with Jev" inside the Gmail and Outlook tabs: one click sorts the
// loaded emails into piles. Results are saved on this Mac; nothing is
// labelled, moved or sent in the mailbox.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Play, Square } from "lucide-react";
import type { InboxItem } from "@/lib/operator";
import { PILES, inboxCategories, type InboxLabel } from "@/lib/jev-inbox";
import { jevFetch } from "@/lib/jev-client";
import { JevMark, fmtUsd } from "@/components/jev/jev-card";

import "./jev-inbox-sort.css";

export type JevSortState = ReturnType<typeof useJevInboxLabels>;

export function useJevInboxLabels(messages: InboxItem[]) {
  const [labels, setLabels] = useState<InboxLabel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ count: 0, ms: 0, costUsd: 0 });
  const controller = useRef<AbortController | null>(null);
  const ids = useMemo(() => messages.map((m) => m.id).join("|"), [messages]);
  useEffect(() => {
    if (!ids) return;
    const ac = new AbortController();
    void jevFetch("/__jev/inbox", { signal: ac.signal })
      .then((r) => r.json())
      .then((saved: InboxLabel[]) => {
        if (!ac.signal.aborted && Array.isArray(saved)) setLabels(saved);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [ids]);
  useEffect(() => () => controller.current?.abort(), []);
  const byId = useMemo(() => new Map(labels.map((l) => [l.messageId, l])), [labels]);

  const run = useCallback(async () => {
    const targets = messages.slice(0, 500).map((m) => m.id);
    if (!targets.length) return;
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setError("");
    setStats({ count: 0, ms: 0, costUsd: 0 });
    try {
      const r = await jevFetch("/__jev/inbox", { method: "POST", body: JSON.stringify({ ids: targets }), signal: ac.signal });
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines.filter(Boolean)) {
            const event = JSON.parse(line);
            if (event.error) throw new Error(event.error);
            if (event.row) setLabels((old) => [...old.filter((l) => l.messageId !== event.row.messageId), event.row]);
            if (event.stats) setStats(event.stats);
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Sorting failed");
    } finally {
      setBusy(false);
    }
  }, [messages]);

  return { byId, run, stop: () => controller.current?.abort(), busy, error, stats, total: messages.length };
}

export function JevSortBar({ state, pile, setPile }: { state: JevSortState; pile: string; setPile: (p: string) => void }) {
  const sorted = [...state.byId.values()];
  const counts = Object.fromEntries(inboxCategories.map((c) => [c, sorted.filter((l) => l.category === c).length]));
  const has = sorted.length > 0;
  return (
    <div className="jsb" aria-label="Sort with Jev">
      <div className="jsb-top">
        {state.busy ? (
          <button type="button" className="jsb-btn is-stop" onClick={state.stop}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button type="button" className="jsb-btn" disabled={!state.total} onClick={() => void state.run()} title="Sends sender, subject and the first 500 characters of each email to Jev via OpenRouter. Nothing changes in your mailbox.">
            <JevMark size={14} /> {has ? "Sort again with Jev" : "Sort with Jev"}
            {!has && <Play size={12} />}
          </button>
        )}
        {(state.busy || state.stats.count > 0) && (
          <span className="jsb-stats" aria-live="polite">
            <b>{state.stats.count}</b> of {Math.min(500, state.total)} sorted · {(state.stats.ms / 1000).toFixed(1)} s · {fmtUsd(state.stats.costUsd)}
          </span>
        )}
        {state.error && <span className="jsb-error">{state.error}</span>}
      </div>
      {has && (
        <div className="jsb-piles" role="group" aria-label="Filter by Jev pile">
          <button type="button" aria-pressed={pile === "all"} onClick={() => setPile("all")}>
            All <small>{state.total}</small>
          </button>
          {inboxCategories
            .filter((c) => counts[c])
            .map((c) => (
              <button key={c} type="button" aria-pressed={pile === c} onClick={() => setPile(c)} style={{ "--pile": PILES[c].color } as CSSProperties}>
                <i /> {PILES[c].name} <small>{counts[c]}</small>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function JevPileTag({ label }: { label?: InboxLabel }) {
  if (!label) return null;
  const pile = PILES[label.category];
  const a = label.decision.answers.category;
  const sure = a?.type === "choice" ? a.probabilities[a.choice] ?? a.confidence : 0;
  return (
    <span className="jsb-tag" style={{ "--pile": pile.color } as CSSProperties} title={`Jev: ${pile.name}, ${Math.round(sure * 100)}% sure`}>
      {pile.name}
    </span>
  );
}
