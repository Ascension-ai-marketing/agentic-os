import { useState } from "react";
import { ArrowUp, Mic, Sparkles } from "lucide-react";
import { askOperator } from "@/lib/operator";
export function GradientComposer({
  placeholder,
  context = "",
}: {
  placeholder: string;
  context?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="biz-composer-panel ar-gradient-composer">
      <div className="biz-composer-sky" aria-hidden="true" />
      <div className="biz-composer-stack">
        <div className="ar-composer-intro">
          <Sparkles size={18} />
          <span>A little clarity changes everything.</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) {
              askOperator(draft, context, true);
              setDraft("");
            }
          }}
        >
          <input
            aria-label="Ask about your business"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
          />
          <div>
            <span>Your context. Your conversation.</span>
            <button
              type="button"
              aria-label="Talk about your business"
              onClick={() => {
                askOperator("", context);
                window.dispatchEvent(
                  new CustomEvent("oracle:activate", { detail: { voice: true } }),
                );
              }}
            >
              <Mic size={17} />
            </button>
            <button aria-label="Send business question" disabled={!draft.trim()}>
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
