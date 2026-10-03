import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { BRAIN_SOURCES, brainEnabled, sourceOrigin } from "@/lib/brain-sources";
import { operatorRequest, type OperatorState } from "@/lib/operator";
export function VoiceSources({
  state,
  onClose,
  onBeforeChange,
}: {
  state: OperatorState;
  onClose: () => void;
  onBeforeChange: () => void;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("");
  async function toggle(id: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    onBeforeChange();
    try {
      const result = await operatorRequest<{
        brainSources: Record<string, boolean>;
        brainRevision: number;
        changed: boolean;
      }>("/brain/sources", { id, enabled: !brainEnabled(state, id) });
      await cache.cancelQueries({ queryKey: ["operator-state"] });
      cache.setQueryData<OperatorState>(["operator-state"], (previous) =>
        previous
          ? { ...previous, brainSources: result.brainSources, brainRevision: result.brainRevision }
          : previous,
      );
      if (result.changed) window.dispatchEvent(new Event("operator:brain-change"));
      void cache.invalidateQueries({ queryKey: ["operator-state"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="jarvis-sources" aria-label="Jarvis memory sources">
      <div className="jarvis-section-head">
        <button onClick={onClose} aria-label="Back to conversation">
          <ArrowLeft size={15} />
        </button>
        <h2>Memory sources</h2>
      </div>
      <p>
        Choose what Jarvis can use. These switches also apply in Memory. Changing a source ends the
        current call so its context can be cleared.
      </p>
      <input
        aria-label="Filter memory sources"
        placeholder="Find a source…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <div className="jarvis-source-list">
        {["Agent memory", "Your world", "Knowledge & tools"].map((group) => {
          const rows = BRAIN_SOURCES.filter(
            (s) => s.group === group && s.name.toLowerCase().includes(filter.toLowerCase()),
          );
          if (!rows.length) return null;
          return (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map((source) => {
                const count = state.sources.filter(
                  (s) => !s.deletedAt && !s.connector?.supersededAt && s.status === "ready" && sourceOrigin(s) === source.id,
                ).length;
                return (
                  <div className="jarvis-source-row" key={source.id}>
                    <span>
                      <strong>{source.name}</strong>
                      <small>
                        {count ? `${count.toLocaleString()} saved memories` : ["email", "meetings", "images"].includes(source.id) ? "No memories imported yet" : source.description}
                      </small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-label={source.name}
                      aria-checked={brainEnabled(state, source.id)}
                      disabled={!!busy}
                      onClick={() => void toggle(source.id)}
                    >
                      {busy === source.id ? <Loader2 size={12} className="animate-spin" /> : <i />}
                    </button>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}
