// Hermes and OpenClaw side by side. Each side is the agent's own page in a frame,
// so both look and behave exactly as they do full-window; nothing in them is rewritten.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Maximize2 } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import "./workbench.css";

const SIDES = [
  { id: "hermes", label: "Hermes", to: "/agents/hermes" },
  { id: "openclaw", label: "OpenClaw", to: "/agents/openclaw" },
] as const;

/** The frame's name is how the page inside knows to drop the sidebar and header (see __root.tsx). */
export const EMBED_NAME = "os-embed";

function Side({ side, dragging }: { side: (typeof SIDES)[number]; dragging: boolean }) {
  return (
    <section className="wb-side" aria-label={side.label}>
      <header className="wb-bar">
        <strong>{side.label}</strong>
        <Link to={side.to as any} className="op-button wb-open">
          <Maximize2 size={13} /> Full window
        </Link>
      </header>
      {/* A frame under the pointer swallows the drag, so frames ignore the pointer while the divider moves. */}
      <iframe
        name={`${EMBED_NAME}-${side.id}`}
        title={side.label}
        src={`${side.to}?embed=1`}
        className="wb-frame"
        style={dragging ? { pointerEvents: "none" } : undefined}
      />
    </section>
  );
}

export function Workbench() {
  const [stacked, setStacked] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 900px)");
    const update = () => setStacked(narrow.matches);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const done = () => setDragging(false);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
    return () => { window.removeEventListener("pointerup", done); window.removeEventListener("pointercancel", done); };
  }, [dragging]);

  return (
    <div className="wb">
      <ResizablePanelGroup orientation={stacked ? "vertical" : "horizontal"} className="wb-group">
        <ResizablePanel defaultSize="50%" minSize="25%"><Side side={SIDES[0]} dragging={dragging} /></ResizablePanel>
        <ResizableHandle withHandle className="wb-handle" onPointerDown={() => setDragging(true)} />
        <ResizablePanel defaultSize="50%" minSize="25%"><Side side={SIDES[1]} dragging={dragging} /></ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
