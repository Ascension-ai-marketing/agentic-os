// While a live conversation runs on any other page (after "take me to my
// dashboard"), a small pill shows it is still listening, what it is saying,
// and ends it.
import { Link } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { JevLogo } from "./jev-card";
import { stopLive, useLiveVoice } from "./live-voice";
import "./live-pill.css";
import { LiveCardView } from "./live-card";

const WORD: Record<string, string> = { connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
export function LivePill() {
  const live = useLiveVoice();
  if (live.phase === "off") return null;
  return (
    <>
    {live.card && (
      <div className="live-pill-card">
        <LiveCardView card={live.card} />
      </div>
    )}
    <div className="live-pill" data-phase={live.phase} role="status" aria-live="polite">
      <Link to="/chat" search={{ talk: 1 } as never} className="live-pill-main" title="Back to the conversation">
        <span className="live-pill-orb">
          <JevLogo size={22} />
        </span>
        <b>Live · {WORD[live.phase]}</b>
        {live.caption && <span className="live-pill-caption">{live.caption}</span>}
      </Link>
      <button type="button" onClick={stopLive} aria-label="End the conversation">
        <Square size={11} /> End
      </button>
    </div>
    </>
  );
}
