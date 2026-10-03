import { useBusinessDemo } from "@/lib/business-demo";
import { AgentUsage } from "@/components/business/agent-usage";
import { FinanceSnapshotState } from "@/components/business/finance-snapshot-state";
import { SetupWelcome } from "@/components/operator/setup-welcome";
import { ProgressPanel } from "@/components/business/progress-panel";
import { AiSpendPanel } from "@/components/business/ai-spend-panel";
import { OVERVIEW_FINANCE_DEMO, WorkspaceOverview } from "@/components/business/workspace-overview";
import { AudiencePanel } from "@/components/business/audience-panel";
import { useBusinessWorkspace } from "@/lib/business-workspace";
import { businessGoalContext } from "@/lib/business-goal-context";
import { useOperator, operatorRequest } from "@/lib/operator";
import { useQuery } from "@tanstack/react-query";
import type { AudienceContentData } from "@/components/business/audience-content";
import { brainEnabled } from "@/lib/brain-sources";
import { BusinessComposer } from "@/components/operator/business-composer";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Curve,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  ChevronDown,
  Handshake,
  Receipt,
  Table2,
  Users,
  Video,
} from "lucide-react";
import "./business.css";
import { BusinessConnections, BusinessLogo } from "@/components/business/connections-panel";
import { InstrumentMark } from "@/components/business/instrument-mark";
import { PartnershipPipeline } from "@/components/business/partnership-pipeline";
import { useBusinessVideos, publishedInQuarter } from "@/lib/business-videos";
import { cn } from "@/lib/utils";
import { CURRENCIES, useCurrency } from "@/lib/currency";
import {
  BUSINESS_SAMPLE,
  STATUS,
  STREAMS,
  compactNumber,
  monthNet,
  monthTotal,
  pctChange,
  quarterProgress,
  type QuarterMetric,
  type StreamKey,
} from "@/lib/business-intel";

export const Route = createFileRoute("/business")({
  component: BusinessPage,
  head: () => ({
    meta: [
      { title: "Business — Agentic OS" },
      {
        name: "description",
        content: "Your priorities, AI spend, finances and audience in one workspace.",
      },
    ],
  }),
});

// ── shared chrome ──────────────────────────────────────────────────────────

const SERIES = ["#cbb0ed", "#91bfc7", "#a5d6bb", "#e7cb7b", "#ada2d9", "#d996af"] as const;
const SEQUENTIAL = [
  "#3d334b",
  "#564165",
  "#745387",
  "#946eac",
  "#b08bcd",
  "#c3a1dc",
  "#dbc2ef",
] as const;
const STREAM_COLOR: Record<StreamKey, string> = {
  sponsorships: SERIES[0],
  community: SERIES[1],
  products: SERIES[2],
  consulting: SERIES[3],
};
const SURFACE = "var(--op-panel)";
const INK = {
  primary: "var(--op-ink)",
  secondary: "var(--op-muted)",
  muted: "var(--op-muted)",
};
const GRID = "var(--op-border)";

function Panel({
  className,
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className={cn("biz-card relative overflow-hidden p-4 md:p-5", className)}
      style={{ background: SURFACE, ...style }}
    >
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[9.5px] uppercase tracking-[0.18em] text-white/38">{children}</div>;
}

function IconTile({ icon, tone }: { icon: ReactNode; tone: string }) {
  return (
    <span
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border text-white"
      style={{
        borderColor: `${tone}55`,
        background: `radial-gradient(120% 120% at 30% 20%, ${tone}66, ${tone}14 70%)`,
        boxShadow: `0 0 24px -6px ${tone}99, inset 0 1px 0 rgba(255,255,255,0.18)`,
      }}
    >
      {icon}
    </span>
  );
}

function Delta({
  pct,
  upIsGood = true,
  label,
}: {
  pct: number | null;
  upIsGood?: boolean;
  label: string;
}) {
  if (pct === null) return <span className="text-[11px] text-white/38">{label}</span>;
  const up = pct >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-white/62">
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[2px] text-[10.5px] font-medium"
        style={{
          color: good ? "#7ee2a1" : "#f2a4a4",
          background: good ? "rgba(12,163,12,0.14)" : "rgba(208,59,59,0.16)",
        }}
      >
        <Icon className="h-3 w-3" />
        {Math.abs(pct).toFixed(1)}%
      </span>
      {label}
    </span>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.025] p-0.5">
      {[
        { t: false, icon: <BarChart3 className="h-3.5 w-3.5" />, label: "Chart" },
        { t: true, icon: <Table2 className="h-3.5 w-3.5" />, label: "Table" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          aria-label={`${o.label} view`}
          aria-pressed={table === o.t}
          onClick={() => onChange(o.t)}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            table === o.t ? "bg-white/[0.09] text-white/90" : "text-white/40 hover:text-white/75",
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

// Eased ring progress. Monetary figures always render their actual value.
function useAnimatedNumber(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const val = a + (target - a) * e;
      setV(val);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    // Belt and braces: a throttled or hidden tab may starve rAF. The figure
    // must never sit at a wrong value, so settle it on a plain timer too.
    const settle = window.setTimeout(() => {
      setV(target);
      from.current = target;
    }, ms + 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [target, ms]);
  return v;
}

// ── marks ──────────────────────────────────────────────────────────────────

// Polar helper — angles are degrees clockwise from 12 o'clock.
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
};
const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

const SWEEP_START = -130;
const SWEEP_END = 130;
const SWEEP = SWEEP_END - SWEEP_START;

/**
 * Instrument-cluster dial: a 260° tick ring, a colored sweep for progress, an
 * optional needle, and an optional "pace" marker showing where the value
 * should be if progress were linear through the period.
 */
function Dial({
  value,
  max,
  color,
  size = 200,
  needle = false,
  pace,
  children,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
  needle?: boolean;
  /** 0..1 — where the value ought to sit right now. */
  pace?: number;
  children?: ReactNode;
}) {
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  const animated = useAnimatedNumber(frac, 1100);
  const cx = size / 2;
  const cy = size / 2;
  const rTrack = size * 0.42;
  const rTick = size * 0.47;
  const stroke = Math.max(6, size * 0.045);
  const ticks = 52;
  const valueAngle = SWEEP_START + SWEEP * animated;
  const paceAngle =
    pace === undefined ? null : SWEEP_START + SWEEP * Math.max(0, Math.min(1, pace));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="absolute inset-0"
        aria-hidden
      >
        <defs>
          <filter id="dial-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={size * 0.03} />
          </filter>
        </defs>
        {/* tick ring */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const a = SWEEP_START + (SWEEP * i) / ticks;
          const major = i % 13 === 0;
          const len = major ? size * 0.05 : size * 0.025;
          const [x0, y0] = polar(cx, cy, rTick, a);
          const [x1, y1] = polar(cx, cy, rTick - len, a);
          const lit = a <= valueAngle;
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={lit ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.16)"}
              strokeWidth={major ? 2 : 1.25}
              strokeLinecap="round"
            />
          );
        })}
        {/* track + sweep */}
        <path
          d={arcPath(cx, cy, rTrack, SWEEP_START, SWEEP_END)}
          fill="none"
          stroke={`${color}26`}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {animated > 0.002 && (
          <>
            <path
              d={arcPath(cx, cy, rTrack, SWEEP_START, valueAngle)}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              opacity={0.55}
              filter="url(#dial-glow)"
            />
            <path
              d={arcPath(cx, cy, rTrack, SWEEP_START, valueAngle)}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          </>
        )}
        {/* pace marker */}
        {paceAngle !== null &&
          (() => {
            const [x0, y0] = polar(cx, cy, rTrack + stroke, paceAngle);
            const [x1, y1] = polar(cx, cy, rTrack - stroke, paceAngle);
            return (
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })()}
        {/* needle */}
        {needle &&
          (() => {
            const [nx, ny] = polar(cx, cy, rTrack - stroke * 1.4, valueAngle);
            const [tx, ty] = polar(cx, cy, size * 0.06, valueAngle + 180);
            return (
              <>
                <line
                  x1={tx}
                  y1={ty}
                  x2={nx}
                  y2={ny}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={size * 0.03}
                  fill={SURFACE}
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth={2}
                />
              </>
            );
          })()}
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center text-center"
        style={{ paddingTop: needle ? size * 0.1 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

/** Fuel-gauge style segmented meter. Track is a lighter step of the fill hue. */
// Recharts tooltip in the page's chrome.
function ChartTip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string;
  money: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (typeof p.value === "number" ? p.value : 0), 0);
  return (
    <div
      className="rounded-lg border border-white/[0.1] px-3 py-2 text-[11px] shadow-xl"
      style={{ background: "#0d1015" }}
    >
      <div className="mb-1 font-medium text-white/85">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-white/62">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums text-white/85">{money(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex justify-between border-t border-white/[0.08] pt-1 text-white/62">
          <span>Total</span>
          <span className="tabular-nums text-white/90">{money(total)}</span>
        </div>
      )}
    </div>
  );
}

// Fixed month names: server and browser ICU disagree on en-GB abbreviations
// ("Sep" vs "Sept"), which breaks hydration. Never use toLocaleDateString here.
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDay = (iso: string, weekday = false) => {
  const d = new Date(iso + "T00:00:00Z");
  const core = `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
  return weekday ? `${DAYS_SHORT[d.getUTCDay()]} ${core}` : core;
};

// ── page ───────────────────────────────────────────────────────────────────

type Range = 3 | 6 | 12;
type BusinessView = "overview" | "finance" | "progress" | "audience";
const BUSINESS_VIEWS: BusinessView[] = ["overview", "finance", "progress", "audience"];

function BusinessPage() {
  return <BusinessCluster />;
}

function BusinessCluster() {
  const demo = useBusinessDemo();
  const data = BUSINESS_SAMPLE;
  const { data: workspace } = useBusinessWorkspace();
  const { state: operatorState } = useOperator();
  const tracker = useBusinessVideos();
  const cur = useCurrency();
  const money = (n: number, compact = false) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur.code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: compact ? 1 : 0,
      ...(compact ? { notation: "compact" as const } : {}),
    }).format(cur.convert(n));
  const [view, setView] = useState<BusinessView>("overview");
  const [range, setRange] = useState<Range>(6);
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>();
  const audienceContent = useQuery<AudienceContentData>({
    queryKey: ["business-content"],
    queryFn: () => operatorRequest("/business/content"),
    enabled: view === "audience",
    staleTime: 60_000,
    retry: 1,
  });
  const [financeDetail, setFinanceDetail] = useState<"accounts" | "partnerships" | "ai">(
    "accounts",
  );
  const [audiencePlatform, setAudiencePlatform] = useState<
    "youtube" | "instagram" | "tiktok" | "linkedin"
  >("youtube");
  useEffect(() => {
    const selection = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.platform &&
        ["youtube", "instagram", "tiktok", "linkedin"].includes(detail.platform)
      )
        setAudiencePlatform(detail.platform);
      setSelectedVideoId(detail?.videoId);
    };
    window.addEventListener("agentic:audience-selection", selection);
    return () => window.removeEventListener("agentic:audience-selection", selection);
  }, []);
  const importedAccounts = workspace?.finances?.accounts ?? [];
  const knownCurrency = importedAccounts[0]?.currency;
  const canCombineAccounts =
    importedAccounts.length > 0 &&
    !!knownCurrency &&
    importedAccounts.every(
      (account) => account.currency === knownCurrency && Number.isFinite(account.balance),
    );
  const formatAccount = (amount: number, currency: string | null) =>
    currency
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(amount)
      : amount.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const actualTotal = canCombineAccounts
    ? importedAccounts.reduce((sum, account) => sum + account.balance, 0)
    : null;
  // Keep older growth links working after introducing the Audience tab.
  useEffect(() => {
    const url = new URL(window.location.href);
    const platform = url.searchParams.get("platform");
    if (platform && ["youtube", "instagram", "tiktok", "linkedin"].includes(platform))
      setAudiencePlatform(platform as typeof audiencePlatform);
    const requested = url.searchParams.get("view");
    const wanted = requested === "growth" ? "audience" : requested;
    if (wanted && (BUSINESS_VIEWS as readonly string[]).includes(wanted))
      setView(wanted as BusinessView);
    if (requested === "growth") {
      url.searchParams.set("view", "audience");
      window.history.replaceState(null, "", url);
    }
  }, []);
  const today = new Date(data.generatedAt);
  const stamp = `${fmtDay(data.generatedAt.slice(0, 10))} ${data.generatedAt.slice(0, 4)}`;
  const months = data.months.slice(-range);
  const full = data.months.filter((m) => !m.partial);
  const lastFull = full[full.length - 1];
  const balance = data.accounts.reduce((s, a) => s + a.balance, 0);
  const balance30 = data.balanceHistory[data.balanceHistory.length - 31] ?? data.balanceHistory[0];
  const burn = full.slice(-3).reduce((s, m) => s + m.expenses, 0) / 3;
  const runway = balance / burn;
  const margin = (monthNet(lastFull) / monthTotal(lastFull)) * 100;
  const q = quarterProgress(data.quarter.start, data.quarter.end, today);
  const priority = data.quarter.priority;

  const selectView = (next: typeof view) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (next !== "audience") {
      url.searchParams.delete("platform");
      url.searchParams.delete("record");
    }
    window.history.replaceState(null, "", url);
    document.getElementById(`biz-tab-${next}`)?.focus();
  };

  const selectAudience = (platform?: typeof audiencePlatform) => {
    if (platform) setAudiencePlatform(platform);
    selectView("audience");
    if (platform) {
      const url = new URL(window.location.href);
      url.searchParams.set("platform", platform);
      window.history.replaceState(null, "", url);
    }
  };

  // Everything on the page, as the model sees it. Small on purpose: it rides
  // along with every question.
  const numbersContext = () => {
    if (!demo.enabled) return JSON.stringify({
      financialDataMode: workspace?.finances?.accounts?.length ? "saved account snapshot" : "no financial source connected",
      finances: workspace?.finances ?? null,
      audience: workspace?.snapshots ?? [],
      goals: workspace?.progress?.goals ?? [],
      note: "Missing income, expenses, targets and balances are unknown. Do not substitute fictional examples.",
    });
    const videosDone = publishedInQuarter(tracker.videos, data.quarter.start, data.quarter.end);
    return JSON.stringify({
      financialDataMode: "demo — these are sample figures, not connected account balances",
      asOf: stamp,
      currency: cur.code,
      bank: {
        total: money(balance),
        accounts: data.accounts.map((a) => ({ name: a.name, balance: money(a.balance) })),
        changeVs30DaysAgoPct: pctChange(balance, balance30)?.toFixed(1),
      },
      months: data.months.map((m) => ({
        month: m.month,
        partial: m.partial ?? false,
        income: money(monthTotal(m)),
        expenses: money(m.expenses),
        net: money(monthNet(m)),
        byStream: Object.fromEntries(STREAMS.map((st) => [st.key, money(m.income[st.key])])),
      })),
      runwayMonths: runway.toFixed(1),
      averageMonthlySpend: money(burn),
      marginPct: margin.toFixed(0),
      quarter: {
        label: data.quarter.label,
        daysLeft: q.left,
        priority: { ...priority },
        metrics: data.quarter.metrics.map((m) => ({
          ...m,
          value: m.key === "videos" ? videosDone : m.value,
        })),
      },
      deals: data.deals.map((d) => ({
        partner: d.partner,
        stage: d.stage,
        value: money(d.value),
        close: d.close,
      })),
      invoices: {
        owed: money(data.invoices.outstanding + data.invoices.overdue),
        unpaidCount: data.invoices.outstandingCount + data.invoices.overdueCount,
        overdue: money(data.invoices.overdue),
        overdueCount: data.invoices.overdueCount,
        collectedThisMonth: money(data.invoices.paidThisMonth),
      },
      expensesThisMonth: data.expensesThisMonth.map((l) => ({
        name: l.name,
        amount: money(l.amount),
      })),
    });
  };

  return (
    <div className="business-studio">
      <SetupWelcome/>
      <AgentUsage />
      <div className="biz-heading">
        <div>
          <div className="biz-overline">YOUR BUSINESS, IN FOCUS</div>
          <h1>
            Room to grow<span>.</span>
          </h1>
        </div>
        <div className="biz-context">
          {!demo.liveData && (
            <button className="biz-demo-toggle" type="button" aria-pressed={demo.enabled} onClick={() => demo.setEnabled(!demo.enabled)}>{demo.enabled ? "Demo numbers on" : "Demo numbers"}</button>
          )}
          <BusinessConnections />
        </div>
      </div>
      <div className="biz-toolbar">
        <div className="biz-tabs" role="tablist" aria-label="Business views">
          {(
            [
              { key: "overview", label: "Overview" },
              { key: "finance", label: "Finances" },
              { key: "progress", label: "Progress" },
              { key: "audience", label: "Audience" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              role="tab"
              id={`biz-tab-${tab.key}`}
              aria-selected={view === tab.key}
              aria-controls="biz-content"
              tabIndex={view === tab.key ? 0 : -1}
              onKeyDown={(e) => {
                const tabs = BUSINESS_VIEWS;
                const index = tabs.indexOf(view);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : e.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next >= 0) {
                  e.preventDefault();
                  selectView(tabs[next]);
                }
              }}
              onClick={() => selectView(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="biz-currency">
          Currency{" "}
          <select
            aria-label="Business currency"
            value={cur.selected}
            onChange={(e) => cur.setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
          {cur.code !== cur.selected && <small>Showing USD while rates load</small>}
        </label>
      </div>

      <div
        id="biz-content"
        role="tabpanel"
        aria-labelledby={`biz-tab-${view}`}
        key={view}
        className="biz-content"
      >
        {view === "overview" && (
          <WorkspaceOverview
            money={money}
            onAudience={selectAudience}
            onFinances={() => selectView("finance")}
            onProgress={() => selectView("progress")}
          />
        )}
        {view === "finance" && !demo.enabled && (
          <FinanceSnapshotState finances={workspace?.finances} onExamples={demo.liveData ? undefined : () => demo.setEnabled(true)} />
        )}
        {view === "finance" && demo.enabled && (
          <>
            <div className="biz-finance-group">
              <div className="biz-finance-label">
                <span>Your finances, in one view</span>
                <span>Revenue, cash flow and runway charts · Demo data, {stamp}</span>
              </div>
              <div className="biz-top-grid">
                <section
                  className={`biz-bank biz-finance-balance${accountsExpanded ? " is-expanded" : ""}`}
                  aria-labelledby="bank-heading"
                >
                  <div className="biz-bank-top">
                    <span className="biz-balance-provider">
                      <BusinessLogo provider="mercury" />
                    </span>
                    <h2 id="bank-heading">{importedAccounts.length && !canCombineAccounts ? "Account balances" : "Combined balance"}</h2>
                    <span className="biz-bank-code">
                      {canCombineAccounts
                        ? knownCurrency
                        : importedAccounts.length
                          ? "SNAPSHOT"
                          : "DEMO"}
                    </span>
                  </div>
                  <div className="biz-bank-caption">
                    {importedAccounts.length
                      ? `${importedAccounts.length} Mercury account snapshots`
                      : "Example accounts · Demo snapshot"}
                  </div>
                  <div
                    className={`biz-bank-number${importedAccounts.length && !canCombineAccounts ? " is-unavailable" : ""}`}
                  >
                    {actualTotal !== null
                      ? formatAccount(actualTotal, knownCurrency!)
                      : importedAccounts.length
                        ? <div className="biz-balance-numbers">{importedAccounts.map(account => <div key={account.sourceId || account.name}><span>{account.name}<small>{account.currency || "Currency not supplied"}</small></span><strong>{formatAccount(account.balance, account.currency)}</strong></div>)}</div>
                        : money(balance)}
                  </div>
                  <p className="biz-balance-availability">
                    {canCombineAccounts
                      ? `Recorded ${fmtDay(workspace!.finances!.recordedAt.slice(0, 10))} · ${workspace!.finances!.sourceLabel}`
                      : importedAccounts.length
                        ? `Recorded ${fmtDay(workspace!.finances!.recordedAt.slice(0, 10))} · Shown separately because currencies differ or are unknown.`
                        : "Connect your bank to replace this example with your own balances."}
                  </p>
                  <span className="biz-balance-chart-label">Demo balance trend · {stamp}</span>
                  <div
                    className="biz-bank-art"
                    role="img"
                    aria-label="Illustrative daily bank balance over 30 days, demo data"
                  >
                    <svg viewBox="0 0 420 110" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="bank-line" x1="0" x2="1">
                          <stop stopColor="#c2a7e6" stopOpacity=".12" />
                          <stop offset=".55" stopColor="#e2cdfb" />
                          <stop offset="1" stopColor="#f4eafe" />
                        </linearGradient>
                        <linearGradient id="bank-fill" x2="0" y2="1">
                          <stop stopColor="#cbb3ed" stopOpacity=".18" />
                          <stop offset="1" stopColor="#cbb3ed" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {(() => {
                        const values = data.balanceHistory.slice(-31);
                        const lo = Math.min(...values);
                        const hi = Math.max(...values);
                        const points = values.map((value, i) => ({
                          x: 8 + (i / (values.length - 1)) * 404,
                          y: 86 - ((value - lo) / (hi - lo || 1)) * 60,
                        }));
                        const end = points[points.length - 1];
                        return (
                          <>
                            <Curve
                              type="monotoneX"
                              points={points}
                              baseLine={110}
                              fill="url(#bank-fill)"
                              stroke="none"
                            />
                            <Curve
                              type="monotoneX"
                              points={points}
                              fill="none"
                              stroke="url(#bank-line)"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                            <circle cx={end.x} cy={end.y} r={7} fill="#e5cef4" opacity={0.1} />
                            <circle cx={end.x} cy={end.y} r={3} fill="#f2e7ff" />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <button
                    type="button"
                    className="biz-bank-footer"
                    aria-expanded={accountsExpanded}
                    aria-controls="finance-account-breakdown"
                    onClick={() => setAccountsExpanded(!accountsExpanded)}
                  >
                    <span>
                      <span className="biz-balance-provider is-small">
                        <BusinessLogo provider="mercury" />
                      </span>
                      {importedAccounts.length || data.accounts.length}{" "}
                      {importedAccounts.length ? "accounts" : "example accounts"}
                    </span>
                    <span>
                      {accountsExpanded ? "Hide accounts" : "Account details"}
                      <ChevronDown size={15} />
                    </span>
                  </button>
                  {accountsExpanded && (
                    <div id="finance-account-breakdown" className="biz-balance-breakdown">
                      {importedAccounts.length ? (
                        <>
                          <p>
                            {workspace?.finances?.sourceLabel} · recorded{" "}
                            {fmtDay(workspace!.finances!.recordedAt.slice(0, 10))}
                          </p>
                          {importedAccounts.map((account, index) => (
                            <div
                              className="biz-balance-account"
                              key={account.sourceId || `${account.name}-${index}`}
                            >
                              <span>
                                <strong>{account.name}</strong>
                                <small>{account.currency || "Account currency not provided"}</small>
                              </span>
                              <b>{formatAccount(account.balance, account.currency)}</b>
                            </div>
                          ))}
                          {!canCombineAccounts && (
                            <small className="biz-balance-footnote">
                              Amounts remain in their account currency. No currency conversion or
                              combined total has been applied.
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <p>Example account breakdown · Demo data</p>
                          {data.accounts.map((account) => (
                            <div className="biz-balance-account" key={account.name}>
                              <span>
                                <strong>{account.name}</strong>
                                <small>{account.note}</small>
                              </span>
                              <b>{money(account.balance)}</b>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </section>
                <RevenueOverview
                  months={months}
                  money={money}
                  range={range}
                  setRange={setRange}
                  lastFull={lastFull}
                  margin={margin}
                />
              </div>
              <div className="biz-finance-key-metrics">
                <section className="biz-card biz-runway">
                  <div className="biz-card-heading">
                    <h2>Runway</h2>
                    <span className="biz-small-tag">At current spending</span>
                  </div>
                  <RunwayInstrument months={runway} />
                  <div className="biz-runway-foot">
                    <span>Average monthly spend</span>
                    <strong>{money(burn)}</strong>
                  </div>
                </section>
                <ExpenseBreakdown lines={data.expensesThisMonth} money={money} />
                <InvoicesTile inv={data.invoices} money={money} />
              </div>
              <CashFlow months={months} money={money} />
            </div>
            <section className="biz-finance-deep-dive" id="finance-details">
              <div className="biz-finance-deep-tabs" role="tablist" aria-label="Finance details">
                {(
                  [
                    { id: "accounts", label: "Income history" },
                    { id: "partnerships", label: "Partnerships" },
                    { id: "ai", label: "AI spend" },
                  ] as const
                ).map((tab, index) => (
                  <button
                    type="button"
                    role="tab"
                    id={`finance-detail-${tab.id}`}
                    key={tab.id}
                    aria-selected={financeDetail === tab.id}
                    aria-controls="finance-detail-content"
                    tabIndex={financeDetail === tab.id ? 0 : -1}
                    onClick={() => setFinanceDetail(tab.id)}
                    onKeyDown={(event) => {
                      const keys = ["accounts", "partnerships", "ai"] as const;
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % 3
                          : event.key === "ArrowLeft"
                            ? (index + 2) % 3
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? 2
                                : -1;
                      if (next >= 0) {
                        event.preventDefault();
                        setFinanceDetail(keys[next]);
                        document.getElementById(`finance-detail-${keys[next]}`)?.focus();
                      }
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div
                className="biz-finance-deep-content"
                id="finance-detail-content"
                role="tabpanel"
                aria-labelledby={`finance-detail-${financeDetail}`}
              >
                {financeDetail === "accounts" && (
                  <>
                    <div className="biz-finance-label">
                      <span>Income by month</span>
                      <span>Demo data · {stamp}</span>
                    </div>
                    <IncomeByMonth months={months} money={money} />
                  </>
                )}
                {financeDetail === "partnerships" && (
                  <>
                    <div className="biz-finance-label">
                      <span>Example partnership pipeline</span>
                      <span>Demo data · {stamp}</span>
                    </div>
                    <PartnershipPipeline deals={data.deals} money={money} />
                  </>
                )}
                {financeDetail === "ai" && <AiSpendPanel money={money} />}
              </div>
            </section>
          </>
        )}
        {view === "progress" && <ProgressPanel />}
        {view === "audience" && (
          <AudiencePanel initialPlatform={audiencePlatform} />
        )}
      </div>
      <BusinessComposer
        context={JSON.stringify({
          section: view,
          profile: {
            businessName: workspace?.profile?.businessName,
            whatYouDo: workspace?.profile?.whatYouDo,
            whoYouHelp: workspace?.profile?.whoYouHelp,
            longTermDirection: workspace?.profile?.longTermDirection,
            ...(brainEnabled(operatorState, "personal")
              ? {
                  preferredName: workspace?.profile?.preferredName,
                  personalPriorities: workspace?.profile?.personalPriorities,
                }
              : {}),
          },
          ...businessGoalContext(workspace),
          ...(view === "overview"
            ? demo.enabled
              ? {
                  overviewFinancialPreview: OVERVIEW_FINANCE_DEMO,
                  instruction:
                    "Overview financial cards are explicitly labelled Demo. They do not represent actual cash, income or revenue targets. Missing social totals marked Demo are illustrative and are not observed metrics.",
                }
              : {
                  importedBalances: workspace?.finances ?? null,
                  revenueTargetMonthly: workspace?.profile?.revenueTargetMonthly ?? null,
                  audienceObservations: workspace?.snapshots ?? [],
                  instruction:
                    "Cash on hand is the sum of saved account balances per currency at their recorded date. Monthly income is the observed sum of settled incoming payments over the trailing 30 days with internal transfers excluded; it is gross money in, not profit. The revenue target is set by the operator in USD. Missing values are unknown; never substitute example figures.",
                }
            : {}),
          ...(view === "finance"
            ? {
                importedBalances: workspace?.finances ?? null,
                exampleFinancialFigures: numbersContext(),
                instruction:
                  "The example financial figures are sample data. Never describe sample figures as actual revenue, balances or invoices. Imported balances are dated snapshots in their stated currency; a null currency is unknown and must not be assumed or converted.",
              }
            : {}),
          ...(view === "audience"
            ? {
                selectedPlatform: audiencePlatform,
                selectedVideoId,
                audienceObservations: workspace?.snapshots ?? [],
                youtubeContent: audienceContent.data
                  ? {
                      recordedAt: audienceContent.data.recordedAt,
                      sourceLabel: audienceContent.data.sourceLabel,
                      videos: audienceContent.data.videos
                        .filter(
                          (video) =>
                            typeof video.durationSeconds === "number" &&
                            video.durationSeconds > 180,
                        )
                        .slice(0, 6)
                        .map((video) => ({
                          id: video.id,
                          title: video.title,
                          url: video.url,
                          publishedAt: video.publishedAt,
                          views: video.views,
                          likes: video.likes,
                          commentCount: video.commentCount,
                          commentStatus: video.commentStatus,
                          commentSampleSize: video.commentSampleSize,
                          durationSeconds: video.durationSeconds,
                          commentSummary: video.commentSummary,
                          comments: video.comments,
                        })),
                      sampledThemes: audienceContent.data.insights,
                      sampling: audienceContent.data.sampling,
                      insightMethod: audienceContent.data.insightMethod,
                    }
                  : null,
                instruction:
                  "Use the recorded social observations and the sampled YouTube comments with their observation dates. Comment samples are not representative of the full audience. Missing metrics are unknown; do not substitute Demo values.",
              }
            : {}),
        })}
      />
      <footer className="biz-footer">
        <span>YOUR BUSINESS WORKSPACE</span>
        <span>Built around the way you work.</span>
      </footer>
    </div>
  );
}

function RunwayInstrument({ months }: { months: number }) {
  const value = Math.max(0, Math.min(12, months));
  return (
    <div
      className="biz-instrument"
      role="img"
      aria-label={`${months.toFixed(1)} months of runway at current spending, on a 12-month scale`}
    >
      <svg viewBox="0 0 240 164" aria-hidden="true">
        <defs>
          <linearGradient id="runway-arc">
            <stop stopColor="#568678" />
            <stop offset=".55" stopColor="#a9dcc7" />
            <stop offset="1" stopColor="#d2f9e3" />
          </linearGradient>
        </defs>
        {Array.from({ length: 41 }, (_, i) => {
          const angle = -120 + i * 6;
          const [x1, y1] = polar(120, 119, 104, angle);
          const [x2, y2] = polar(120, 119, i % 5 === 0 ? 95 : 99, angle);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={i / 40 <= value / 12 ? "#88b8a2" : "#36363b"}
              strokeWidth={i % 5 === 0 ? 1.5 : 1}
            />
          );
        })}
        <path
          d={arcPath(120, 119, 83, -120, 120)}
          stroke="#292d2c"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={arcPath(120, 119, 83, -120, -120 + (240 * value) / 12)}
          stroke="url(#runway-arc)"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
        />
        <text
          x="120"
          y="119"
          textAnchor="middle"
          fill="var(--op-ink)"
          fontSize="43"
          fontWeight="450"
          letterSpacing="-2"
        >
          {months.toFixed(1)}
        </text>
        <text x="120" y="140" textAnchor="middle" fill="#939b97" fontSize="11">
          months of runway
        </text>
      </svg>
      <span className="biz-scale-zero">0</span>
      <span className="biz-scale-max">12</span>
    </div>
  );
}

function RevenueOverview({
  months,
  money,
  range,
  setRange,
  lastFull,
  margin,
}: {
  months: typeof BUSINESS_SAMPLE.months;
  money: (n: number, c?: boolean) => string;
  range: Range;
  setRange: (r: Range) => void;
  lastFull: (typeof BUSINESS_SAMPLE.months)[number];
  margin: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const total = months.reduce((sum, m) => sum + monthTotal(m), 0);
  const peak = Math.max(...months.map(monthTotal));
  const active = months.find((m) => m.month === selected);
  return (
    <section className="biz-card biz-revenue">
      <div className="biz-card-heading">
        <h2>Income</h2>
        <div className="biz-revenue-controls">
          <div className="biz-range" aria-label="Income period">
            {([3, 6, 12] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRange(r);
                  setSelected(null);
                }}
                aria-pressed={r === range}
              >
                {r}M
              </button>
            ))}
          </div>
          <button
            className="biz-icon-button"
            onClick={() => setTable((v) => !v)}
            aria-label={table ? "Show income chart" : "Show income table"}
          >
            {table ? <BarChart3 size={15} /> : <Table2 size={15} />}
          </button>
        </div>
      </div>
      <div className="biz-income-heading">
        <strong>{money(active ? monthTotal(active) : total)}</strong>
        <span>
          {active
            ? `${active.label}${active.partial ? " · in progress" : ""}`
            : `past ${range} months`}
        </span>
      </div>
      {table ? (
        <div className="biz-income-table">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Income</th>
                <th>Net profit</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {m.label}
                    {m.partial ? " (in progress)" : ""}
                  </td>
                  <td>{money(monthTotal(m))}</td>
                  <td>{money(monthNet(m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="biz-revenue-chart">
          <div className="biz-chart-guide">
            <span>{money(peak, true)}</span>
            <span>{money(peak / 2, true)}</span>
            <span>0</span>
          </div>
          <div className="biz-chart-bars">
            {months.map((m) => (
              <button
                key={m.month}
                aria-label={`${m.label}${m.partial ? ", month in progress" : ""}: ${money(monthTotal(m))} income`}
                aria-pressed={selected === m.month}
                className={cn(
                  "biz-month",
                  m.partial && "is-partial",
                  selected === m.month && "is-selected",
                )}
                onMouseEnter={() => setSelected(m.month)}
                onMouseLeave={() => setSelected(null)}
                onFocus={() => setSelected(m.month)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(selected === m.month ? null : m.month)}
              >
                <span className="biz-bar-track">
                  <span
                    className="biz-bar-fill"
                    style={{ height: `${(monthTotal(m) / peak) * 100}%` }}
                  >
                    <span />
                  </span>
                </span>
                <span className="biz-month-label">
                  {m.label}
                  {m.partial ? "*" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="biz-chart-caption">
        <span>
          <i />
          Income received
        </span>
        <span>* Month in progress</span>
      </div>
      <div className="biz-revenue-stats">
        <div>
          <span>{lastFull.label} income</span>
          <strong>{money(monthTotal(lastFull))}</strong>
        </div>
        <div>
          <span>{lastFull.label} net profit</span>
          <strong>{money(monthNet(lastFull))}</strong>
        </div>
        <div>
          <span>Profit margin</span>
          <strong className="biz-mint">
            {margin.toFixed(0)}% <ArrowUpRight size={13} />
          </strong>
        </div>
      </div>
    </section>
  );
}

function MetricDial({
  metric,
  color,
  fraction,
}: {
  metric: QuarterMetric;
  color: string;
  fraction: number;
}) {
  const Icon = metric.icon === "video" ? Video : metric.icon === "handshake" ? Handshake : Users;
  const pct = pctChange(metric.value, metric.previous);
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
      <Dial value={metric.value} max={metric.target} color={color} size={150} pace={fraction}>
        <Icon className="mb-1 h-4 w-4 text-white/55" />
        <div className="text-[26px] font-semibold leading-none tracking-[-0.035em] text-white/95">
          {compactNumber(metric.value)}
        </div>
        <div className="mt-1 text-[10px] text-white/45">of {compactNumber(metric.target)}</div>
      </Dial>
      <div className="mt-2 text-[12px] font-medium text-white/85">{metric.label}</div>
      <div className="mt-1.5">
        <Delta pct={pct} label="vs last quarter" />
      </div>
    </div>
  );
}

// ── charts ─────────────────────────────────────────────────────────────────

function IncomeByMonth({
  months,
  money,
  className,
}: {
  months: typeof BUSINESS_SAMPLE.months;
  money: (n: number, c?: boolean) => string;
  className?: string;
}) {
  const [table, setTable] = useState(false);
  const [focus, setFocus] = useState<StreamKey | null>(null);
  const rows = months.map((m) => ({
    label: m.label + (m.partial ? "*" : ""),
    ...m.income,
    total: monthTotal(m),
  }));
  const best = rows.reduce((b, r) => (r.total > b.total ? r : b), rows[0]);
  const shown = STREAMS.filter((s) => !focus || s.key === focus);

  return (
    <Panel className={className}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Eyebrow>Income by month</Eyebrow>
          <div className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-white/90">
            {money(
              rows.reduce((s, r) => s + r.total, 0),
              true,
            )}{" "}
            <span className="text-[12px] font-normal text-white/45">
              over {months.length} months
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle table={table} onChange={setTable} />
        </div>
      </div>

      {/* legend — click to isolate a stream */}
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Income streams">
        {STREAMS.map((s) => {
          const active = !focus || focus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={focus === s.key}
              onClick={() => setFocus(focus === s.key ? null : s.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] transition-colors",
                active ? "border-white/[0.12] text-white/80" : "border-white/[0.06] text-white/35",
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STREAM_COLOR[s.key], opacity: active ? 1 : 0.35 }}
              />
              {s.label}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[10px] text-white/35">* month in progress</span>
      </div>

      {table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-white/45">
                <th className="py-1.5 pr-3 font-medium">Month</th>
                {STREAMS.map((s) => (
                  <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-white/80">
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-white/[0.06]">
                  <td className="py-1.5 pr-3 text-white/62">{r.label}</td>
                  {STREAMS.map((s) => (
                    <td key={s.key} className="py-1.5 pr-3 text-right">
                      {money(r[s.key])}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-medium text-white/92">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 18, right: 8, left: -12, bottom: 0 }}
              barCategoryGap="30%"
            >
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                tick={{ fill: INK.muted, fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK.muted, fontSize: 10.5 }}
                tickFormatter={(v: number) => money(v, true)}
                width={64}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={<ChartTip money={(n) => money(n)} />}
              />
              {shown.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="income"
                  fill={STREAM_COLOR[s.key]}
                  stroke={SURFACE}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={i === shown.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive
                  animationDuration={700}
                  label={
                    i === shown.length - 1
                      ? ({
                          x,
                          y,
                          width,
                          index,
                        }: {
                          x?: number;
                          y?: number;
                          width?: number;
                          index?: number;
                        }) => {
                          const r = rows[index ?? -1];
                          if (
                            !r ||
                            r.label !== best.label ||
                            x === undefined ||
                            y === undefined ||
                            width === undefined
                          )
                            return <g />;
                          return (
                            <text
                              x={x + width / 2}
                              y={y - 6}
                              textAnchor="middle"
                              fill={INK.secondary}
                              fontSize={10.5}
                            >
                              {money(focus ? r[focus] : r.total, true)}
                            </text>
                          );
                        }
                      : undefined
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function CashFlow({
  months,
  money,
  className,
}: {
  months: typeof BUSINESS_SAMPLE.months;
  money: (n: number, c?: boolean) => string;
  className?: string;
}) {
  const [table, setTable] = useState(false);
  const rows = months.map((m) => ({
    label: m.label + (m.partial ? "*" : ""),
    in: monthTotal(m),
    out: m.expenses,
    net: monthNet(m),
  }));
  const positive = rows.filter((r) => r.net >= 0).length;
  return (
    <Panel className={className}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>Net cash flow</Eyebrow>
          <div className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-white/90">
            {positive} of {rows.length} months positive
          </div>
        </div>
        <ViewToggle table={table} onChange={setTable} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10.5px] text-white/50">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: SERIES[2] }} /> Money in
          exceeds out
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: SERIES[0] }} /> Out exceeds in
        </span>
      </div>
      {table ? (
        <table className="mt-3 w-full text-[11.5px]">
          <thead>
            <tr className="text-left text-white/45">
              <th className="py-1.5 font-medium">Month</th>
              <th className="py-1.5 text-right font-medium">In</th>
              <th className="py-1.5 text-right font-medium">Out</th>
              <th className="py-1.5 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-white/80">
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-white/[0.06]">
                <td className="py-1.5 text-white/62">{r.label}</td>
                <td className="py-1.5 text-right">{money(r.in)}</td>
                <td className="py-1.5 text-right">{money(r.out)}</td>
                <td className="py-1.5 text-right font-medium text-white/92">{money(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-2 h-[190px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              barCategoryGap="35%"
            >
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK.muted, fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK.muted, fontSize: 10.5 }}
                tickFormatter={(v: number) => money(v, true)}
                width={64}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={<ChartTip money={(n) => money(n)} />}
              />
              <Bar
                dataKey="net"
                name="Net"
                maxBarSize={22}
                radius={4}
                isAnimationActive
                animationDuration={700}
              >
                {rows.map((r) => (
                  <Cell key={r.label} fill={r.net >= 0 ? SERIES[2] : SERIES[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function ExpenseBreakdown({
  lines,
  money,
  className,
}: {
  lines: typeof BUSINESS_SAMPLE.expensesThisMonth;
  money: (n: number, c?: boolean) => string;
  className?: string;
}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <Panel className={className}>
      <Eyebrow>Where the money goes · this month</Eyebrow>
      <div className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-white/90">
        {money(total)}
      </div>
      <div
        className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label="Expense breakdown"
      >
        {lines.map((l, i) => (
          <div
            key={l.name}
            onMouseEnter={() => setHover(l.name)}
            onMouseLeave={() => setHover(null)}
            className="h-full transition-opacity"
            style={{
              width: `${(l.amount / total) * 100}%`,
              background: SERIES[i % SERIES.length],
              opacity: hover && hover !== l.name ? 0.35 : 1,
            }}
            title={`${l.name} ${money(l.amount)}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {lines.map((l, i) => (
          <li
            key={l.name}
            onMouseEnter={() => setHover(l.name)}
            onMouseLeave={() => setHover(null)}
            className={cn(
              "flex items-center justify-between text-[11.5px] transition-opacity",
              hover && hover !== l.name && "opacity-45",
            )}
          >
            <span className="inline-flex items-center gap-2 text-white/70">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: SERIES[i % SERIES.length] }}
              />
              {l.name}
            </span>
            <span className="tabular-nums text-white/85">
              {money(l.amount)}{" "}
              <span className="text-white/38">{((l.amount / total) * 100).toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function InvoicesTile({
  inv,
  money,
  className,
}: {
  inv: typeof BUSINESS_SAMPLE.invoices;
  money: (n: number, c?: boolean) => string;
  className?: string;
}) {
  const total = inv.outstanding + inv.overdue + inv.paidThisMonth;
  const segs = [
    { k: "Paid this month", v: inv.paidThisMonth, n: inv.paidCount, color: SERIES[2] },
    { k: "Outstanding", v: inv.outstanding, n: inv.outstandingCount, color: SERIES[1] },
    { k: "Overdue", v: inv.overdue, n: inv.overdueCount, color: STATUS.critical, status: true },
  ];
  return (
    <Panel className={className}>
      <div className="flex items-start gap-3">
        <IconTile icon={<Receipt className="h-5 w-5" />} tone={SERIES[1]} />
        <div className="min-w-0 flex-1">
          <Eyebrow>Invoices</Eyebrow>
          <div className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-white/95">
            {money(inv.outstanding + inv.overdue)}
          </div>
          <div className="mt-1.5 text-[11px] text-white/50">
            owed to you across {inv.outstandingCount + inv.overdueCount} invoices
          </div>
        </div>
      </div>
      <div className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segs.map((s) => (
          <div
            key={s.k}
            className="h-full"
            style={{ width: `${(s.v / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segs.map((s) => (
          <li key={s.k} className="flex items-center justify-between text-[11.5px]">
            <span className="inline-flex items-center gap-2 text-white/70">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.k}
              {s.status && s.n > 0 && (
                <span
                  className="rounded-full px-1.5 py-[1px] text-[9.5px] font-medium"
                  style={{ color: "#f2a4a4", background: "rgba(208,59,59,0.16)" }}
                >
                  chase
                </span>
              )}
            </span>
            <span className="tabular-nums text-white/85">
              {money(s.v)} <span className="text-white/38">· {s.n}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
