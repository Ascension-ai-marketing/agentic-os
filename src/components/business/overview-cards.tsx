import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, GripHorizontal, RotateCcw } from "lucide-react";
import "./overview-cards.css";

type Card = { id: string; label: string; content: ReactNode };
const STORAGE_KEY = "agentic-overview-card-order";

/** Only the three overview cards move. Their existing actions keep normal pointer behaviour. */
export function OverviewCards({ cards, caption }: { cards: Card[]; caption: ReactNode }) {
  const [order, setOrder] = useState<string[]>([]);
  const [arranging, setArranging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<{ id: string; over: string; x: number; y: number } | null>(null);
  const pointer = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
    over: string;
    rects: { id: string; rect: DOMRect }[];
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const instructions = useId();
  // Unknown/duplicate IDs are ignored and newly introduced cards retain their default place.
  const ids = [
    ...new Set([
      ...order.filter((id) => cards.some((card) => card.id === id)),
      ...cards.map((card) => card.id),
    ]),
  ];
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved))
        setOrder(saved.filter((id): id is string => typeof id === "string"));
    } catch {
      /* A missing or old preference uses the default order. */
    }
  }, []);

  function save(next: string[]) {
    setOrder(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Still works for this visit. */
    }
  }
  function move(id: string, to: number) {
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save(next);
    setAnnouncement(
      `${cards.find((card) => card.id === id)?.label} moved to position ${to + 1} of ${ids.length}.`,
    );
  }
  function cancelDrag() {
    pointer.current = null;
    setDrag(null);
  }

  return (
    <>
      <div className="biz-overview-section-label">
        <span>Your business at a glance</span>
        <div className="overview-arrange-actions">
          {arranging ? (
            <button
              type="button"
              onClick={() => {
                save(cards.map((card) => card.id));
                setAnnouncement("Default card order restored.");
              }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          ) : (
            <small>{caption}</small>
          )}
          <button
            type="button"
            aria-pressed={arranging}
            onClick={() => {
              cancelDrag();
              setArranging(!arranging);
            }}
          >
            {arranging ? <Check size={14} /> : <GripHorizontal size={14} />}
            {arranging ? "Done" : "Arrange cards"}
          </button>
        </div>
      </div>
      {arranging && (
        <p id={instructions} className="overview-arrange-hint">
          Drag a handle or focus it and use the arrow keys. Your layout saves on this browser.
        </p>
      )}
      <div ref={grid} className="biz-overview-money-row" data-arranging={arranging || undefined}>
        {ids.map((id) => {
          const card = cards.find((card) => card.id === id)!;
          return (
            <div
              key={id}
              className="overview-card-slot"
              data-overview-card={id}
              data-dragging={drag?.id === id || undefined}
              data-drop-target={(drag && drag.over === id && drag.id !== id) || undefined}
              style={
                drag?.id === id
                  ? { transform: `translate(${drag.x}px, ${drag.y}px)`, zIndex: 5 }
                  : undefined
              }
            >
              {arranging && (
                <button
                  type="button"
                  className="overview-card-handle"
                  aria-label={`Move ${card.label}`}
                  aria-describedby={instructions}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      cancelDrag();
                      return;
                    }
                    const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[
                      event.key
                    ];
                    if (direction) {
                      event.preventDefault();
                      move(id, ids.indexOf(id) + direction);
                    }
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointer.current = {
                      id,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                      over: id,
                      rects: [
                        ...(grid.current?.querySelectorAll<HTMLElement>("[data-overview-card]") ??
                          []),
                      ].map((element) => ({
                        id: element.dataset.overviewCard!,
                        rect: element.getBoundingClientRect(),
                      })),
                    };
                  }}
                  onPointerMove={(event) => {
                    const p = pointer.current;
                    if (!p || p.id !== id) return;
                    const x = event.clientX - p.x,
                      y = event.clientY - p.y;
                    if (!p.moved && Math.hypot(x, y) < 6) return;
                    p.moved = true;
                    p.over =
                      p.rects.find(
                        ({ rect }) =>
                          event.clientX >= rect.left &&
                          event.clientX <= rect.right &&
                          event.clientY >= rect.top &&
                          event.clientY <= rect.bottom,
                      )?.id ?? id;
                    setDrag({ id, over: p.over, x, y });
                  }}
                  onPointerUp={() => {
                    const p = pointer.current;
                    if (p?.moved) move(id, ids.indexOf(p.over));
                    cancelDrag();
                  }}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                >
                  <GripHorizontal size={16} aria-hidden="true" />
                  <span>{card.label}</span>
                </button>
              )}
              {card.content}
            </div>
          );
        })}
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
