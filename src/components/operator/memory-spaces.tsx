import { useState } from "react";
import {
  ArrowUpRight,
  Building2,
  Check,
  Folder,
  Heart,
  Lightbulb,
  Plus,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { memorySpaces, operatorRequest, useOperator } from "@/lib/operator";
import { BRAIN_SOURCES, sourceOrigin } from "@/lib/brain-sources";
import { SourceBrand } from "./source-brand";
import { Busy } from "./ui";
import "./memory-spaces.css";

const icons = {
  business: Building2,
  content: Video,
  projects: Folder,
  personal: UserRound,
  folder: Folder,
  heart: Heart,
  idea: Lightbulb,
};
const colors = ["#c8afe9", "#96c7bd", "#e6be84", "#90b9d9", "#c49ab3"];

export function MemorySpaces({
  selected,
  onSelect,
  onAdd,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
}) {
  const { state, refresh } = useOperator();
  const [creating, setCreating] = useState(false),
    [name, setName] = useState("");
  const [icon, setIcon] = useState("folder"),
    [color, setColor] = useState(colors[0]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const spaces = memorySpaces(state);
  return (
    <section className="memory-spaces-v5" aria-labelledby="memory-spaces-heading">
      <div className="cortex-section-heading">
        <div>
          <h2 id="memory-spaces-heading">Your knowledge spaces</h2>
          <p>Context for every part of your world.</p>
        </div>
        <div className="ms5-heading-actions">
          <button className="op-text-link" onClick={() => onSelect("all")}>
            View all <ArrowUpRight size={12} />
          </button>
          <button className="op-button" onClick={() => setCreating(!creating)}>
            <Plus size={13} />
            New space
          </button>
        </div>
      </div>
      <div className="ms5-grid">
        {spaces.map((space) => {
          const Icon = icons[(space.icon || space.id) as keyof typeof icons] || Folder;
          const records = state.sources.filter((s) => !s.deletedAt && s.collection === space.id);
          const brands = [...new Set(records.map((s) => s.connector?.provider || sourceOrigin(s)))];
          return (
            <article
              className={`ms5-space ${selected === space.id ? "is-selected" : ""}`}
              key={space.id}
              style={{ "--space-color": space.color } as React.CSSProperties}
            >
              <button
                className="ms5-main"
                onClick={() => onSelect(space.id)}
                aria-pressed={selected === space.id}
              >
                <span className="ms5-icon">
                  <Icon size={20} strokeWidth={1.6} />
                </span>
                <span className="ms5-title">
                  <strong>{space.name}</strong>
                  <small>
                    {records.length.toLocaleString()} {records.length === 1 ? "memory" : "memories"}
                  </small>
                </span>
                <ArrowUpRight size={14} />
                <p>{space.description || "A space for the context that belongs together."}</p>
                <span className="ms5-brands">
                  {brands.length ? (
                    <>
                      {brands.slice(0, 5).map((id) => (
                        <span
                          key={id}
                          title={`${BRAIN_SOURCES.find((x) => x.id === id)?.name || id} · ${records.filter((s) => (s.connector?.provider || sourceOrigin(s)) === id).length} sources`}
                        >
                          <SourceBrand id={id} size={16} />
                        </span>
                      ))}
                      <small>
                        {brands.length > 5
                          ? `+${brands.length - 5} more`
                          : `${brands.length} ${brands.length === 1 ? "source" : "sources"}`}
                      </small>
                    </>
                  ) : (
                    <small>No sources added yet</small>
                  )}
                </span>
              </button>
              <button
                className="ms5-add"
                onClick={() => onAdd(space.id)}
                aria-label={`Add memory to ${space.name}`}
              >
                <Plus size={12} />
                Add memory
              </button>
            </article>
          );
        })}
      </div>
      {creating && (
        <form
          className="ms5-create"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await operatorRequest("/memory/spaces", {
                name: name.trim(),
                color,
                icon,
              });
              await refresh();
              onSelect(result.space?.id || result.id);
              setCreating(false);
              setName("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="memory-space-name">New knowledge space</label>
            <button type="button" aria-label="Close new space" onClick={() => setCreating(false)}>
              <X size={14} />
            </button>
          </div>
          <input
            id="memory-space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. YouTube, My business, Learning…"
            maxLength={48}
            required
            autoFocus
            disabled={busy}
          />
          <div className="ms5-create-bottom">
            <div role="group" aria-label="Space icon">
              {(["folder", "business", "idea", "heart"] as const).map((id) => {
                const Icon = icons[id];
                return (
                  <button
                    type="button"
                    key={id}
                    aria-label={`${id} icon`}
                    aria-pressed={icon === id}
                    onClick={() => setIcon(id)}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>
            <div role="group" aria-label="Space colour">
              {colors.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                >
                  {color === c && <Check size={11} />}
                </button>
              ))}
            </div>
            <button className="op-button primary" disabled={busy || !name.trim()}>
              {busy ? <Busy /> : <Plus size={13} />}Create space
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
