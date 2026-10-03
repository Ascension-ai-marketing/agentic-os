import { Bookmark, ChevronDown, Scissors, Volume2, AudioLines } from "lucide-react";
import type { ReelStyle } from "@/lib/reel-styles";
import { Toggle } from "@/components/ui/liquid-toggle";

export function ReelPlatformMark({ platform }: { platform: "instagram" | "tiktok" | "youtubeshorts" }) {
  return <span className={`rs-platform-mark rs-platform-${platform}`} aria-hidden="true"><img src={`/reels/${platform}.svg`} alt="" /></span>;
}
export function ReelStylePrompt({ value, saved, disabled, onChange, onSave }: { value: string; saved: ReelStyle[]; disabled: boolean; onChange: (text: string) => void; onSave: (style: ReelStyle) => Promise<void> }) {
  function save() {
    const brief = value.trim();
    if (!brief) return;
    const name = brief.split(/[.\n]/)[0].trim().slice(0, 48);
    void onSave({ id: "prompt-style", name: name || "My style", brief, colors: ["#20212a", "#f6f5f3", "#b6b5c1"] });
  }
  return <div className="rs-prompt-panel">
    <div className="rs-prompt-heading"><label htmlFor="reel-style-prompt">Style prompt</label><div className="rs-saved-select"><Bookmark size={13} /><select aria-label="Saved styles" value="" disabled={disabled || !saved.length} onChange={e => { const style = saved.find(s => s.id === e.target.value); if (style) onChange(style.brief); }}><option value="">Saved styles{saved.length ? ` (${saved.length})` : ""}</option>{saved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><ChevronDown size={12} /></div></div>
    <textarea id="reel-style-prompt" value={value} disabled={disabled} maxLength={1200} onChange={e => onChange(e.target.value)} placeholder="Describe a look. Try paper textures, bold type and a warm orange accent." />
    <div className="rs-prompt-footer"><button className="rs-button" onClick={save} disabled={disabled || !value.trim()}><Bookmark size={13} />Save style</button></div>
  </div>;
}
function ProcessingGraphic({ kind }: { kind: "audio" | "cuts" | "effects" }) {
  return <span className={`rs-processing-art rs-art-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 92 52" fill="none">
      {kind === "audio" ? <>{[9, 16, 25, 36, 28, 43, 32, 20, 11].map((h, i) => <rect key={i} x={10 + i * 8} y={(52 - h) / 2} width="4" height={h} rx="2" fill="currentColor" opacity={i < 4 ? 0.3 + i * .15 : 1 - (i - 4) * .12} />)}<path d="M8 26H85" stroke="currentColor" strokeOpacity=".12" /></> : kind === "cuts" ? <><rect x="5" y="13" width="32" height="25" rx="5" fill="currentColor" opacity=".14" /><rect x="54" y="13" width="32" height="25" rx="5" fill="currentColor" opacity=".45" /><path d="M45 7V44" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />{[13, 20, 27, 62, 69, 76].map((x, i) => <path key={x} d={`M${x} ${20 - i % 2 * 3}V${31 + i % 2 * 3}`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />)}</> : <><circle cx="46" cy="26" r="20" stroke="currentColor" strokeOpacity=".12" /><circle cx="46" cy="26" r="13" stroke="currentColor" strokeOpacity=".22" /><path d="M8 26H27L34 17L40 34L47 9L55 42L62 22L67 26H85" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
    {kind === "audio" ? <AudioLines size={12} /> : kind === "cuts" ? <Scissors size={12} /> : <Volume2 size={12} />}
  </span>;
}
export function ReelProcessingOption({ kind, label, description, checked, disabled, onChange }: { kind: "audio" | "cuts" | "effects"; label: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className={`rs-processing-option ${checked ? "is-on" : ""}`}><ProcessingGraphic kind={kind} /><span><strong>{label}</strong><small>{description}</small></span><Toggle aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} /></label>;
}
