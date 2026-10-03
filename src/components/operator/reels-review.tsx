import { useCallback, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, Check, Download, Film, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { reelFamilies, type ReelFamily, type ReelProject, type ReelSummary } from "@/lib/jev-reels";
import { defaultReelStyles, type ReelStyle } from "@/lib/reel-styles";
import { ReelVideo, useReelMedia } from "./reels-media";
import { JevProof } from "./jev-proof";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export function ReelHistoryCard({ project, disabled, onOpen }: { project: ReelSummary; disabled: boolean; onOpen: () => void }) {
  const hasVideos = reelFamilies.some(family => project.outputs[family.id]);
  return <button className={`rs-history-card ${hasVideos ? "has-videos" : ""}`} onClick={onOpen} disabled={disabled}>
    <span className="rs-history-screen">
      {hasVideos ? reelFamilies.map(family => <span className="rs-history-frame" key={family.id}><ReelVideo id={project.id} file={project.outputs[family.id]} label={`${project.name}, version ${family.id}`} /></span>) : <span className="rs-history-draft"><Film size={38} /><span>Continue your reel</span></span>}
      <span className="rs-history-open"><ArrowUpRight size={20} /></span>
    </span>
    <span className="rs-history-caption"><span><strong>{project.name}</strong><small>{time(project.duration)} · {project.sectionCount} sections{project.source === "reference" ? " · Example" : ""}</small></span><span>{hasVideos ? "Open reel" : "Continue"}<ArrowUpRight size={15} /></span></span>
  </button>;
}

function DownloadExport({ project }: { project: ReelProject }) {
  const { url } = useReelMedia(project.id, project.selectedOutput);
  return url ? <a className="rs-review-export" href={url} download="my-reel.mp4"><Download size={15} />Download</a> : null;
}

function ReviewStage({ project, sectionId, busy, onPick, onSave }: {
  project: ReelProject; sectionId: string; busy: boolean;
  onPick: (family: ReelFamily) => void; onSave: (style: ReelStyle) => Promise<void>;
}) {
  const videos = useRef<Partial<Record<ReelFamily, HTMLVideoElement>>>({});
  const [playing, setPlaying] = useState(true), [sound, setSound] = useState<ReelFamily | null>(null), [position, setPosition] = useState(0);
  const playbackBlocked = useCallback(() => setPlaying(false), []);
  const styles = project.styles ?? defaultReelStyles(), section = project.sections.find(item => item.id === sectionId);
  const availableSections = project.sections.filter(item => item.clips?.A);
  const duration = section ? section.t1 - section.t0 : availableSections.reduce((sum, item) => sum + item.t1 - item.t0, 0) || project.duration;
  function seek(seconds: number) { setPosition(seconds); Object.values(videos.current).forEach(video => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(seconds, video.duration); }); }
  function togglePlay() { if (!playing) seek(position); setPlaying(!playing); }
  function progress(family: ReelFamily, seconds: number) {
    const active = Object.entries(videos.current).filter(([, video]) => !video.paused);
    if (active[0]?.[0] !== family) return;
    setPosition(seconds);
    // Keep visible variants aligned even if their files finish loading at different times.
    active.slice(1).forEach(([, video]) => { if (video.readyState >= 2 && Math.abs(video.currentTime - seconds) > 0.2) video.currentTime = Math.min(seconds, video.duration); });
  }
  return <>
    <div className="rs-review-stage" aria-label={section ? `Compare ${section.name}` : "Compare full reels"}>
      {reelFamilies.map(family => {
        const file = section ? section.clips?.[family.id] : project.outputs[family.id];
        const picked = section ? project.picks?.[section.id] === family.id : availableSections.length > 0 && availableSections.every(item => project.picks?.[item.id] === family.id);
        return <article key={family.id} className={`rs-review-version ${picked ? "is-picked" : ""}`}>
          <div className="rs-review-film">
            <ReelVideo id={project.id} file={file} label={`${section?.name ?? "Full reel"}, ${styles[family.id].name}`} playing={playing} muted={sound !== family.id} register={video => { if (video) videos.current[family.id] = video; else delete videos.current[family.id]; }} onTime={seconds => progress(family.id, seconds)} onReady={video => { const leader = Object.values(videos.current).find(other => other !== video && !other.paused); if (leader) video.currentTime = Math.min(leader.currentTime, video.duration); }} onBlocked={playbackBlocked} />
            <span className="rs-review-version-label">{family.id}</span>
            <button className="rs-video-sound" aria-label={sound === family.id ? `Mute ${styles[family.id].name}` : `Listen to ${styles[family.id].name}`} aria-pressed={sound === family.id} onClick={() => setSound(sound === family.id ? null : family.id)}>{sound === family.id ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
            <button className="rs-film-select" disabled={busy || !file} onClick={() => onPick(family.id)} aria-label={`Use ${styles[family.id].name}${section ? ` for ${section.name}` : " for all sections"}`} aria-pressed={picked}><span>{picked ? <Check size={15} /> : <span className="rs-selection-ring" />}{styles[family.id].name}</span><span>{picked ? "Selected" : "Use this"}</span></button>
          </div>
          <button className="rs-review-save" aria-label={`Save ${styles[family.id].name} style`} disabled={busy} onClick={() => void onSave(styles[family.id])}><Bookmark size={13} /></button>
        </article>;
      })}
    </div>
    <div className="rs-review-transport"><button onClick={togglePlay} aria-label={playing ? "Pause previews" : "Play previews"}>{playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}</button><input aria-label="Seek previews" type="range" min="0" max={duration} step="0.05" value={Math.min(position, duration)} onChange={event => seek(Number(event.target.value))} /><time>{time(position)} / {time(duration)}</time></div>
  </>;
}

export function ReelReview({ project, busy, running, error, notice, onClose, onUpdate, onSave, onExport }: {
  project: ReelProject; busy: boolean; running: boolean; error: string; notice: string;
  onClose: () => void;
  onUpdate: (data: { picks: Record<string, ReelFamily> }) => Promise<void>;
  onSave: (style: ReelStyle) => Promise<void>; onExport: () => void;
}) {
  const [sectionId, setSectionId] = useState("");
  const section = project.sections.find(item => item.id === sectionId), picks = project.picks ?? {}, selected = Object.keys(picks).length;
  function pick(family: ReelFamily) {
    void onUpdate({ picks: section ? { ...picks, [section.id]: family } : Object.fromEntries(project.sections.filter(item => item.clips?.[family]).map(item => [item.id, family])) });
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="rs-review">
      <DialogDescription className="sr-only">Compare three automatically playing versions, then choose a whole reel or select a style for each section.</DialogDescription>
      <header className="rs-review-heading"><DialogTitle>{project.name}</DialogTitle><span className="rs-review-context">{section ? section.name : `${project.sections.length} sections · ${time(project.duration)}`}</span></header>
      <ReviewStage key={`${project.id}-${sectionId}`} project={project} sectionId={sectionId} busy={busy || running} onPick={pick} onSave={onSave} />
      <nav className="rs-section-strip" aria-label="Reel sections"><button aria-current={!section ? "page" : undefined} onClick={() => setSectionId("")}><Film size={16} /><span>Full reel</span></button>{project.sections.map((item, index) => <button key={item.id} aria-current={sectionId === item.id ? "page" : undefined} onClick={() => setSectionId(item.id)}><span className="rs-strip-index">{String(index + 1).padStart(2, "0")}</span><span>{item.name}<small>{time(item.t0)} · {picks[item.id] ? `Style ${picks[item.id]}` : "Not included"}</small></span></button>)}</nav>
      <footer className="rs-review-footer"><div>{section ? <label><input type="checkbox" checked={!!picks[section.id]} disabled={busy || running || !section.clips?.A} onChange={event => { const next = { ...picks }; if (event.target.checked) next[section.id] = "A"; else delete next[section.id]; void onUpdate({ picks: next }); }} />Include this section</label> : <span>Choose a full reel, or mix styles section by section.</span>}<small>{selected} of {project.sections.length} sections selected</small></div><div className="rs-review-export-actions"><button className="rs-review-export" disabled={busy || running || !selected || project.simulated} title={project.simulated ? "Example reel. Export works on your own reels." : undefined} onClick={onExport}>{running ? <Loader2 size={15} className="rs-spin" /> : <Download size={15} />}{running ? "Exporting" : "Export selection"}</button><DownloadExport project={project} /></div></footer>
      {project.decision && <details className="rs-review-details"><summary>Usage</summary><div><JevProof decision={project.decision} compact />{project.sections.filter(item => item.sfxDecision).map(item => <div key={item.id}><strong>{item.name}</strong><JevProof decision={item.sfxDecision!} compact /></div>)}<p>Opus reported: {project.opusCostUsd === undefined ? "unavailable" : `$${project.opusCostUsd.toFixed(4)}`} · Jev: ${(project.jevCostUsd ?? 0).toFixed(6)}</p></div></details>}
      {(error || notice) && <p role={error ? "alert" : "status"} className={`rs-review-notice ${error ? "is-error" : ""}`}>{error || notice}</p>}
    </DialogContent>
  </Dialog>;
}
