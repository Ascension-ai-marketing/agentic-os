import { lazy, Suspense, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronRight, Moon, Play } from "lucide-react";
import { useLiveData } from "@/lib/use-live-data";
import { askOperator } from "@/lib/operator";
import { Modal } from "@/components/operator/ui";
import type { ReplayPrescription } from "@/components/dream-replay";
import "./workspace-overview.css";
const DreamReplay = lazy(() => import("@/components/dream-replay"));
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
type DreamFinding = ReplayPrescription & { prescription?: string; status?: string };
export function DreamReviewActions() {
  const ld = useLiveData();
  const [dreamOpen, setDreamOpen] = useState(false),
    [replayOpen, setReplayOpen] = useState(false),
    [findingIndex, setFindingIndex] = useState(0);
  const findings: DreamFinding[] =
    ld?.isExample !== true && Array.isArray(ld?.dream?.prescriptions)
      ? ld.dream.prescriptions.filter(
          (item: any) =>
            item &&
            typeof item.headline === "string" &&
            !["accepted", "dismissed"].includes(item.status),
        )
      : [];
  const finding = findings[findingIndex] ?? findings[0];
  const dreamDate = typeof ld?.dream?.date === "string" ? ld.dream.date : null;
  const dreamStamp =
    dreamDate && !Number.isNaN(Date.parse(dreamDate))
      ? new Date(dreamDate + "T12:00:00").toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })
      : "No saved review";
  const counters = [
    { label: "Messages · 7 days", value: number(ld?.summary?.messagesLast7d) },
    { label: "Memory files", value: number(ld?.memory?.stats?.totalFiles) },
    { label: "Hermes sessions", value: number(ld?.hermes?.sessionCount) },
  ].filter((row) => row.value > 0);
  return (
    <>
      <div className="biz-dream-secondary-actions">
        <span>
          <Moon size={13} />
          Dream · {dreamStamp}
        </span>
        {findings.length ? (
          <>
            <button type="button" onClick={() => setDreamOpen(true)}>
              Read Dream review
              <ChevronRight size={12} />
            </button>
            <button type="button" onClick={() => setReplayOpen(true)}>
              <Play size={11} />
              Watch replay
            </button>
          </>
        ) : (
          <Link to="/dashboard">
            Set up Dream
            <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
      <Modal
        open={dreamOpen}
        onClose={() => setDreamOpen(false)}
        title="Dream review"
        description={`Saved ${dreamStamp}. Review the evidence before deciding what to act on.`}
      >
        <div className="biz-dream-reader">
          <div className="biz-dream-findings">
            {findings.map((item, index) => (
              <button
                key={item.id ?? index}
                type="button"
                aria-pressed={finding === item}
                onClick={() => setFindingIndex(index)}
              >
                <small>{item.cat || "Finding"}</small>
                <span>{item.headline}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {finding && (
            <article>
              <h3>{finding.headline}</h3>
              <p>{finding.prescription}</p>
              {Array.isArray(finding.evidence) && (
                <details>
                  <summary>View evidence</summary>
                  <ul>
                    {finding.evidence.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                className="op-button"
                type="button"
                onClick={() => {
                  setDreamOpen(false);
                  askOperator(
                    "Help me assess this saved Dream finding. Check its evidence and whether it still applies before proposing next steps.",
                    JSON.stringify({
                      savedAt: dreamDate,
                      headline: finding.headline,
                      analysis: finding.prescription,
                      evidence: finding.evidence,
                    }),
                    true,
                    undefined,
                    "business",
                  );
                }}
              >
                Discuss this finding <ArrowUpRight size={13} />
              </button>
            </article>
          )}
        </div>
      </Modal>
      {replayOpen && (
        <Suspense
          fallback={
            <div className="biz-replay-loading" role="status">
              Opening Dream replay…{" "}
              <button type="button" onClick={() => setReplayOpen(false)}>
                Cancel
              </button>
            </div>
          }
        >
          <DreamReplay
            onClose={() => setReplayOpen(false)}
            date={dreamDate}
            engineName={String(ld?.dream?.model || "Saved review")}
            prescriptions={findings.map((item) => ({
              ...item,
              cat: item.cat || "Finding",
              tone: ["pink", "orange", "blue", "yellow"].includes(item.tone) ? item.tone : "blue",
              evidence: Array.isArray(item.evidence) ? item.evidence : [],
              dollarImpact: null,
              timeImpactMins: null,
            }))}
            stats={{
              counters,
              candidates: Math.max(number(ld?.dream?.metadata?.totalCandidates), findings.length),
            }}
            sources={[
              {
                name: "Sessions",
                color: "#e8b789",
                live: number(ld?.summary?.totalAssistantMessages) > 0,
              },
              { name: "Memory", color: "#cbb0ed", live: number(ld?.memory?.stats?.totalFiles) > 0 },
              { name: "Skills", color: "#91bfc7", live: (ld?.skills?.active?.length ?? 0) > 0 },
              { name: "Hermes", color: "#e7cb7b", live: Boolean(ld?.hermes?.installed) },
            ]}
          />
        </Suspense>
      )}
    </>
  );
}
