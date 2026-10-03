import { useBusinessDemo } from "@/lib/business-demo";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Download, MessageCircle, Plus, Upload, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  audienceSeries, audienceChartDomain, parseAudienceCsv, snapshotDate, useBusinessWorkspace,
  type AudienceMetric, type AudiencePlatform, type SnapshotInput,
} from "@/lib/business-workspace";
import "./audience.css";
import { AudienceContent } from "./audience-content";
import { askOperator } from "@/lib/operator";

export const AUDIENCE_PLATFORMS: Array<{
  id: AudiencePlatform; name: string; primary: AudienceMetric; label: string; color: string;
}> = [
  { id: "youtube", name: "YouTube", primary: "followers", label: "Subscribers", color: "#e89099" },
  { id: "instagram", name: "Instagram", primary: "followers", label: "Followers", color: "#d4a4cb" },
  { id: "tiktok", name: "TikTok", primary: "followers", label: "Followers", color: "#8acac5" },
  { id: "linkedin", name: "LinkedIn", primary: "followers", label: "Followers", color: "#9eb8ed" },
];
const METRIC_LABELS: Record<AudienceMetric, string> = {
  followers: "Followers", views: "Total views", likes: "Total likes", posts: "Total posts", videos: "Total videos",
};
const fullNumber = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const shortNumber = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const shortDate = (value: string | number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = (value: string | number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export { AudienceLogo } from "./audience-logo";
import { AudienceLogo } from "./audience-logo";

export function AudiencePanel({ initialPlatform = "youtube" }: { initialPlatform?: AudiencePlatform } = {}) {
  const workspace = useBusinessWorkspace();
  const demo = useBusinessDemo();
  const [platform, setPlatform] = useState<AudiencePlatform>(initialPlatform);
  const [metric, setMetric] = useState<AudienceMetric>("followers");
  const [range, setRange] = useState("90");
  const [entry, setEntry] = useState<"record" | "import" | null>(null);
  const [status, setStatus] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (workspace.isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const linked = AUDIENCE_PLATFORMS.find((item) => item.id === params.get("platform"));
    if (linked) { setPlatform(linked.id); setMetric(linked.primary); }
    if (params.get("record") === "1") {
      setEntry("record");
      const timer = window.setTimeout(() => formRef.current?.scrollIntoView({ block: "center" }), 150);
      return () => window.clearTimeout(timer);
    }
  }, [workspace.isLoading]);
  const snapshots = workspace.data?.snapshots || [];
  const selected = AUDIENCE_PLATFORMS.find((item) => item.id === platform)!;
  const since = range === "all" ? -Infinity : Date.now() - Number(range) * 86_400_000;
  const series = audienceSeries(snapshots, platform, metric, since);
  const chartDomain = audienceChartDomain(series.map((point) => point.value), platform, metric);
  const allSeries = audienceSeries(snapshots, platform, metric);
  const latest = allSeries.at(-1);
  const change = series.length > 1 ? series.at(-1)!.value - series[0].value : null;
  const percent = change !== null && series[0].value > 0 ? (change / series[0].value) * 100 : null;
  const metricLabel = metric === "followers" ? selected.label : METRIC_LABELS[metric];
  const availableMetrics: AudienceMetric[] = platform === "youtube" ? ["followers", "views", "videos", "likes"] : ["followers", "views", "likes", "posts"];
  const observationCount = snapshots.filter((point) => point.platform === platform).length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agentic:audience-selection", { detail: { platform } }));
  }, [platform, metric]);

  function selectPlatform(id: AudiencePlatform) {
    setPlatform(id);
    setMetric(AUDIENCE_PLATFORMS.find((item) => item.id === id)!.primary);
  }
  function openEntry(kind: "record" | "import") {
    setEntry(kind);
    setStatus("");
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }), 50);
  }
  async function save(points: SnapshotInput[]) {
    await workspace.saveSnapshots(points);
    selectPlatform(points[0].platform);
    setRange("all");
    setStatus(`${points.length === 1 ? "Observation" : `${points.length} observations`} saved.`);
    setEntry(null);
  }

  if (workspace.isLoading) return <section className="audience-loading" aria-busy="true">Loading your audience…</section>;
  if (workspace.error) return <section className="audience-error" role="alert"><p>Your audience data couldn’t be loaded.</p><button type="button" onClick={() => void workspace.refresh()}>Try again</button></section>;
  return <section className="audience-panel" aria-label="Audience analytics">
    <div className="audience-heading">
      <div><p className="audience-eyebrow">YOUR REACH, CONNECTED</p><h2>Your audience.</h2><p>{demo.enabled ? "Demo audience · fictional numbers for your walkthrough." : "Your connected accounts and latest published work."}</p></div>
      <div className="audience-heading-actions"><button className="audience-action" type="button" onClick={() => askOperator("What stands out across my social accounts?", JSON.stringify({ audienceObservations: snapshots, instruction: demo.enabled ? "These are fictional demo observations. Discuss the example only; never present them as real account metrics." : "Use actual dated observations only. Identify missing platforms and dates." }), false, undefined, "business")}><MessageCircle size={15} /> Ask about my audience</button><button className="audience-action" type="button" onClick={() => openEntry("record")}><Plus size={15} /> Record numbers</button></div>
    </div>
    <div className="audience-platforms" aria-label="Choose a platform">
      {AUDIENCE_PLATFORMS.map((item) => {
        const points = audienceSeries(snapshots, item.id, item.primary);
        const point = points.at(-1);
        return <button key={item.id} type="button" className={`audience-platform${platform === item.id ? " is-selected" : ""}`} style={{ "--audience-tone": item.color } as CSSProperties} aria-pressed={platform === item.id} aria-label={`${item.name} ${item.label}: ${point ? fullNumber(point.value) : "not recorded"}`} onClick={() => selectPlatform(item.id)}>
          <span className="audience-platform-top"><AudienceLogo platform={item.id} /><span>{item.name}</span><ArrowUpRight className="audience-platform-arrow" size={15} /></span>
          <strong>{point ? shortNumber(point.value) : "—"}</strong>
          <span className="audience-platform-label">{item.label}</span>
          <span className="audience-platform-foot">{point ? `As of ${shortDate(point.date)}` : "Not connected"}</span>
        </button>;
      })}
    </div>

    {!demo.enabled && <AudienceContent platform={platform} onRecord={() => openEntry("record")} onImport={() => openEntry("import")} />}

    {allSeries.length > 0 ? <details className="audience-history audience-history-fold" style={{ "--audience-tone": selected.color } as CSSProperties}>
      <summary><span>{selected.name} history</span><span>{fullNumber(latest!.value)} {metricLabel.toLowerCase()} <ChevronDown size={14} /></span></summary>
      <div className="audience-history-heading">
        <p className="audience-field-help">Saved observations · {latest?.snapshot.sourceLabel || "Recorded total"}</p>
        <div className="audience-history-controls">
          <label className="audience-select"><span className="sr-only">Audience metric</span><select aria-label="Audience metric" value={metric} onChange={e => setMetric(e.target.value as AudienceMetric)}>{availableMetrics.map(key => <option key={key} value={key}>{key === "followers" ? selected.label : METRIC_LABELS[key]}</option>)}</select><ChevronDown size={13} /></label>
          <div className="audience-ranges" aria-label="History date range">{[["30", "30D"], ["90", "90D"], ["365", "1Y"], ["all", "All"]].map(([value, label]) => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}</div>
        </div>
      </div>
      {change !== null && <p className="audience-field-help">{change > 0 ? "+" : ""}{fullNumber(change)}{percent !== null ? ` (${percent > 0 ? "+" : ""}${percent.toFixed(1)}%)` : ""} · {shortDate(series[0].date)} – {shortDate(series.at(-1)!.date)}</p>}
      {series.length > 0 ? <div className="audience-chart" role="img" aria-label={`${selected.name} ${metricLabel.toLowerCase()}, ${series.length} observations from ${longDate(series[0].date)} to ${longDate(series.at(-1)!.date)}. Latest ${fullNumber(series.at(-1)!.value)}. Chart range ${fullNumber(chartDomain[0])} to ${fullNumber(chartDomain[1])}.`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 15, right: 20, bottom: 10, left: 4 }}><CartesianGrid vertical={false} stroke="var(--op-border)" strokeDasharray="3 5" /><XAxis dataKey="date" type="number" domain={series.length === 1 ? [series[0].date - 86_400_000, series[0].date + 86_400_000] : ["dataMin", "dataMax"]} scale="time" tickFormatter={shortDate} tick={{ fontSize: 10, fill: "var(--op-muted)" }} tickLine={false} axisLine={false} minTickGap={44} /><YAxis domain={chartDomain} tickFormatter={shortNumber} tick={{ fontSize: 10, fill: "var(--op-muted)" }} tickLine={false} axisLine={false} width={54} allowDecimals={false} /><Tooltip labelFormatter={(value) => longDate(Number(value))} formatter={(value: number) => [fullNumber(value), metricLabel]} contentStyle={{ background: "var(--op-panel)", border: "1px solid var(--op-border)", borderRadius: 12, color: "var(--op-ink)", fontSize: 12 }} itemStyle={{ color: "var(--op-ink)" }} /><Line type="linear" dataKey="value" stroke={selected.color} strokeWidth={2.5} dot={{ r: series.length > 60 ? 2 : 4, strokeWidth: 2, fill: "var(--op-panel)" }} activeDot={{ r: 6 }} isAnimationActive={false} /></LineChart></ResponsiveContainer>
      </div> : <p>No observations in this range. <button type="button" onClick={() => setRange("all")}>Show all history</button></p>}
      <div className="audience-chart-caption"><span>{series.length === 1 ? "One saved observation. Growth needs another comparable reading." : "Lines connect saved observations."}</span><button type="button" onClick={() => openEntry("import")}><Upload size={13} /> Import history</button></div>
      <details className="audience-observations"><summary>Source records <ChevronDown size={14} /></summary><div className="audience-table-wrap"><table><thead><tr><th>Date</th><th>{metricLabel}</th><th>Source</th></tr></thead><tbody>{[...series].reverse().map(point => <tr key={`${point.date}-${point.snapshot.id}`}><td>{longDate(point.date)}</td><td>{fullNumber(point.value)}</td><td>{point.snapshot.sourceLabel || "Recorded manually"}</td></tr>)}</tbody></table></div></details>
    </details> : <div className="audience-connection-note"><AudienceLogo platform={platform} /><span>No verified {selected.name} numbers yet.</span><a href="/setup">Add your profile <ArrowUpRight size={13} /></a><button type="button" onClick={() => openEntry("record")}>Record numbers</button></div>}

    <div ref={formRef} className="audience-entry-anchor">
      {status && <p className="audience-saved" role="status"><Check size={15} />{status}</p>}
      {entry ? <section className="audience-entry"><div className="audience-entry-heading"><div><p className="audience-eyebrow">BUILD YOUR HISTORY</p><h3>{entry === "record" ? "A moment in your growth." : "Bring the history with you."}</h3></div><button type="button" className="audience-icon-button" aria-label="Close numbers form" onClick={() => setEntry(null)}><X size={18} /></button></div>{entry === "record" ? <RecordForm key={platform} platform={platform} onSave={save} onImport={() => setEntry("import")} /> : <ImportForm onSave={save} onRecord={() => setEntry("record")} />}</section>
        : null}
    </div>
  </section>;
}

function RecordForm({ platform: initial, onSave, onImport }: { platform: AudiencePlatform; onSave: (points: SnapshotInput[]) => Promise<void>; onImport: () => void }) {
  const [platform, setPlatform] = useState(initial);
  const [date, setDate] = useState(localToday);
  const [values, setValues] = useState<Partial<Record<AudienceMetric, string>>>({});
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = AUDIENCE_PLATFORMS.find((item) => item.id === platform)!;
  const fields: AudienceMetric[] = platform === "youtube" ? ["followers", "views", "videos"] : ["followers", "views", "posts"];
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const recordedAt = snapshotDate(date);
      const metrics: Partial<Record<AudienceMetric, number>> = {};
      for (const key of fields) {
        const raw = values[key]?.trim();
        if (!raw) continue;
        const value = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) throw new Error("Enter whole numbers, or leave a field blank.");
        metrics[key] = value;
      }
      if (!Object.keys(metrics).length) throw new Error("Enter at least one number to record.");
      setBusy(true);
      await onSave([{ platform, recordedAt, metrics, origin: "manual", sourceLabel: source.trim() || "Manually recorded" }]);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  return <form onSubmit={submit} className="audience-record-form">
    <div className="audience-form-grid"><label>Platform<select value={platform} disabled={busy} onChange={(event) => { setPlatform(event.target.value as AudiencePlatform); setValues({}); }}>{AUDIENCE_PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Recorded date<input type="date" value={date} required disabled={busy} onChange={(event) => setDate(event.target.value)} /></label></div>
    <div className="audience-form-grid audience-metric-fields">{fields.map((key) => <label key={key}>{key === "followers" ? selected.label : METRIC_LABELS[key]}<input type="text" inputMode="numeric" placeholder="Not recorded" value={values[key] || ""} disabled={busy} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}</div>
    <label>Source note <span className="audience-optional">optional</span><input type="text" placeholder={`e.g. ${selected.name} analytics export`} maxLength={160} value={source} disabled={busy} onChange={(event) => setSource(event.target.value)} /></label>
    <p className="audience-field-help">Use the total shown on that date. Blank fields stay unrecorded.</p>
    {error && <p className="audience-form-error" role="alert">{error}</p>}
    <div className="audience-form-footer"><button className="audience-text-button" type="button" disabled={busy} onClick={onImport}>Have an export? Import CSV</button><button className="audience-action is-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save observation"}<Check size={15} /></button></div>
  </form>;
}

function ImportForm({ onSave, onRecord }: { onSave: (points: SnapshotInput[]) => Promise<void>; onRecord: () => void }) {
  const [csv, setCsv] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => { if (!csv.trim()) return null; try { return { points: parseAudienceCsv(csv), error: "" }; } catch (cause) { return { points: [], error: (cause as Error).message }; } }, [csv]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const points = parseAudienceCsv(csv);
      setBusy(true);
      await onSave(points);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  function template() {
    const blob = new Blob(["platform,date,followers,views,likes,posts,videos,sourceLabel\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "audience-history.csv"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <form className="audience-import-form" onSubmit={submit}>
    <p>One row per platform and date. Include the numbers you have; leave the rest blank.</p>
    <div className="audience-import-actions"><button className="audience-action" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={15} /> Choose CSV</button><button className="audience-text-button" type="button" onClick={template}><Download size={14} /> Get template</button></div>
    <input className="sr-only" ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Choose audience history CSV" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      setError("");
      if (file.size > 1_000_000) { setError("Keep this import under 1 MB."); event.target.value = ""; return; }
      try { setCsv(await file.text()); } catch { setError("This file could not be read. Try choosing it again."); }
      event.target.value = "";
    }} />
    <label>Or paste CSV<textarea value={csv} spellCheck={false} disabled={busy} onChange={(event) => { setCsv(event.target.value); setError(""); }} placeholder="platform,date,followers,views,posts" rows={5} /></label>
    <p className="audience-field-help">Supported columns: platform, date, followers (or subscribers for YouTube), views, likes, posts, videos, sourceLabel. Up to 500 observations.</p>
    {preview?.error && <p className="audience-form-error" role="status">{preview.error}</p>}
    {preview && !preview.error && <p className="audience-import-preview"><Check size={14} /> {preview.points.length} observations across {new Set(preview.points.map((point) => point.platform)).size} platforms, ready to import.</p>}
    {error && <p className="audience-form-error" role="alert">{error}</p>}
    <div className="audience-form-footer"><button className="audience-text-button" type="button" disabled={busy} onClick={onRecord}>Record one date instead</button><button className="audience-action is-primary" type="submit" disabled={busy || !preview?.points.length || !!preview.error}>{busy ? "Importing…" : "Import history"}<Check size={15} /></button></div>
  </form>;
}
