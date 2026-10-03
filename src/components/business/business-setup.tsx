import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Download, FileText, Link, Plus, Plug, Upload, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useBusinessWorkspace, type BusinessProfile, type BusinessWidgets, type ProgressGoal } from "@/lib/business-workspace";
import { currentGoalPeriod, goalPeriodState, localDateInZone, type GoalHorizon } from "@/lib/goal-periods";
import { operatorRequest, useOperator, type MemorySource } from "@/lib/operator";
import { openBusinessAccounts, BusinessLogo } from "./connections-panel";
import { AmbientVideo } from "./ambient-video";
import "./business-setup.css";

const WIDGETS: Array<{ key: keyof BusinessWidgets; title: string; description: string }> = [
  { key: "cash", title: "Cash position", description: "Your latest account balances" },
  { key: "audience", title: "Audience", description: "Your channels and community growth" },
  { key: "dailyBrief", title: "Daily brief", description: "What needs your attention today" },
];
const DEFAULT_WIDGETS: BusinessWidgets = { cash: true, audience: true, goals: true, dailyBrief: true, aiSpend: true, dream: true, inbox: true, calendar: true, memory: true };
const STEPS = [
  { title: "Your context", short: "Context", headline: "Start with your world.", copy: "Tell us who you are, what you’re building and what matters to you.", visual: "Your perspective.\nYour possibilities." },
  { title: "Your accounts", short: "Accounts", headline: "Bring your world together.", copy: "Connect the tools you already use. Your data starts to tell one story.", visual: "A clearer view\nof everything." },
  { title: "Your goals & overview", short: "Goals", headline: "Give your ambition a direction.", copy: "One outcome. A monthly milestone. A commitment for this week.", visual: "Think bigger.\nStart with today." },
];
const HORIZONS: Array<{ id: GoalHorizon; title: string; description: string; placeholder: string }> = [
  { id: "quarter", title: "Your quarterly outcome", description: "The meaningful result you want by the end of this quarter.", placeholder: "e.g. Launch the new offer with 30 paying customers" },
  { id: "month", title: "Your monthly milestone", description: "The checkpoint that moves you towards that outcome.", placeholder: "e.g. Validate the offer with 10 customer conversations" },
  { id: "week", title: "This week’s commitment", description: "One concrete action you can finish by Sunday.", placeholder: "e.g. Book the first five customer conversations" },
];
type GoalDraft = { id?: string; title: string; renewedFromId?: string };
const EMPTY_GOALS: Record<GoalHorizon, GoalDraft> = { quarter: { title: "" }, month: { title: "" }, week: { title: "" } };
const periodDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const currentGoal = (goals: ProgressGoal[], horizon: GoalHorizon, now: Date) => goals.filter(goal => goal.horizon === horizon && goalPeriodState(goal, now) === "current").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
const earlierGoal = (goals: ProgressGoal[], horizon: GoalHorizon, now: Date) => goals.filter(goal => goal.horizon === horizon && ["past", "undated"].includes(goalPeriodState(goal, now))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

export function BusinessSetup(_props: { section?: string }) {
  const { data, isLoading, error: loadError, saveProfile, saveWidgets, saveProgress } = useBusinessWorkspace();
  const operator = useOperator();
  const integrations = useQuery<{ integrations: Array<{ id: string; configured: boolean }> }>({ queryKey: ["business-integrations"], queryFn: () => operatorRequest("/business/integrations"), staleTime: 30_000 });
  const [step, setStep] = useState(0), [draft, setDraft] = useState<BusinessProfile>({});
  const [contextChanges, setContextChanges] = useState<BusinessProfile>({});
  const [goalDrafts, setGoalDrafts] = useState<Record<GoalHorizon, GoalDraft>>(EMPTY_GOALS);
  const [goalChanges, setGoalChanges] = useState<Partial<Record<GoalHorizon, GoalDraft>>>({});
  const [widgets, setWidgets] = useState<BusinessWidgets>(DEFAULT_WIDGETS);
  const [widgetChanges, setWidgetChanges] = useState<Partial<BusinessWidgets>>({});
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState(""), [completed, setCompleted] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const day = localDateInZone(clock, timeZone);
  const contextDirty = Object.keys(contextChanges).length > 0;
  const goalsDirty = Object.keys(goalChanges).length > 0;
  const overviewDirty = goalsDirty || Object.keys(widgetChanges).length > 0;
  const goals = data?.progress?.goals || [];
  useEffect(() => {
    const refreshDate = () => setClock(new Date());
    const timer = window.setInterval(refreshDate, 60_000); window.addEventListener("focus", refreshDate);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshDate); };
  }, []);
  useEffect(() => {
    if (!data || operator.isLoading) return;
    if (!contextDirty) setDraft({ ...data.profile, longTermDirection: data.profile.longTermDirection ?? operator.state.goals.longTerm ?? "" });
    if (!goalsDirty) setGoalDrafts(Object.fromEntries(HORIZONS.map(({ id }) => {
      const goal = currentGoal(data.progress?.goals || [], id, clock);
      return [id, goal ? { id: goal.id, title: goal.title } : { title: "" }];
    })) as Record<GoalHorizon, GoalDraft>);
    if (!Object.keys(widgetChanges).length) setWidgets({ ...DEFAULT_WIDGETS, ...data.widgets });
  }, [data, operator.isLoading, operator.state.goals.longTerm, contextDirty, goalsDirty, widgetChanges, day]);
  function changed() { setCompleted(false); setNotice(""); }
  function updateContext(key: keyof BusinessProfile, value: string) { setDraft(current => ({ ...current, [key]: value })); setContextChanges(current => ({ ...current, [key]: value })); changed(); }
  function updateGoal(horizon: GoalHorizon, value: GoalDraft) { setGoalDrafts(current => ({ ...current, [horizon]: value })); setGoalChanges(current => ({ ...current, [horizon]: value })); changed(); }
  function go(next: number) { setStep(next); setError(""); setNotice(""); }
  async function persistContext() {
    if (contextDirty) { await saveProfile(contextChanges); setContextChanges({}); await operator.refresh(); }
  }
  async function saveContext(next = false) {
    setSaving(true); setError("");
    try { await persistContext(); if (next) { setStep(1); setNotice(""); } else setNotice("Your context is saved to your workspace and memory."); }
    catch (cause) { setError((cause as Error).message); } finally { setSaving(false); }
  }
  async function saveOverview() {
    setSaving(true); setError("");
    try {
      await persistContext();
      const changedGoals = Object.entries(goalChanges).map(([horizon, value]) => ({ ...value, horizon }));
      if (changedGoals.some(goal => !goal.title?.trim())) throw new Error("Give each edited goal a short title. Earlier goals are kept in Progress; clearing a field will not delete them.");
      if (changedGoals.length) { await saveProgress({ action: "setup-goals", goals: changedGoals, timeZone }); setGoalChanges({}); }
      if (Object.keys(widgetChanges).length) { await saveWidgets(widgetChanges); setWidgetChanges({}); }
      setCompleted(true); setNotice("Your setup is saved. Goals and updates live together in Progress.");
    } catch (cause) { setError((cause as Error).message); } finally { setSaving(false); }
  }
  function exportLayout() {
    const blob = new Blob([JSON.stringify({ version: 1, widgets: Object.fromEntries(WIDGETS.map(item => [item.key, widgets[item.key] !== false])) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "workspace-layout.json"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importLayout(file?: File) {
    if (!file) return;
    setSaving(true); setError(""); setNotice("");
    try {
      if (file.size > 10_000) throw new Error("Choose a workspace layout JSON file under 10 KB.");
      const layout = JSON.parse(await file.text());
      if (!layout || layout.version !== 1 || !layout.widgets || typeof layout.widgets !== "object" || Array.isArray(layout.widgets)) throw new Error("This file is not a workspace layout.");
      const supported = WIDGETS.map(item => item.key), entries = Object.entries(layout.widgets).filter(([key, value]) => supported.includes(key as keyof BusinessWidgets) && typeof value === "boolean");
      if (!entries.length) throw new Error("This layout has no supported sections.");
      const imported = Object.fromEntries(entries); await saveWidgets(imported); setWidgets(current => ({ ...current, ...imported }));
      setWidgetChanges(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in imported))));
      setNotice("Layout imported. Your context, goals and accounts stay as they are.");
    } catch (cause) { setError((cause as Error).message); } finally { setSaving(false); }
  }
  const readyCount = integrations.data?.integrations.filter(item => item.configured).length || 0;
  const story = STEPS[step], loaded = !!data && !isLoading && !operator.isLoading;
  const previousWeek = earlierGoal(goals, "week", clock), currentWeek = currentGoal(goals, "week", clock);
  return <section className="biz-setup" id="business-setup" aria-labelledby="business-setup-title">
    <div className="biz-setup-shell">
      <aside className="biz-setup-media"><AmbientVideo src="/business-art/setup-portals-loop.mp4" poster="/business-art/setup-portals.png" className="biz-setup-motion" label="Soft sculpted portals in motion" /><div className="biz-setup-visual-shade" /><span className="biz-setup-visual-eyebrow">YOUR BUSINESS. YOUR WORLD.</span><div className="biz-setup-visual-copy"><span>0{step + 1} / 03</span><p>{story.visual}</p><small>A little context. A clearer direction.</small></div></aside>
      <div className="biz-setup-right">
        <nav className="biz-setup-steps" aria-label="Setup steps">{STEPS.map((item, index) => <button key={item.title} type="button" disabled={saving} onClick={() => go(index)} aria-current={step === index ? "step" : undefined} aria-label={`Step ${index + 1}: ${item.title}`}><span className="biz-setup-step-number">{index + 1}</span><span>{item.short}</span></button>)}</nav>
        <header className="biz-setup-title"><span>MAKE IT YOURS</span><h2 id="business-setup-title">{story.headline}</h2><p>{story.copy}</p></header>
        <div className="biz-setup-workspace" aria-busy={saving || !loaded}>
          {!loaded ? <div className="biz-setup-loading">{loadError ? "Your setup couldn’t be loaded. Refresh the page to try again." : "Loading your workspace…"}</div> : <>
            {(step === 0 ? contextDirty : step === 2 ? overviewDirty : false) && <p className="biz-setup-draft">Unsaved changes</p>}
            {step === 0 && <>
              <form id="business-context-form" onSubmit={event => { event.preventDefault(); void saveContext(true); }}>
                <div className="biz-setup-field-grid">
                  <label>What should we call you?<input value={draft.preferredName || ""} onChange={event => updateContext("preferredName", event.target.value)} placeholder="Your name" maxLength={3000} disabled={saving} autoComplete="given-name" /></label>
                  <label>Your business name<input value={draft.businessName || ""} onChange={event => updateContext("businessName", event.target.value)} placeholder="Business or project" maxLength={3000} disabled={saving} autoComplete="organization" /></label>
                  <label className="wide">Who do you help?<input value={draft.whoYouHelp || ""} onChange={event => updateContext("whoYouHelp", event.target.value)} placeholder="Your ideal customer or community" maxLength={3000} disabled={saving} /></label>
                  <label className="wide">What do you help them achieve?<textarea aria-label="What do you help them achieve?" value={draft.whatYouDo || ""} onChange={event => updateContext("whatYouDo", event.target.value)} placeholder="The problem you solve, in your own words" rows={2} maxLength={3000} disabled={saving} /></label>
                  <label className="wide">What are you building towards?<textarea aria-label="What are you building towards?" value={draft.longTermDirection || ""} onChange={event => updateContext("longTermDirection", event.target.value)} placeholder="Your longer-term ambition" rows={2} maxLength={3000} disabled={saving} /></label>
                </div>
                <details className="biz-setup-personal"><summary>A little more about you <span>Optional</span></summary><label>What should work leave room for?<textarea aria-label="What should work leave room for?" value={draft.personalPriorities || ""} onChange={event => updateContext("personalPriorities", event.target.value)} placeholder="Personal priorities, boundaries and what gives you energy" rows={2} maxLength={3000} disabled={saving} /></label></details>
              </form>
              <BusinessMemoryCapture disabled={saving} />
              <p className="biz-setup-field-note">Optional, editable anytime. Saved context informs your workspace, shared memory and daily brief when those sources are enabled.</p>
            </>}
            {step === 1 && <div className="biz-setup-account-step"><div className="biz-setup-account-art" aria-label="Mercury, YouTube and Instagram"><BusinessLogo provider="mercury" /><BusinessLogo provider="youtube" /><BusinessLogo provider="instagram" /></div><h3>Your work, connected.</h3><p>Bring in your cash and audience. Email and calendar are available in the same account hub.</p><button className="biz-setup-primary" type="button" onClick={openBusinessAccounts}><Plug size={17} /> Connect accounts <ArrowUpRight size={17} /></button><div className="biz-setup-account-status"><span className={readyCount ? "ready" : ""} /><p>{integrations.isPending ? "Checking existing connections…" : integrations.isError ? "Open accounts to check your connections." : readyCount ? `${readyCount} connections found on this Mac.` : "Start with whichever account you use most."}</p></div>{data.finances && <p className="biz-setup-account-snapshot"><Check size={14} /> Your saved balances are already here.</p>}<p className="biz-setup-field-note">You can continue now and connect more accounts later.</p></div>}
            {step === 2 && <div className="biz-setup-overview-step">
              {previousWeek && !currentWeek && <div className="biz-setup-week-review"><span>TIME FOR A FRESH WEEK</span><h3>Review, then choose your next step.</h3><p>Earlier commitment: <strong>{previousWeek.title}</strong> · {previousWeek.status === "done" ? "Completed" : previousWeek.status === "active" ? "In progress" : "Planned"}.</p><p>The original stays in your history. Carry it forward only if it still matters.</p><button type="button" disabled={saving} onClick={() => updateGoal("week", { title: previousWeek.title, renewedFromId: previousWeek.id })}>Use this again <ArrowRight size={14} /></button></div>}
              <div className="biz-setup-goal-fields">{HORIZONS.map((horizon, index) => {
                const period = currentGoalPeriod(horizon.id, clock, timeZone), existing = currentGoal(goals, horizon.id, clock), previous = earlierGoal(goals, horizon.id, clock);
                const legacy = horizon.id === "quarter" ? operator.state.goals.quarter || data.profile.quarterGoal : horizon.id === "week" ? operator.state.goals.week : "";
                return <div className="biz-setup-goal-field" key={horizon.id}><div className="biz-setup-goal-kicker"><span>0{index + 1}</span><span>{periodDate(period.startDate)} – {periodDate(period.endDate)}{horizon.id === "week" ? " · ends Sunday" : ""}</span></div><label>{horizon.title}<small>{horizon.description}</small><textarea aria-label={horizon.title} value={goalDrafts[horizon.id].title} onChange={event => updateGoal(horizon.id, { ...goalDrafts[horizon.id], title: event.target.value })} rows={2} maxLength={300} placeholder={horizon.placeholder} disabled={saving} /></label>{existing && <p className="biz-setup-goal-saved">{existing.status === "done" ? "Completed. Editing the wording will keep it completed." : "Saved in Progress. Changes here update the same goal."}</p>}{!existing && !goalDrafts[horizon.id].title && (previous || legacy) && horizon.id !== "week" && <button className="biz-setup-use-prior" type="button" onClick={() => updateGoal(horizon.id, { title: previous?.title || legacy || "", ...(previous ? { renewedFromId: previous.id } : {}) })}>Use earlier direction <ArrowRight size={13} /></button>}{horizon.id === "week" && !existing && !previous && legacy && !goalDrafts.week.title && <button className="biz-setup-use-prior" type="button" onClick={() => updateGoal("week", { title: legacy })}>Use earlier commitment <ArrowRight size={13} /></button>}</div>;
              })}</div>
              <p className="biz-setup-field-note">Weeks run Monday to Sunday in {timeZone}. Next week you’ll review and renew; saved goals and completion history stay intact.</p>
              <a className="biz-setup-goals-link" href="/business?view=progress">See all goals and history in Progress <ArrowUpRight size={15} /></a>
              <details className="biz-setup-display" open><summary>Choose your Overview</summary><div className="biz-setup-widget-list">{WIDGETS.map(item => <label key={item.key}><span><strong>{item.title}</strong><small>{item.description}</small></span><input type="checkbox" role="switch" checked={widgets[item.key]} disabled={saving} onChange={event => { setWidgets(current => ({ ...current, [item.key]: event.target.checked })); setWidgetChanges(current => ({ ...current, [item.key]: event.target.checked })); changed(); }} /></label>)}</div></details>
              <details className="biz-setup-share"><summary><Upload size={15} /> Share or reuse a layout</summary><p>Share these three display choices. Your personal context and goals are not included.</p><div><button type="button" disabled={saving} onClick={exportLayout}><Download size={15} /> Export layout</button><label><Upload size={15} /> Import layout<input type="file" aria-label="Import layout" accept="application/json,.json" disabled={saving} onChange={event => { void importLayout(event.target.files?.[0]); event.target.value = ""; }} /></label></div></details>
            </div>}
            {error && <p className="biz-setup-error" role="alert">{error}</p>}{notice && <p className="biz-setup-notice" role="status"><Check size={16} />{notice}</p>}
            <footer className="biz-setup-footer">{step > 0 ? <button className="biz-setup-back" type="button" disabled={saving} onClick={() => go(step - 1)}><ArrowLeft size={16} /> Back</button> : <button className="biz-setup-back" type="button" disabled={saving || !contextDirty} onClick={() => void saveContext(false)}>Save for later</button>}{step === 0 ? <button className="biz-setup-primary" type="submit" form="business-context-form" disabled={saving}>{saving ? "Saving…" : contextDirty ? "Save & continue" : "Continue"}<ArrowRight size={17} /></button> : step === 1 ? <button className="biz-setup-next" type="button" onClick={() => go(2)}>Continue<ArrowRight size={17} /></button> : <button className="biz-setup-primary" type="button" disabled={saving} onClick={() => void saveOverview()}>{saving ? "Saving…" : completed && !overviewDirty && !contextDirty ? "Setup saved" : "Save my setup"}{completed && !overviewDirty && !contextDirty ? <Check size={17} /> : <ArrowRight size={17} />}</button>}</footer>
          </>}
        </div>
      </div>
    </div>
  </section>;
}

export function BusinessMemoryCapture({
  disabled,
  compact = false,
}: {
  disabled: boolean;
  compact?: boolean;
}) {
  const operator = useOperator();
  const [mode, setMode] = useState<"note" | "link" | "file">("note"),
    [text, setText] = useState(""),
    [url, setUrl] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<MemorySource[]>([]),
    [duplicate, setDuplicate] = useState(false);
  const sources = saved.map(
    (source) =>
      operator.state.sources.find((item) => item.id === source.id) || source,
  );
  function chooseFile(next?: File) {
    setError("");
    setFile(null);
    if (!next) return;
    if (next.size > 5 * 1024 * 1024) {
      setError("Choose a document or image under 5 MB.");
      return;
    }
    if (
      /^\.?env(?:\.|$)|(?:^|[._ -])(?:credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519)(?:[._ -]|$)|\.(?:pem|key|p12|pfx|kdbx)$/i.test(
        next.name,
      )
    ) {
      setError(
        "Keep passwords, API keys and credential files out of your business memory.",
      );
      return;
    }
    if (
      !/\.(?:pdf|txt|md|markdown|csv|html|htm|vtt|srt|png|jpe?g|webp|heic|tiff?|bmp)$/i.test(
        next.name,
      )
    ) {
      setError(
        "Choose a PDF, text, Markdown, CSV, transcript, HTML or image file.",
      );
      return;
    }
    setFile(next);
  }
  async function add() {
    setBusy(true);
    setError("");
    setDuplicate(false);
    try {
      const body: Record<string, unknown> = {
        collection: "business",
        origin: "business",
      };
      if (mode === "note") {
        if (text.trim().length < 15)
          throw new Error("Add at least 15 characters of business context.");
        Object.assign(body, {
          title: "Business DNA · your context",
          text: text.trim(),
          kind: "note",
        });
      }
      if (mode === "link") {
        let parsed: URL;
        try {
          parsed = new URL(url.trim());
        } catch {
          throw new Error("Paste a full public link beginning with https://.");
        }
        if (
          !/^https?:$/.test(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw new Error(
            "Use a public HTTP or HTTPS link without a password.",
          );
        body.url = parsed.href;
      }
      if (mode === "file") {
        if (!file) throw new Error("Choose a file first.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        Object.assign(body, {
          filename: file.name,
          title: file.name,
          kind: "document",
          base64: btoa(binary),
        });
      }
      const result = await operatorRequest<{
        source: MemorySource;
        duplicate?: boolean;
      }>("/memory", body);
      setSaved((current) =>
        [
          result.source,
          ...current.filter((item) => item.id !== result.source.id),
        ].slice(0, 5),
      );
      setDuplicate(!!result.duplicate);
      setText("");
      setUrl("");
      setFile(null);
      await operator.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="biz-setup-memory">
      <summary>
        <Plus size={17} />
        <span>
          {compact ? "Add notes or a brief" : "Give your business a memory"}
          {!compact && <small>Notes, links, documents and images</small>}
        </span>
      </summary>
      <div className="biz-setup-memory-body">
        {!compact && (
          <p>
            Your story, your customers, your way of working. Add the context you
            want this workspace to remember.
          </p>
        )}
        <div
          className="biz-setup-memory-modes"
          role="group"
          aria-label="Business memory input"
        >
          {(
            [
              { id: "note", title: "Write", Icon: FileText },
              { id: "link", title: "Link", Icon: Link },
              { id: "file", title: "File", Icon: Upload },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={busy || disabled}
              aria-pressed={mode === item.id}
              onClick={() => {
                setMode(item.id);
                setError("");
              }}
            >
              <item.Icon size={14} />
              {item.title}
            </button>
          ))}
        </div>
        {mode === "note" && (
          <>
            <label className="biz-setup-memory-label">
              Business context
              <textarea
                aria-label="Business context to remember"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={
                  compact
                    ? "A few notes about your work."
                    : "Your founder story, what makes you different, how customers find you, or your current bottleneck…"
                }
                rows={compact ? 2 : 4}
                maxLength={30000}
                disabled={busy || disabled}
              />
            </label>
            {!compact && (
              <div className="biz-setup-memory-prompts">
                {[
                  "What makes us different",
                  "Our customer journey",
                  "Our biggest bottleneck",
                ].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={busy || disabled}
                    onClick={() =>
                      setText(
                        (current) =>
                          `${current}${current ? "\n\n" : ""}${prompt}: `,
                      )
                    }
                  >
                    {prompt}
                    <Plus size={11} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {mode === "link" && (
          <label className="biz-setup-memory-label">
            A useful public link
            <input
              type="url"
              aria-label="Business memory link"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-business.com/about"
              disabled={busy || disabled}
            />
            <small>
              Web pages and YouTube links are read by your existing memory
              importer.
            </small>
          </label>
        )}
        {mode === "file" && (
          <>
            <label className="biz-setup-memory-file">
              <Upload size={23} />
              <strong>{file ? file.name : "Choose a document or image"}</strong>
              <span>PDF, text, CSV, transcript or image · up to 5 MB</span>
              <input
                type="file"
                aria-label="Business memory file"
                accept=".pdf,.txt,.md,.markdown,.csv,.html,.htm,.vtt,.srt,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.bmp"
                disabled={busy || disabled}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {file && (
              <button
                className="biz-setup-remove-file"
                type="button"
                onClick={() => setFile(null)}
              >
                <X size={13} />
                Remove file
              </button>
            )}
          </>
        )}
        <button
          className="biz-setup-memory-save"
          type="button"
          disabled={busy || disabled}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Add to Business memory"}
          <ArrowUpRight size={15} />
        </button>
        <p className="biz-setup-memory-storage">
          Stored in your local Business memory. It becomes searchable after
          indexing and is used when Business context is enabled. Images use
          local text recognition.
        </p>
        {error && (
          <p className="biz-setup-error" role="alert">
            {error}
          </p>
        )}
        {duplicate && (
          <p className="biz-setup-memory-duplicate" role="status">
            That source is already in your memory.
          </p>
        )}
        {!!sources.length && (
          <ul className="biz-setup-memory-status" aria-live="polite">
            {sources.map((source) => (
              <li key={source.id}>
                <FileText size={15} />
                <span>
                  <strong>{source.title}</strong>
                  <small>
                    {source.status === "ready"
                      ? source.collection === "business"
                        ? "Saved and searchable in Business memory"
                        : `Already searchable in ${source.collection} memory`
                      : source.status === "error"
                        ? source.error ||
                          "Indexing failed. Open Memory to review this source."
                        : "Saved · indexing…"}
                  </small>
                </span>
                {source.status === "ready" && <Check size={15} />}
                {source.status === "error" && (
                  <a href="/memory">
                    Review <ArrowUpRight size={12} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
