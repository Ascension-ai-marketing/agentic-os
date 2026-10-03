// "Create a free Fish Audio account": the one sign-up link, shown wherever
// voice is set up while there is no FISH_API_KEY (or always, where asked).
import { useEffect } from "react";
import { ArrowUpRight } from "lucide-react";
import { FISH_SIGNUP_URL } from "@/lib/fish";
import { loadVoices, useVoice } from "./voice-store";
import "./fish-signup.css";

export function FishSignup({ always, compact, label }: { always?: boolean; compact?: boolean; label?: string }) {
  const v = useVoice();
  useEffect(() => {
    if (!always && !v.voices.length && v.fishMissing === undefined) void loadVoices();
  }, [always, v.voices.length, v.fishMissing]);
  if (!always && !v.fishMissing) return null;
  return (
    <a className={`fish-signup${compact ? " is-compact" : ""}`} href={FISH_SIGNUP_URL} target="_blank" rel="noopener noreferrer" data-no-talk>
      <span className="fish-signup-dot" aria-hidden="true" />
      <span>
        <b>{label ?? "Create a free Fish Audio account"}</b>
        {!compact && <small>Fish Audio is the voice of your OS. Sign up, copy your API key, add FISH_API_KEY to ~/.config/agentic-os.env.</small>}
      </span>
      <ArrowUpRight size={13} />
    </a>
  );
}
