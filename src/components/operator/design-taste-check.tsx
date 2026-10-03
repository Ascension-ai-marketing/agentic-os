import { useEffect, useState } from "react";
import type { JevDecision } from "@/lib/jev-types";
import { jevFetch } from "@/lib/jev-client";
import { JevProof } from "./jev-proof";

export function DesignTasteCheck({ projectId, version, demo = false }: { projectId: string; version?: number; demo?: boolean }) {
  const [decision, setDecision] = useState<JevDecision | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController(); setDecision(null); setError("");
    void jevFetch(`/__jev/design-check?projectId=${encodeURIComponent(projectId)}`, { signal: ac.signal })
      .then(r => r.json()).then(data => { if (!ac.signal.aborted) setDecision(data.decision); })
      .catch(() => { /* No saved check, the explicit button reports read errors. */ });
    return () => ac.abort();
  }, [projectId, version]);
  async function check() {
    setBusy(true); setError("");
    try { const data = await (await jevFetch("/__jev/design-check", { method: "POST", body: JSON.stringify({ projectId }) })).json(); setDecision(data.decision); }
    catch (e) { setError(e instanceof Error ? e.message : "Design check unavailable"); }
    finally { setBusy(false); }
  }
  const generic = decision?.answers.is_slop, fake = decision?.answers.is_fake, taste = decision?.answers.taste;
  return <section aria-label="Jev design check" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-left">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold text-white/80">{demo ? "Try a fictional Design example" : "Jev design check"}</h4>
      {(!decision || decision.error) && <button onClick={check} disabled={busy} className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{busy ? "Checking..." : "Check with Jev"}</button>}
    </div>
    {decision && !decision.error && <p className="text-xs text-white/75">Generic: {generic?.type === "noul" ? `${Math.round(generic.noul * 100)}%` : "unavailable"} · Unsupported claim signals: {fake?.type === "noul" ? `${Math.round(fake.noul * 100)}%` : "unavailable"} · Taste: {taste?.type === "score" ? `${taste.score.toFixed(1)}/9` : "unavailable"}</p>}
    <p className="text-[10px] leading-relaxed text-white/45">Jev reads up to 450 words and style statistics through OpenRouter. This is a design heuristic; pixels, linked stylesheets and factual claims are not verified. {demo && "The example is fictional. Clicking runs a real Jev check."}</p>
    {decision && <JevProof decision={decision} compact />}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </section>;
}
