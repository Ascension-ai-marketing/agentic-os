import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Database, BrainCircuit, Briefcase, Layers, Plus, ArrowUpRight } from "lucide-react";
import { BRAIN_SOURCES, brainEnabled, brainSourceCounts } from "@/lib/brain-sources";
import { operatorRequest, useOperator } from "@/lib/operator";
import { useLiveData } from "@/lib/use-live-data";
import { Modal, Notice } from "./ui";
export function BrainSourcesPanel({
  label = "Manage sources",
  onImport,
}: {
  label?: string;
  onImport?: (source: string) => void;
}) {
  const { state, refresh } = useOperator(),
    live = useLiveData();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const counts = brainSourceCounts(state, live);
  useEffect(() => {
    const show = () => {
      if (onImport || !document.querySelector(".cortex-workspace")) setOpen(true);
    };
    window.addEventListener("memory:sources", show);
    return () => window.removeEventListener("memory:sources", show);
  }, [onImport]);
  const available = BRAIN_SOURCES.filter((s) => counts[s.id].saved + counts[s.id].mapped > 0);
  const on = available.filter((s) => brainEnabled(state, s.id)).length;
  async function toggle(id: string) {
    setBusy(id);
    setError("");
    try {
      await operatorRequest("/brain/sources", { id, enabled: !brainEnabled(state, id) });
      await refresh();
      window.dispatchEvent(new Event("operator:brain-change"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <button className="op-button cortex-manage-sources" onClick={() => setOpen(true)}>
        <Database size={14} /> {label} <span>{on} active</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Sources your AI can use"
        description="Control recall and chat context. Connect and sync apps below the graph."
      >
        <div className="cortex-source-dialog">
          <div className="ar-source-groups">
            {["Your world", "Agent memory", "Knowledge & tools"].map((group, i) => {
              const Icon = [Briefcase, BrainCircuit, Layers][i];
              return (
                <div key={group}>
                  <h3>
                    <Icon size={14} />
                    {group}
                  </h3>
                  {BRAIN_SOURCES.filter((s) => s.group === group).map((s) => {
                    const count = counts[s.id],
                      ready = count.saved + count.mapped > 0,
                      enabled = brainEnabled(state, s.id);
                    return (
                      <div className={`ar-brain-source ${ready ? "available" : ""}`} key={s.id}>
                        <div>
                          <strong>{s.name}</strong>
                          <p>{s.description}</p>
                          <small>
                            {ready
                              ? [
                                  count.saved ? `${count.saved} saved` : "",
                                  count.mapped ? `${count.mapped} mapped` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : "No sources added yet"}
                          </small>
                          {s.id === "email" ? (
                            <Link
                              className="cortex-source-add"
                              to="/inbox"
                              onClick={() => setOpen(false)}
                            >
                              Choose an email <ArrowUpRight size={11} />
                            </Link>
                          ) : (
                            onImport && (
                              <button
                                type="button"
                                className="cortex-source-add"
                                onClick={() => {
                                  setOpen(false);
                                  onImport(s.id);
                                }}
                              >
                                <Plus size={11} />
                                {["codex", "claude", "hermes", "chatgpt"].includes(s.id)
                                  ? "Set up this app"
                                  : s.id === "notion"
                                    ? "Import a page"
                                    : s.id === "images"
                                      ? "Read an image"
                                      : "Add context"}
                              </button>
                            )
                          )}
                        </div>
                        <button
                          role="switch"
                          aria-label={`Use ${s.name}`}
                          aria-checked={enabled}
                          disabled={!!busy}
                          onClick={() => void toggle(s.id)}
                          className="ar-source-switch"
                        >
                          <span />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="ar-sources-note">
            Switching a source off excludes it from the graph, automatic recall and new chat
            context. Your original material stays saved. Sources with no data are ready for future
            imports; mapped items may contain metadata only. Previous chat stays visible but is not
            reused after a source change.
          </p>
          {error && <Notice error>{error}</Notice>}
        </div>
      </Modal>
    </>
  );
}
