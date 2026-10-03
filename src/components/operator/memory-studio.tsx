import { useEffect, useState, type ReactNode } from "react";
import { MemorySculpture } from "./memory-sculpture";
import "./memory-studio.css";

export function MemoryStudio({ capture }: { capture: ReactNode }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const glow = () => {
      setSaved(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSaved(false), 1800);
    };
    window.addEventListener("memory:saved", glow);
    return () => {
      window.removeEventListener("memory:saved", glow);
      clearTimeout(timer);
    };
  }, []);
  return (
    <section
      className={`memory-studio${saved ? " is-memory-saved" : ""}`}
      aria-label="Build your AI brain"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if ((event.target as Element).closest(".memory-capture-v5")) return;
        event.preventDefault();
        if (!event.dataTransfer.files.length) return;
        const input = event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
        if (input && !input.disabled) {
          input.files = event.dataTransfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }}
    >
      <div className="memory-studio-art">
        <MemorySculpture />
        <div className="memory-studio-caption">
          <h2>
            Build your
            <br />
            AI brain.
          </h2>
        </div>
      </div>
      <div className="memory-studio-main">{capture}</div>
    </section>
  );
}
