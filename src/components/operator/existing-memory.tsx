import { useState } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { operatorRequest } from "@/lib/operator";
import { Busy, Modal, Notice, Panel } from "./ui";
type ExistingNote = {
  id: string;
  title: string;
  excerpt?: string;
  updated?: string;
  vault: string;
};
export function ExistingMemory({ graphs, refresh }: { graphs: any[]; refresh: () => unknown }) {
  const [expanded, setExpanded] = useState(false),
    [selected, setSelected] = useState<ExistingNote | null>(null),
    [text, setText] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const notes: ExistingNote[] = graphs.flatMap((g) =>
    (g.notes || []).map((n: any) => ({ ...n, vault: g.vault })),
  );
  if (!notes.length) return null;
  async function open(note: ExistingNote) {
    setSelected(note);
    setText("");
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const r = await fetch(
        `/__memory_note?vault=${encodeURIComponent(note.vault)}&id=${encodeURIComponent(note.id)}`,
      );
      const data = await r.json();
      if (!r.ok || !data.ok || !data.content)
        throw new Error(
          data.error ||
            "The original note is unavailable. Open the existing brain to inspect the source.",
        );
      setText(data.content);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Panel className="op-existing-memory">
        <div className="op-panel-title">
          <div>
            <h2>Already part of your world.</h2>
            <small>
              {notes.length} notes from your existing workspace · original files kept in place
            </small>
          </div>
          <button className="op-text-link" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "See your notes"}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
        <div className="op-existing-notes">
          {notes.slice(0, expanded ? notes.length : 3).map((n) => (
            <button key={`${n.vault}:${n.id}`} className="op-existing-note" onClick={() => open(n)}>
              <BookOpen size={16} />
              <span>
                {n.title}
                <small>{n.vault}</small>
              </span>
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
        <div className="op-existing-foot">
          Open a note to read it or bring a copy into your new collections.
          <Link to="/memory-map">Explore the full brain ↗</Link>
        </div>
      </Panel>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title || "Existing note"}
        description={`${selected?.vault || "Workspace"} · original source, read only`}
      >
        {loading ? (
          <p className="op-muted">Reading the original note…</p>
        ) : (
          <>
            {error && <Notice error>{error}</Notice>}
            {notice && <Notice>{notice}</Notice>}
            {text && <div className="op-detail-text">{text}</div>}
            <div className="op-detail-actions">
              <p className="op-form-help" style={{ flex: 1 }}>
                Import a copy to search, edit and chat with this note in your Business collection.
              </p>
              <button
                className="op-button primary"
                disabled={!text || busy}
                onClick={async () => {
                  if (!selected) return;
                  setBusy(true);
                  try {
                    const r = await operatorRequest("/memory", {
                      title: selected.title,
                      text,
                      filename: `${selected.id}.md`,
                      kind: "note",
                      collection: "business",
                    });
                    await refresh();
                    setNotice(
                      r.duplicate
                        ? "This note is already in your library."
                        : "Copied into Business memory and indexed. The original is unchanged.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Busy /> : <Plus size={13} />} Add to library
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
