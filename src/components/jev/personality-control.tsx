// Jarvis's personality: a humour level and "How Jarvis talks". Saved, and
// applied to the running conversation straight away.
import { useEffect, useState } from "react";
import { DEFAULT_PERSONA, loadPersonality, PERSONALITY_EVENT, type Personality } from "@/lib/jev-personality";
import { HumourDial } from "./voice-dials";
import { applyPersonality } from "./live-voice";

export function PersonalityControl() {
  const [p, setP] = useState<Personality>(() => loadPersonality());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.prompt);
  const update = (next: Personality) => {
    setP(next);
    applyPersonality(next);
  };
  // A change asked for by voice (or in another tab) moves the control here too.
  useEffect(() => {
    const onChange = (e: Event) => setP((e as CustomEvent<Personality>).detail);
    window.addEventListener(PERSONALITY_EVENT, onChange);
    return () => window.removeEventListener(PERSONALITY_EVENT, onChange);
  }, []);
  return (
    <div className="cv-personality">
      <HumourDial value={p.humour} onChange={(humour) => update({ ...p, humour })} />
      <button type="button" className="cv-persona-toggle" aria-expanded={editing} onClick={() => { setDraft(p.prompt); setEditing(!editing); }}>
        How Jarvis talks
      </button>
      {editing && (
        <div className="cv-persona">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxLength={1500} aria-label="How Jarvis talks" />
          <div>
            <button type="button" className="is-primary" onClick={() => { update({ ...p, prompt: draft }); setEditing(false); }}>Save</button>
            <button type="button" onClick={() => setDraft(DEFAULT_PERSONA)}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
