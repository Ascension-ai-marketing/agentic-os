import { useState } from "react";
import { ArrowUpRight, Hammer, Code2, Send } from "lucide-react";
import { AgentMark, type AgentTarget } from "./agent-jobs-panel";

export function JarvisBuild({
  onRun,
}: {
  onRun: (
    prompt: string,
    target: AgentTarget,
    workflow: "build" | "improve-os",
  ) => Promise<unknown>;
}) {
  const [workflow, setWorkflow] = useState<"build" | "improve-os">("build");
  const [target, setTarget] = useState<AgentTarget>("codex");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="jarvis-build"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !prompt.trim()) return;
        setBusy(true);
        setError("");
        try {
          await onRun(prompt.trim(), target, workflow);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="jarvis-eyebrow">FROM CONVERSATION TO CREATION</span>
      <h1>What shall we build?</h1>
      <p>Give your idea to an agent. Follow the work here.</p>
      <div className="jarvis-workflows" role="group" aria-label="Workflow">
        <button
          type="button"
          aria-pressed={workflow === "build"}
          onClick={() => setWorkflow("build")}
        >
          <Hammer size={21} />
          <strong>Build something</strong>
          <span>A new project, a document, a workflow.</span>
        </button>
        <button
          type="button"
          aria-pressed={workflow === "improve-os"}
          onClick={() => setWorkflow("improve-os")}
        >
          <Code2 size={21} />
          <strong>Improve this OS</strong>
          <span>Change this workspace with its own skill.</span>
        </button>
      </div>
      <label htmlFor="jarvis-build-prompt">
        {workflow === "improve-os" ? "What would you like to change?" : "Describe your idea"}
      </label>
      <textarea
        id="jarvis-build-prompt"
        value={prompt}
        maxLength={6000}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          workflow === "improve-os" ? "Add a weekly view to my calendar…" : "Build a dashboard for…"
        }
        required
      />
      <div className="jarvis-builder-choice" role="group" aria-label="Choose your agent">
        {(["codex", "claude", "both"] as const).map((agent) => (
          <button
            type="button"
            key={agent}
            aria-pressed={target === agent}
            onClick={() => setTarget(agent)}
          >
            {agent !== "both" && <AgentMark agent={agent} />}
            {agent === "both" ? "Together" : agent === "codex" ? "Codex" : "Claude"}
          </button>
        ))}
      </div>
      <small>
        {target === "both"
          ? "Codex builds. Claude independently reviews the approach."
          : `${target === "codex" ? "Codex" : "Claude"} runs the task using its connected tools.`}{" "}
        {workflow === "improve-os"
          ? "Works in this OS checkout."
          : "Starts in a separate local task folder."}
      </small>
      {error && <p role="alert">{error}</p>}
      <button className="jarvis-build-submit" disabled={busy || !prompt.trim()}>
        {busy ? "Starting…" : "Start building"}
        {busy ? <ArrowUpRight size={17} /> : <Send size={17} />}
      </button>
    </form>
  );
}
