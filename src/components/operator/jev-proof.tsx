import { JevCard } from "@/components/jev/jev-card";
import type { JevDecision } from "@/lib/jev-types";
export function JevProof({ decision, compact = false }: { decision: JevDecision; compact?: boolean }) {
  return <div className="space-y-1" aria-label="Jev decision details">
    <JevCard decision={decision} compact={compact} />
    {Object.entries(decision.answers).map(([id, a]) => <p className="text-xs text-muted-foreground" key={id}>{id}: {a.type === "noul" ? `${Math.round(a.noul * 100)}% yes` : a.type === "score" ? `${a.score.toFixed(2)} / ${(Array.isArray(a.legend) ? a.legend.length : Object.keys(a.legend ?? a.probabilities).length) - 1}, ${Math.round(a.confidence * 100)}% confidence` : `${a.choice}, ${Math.round(a.confidence * 100)}% confidence`}</p>)}
    {decision.escalated && <p className="text-xs">A small model made the final choice. Jev's original odds are above.</p>}
    {decision.error && <p role="alert" className="text-xs text-red-400">{decision.error}</p>}
    {decision.compare && <p className="text-xs text-muted-foreground">{decision.compare.model}: ${decision.compare.costUsd.toFixed(6)} for the same tokens, {decision.compare.kind}{decision.compare.ms > 0 ? `, about ${decision.compare.ms} ms` : ", time unavailable"}.</p>}
  </div>;
}
