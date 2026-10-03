import { useEffect, useRef, useState } from "react";
import { FishSignup } from "@/components/jev/fish-signup";
import { ArrowLeft, FolderOpen, Loader2, Plus, Upload } from "lucide-react";
import { jevFetch } from "@/lib/jev-client";
import { reelFamilies, reelIsBusy, type ReelProject, type ReelFamily, type ReelSummary, type ReelQuote } from "@/lib/jev-reels";
import { type ReelStyle } from "@/lib/reel-styles";
import { ReelPlatformMark, ReelStylePrompt, ReelProcessingOption } from "./reels-setup";
import { ReelHistoryCard, ReelReview } from "./reels-review";
import { JevProof } from "./jev-proof";
import { ReelShowcase } from "./reels-showcase";
import "./reels-studio.css";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const stateLabel = (state: ReelProject["state"]) => ({ uploaded: "Uploaded", ready: "Sections ready", done: "Ready", error: "Needs attention", "processing-audio": "Preparing video", transcribing: "Transcribing", planning: "Finding sections", graphics: "Building styles", sound: "Choosing effects", rendering: "Rendering", exporting: "Exporting" })[state];
export function ReelsStudio({ active }: { active: boolean }) {
  // Reels opens on the finished example as one long scroll page. Upload and
  // your saved reels stay one click away.
  const [view, setView] = useState<"showcase" | "editor" | "library">("showcase");
  const [showcase, setShowcase] = useState<ReelProject | null>(null);
  const [projects, setProjects] = useState<ReelSummary[]>([]), [project, setProject] = useState<ReelProject | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<ReelQuote | null>(null), [budget, setBudget] = useState(0);
  const [cleanup, setCleanup] = useState(false), [autoCut, setAutoCut] = useState(false), [sfx, setSfx] = useState(false), [layout, setLayout] = useState<"full" | "top">("full");
  const [saved, setSaved] = useState<ReelStyle[]>([]), [stylePrompt, setStylePrompt] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null), revision = useRef(0);
  const running = reelIsBusy(project), hasSections = !!project?.sections.length;
  const built = project?.state === "done" || project?.state === "exporting" || (project?.state === "error" && reelFamilies.every(f => project.outputs[f.id]));
  const selected = project?.selectedSectionIds ?? project?.sections.map(s => s.id) ?? [];
  const config = () => ({ stylePrompt, styleMode: "selected", autoCut, audioProcessing: cleanup ? "local" : "none", layout, includeSfx: sfx });
  async function list() {
    try {
      const all: ReelSummary[] = await (await jevFetch("/__reels/projects")).json(); setProjects(all);
      if (!showcase && all.some(p => p.id === "demo")) { const d: ReelProject = await (await jevFetch("/__reels/status?id=demo")).json(); setShowcase(d); }
      else if (!showcase) setView(v => (v === "showcase" ? "editor" : v));
    } catch { setError("Previous reels could not be loaded."); setView(v => (v === "showcase" ? "editor" : v)); } finally { setLoading(false); }
  }
  async function estimate(p: ReelProject) { if (p.state === "done" || p.simulated || (p.state === "error" && reelFamilies.every(f => p.outputs[f.id]))) { setQuote(null); return; } const q = await (await jevFetch(`/__reels/estimate?id=${p.id}`)).json(); setQuote(q); setBudget(q.opusBudgetUsd); }
  async function open(id: string) {
    setBusy(true); setError(""); setNotice(""); const attempt = ++revision.current;
    try { const p: ReelProject = await (await jevFetch(`/__reels/status?id=${id}`)).json(); if (attempt !== revision.current) return;
      if (p.simulated) { setShowcase(p); setView("showcase"); window.scrollTo({ top: 0 }); return; }
      setProject(p); setCleanup(p.audioProcessing === "local"); setAutoCut(!!p.autoCut); setSfx(!!p.includeSfx); setLayout(p.layout); setStylePrompt(p.stylePrompt ?? p.styles?.A.brief ?? ""); setView("editor"); await estimate(p); }
    catch (e) { setError(e instanceof Error ? e.message : "Reel unavailable"); } finally { setBusy(false); }
  }
  useEffect(() => { if (active) { void list(); void jevFetch("/__reels/styles").then(r => r.json()).then(setSaved).catch(() => {}); } }, [active, view]);
  useEffect(() => {
    if (!project || !running) return;
    const ac = new AbortController(), id = project.id;
    const timer = setInterval(() => { void jevFetch(`/__reels/status?id=${id}`, { signal: ac.signal }).then(r => r.json()).then(p => { if (ac.signal.aborted) return; setProject(p); if (!reelIsBusy(p)) { void estimate(p); void list(); } }).catch(() => {}); }, 1500);
    return () => { ac.abort(); clearInterval(timer); };
  }, [project?.id, running]);
  async function upload(file?: File) {
    if (!file || busy) return;
    if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 250 * 1024 * 1024) { setError("Choose an MP4 or MOV under 250 MB."); return; }
    setBusy(true); setError(""); setNotice(""); const attempt = ++revision.current;
    try { const p = await (await jevFetch(`/__reels/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "video/mp4" }, body: file })).json(); if (attempt !== revision.current) return;
      const configured = await (await jevFetch("/__reels/project", { method: "PATCH", body: JSON.stringify({ id: p.id, ...config() }) })).json(); setProject(configured); setView("editor"); await estimate(configured); void list(); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function action(step: "prepare" | "build" | "export") {
    if (!project) return; setBusy(true); setError(""); setNotice("");
    try { if (step !== "export") await jevFetch("/__reels/project", { method: "PATCH", body: JSON.stringify({ id: project.id, ...config() }) });
      const p = await (await jevFetch(`/__reels/${step}`, { method: "POST", body: JSON.stringify({ id: project.id, confirmed: true, opusBudgetUsd: budget, ...config() }) })).json(); setProject(p); void list(); }
    catch (e) { setError(e instanceof Error ? e.message : "This step could not start"); } finally { setBusy(false); }
  }
  async function update(data: { selectedSectionIds?: string[]; picks?: Record<string, ReelFamily>; ideas?: Record<string, string> }) {
    if (!project || busy || running) return; setBusy(true); setError("");
    try { const p = await (await jevFetch("/__reels/project", { method: "PATCH", body: JSON.stringify({ id: project.id, ...data }) })).json(); setProject(p); if (data.selectedSectionIds) await estimate(p); }
    catch (e) { setError(e instanceof Error ? e.message : "Selection could not be saved"); } finally { setBusy(false); }
  }
  async function saveStyle(style: ReelStyle) { setBusy(true); setError(""); try { const result = await (await jevFetch("/__reels/styles", { method: "POST", body: JSON.stringify(style) })).json(); setSaved(old => [result, ...old.filter(s => s.id !== result.id)]); setNotice(`${result.name} saved to your styles.`); } catch (e) { setError(e instanceof Error ? e.message : "Style could not be saved"); } finally { setBusy(false); } }
  function newReel() { revision.current++; setProject(null); setQuote(null); setLayout("full"); setStylePrompt(""); setCleanup(false); setAutoCut(false); setSfx(false); setError(""); setNotice(""); setView("editor"); }
  const promptPanel = <ReelStylePrompt value={stylePrompt} saved={saved} disabled={busy || running} onChange={setStylePrompt} onSave={saveStyle} />;
  const options = <div className="rs-processing-options">
    {!hasSections && <><ReelProcessingOption kind="audio" label="Clean up audio" description="Less noise. Clearer speech." checked={cleanup} disabled={running || busy} onChange={setCleanup} /><ReelProcessingOption kind="cuts" label="Cut pauses" description="Trim the gaps between words." checked={autoCut} disabled={running || busy} onChange={setAutoCut} /></>}
    <ReelProcessingOption kind="effects" label="Sound effects" description="Add a little emphasis." checked={sfx} disabled={running || busy} onChange={setSfx} />
    <FishSignup compact label="Sound effects use Fish Audio: create a free account" />
  </div>;
  if (view === "showcase") {
    return showcase ? <ReelShowcase project={showcase} savedCount={projects.filter(p => p.id !== "demo").length} onNew={newReel} onLibrary={() => setView("library")} />
      : <div className="rsx-loading" role="status"><Loader2 size={18} className="rs-spin" /> Opening your reels</div>;
  }
  return <section className="reels-app" aria-label="Reels workspace">
    <header className="rs-header"><div><h2><ReelPlatformMark platform="instagram" />Reels</h2><p>Upload a video and create three styled reels.</p></div><nav aria-label="Reels views"><button aria-current={view === "editor" ? "page" : undefined} onClick={newReel}><Plus size={15} /> New reel</button><button aria-current={view === "library" ? "page" : undefined} onClick={() => setView("library")}><FolderOpen size={15} /> Previous reels <span>{projects.length}</span></button></nav></header>
    <input ref={input} hidden type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={e => void upload(e.target.files?.[0])} />
    {error && <p role="alert" className="rs-error">{error}</p>}{notice && <p role="status" className="rs-notice">{notice}</p>}
    {view === "library" ? <div className="rs-library"><div className="rs-section-title"><h3>Previous reels</h3><span>{projects.length} saved</span></div>{loading ? <p className="rs-empty">Loading reels...</p> : projects.length ? <div className="rs-history-gallery">{projects.map(p => <ReelHistoryCard key={p.id} project={p} disabled={busy} onOpen={() => void open(p.id)} />)}</div> : <div className="rs-empty"><FolderOpen size={28} /><h3>No reels yet</h3><p>Your videos and finished reels will appear here.</p><button className="rs-button" onClick={newReel}>Create a reel</button></div>}</div> : built && project ? <ReelReview key={project.id} project={project} busy={busy} running={running} error={error} notice={notice} onClose={() => { setProject(null); setView("library"); }} onUpdate={update} onSave={saveStyle} onExport={() => void action("export")} /> : <>
      {!project ? <><div className="rs-create-grid"><div className="rs-upload-panel"><button className={`rs-dropzone ${dragging ? "is-dragging" : ""}`} disabled={busy} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]); }}><img className="rs-upload-art" src="/reels/upload-sculpture.png" alt="" draggable={false} /><strong>{busy ? "Uploading video" : dragging ? "Drop it here" : "Drop your video here"}</strong><span className="rs-upload-cta">{busy ? <Loader2 className="rs-spin" size={14} /> : <Upload size={14} />}{busy ? "Uploading" : "Choose a video"}</span><small>MP4 or MOV · up to 2 minutes · 250 MB</small></button></div><div className="rs-side-card">{promptPanel}{options}</div></div></> : <>
        <div className="rs-project-bar"><div><button aria-label="Back to new reel" onClick={newReel}><ArrowLeft size={16} /></button><strong>{project.name}</strong><span>{time(project.duration)}{project.source === "reference" ? " · Example" : ""}</span></div><span className={`rs-status rs-status-${project.state}`}>{stateLabel(project.state)}</span></div>
        {!built && <div className="rs-side-card rs-project-style">{!running && promptPanel}{options}</div>}
        {running && <div className="rs-progress" role="status"><Loader2 size={16} className="rs-spin" /><span>{project.progress || stateLabel(project.state)}</span><small>Saved in Previous reels.</small></div>}
        {project.error && <p role="alert" className="rs-error">{project.error}</p>}
        {hasSections && <><div className="rs-section-title rs-sections-heading"><div><h3>Choose your sections</h3><p>{selected.length} of {project.sections.length} selected</p></div></div><div className="rs-sections">{project.sections.map((s, i) => <article key={s.id} className={`rs-section-card ${selected.includes(s.id) ? "is-included" : ""}`}><div className="rs-section-row"><label className="rs-section-select"><input type="checkbox" checked={selected.includes(s.id)} disabled={running || busy} aria-label={`Include section ${i + 1}`} onChange={e => void update({ selectedSectionIds: e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id) })} /><span>{String(i + 1).padStart(2, "0")}</span></label><div className="rs-section-text"><strong>{s.name}</strong><p>{s.words}</p></div><time>{time(s.t0)} – {time(s.t1)}</time></div><details className="rs-idea"><summary>Picture idea</summary><textarea aria-label={`Picture idea for section ${i + 1}`} defaultValue={s.image} disabled={running || busy} onBlur={e => { if (e.target.value.trim() && e.target.value !== s.image) void update({ ideas: { [s.id]: e.target.value } }); }} /></details></article>)}</div></>}
        {project.decision && <details className="rs-details"><summary>Jev decisions and usage</summary><JevProof decision={project.decision} compact />{project.sections.filter(s => s.sfxDecision).map(s => <div key={s.id}><strong>{s.name}</strong><JevProof decision={s.sfxDecision!} compact /></div>)}<p>Opus reported: {project.opusCostUsd === undefined ? "unavailable" : `$${project.opusCostUsd.toFixed(4)}`} · Jev: ${(project.jevCostUsd ?? 0).toFixed(6)}</p></details>}
        <footer className="rs-action-bar"><div>{quote && <><strong>Estimated ${quote.estimatedTotalUsd.toFixed(3)} for this step</strong><details><summary>Cost and data</summary><p>API-equivalent estimate. Claude Code account usage may differ. Transcription and audio cleanup stay local. The transcript and picture ideas go to Claude; section text goes to Jev through OpenRouter.</p><label>Opus cap ($)<input type="number" min={quote.opusUsd} max={20} step="0.05" value={budget} disabled={running} onChange={e => setBudget(Number(e.target.value))} /></label></details></>}</div><button className="rs-button rs-primary" disabled={busy || running || !quote || (hasSections && !selected.length)} onClick={() => void action(hasSections ? "build" : "prepare")}>{running ? "Working..." : hasSections ? "Build three styles" : "Prepare sections"}</button></footer>
      </>}
    </>}
  </section>;
}
