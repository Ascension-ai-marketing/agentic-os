// Live: everything the OS is doing. The top strip is the voice: what you
// said, the lane Jev picked, the reply. Below it, one terminal tab per agent
// run, so Claude Code and Codex working at the same time sit side by side.
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Pause, Play, SendHorizontal, Square, SquareTerminal, Volume2, VolumeX, X } from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { useLiveData } from "@/lib/use-live-data";
import { jevFetch } from "@/lib/jev-client";
import { JevCard, JevMark, fmtMs, fmtUsd } from "./jev-card";
import { OrbBackdrop } from "./orb-backdrop";
import { VoiceCast } from "./voice-cast";
import { HybridOrb, TIER_NAME, VOICE_STATUS, talkFrom, usePointerAura } from "./voice-orb";
import { activateVoice } from "./live-voice";
import { processVoice, setMuted, stopAll, togglePause, useVoice, voiceLevel } from "./voice-store";
import { activeAgentRun, agentLabel, useAgentJobs, type AgentJob, type AgentRun } from "@/components/operator/agent-jobs-panel";
import { operatorRequest } from "@/lib/operator";
import "./live-page.css";

const QUICK = ["Open my morning brief", "What's on my calendar today?", "What was the biggest AI news today?"];

export type Tab = { key: string; job: AgentJob; run: AgentRun };

function elapsed(from: string, to: number) {
  const s = Math.max(0, Math.round((to - Date.parse(from)) / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
const agentName = (run: AgentRun) => (agentLabel(run.agent) === "Claude" ? "Claude Code" : agentLabel(run.agent));
const promptLine = (job: AgentJob) => job.prompt.split("\n").filter(Boolean).pop() ?? job.prompt;

export function LivePage() {
  const v = useVoice();
  const router = useRouter();
  const orbRef = useRef<HTMLButtonElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const { pointer, onPointerMove, onPointerLeave } = usePointerAura();
  const [typed, setTyped] = useState("");
  const [odds, setOdds] = useState(false);
  const turn = v.turn;
  const deciding = v.mood === "thinking";
  // Oldest first, newest at the bottom. A turn with only an error (the mic
  // was blocked, nothing heard) is not in history, so it is added last.
  const thread = useMemo(() => {
    const list = v.history.slice().reverse();
    if (turn && !v.history.some((t) => t.id === turn.id)) list.push(turn);
    return list;
  }, [v.history, turn]);
  const threadRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, v.mood, v.interim, odds]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = typed;
    setTyped("");
    void processVoice(t);
  };

  return (
    <div className="live">
      <section
        ref={heroRef}
        className="live-hero"
        data-mood={v.mood}
        onPointerMove={(e) => onPointerMove(e, orbRef.current)}
        onPointerLeave={() => onPointerLeave(orbRef.current)}
      >
        <OrbBackdrop variant="nebula" mood={v.mood} levelRef={voiceLevel} pointerRef={pointer} orbSize={168} centerY={0.5} centerX={0.1} drift={1} />
        <button
          type="button"
          className="live-close"
          onClick={() => (window.history.length > 1 ? router.history.back() : void router.navigate({ to: "/business" }))}
          aria-label="Close Live"
          title="Close Live"
        >
          <X size={16} />
        </button>
        <div className="live-orb-col">
          <button ref={orbRef} type="button" className="live-orb" onClick={(e) => talkFrom(e, heroRef.current, orbRef.current, () => activateVoice((href) => void router.navigate({ href })))} aria-label={v.mood === "listening" ? "Stop listening" : "Talk to your OS"}>
            <HybridOrb mood={v.mood} pointerRef={pointer} size={168} />
          </button>
          <div className="live-controls" data-no-talk>
            <button type="button" onClick={() => setMuted(!v.muted)} aria-pressed={v.muted} title={v.muted ? "Unmute: replies are spoken" : "Mute: replies show as text only"}>
              {v.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{v.muted ? "Muted" : "Mute"}</span>
            </button>
            <button type="button" onClick={togglePause} disabled={v.mood !== "speaking"} aria-pressed={v.paused} title={v.paused ? "Resume the reply" : "Pause the reply"}>
              {v.paused ? <Play size={15} /> : <Pause size={15} />}
              <span>{v.paused ? "Play" : "Pause"}</span>
            </button>
            <button type="button" onClick={stopAll} disabled={v.mood === "idle" || v.mood === "error"} title="Stop listening or speaking">
              <Square size={13} />
              <span>Stop</span>
            </button>
          </div>
        </div>
        <div className="live-hero-text" aria-live="polite">
          <span className="live-eyebrow">{VOICE_STATUS[v.mood] || "Live"}</span>
          <ol className="live-thread" ref={threadRef} aria-label="Conversation">
            {thread.length === 0 && v.mood !== "listening" && <li className="lt-empty">Ask your OS for anything. Real work opens here as a terminal tab.</li>}
            {thread.map((t, i) => {
              const latest = i === thread.length - 1;
              const r = t.result;
              const tier = r?.decision?.answers.tier;
              const p = tier?.type === "choice" ? tier.probabilities : {};
              const pending = latest && deciding && !r && !t.error;
              return (
                <Fragment key={t.id}>
                  {t.text && (
                    <li className="lt-you">
                      <p>{t.text}</p>
                    </li>
                  )}
                  {(r || t.error || pending) && (
                    <li className="lt-os">
                      <div className="lt-head">
                        <span className="lt-who">
                          <JevMark size={13} /> OS
                        </span>
                        {pending && (
                          <span className="live-lanes" data-state="deciding">
                            {(["tier-1", "tier-2", "tier-3"] as const).map((id, k) => (
                              <span key={id} className="live-lane" style={{ ["--i" as string]: k }}>
                                {TIER_NAME[id]}
                              </span>
                            ))}
                          </span>
                        )}
                        {r?.decision && (
                          <span className="lt-tier" data-tier={r.decision.picked}>
                            {TIER_NAME[r.decision.picked] ?? r.tier}
                            <b>{Math.round((p[r.decision.picked] ?? 0) * 100)}%</b>
                          </span>
                        )}
                        {r?.cast && (
                          <span className="lt-cast">
                            {r.cast.voiceName} · {r.cast.tone}
                          </span>
                        )}
                        {r?.decision &&
                          (latest ? (
                            <button type="button" className="live-lanes-meta" onClick={() => setOdds(!odds)} aria-expanded={odds} title="See Jev's odds">
                              {fmtMs(r.decision.ms)} · {fmtUsd(r.decision.costUsd)}
                            </button>
                          ) : (
                            <span className="lt-meta">{fmtMs(r.decision.ms)}</span>
                          ))}
                      </div>
                      {t.error ? <p className="lt-reply is-error">{t.error}</p> : r && <p className="lt-reply">{r.replyText}</p>}
                      {latest && odds && r?.decision && <JevCard decision={r.decision} live optionLabels={TIER_NAME} sample={t.sample} />}
                      {latest && r?.needsConfirm && (
                        <div className="live-confirm">
                          <button type="button" className="is-primary" onClick={() => void processVoice(t.text, { confirm: true })}>
                            Start the agent
                          </button>
                          <button type="button" onClick={() => void processVoice(t.text, { force: "tier-2" })}>
                            Quick answer instead
                          </button>
                        </div>
                      )}
                    </li>
                  )}
                </Fragment>
              );
            })}
            {v.mood === "listening" && (
              <li className="lt-you is-live">
                <p>{v.interim || "Listening…"}</p>
              </li>
            )}
          </ol>
        </div>
        <MemoryHint />
      </section>

      <div className="live-main">
        <Terminals focusJobId={v.lastJobId} />
        <VoiceCast />
      </div>

      {/* One voice mode: talk with the orb (OpenAI listens, Jarvis speaks). The old typed quick-ask used the tap-to-talk pipeline and is gone. */}
    </div>
  );
}

/** A quiet link to Memory: how much the OS knows and what it learned last. */
function MemoryHint() {
  const live = useLiveData() as any;
  const mem = live?.memory;
  if (!mem?.nodes) return null;
  const last = mem.recentlyUpdated?.[0];
  return (
    <Link to="/memory" className="live-memory" title="Open Memory">
      <i aria-hidden="true" />
      Memory · {mem.nodes.length.toLocaleString()} records{last ? ` · learned ${String(last.updated).replace(" ago", "")} ago` : ""}
    </Link>
  );
}

function Terminals({ focusJobId }: { focusJobId?: string }) {
  const jobs = useAgentJobs(true);
  const tabs: Tab[] = useMemo(() => {
    const list = (jobs.data?.jobs ?? []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const recent = Date.now() - 6 * 36e5;
    const all = list
      .flatMap((job) => job.runs.map((run) => ({ key: `${job.id}:${run.agent}`, job, run })))
      // Hide old runs and ones that failed before doing anything.
      .filter((t) => activeAgentRun(t.run) || (Date.parse(t.job.updatedAt) > recent && (t.run.status !== "failed" || (t.run.text ?? "").trim())));
    const live = all.filter((t) => activeAgentRun(t.run));
    return [...live, ...all.filter((t) => !activeAgentRun(t.run))].slice(0, 10);
  }, [jobs.data]);
  const [selected, setSelected] = useState<string>("");
  // Follow a job the voice just started; otherwise keep the user's tab.
  useEffect(() => {
    if (!focusJobId) return;
    const hit = tabs.find((t) => t.job.id === focusJobId);
    if (hit) setSelected(hit.key);
  }, [focusJobId, tabs.length]);
  const current = tabs.find((t) => t.key === selected) ?? tabs[0];
  const [now, setNow] = useState(Date.now());
  const anyLive = tabs.some((t) => activeAgentRun(t.run));
  useEffect(() => {
    if (!anyLive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyLive]);

  return (
    <section className="live-term" aria-label="Agent terminals">
      <div className="live-tabs" role="tablist" aria-label="Agent runs">
        {tabs.length === 0 && <span className="live-tabs-empty">No agents yet</span>}
        {tabs.map((t) => {
          const live = activeAgentRun(t.run);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={current?.key === t.key}
              className="live-tab"
              data-agent={t.run.agent}
              data-status={t.run.status}
              onClick={() => setSelected(t.key)}
              title={promptLine(t.job)}
            >
              <i className="live-tab-dot" data-live={live || undefined} />
              <b>{agentName(t.run)}</b>
              <span>{promptLine(t.job).slice(0, 34)}</span>
              <small>{elapsed(t.job.createdAt, live ? now : Date.parse(t.job.updatedAt))}</small>
            </button>
          );
        })}
      </div>
      {current ? <TerminalBody tab={current} now={now} /> : <EmptyTerminal />}
    </section>
  );
}

function EmptyTerminal() {
  return (
    <div className="live-term-body is-empty">
      <pre>
        <span className="live-prompt">$</span> waiting for work{"\n"}
        {"\n"}Ask for real work, like “Build me a landing page for the gym”.{"\n"}Jev hands it to Claude Code or Codex and it runs here, one tab per agent.
        <span className="live-cursor" />
      </pre>
    </div>
  );
}

export function TerminalBody({ tab, now }: { tab: Tab; now: number }) {
  const { job, run } = tab;
  const live = activeAgentRun(run);
  const [stopping, setStopping] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const text = useMemo(() => (run.text ?? "").split("\n").slice(-400).join("\n"), [run.text]);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, tab.key]);
  const [opened, setOpened] = useState("");
  const openTerminal = async () => {
    try {
      await jevFetch("/__open_terminal", { method: "POST", body: JSON.stringify({ agent: run.agent, sessionId: run.sessionId }) });
      setOpened("Opened");
    } catch (e) {
      setOpened(e instanceof Error ? e.message : "Could not open");
    }
    window.setTimeout(() => setOpened(""), 2500);
  };
  const stop = async () => {
    setStopping(true);
    try {
      await operatorRequest("/agent-jobs/cancel", { jobId: job.id, agent: run.agent });
    } finally {
      setStopping(false);
    }
  };
  return (
    <div className="live-term-body" data-agent={run.agent} data-live={live || undefined}>
      <div className="live-term-head">
        <span className="live-term-status" data-status={run.status}>
          {run.status.replace("_", " ")}
        </span>
        <span className="live-term-title">
          {agentName(run)} · {elapsed(job.createdAt, live ? now : Date.parse(job.updatedAt))}
        </span>
        <span className="live-term-actions">
          {run.sessionId && (
            <button type="button" className="live-open" onClick={() => void openTerminal()} title="Opens your Mac's Terminal app on this same session, so you can keep talking to the agent yourself">
              <SquareTerminal size={12} /> {opened || "Continue in Terminal"}
            </button>
          )}
          {live && (
            <button type="button" className="live-stop" onClick={() => void stop()} disabled={stopping}>
              <Square size={11} /> Stop
            </button>
          )}
        </span>
      </div>
      {run.events.length > 0 && (
        <div className="live-steps">
          {run.events.slice(-8).map((e) => (
            <span key={e.id}>{e.label}</span>
          ))}
        </div>
      )}
      <pre ref={ref}>
        <span className="live-prompt">$ {promptLine(job).slice(0, 240)}</span>
        {"\n\n"}
        {text || (live ? "Starting…" : "No output.")}
        {live && <span className="live-cursor" />}
      </pre>
    </div>
  );
}
