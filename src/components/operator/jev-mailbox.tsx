// "Sort all with Jev": a demo inbox that looks like Jack's own, sorted into
// piles by Jev in one tap, plus an invoice search where Jev ranks every
// invoice with odds. Demo only: fictional senders, simulated odds, no calls.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, FileText, Inbox, Paperclip, RotateCcw, Search, Send, Star, X, File as FileIcon } from "lucide-react";
import { PILES, type InboxCategory, type InboxLabel } from "@/lib/jev-inbox";
import {
  DEMO_INVOICES, DEMO_MAIL, DEMO_TODAY, JEV_CALL_USD, daysOpen, demoMailLabel, invoiceMatchDecision, searchInvoices,
  type BrandKey, type DemoInvoice, type DemoMail, type InvoiceHit, type InvoiceSearch,
} from "@/lib/jev-mailbox-demo";
import { JevCard, JevMark, fmtUsd } from "@/components/jev/jev-card";
import { JevLiveMark } from "@/components/jev/jev-live-mark";
import "./jev-mailbox.css";

export const JEV_MAILBOX_EVENT = "jev-mailbox";
const PILE_ORDER: InboxCategory[] = ["reply-today", "sponsor", "lead", "billing", "community", "newsletter", "fyi", "spam"];
const PILE_LABELS = Object.fromEntries(Object.entries(PILES).map(([k, v]) => [k, v.name]));
const BRANDS: Record<BrandKey, { src: string; name: string; dark?: boolean }> = {
  stripe: { src: "/brand-logos/stripe.svg", name: "Stripe" },
  youtube: { src: "/brand-logos/youtube.svg", name: "YouTube" },
  notion: { src: "/brand-logos/notion.svg", name: "Notion" },
  figma: { src: "/brand-logos/figma.svg", name: "Figma" },
  vercel: { src: "/brand-logos/vercel.svg", name: "Vercel", dark: true },
  github: { src: "/brand-logos/github.svg", name: "GitHub", dark: true },
  googlecalendar: { src: "/brand-logos/googlecalendar.svg", name: "Google Calendar" },
  openrouter: { src: "/brand-logos/openrouter.svg", name: "OpenRouter" },
  clay: { src: "/brand-logos/clay.png", name: "Clay" },
  gmail: { src: "/brand-logos/gmail.svg", name: "Gmail" },
};
const HUES = [18, 42, 150, 200, 262, 320, 350, 95];

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: iso.slice(0, 4) === DEMO_TODAY.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });

function Avatar({ name, brand, size = 30 }: { name: string; brand?: BrandKey; size?: number }) {
  if (brand) {
    const b = BRANDS[brand];
    return (
      <span className="jm-avatar is-brand" data-dark={b.dark || undefined} style={{ width: size, height: size, padding: Math.round(size * 0.17) }}>
        <img src={b.src} alt={b.name} />
      </span>
    );
  }
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span className="jm-avatar" style={{ width: size, height: size, "--hue": hue } as CSSProperties}>
      {initials}
    </span>
  );
}

// First-last animation: remember where every [data-flip] element was, then
// after React moves them, slide each one from its old spot to its new one.
function useFlip(root: React.RefObject<HTMLElement | null>) {
  const first = useRef<Map<string, DOMRect> | null>(null);
  const capture = useCallback(() => {
    const map = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => map.set(el.dataset.flip!, el.getBoundingClientRect()));
    first.current = map;
  }, [root]);
  const play = useCallback((opts: { stagger?: number; duration?: number } = {}) => {
    const map = first.current;
    first.current = null;
    if (!map || !root.current || reduceMotion()) return;
    let n = 0;
    root.current.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const was = map.get(el.dataset.flip!);
      if (!was) return;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.55 }, { transform: "translate(0, 0)", opacity: 1 }],
        { duration: opts.duration ?? 720, delay: (n++) * (opts.stagger ?? 12), easing: "cubic-bezier(0.2, 0.85, 0.2, 1)", fill: "backwards" },
      );
    });
  }, [root]);
  return useMemo(() => ({ capture, play }), [capture, play]);
}

// The page-level "Sort all with Jev" button: brings the demo mailbox into
// view and starts the sort.
export function SortAllButton({ onBeforeSort }: { onBeforeSort?: () => void }) {
  return (
    <button
      type="button"
      className="jm-head-go"
      onClick={() => {
        onBeforeSort?.();
        window.setTimeout(() => {
          document.getElementById("jev-mailbox")?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
          window.dispatchEvent(new CustomEvent(JEV_MAILBOX_EVENT, { detail: "sort" }));
        }, 80);
      }}
    >
      <JevMark size={15} /> Sort all with Jev
    </button>
  );
}

type Phase = "idle" | "sorting" | "sorted";

// Spread the piles over columns so they come out about the same height.
function boardColumns(piles: InboxCategory[], n: number) {
  const cols = Array.from({ length: n }, () => ({ h: 0, items: [] as { p: InboxCategory; pi: number }[] }));
  piles.forEach((p, pi) => {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
    col.items.push({ p, pi });
    col.h += 1.6 + DEMO_MAIL.filter((m) => m.category === p).length + (p === "billing" ? 0.8 : 0);
  });
  return cols.map((c) => c.items);
}
type Sheet = { kind: "mail"; mail: DemoMail; label: InboxLabel } | { kind: "invoice"; hit: InvoiceHit; search: InvoiceSearch };

export function JevMailbox({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<"inbox" | "invoices">("inbox");
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [ms, setMs] = useState(0);
  const [pile, setPile] = useState<InboxCategory | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const run = useRef(0);
  const follow = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boardRoot = useRef<HTMLDivElement>(null);
  const flip = useFlip(boardRoot);
  const labels = useMemo(() => DEMO_MAIL.map((m, i) => demoMailLabel(m, i)), []);
  const total = DEMO_MAIL.length;

  const counts = useMemo(() => {
    const c = Object.fromEntries(PILE_ORDER.map((p) => [p, 0])) as Record<InboxCategory, number>;
    DEMO_MAIL.slice(0, done).forEach((m) => c[m.category]++);
    return c;
  }, [done]);

  const sortAll = useCallback(async () => {
    const my = ++run.current;
    const reduce = reduceMotion();
    setView("inbox");
    setSheet(null);
    setPile(null);
    setPhase("sorting");
    setDone(0);
    setMs(0);
    listRef.current?.scrollTo({ top: 0 });
    const start = performance.now();
    follow.current = 0;
    // Ease the list after the row Jev is reading, one frame at a time.
    const glide = () => {
      const list = listRef.current;
      if (run.current !== my || !list || !list.classList.contains("jm-list")) return;
      list.scrollTop += (follow.current - list.scrollTop) * 0.22;
      requestAnimationFrame(glide);
    };
    if (!reduce) requestAnimationFrame(glide);
    await sleep(reduce ? 0 : 420);
    for (let i = 0; i < total; i++) {
      if (run.current !== my) return;
      await sleep(reduce ? 0 : 38);
      setDone(i + 1);
      setMs(performance.now() - start);
      const list = listRef.current;
      const row = list?.querySelector<HTMLElement>(`[data-flip="${DEMO_MAIL[i].id}"]`);
      if (list && row && !reduce) follow.current = Math.max(0, row.offsetTop - list.clientHeight * 0.45);
    }
    setMs(performance.now() - start);
    await sleep(reduce ? 0 : 520);
    if (run.current !== my) return;
    flip.capture();
    setPhase("sorted");
  }, [flip, total]);

  useLayoutEffect(() => {
    if (phase !== "sorted") return;
    listRef.current?.scrollTo({ top: 0 });
    flip.play({ stagger: 14, duration: 760 });
  }, [phase, flip]);

  const reset = () => {
    run.current++;
    setPhase("idle");
    setDone(0);
    setMs(0);
    setPile(null);
    setSheet(null);
  };

  // Deep links for filming and screenshots: ?jev=sort, ?jev=invoices&q=...
  const [initialQuery, setInitialQuery] = useState("");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const want = p.get("jev");
    let t: number | undefined;
    // Opened by voice or chat: bring the mailbox into view first, so the
    // sort or search happens where you can see it.
    if (want === "sort" || want === "invoices")
      window.setTimeout(() => document.getElementById("jev-mailbox")?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }), 250);
    if (want === "sort") t = window.setTimeout(() => void sortAll(), 1100);
    if (want === "invoices") {
      setView("invoices");
      setInitialQuery(p.get("q") ?? "");
    }
    const onEvent = (e: Event) => {
      const what = (e as CustomEvent<string>).detail;
      if (what === "sort") void sortAll();
      if (what === "invoices") setView("invoices");
    };
    window.addEventListener(JEV_MAILBOX_EVENT, onEvent);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(JEV_MAILBOX_EVENT, onEvent);
    };
  }, [sortAll]);
  useEffect(() => () => void run.current++, []);

  const cost = done * JEV_CALL_USD;
  const mood = phase === "sorting" ? "thinking" : phase === "sorted" ? "done" : "idle";

  return (
    <section className="jm" data-compact={compact || undefined} id="jev-mailbox" aria-label="Demo inbox sorted by Jev">
      <header className="jm-top">
        <span className="jm-brand">
          <img src="/brand-logos/gmail.svg" alt="Gmail" />
          <b>Inbox</b>
          <span className="jm-demo">Demo · fictional senders</span>
        </span>
        <div className="jm-tabs" role="tablist" aria-label="Mailbox view">
          <button role="tab" aria-selected={view === "inbox"} onClick={() => setView("inbox")}>
            <Inbox size={15} /> Inbox <small>{total}</small>
          </button>
          <button role="tab" aria-selected={view === "invoices"} onClick={() => { setView("invoices"); setSheet(null); }}>
            <FileText size={15} /> Invoice search
          </button>
        </div>
      </header>

      {view === "inbox" ? (
        <>
          <div className="jm-bar" data-phase={phase}>
            <JevLiveMark size={46} mood={mood} key={mood} />
            <div className="jm-bar-text" aria-live="polite">
              {phase === "idle" && (
                <>
                  <b>{total} new emails since this morning</b>
                  <span>One tap and Jev puts every email in the right pile.</span>
                </>
              )}
              {phase === "sorting" && (
                <>
                  <b>Jev is sorting your inbox</b>
                  <span>{done} of {total} emails in a pile</span>
                </>
              )}
              {phase === "sorted" && (
                <>
                  <b>
                    {total} emails sorted in {(ms / 1000).toFixed(1)} s for {fmtUsd(total * JEV_CALL_USD)}
                  </b>
                  <span>Tap any email to see why Jev put it there.</span>
                </>
              )}
            </div>
            <div className="jm-stats">
              <span><b>{done}</b><small>sorted</small></span>
              <span><b>{(ms / 1000).toFixed(1)} s</b><small>time</small></span>
              <span><b>{fmtUsd(cost)}</b><small>cost</small></span>
            </div>
            {phase === "sorted" ? (
              <button type="button" className="jm-ghost" onClick={reset}>
                <RotateCcw size={14} /> Unsort
              </button>
            ) : (
              <button type="button" className="jm-go" disabled={phase === "sorting"} onClick={() => void sortAll()}>
                <JevMark size={17} /> {phase === "sorting" ? "Sorting" : "Sort all with Jev"}
              </button>
            )}
            <span className="jm-progress" style={{ width: `${(done / total) * 100}%` }} />
          </div>

          <div className="jm-body">
            <nav className="jm-rail" aria-label="Folders and piles">
              <span className="jm-folder is-on"><Inbox size={15} /> Inbox <small>{phase === "sorted" ? 0 : total - done}</small></span>
              <span className="jm-folder"><Star size={15} /> Starred</span>
              <span className="jm-folder"><Send size={15} /> Sent</span>
              <span className="jm-rail-head"><JevMark size={12} /> Jev piles</span>
              {PILE_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="jm-pile-link"
                  aria-pressed={pile === p}
                  disabled={phase !== "sorted"}
                  data-empty={!counts[p] || undefined}
                  style={{ "--pile": PILES[p].color } as CSSProperties}
                  onClick={() => setPile(pile === p ? null : p)}
                >
                  <i /> {PILES[p].name}
                  <b key={counts[p]}>{counts[p] || ""}</b>
                </button>
              ))}
              <p className="jm-rail-note">Simulated odds. Nothing is read, moved or sent.</p>
            </nav>

            <div className="jm-main" ref={boardRoot}>
              {phase !== "sorted" ? (
                <div className="jm-list" ref={listRef} role="list">
                  {DEMO_MAIL.map((m, i) => {
                    const labelled = i < done;
                    const scanning = phase === "sorting" && i === done;
                    const color = PILES[m.category].color;
                    return (
                      <div
                        key={m.id}
                        role="listitem"
                        data-flip={m.id}
                        className="jm-row"
                        data-unread={m.unread || undefined}
                        data-state={labelled ? "done" : scanning ? "scan" : phase === "sorting" ? "wait" : "idle"}
                        style={{ "--pile": color } as CSSProperties}
                        onClick={() => labelled && setSheet({ kind: "mail", mail: m, label: labels[i] })}
                      >
                        <Star size={15} className="jm-star" />
                        <Avatar name={m.name} brand={m.brand} />
                        <span className="jm-from">
                          {m.name}
                          {m.org && <small>{m.org}</small>}
                        </span>
                        <span className="jm-line">
                          <b>{m.subject}</b>
                          <span> · {m.snippet}</span>
                        </span>
                        {m.attachment && <span className="jm-attach"><Paperclip size={12} /> {m.attachment}</span>}
                        <span className="jm-slot">
                          {labelled ? (
                            <span className="jm-chip">{PILES[m.category].name}</span>
                          ) : scanning ? (
                            <span className="jm-chip is-scan"><JevMark size={12} /> reading</span>
                          ) : null}
                        </span>
                        <time>{m.time}</time>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="jm-board" ref={listRef}>
                  {boardColumns(pile ? [pile] : PILE_ORDER, pile ? 1 : 3).map((col, ci) => (
                  <div className="jm-col" key={ci}>
                  {col.map(({ p, pi }) => {
                    const group = DEMO_MAIL.map((m, i) => ({ m, l: labels[i] })).filter(({ m }) => m.category === p);
                    const avg = group.reduce((s, g) => s + g.m.sure, 0) / group.length;
                    return (
                      <section key={p} className="jm-pile" style={{ "--pile": PILES[p].color, "--d": `${pi * 60}ms` } as CSSProperties}>
                        <header>
                          <i />
                          <b>{PILES[p].name}</b>
                          <small>{group.length}</small>
                          <span className="jm-pile-sure">{Math.round(avg * 100)}% sure</span>
                        </header>
                        {group.map(({ m, l }) => (
                          <button type="button" key={m.id} data-flip={m.id} className="jm-card" data-unread={m.unread || undefined} onClick={() => setSheet({ kind: "mail", mail: m, label: l })}>
                            <Avatar name={m.name} brand={m.brand} size={24} />
                            <span className="jm-card-text">
                              <b>{m.org ?? m.name}</b>
                              <span>{m.subject}</span>
                            </span>
                            <span className="jm-odds">{Math.round(m.sure * 100)}%</span>
                          </button>
                        ))}
                        {p === "billing" && (
                          <button type="button" className="jm-pile-cta" onClick={() => setView("invoices")}>
                            Find an invoice <ArrowRight size={13} />
                          </button>
                        )}
                      </section>
                    );
                  })}
                  </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <InvoiceSearchView initialQuery={initialQuery} onWhy={(search, hit) => setSheet({ kind: "invoice", search, hit })} />
      )}

      {sheet && <WhySheet sheet={sheet} onClose={() => setSheet(null)} />}
    </section>
  );
}

function WhySheet({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (sheet.kind === "mail") {
    const { mail, label } = sheet;
    return (
      <aside className="jm-sheet" aria-label="Why Jev put this here" style={{ "--pile": PILES[mail.category].color } as CSSProperties}>
        <button type="button" className="jm-sheet-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="jm-sheet-from">
          <Avatar name={mail.name} brand={mail.brand} size={40} />
          <span>
            <b>{mail.name}{mail.org ? `, ${mail.org}` : ""}</b>
            <small>{mail.email} · {mail.time}</small>
          </span>
        </div>
        <h3>{mail.subject}</h3>
        <p className="jm-sheet-body">{mail.snippet}</p>
        {mail.attachment && <span className="jm-attach"><Paperclip size={12} /> {mail.attachment}</span>}
        <div className="jm-why">
          <span className="jm-why-head"><JevMark size={14} /> Why Jev put this in <b>{PILES[mail.category].name}</b></span>
          <p>{mail.why}</p>
        </div>
        <JevCard decision={label.decision} optionLabels={PILE_LABELS} live sample />
      </aside>
    );
  }
  const { hit, search } = sheet;
  return (
    <aside className="jm-sheet" aria-label="Why Jev picked this invoice">
      <button type="button" className="jm-sheet-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      <div className="jm-sheet-from">
        <Avatar name={hit.invoice.client} brand={hit.invoice.brand} size={40} />
        <span>
          <b>{hit.invoice.client}</b>
          <small>{hit.invoice.number} · {money(hit.invoice.amount)}</small>
        </span>
      </div>
      <div className="jm-why">
        <span className="jm-why-head"><JevMark size={14} /> What Jev looked for</span>
        <p className="jm-clues">{search.clues.map((c) => <span key={c}>{c}</span>)}</p>
      </div>
      {search.single ? (
        <JevCard decision={search.decision} optionLabels={Object.fromEntries(DEMO_INVOICES.map((i) => [i.id, `${i.client} ${i.number}`]))} live sample />
      ) : (
        <JevCard decision={invoiceMatchDecision(search, hit)} live sample />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- invoices

const SUGGESTIONS = ["the Halden invoice from August", "unpaid over 30 days", "everything Lumora owes me", "bills I paid in September", "biggest invoice this year"];

function statusText(inv: DemoInvoice) {
  if (inv.status === "paid") return `Paid ${shortDate(inv.paidOn ?? inv.due)}`;
  if (inv.status === "overdue") return `Overdue · ${daysOpen(inv)} days open`;
  return `Due ${shortDate(inv.due)}`;
}

function InvoiceSearchView({ initialQuery, onWhy }: { initialQuery: string; onWhy: (s: InvoiceSearch, h: InvoiceHit) => void }) {
  const [text, setText] = useState(initialQuery);
  const [result, setResult] = useState<InvoiceSearch | null>(null);
  const [thinking, setThinking] = useState(false);
  const [tick, setTick] = useState(0);
  const ask = useRef(0);
  const oddsRoot = useRef<HTMLDivElement>(null);
  const flip = useFlip(oddsRoot);

  const go = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const my = ++ask.current;
    setText(q);
    setThinking(true);
    setResult(null);
    const reduce = reduceMotion();
    if (!reduce) {
      for (let i = 0; i < 6; i++) {
        await sleep(90);
        if (ask.current !== my) return;
        setTick((t) => t + 1);
      }
    }
    if (ask.current !== my) return;
    flip.capture();
    setResult(searchInvoices(q));
    setThinking(false);
  }, [flip]);

  useLayoutEffect(() => {
    if (result) flip.play({ stagger: 18, duration: 620 });
  }, [result, flip]);

  useEffect(() => {
    if (initialQuery) {
      const t = window.setTimeout(() => void go(initialQuery), 500);
      return () => window.clearTimeout(t);
    }
  }, [initialQuery, go]);
  useEffect(() => () => void ask.current++, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void go(text);
  };
  const odds = result ? result.ranked : DEMO_INVOICES.map((invoice) => ({ invoice, odds: 0 }));
  const owed = result && !result.single ? result.matches.filter((h) => h.invoice.status !== "paid").reduce((s, h) => s + h.invoice.amount, 0) : 0;
  const mood = thinking ? "thinking" : result ? "done" : "idle";

  return (
    <div className="jm-inv">
      <form className="jm-ask" onSubmit={submit} data-thinking={thinking || undefined}>
        <JevLiveMark size={40} mood={mood} key={`${mood}-${result?.query ?? ""}`} />
        <label className="jm-ask-field">
          <span className="sr-only">Find an invoice</span>
          <Search size={18} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an invoice, like the Halden invoice from August" autoComplete="off" />
        </label>
        <button type="submit" className="jm-go" disabled={!text.trim() || thinking}>
          {thinking ? "Weighing" : "Find it"}
        </button>
      </form>
      <div className="jm-suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => void go(s)} aria-pressed={result?.query === s}>
            {s}
          </button>
        ))}
        <span className="jm-demo">Demo invoices</span>
      </div>

      <div className="jm-inv-body">
        <div className="jm-results">
          {!result && !thinking && (
            <div className="jm-empty">
              <b>{DEMO_INVOICES.length} invoices on file</b>
              <span>Ask in plain words. Jev weighs every invoice at once and gives each one odds.</span>
              <div className="jm-mini">
                {DEMO_INVOICES.slice(0, 6).map((inv) => (
                  <span key={inv.id} className="jm-mini-row">
                    <Avatar name={inv.client} brand={inv.brand} size={22} />
                    <b>{inv.client}</b>
                    <small>{inv.number}</small>
                    <em data-status={inv.status}>{inv.status}</em>
                    <span>{money(inv.amount)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {thinking && (
            <div className="jm-weighing">
              {[0, 1, 2].map((i) => <span key={i} className="jm-skel" style={{ "--i": i } as CSSProperties} />)}
            </div>
          )}
          {result && (
            <>
              <div className="jm-results-head">
                <b>
                  {result.matches.length === 0
                    ? "No invoice looks like that"
                    : result.single
                      ? "Best match"
                      : `${result.matches.length} invoices match`}
                </b>
                {result.clues.length > 0 && <span className="jm-clues">{result.clues.map((c) => <span key={c}>{c}</span>)}</span>}
                {owed > 0 && <span className="jm-owed">{money(owed)} open</span>}
              </div>
              {result.matches.length === 0 && <p className="jm-none">Try a client, a month, or words like unpaid or overdue.</p>}
              <div className="jm-cards" data-single={result.single || undefined}>
                {result.matches.map((h, i) => (
                  <InvoiceCard key={h.invoice.id} hit={h} lead={result.single && i === 0} minor={result.single && i > 0} index={i} onWhy={() => onWhy(result, h)} />
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="jm-odds-panel" data-thinking={thinking || undefined} aria-label="Jev's odds for every invoice">
          <header>
            <span><JevMark size={13} /> Jev's odds</span>
            <small>
              {result ? `${(result.decision.ms / 1000).toFixed(2)} s · ${fmtUsd(result.decision.costUsd)} · ${DEMO_INVOICES.length} checked` : thinking ? "Weighing every invoice" : "Waiting for a question"}
            </small>
          </header>
          <div className="jm-odds-list" ref={oddsRoot}>
            {odds.map((h, i) => {
              const p = thinking ? 0.15 + ((Math.sin((i + 1) * 7.3 + tick * 2.1) + 1) / 2) * 0.7 : h.odds;
              const hit = result?.matches.some((m) => m.invoice.id === h.invoice.id);
              return (
                <div key={h.invoice.id} data-flip={h.invoice.id} className="jm-odds-row" data-hit={hit || undefined} data-dim={result && !hit ? true : undefined}>
                  <Avatar name={h.invoice.client} brand={h.invoice.brand} size={18} />
                  <span className="jm-odds-name">{h.invoice.client}<small>{h.invoice.number}</small></span>
                  <span className="jm-odds-track"><span style={{ width: `${Math.max(1.5, p * 100)}%` }} /></span>
                  <b>{thinking || !result ? "" : `${Math.round(h.odds * 100)}%`}</b>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

function InvoiceCard({ hit, lead, minor, index, onWhy }: { hit: InvoiceHit; lead?: boolean; minor?: boolean; index: number; onWhy: () => void }) {
  const inv = hit.invoice;
  return (
    <article className="jm-invoice" data-lead={lead || undefined} data-minor={minor || undefined} style={{ "--i": index } as CSSProperties}>
      <header>
        <Avatar name={inv.client} brand={inv.brand} size={lead ? 44 : 34} />
        <span className="jm-invoice-who">
          <b>{inv.client}</b>
          <small>{inv.what}</small>
        </span>
        <span className="jm-invoice-amt">{money(inv.amount)}</span>
      </header>
      <dl>
        <div><dt>Invoice</dt><dd>{inv.number}</dd></div>
        <div><dt>Issued</dt><dd>{shortDate(inv.issued)}</dd></div>
        <div><dt>{inv.direction === "sent" ? "You billed" : "Bill to you"}</dt><dd>{inv.direction === "sent" ? "Client" : "Supplier"}</dd></div>
      </dl>
      <footer>
        <span className="jm-status" data-status={inv.status}>{statusText(inv)}</span>
        <span className="jm-pdf"><FileIcon size={13} /> {inv.pdf}</span>
        <button type="button" className="jm-match" onClick={onWhy} title="Why Jev picked this">
          <JevMark size={12} /> {Math.round(hit.odds * 100)}% match
        </button>
      </footer>
    </article>
  );
}
