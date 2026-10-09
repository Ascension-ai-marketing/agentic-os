import { OverviewCards } from "./overview-cards";
import { FinanceSnapshotState } from "./finance-snapshot-state";
import { useBusinessDemo } from "@/lib/business-demo";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useId,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronDown, KeyRound, Link2, Pencil, Plus, RefreshCw, Target, X } from "lucide-react";
import {
  audienceSeries,
  useBusinessWorkspace,
  type AudiencePlatform,
  type BusinessWorkspace,
  type MonthlyIncome,
} from "@/lib/business-workspace";
import { useWorkspaceProfile } from "@/lib/workspace-profile";
import { operatorRequest } from "@/lib/operator";
import { BUSINESS_SAMPLE, monthTotal } from "@/lib/business-intel";
import { AudienceLogo } from "./audience-panel";
import { InstrumentMark } from "./instrument-mark";
import { openBusinessAccounts } from "./connections-panel";
import "./workspace-overview.css";

const briefModules = import.meta.glob<{ DailyBrief: ComponentType }>("./daily-brief.tsx");
const BriefPlaceholder = () => (
  <section className="biz-card biz-overview-brief-placeholder" aria-busy="true">
    <h2>Your daily brief</h2>
    <div />
    <div />
  </section>
);
const DailyBrief = lazy(async () => {
  const load = briefModules["./daily-brief.tsx"];
  return { default: load ? (await load()).DailyBrief : BriefPlaceholder };
});

const quarterMonths = BUSINESS_SAMPLE.months.filter(
  (month) =>
    month.month >= BUSINESS_SAMPLE.quarter.start.slice(0, 7) &&
    month.month <= BUSINESS_SAMPLE.quarter.end.slice(0, 7),
);
export const OVERVIEW_FINANCE_DEMO = {
  mode: "Demo snapshot — illustrative, not the user's actual finances",
  asOf: BUSINESS_SAMPLE.generatedAt,
  totalCash: BUSINESS_SAMPLE.accounts.reduce((sum, account) => sum + account.balance, 0),
  monthIncome: monthTotal(BUSINESS_SAMPLE.months.at(-1)!),
  quarterRevenue: quarterMonths.reduce((sum, month) => sum + monthTotal(month), 0),
  quarterTarget: 1_500_000,
};
const SOCIAL_PREVIEWS = [
  { id: "youtube", name: "YouTube", label: "Subscribers", metric: "followers", tone: "#de9ba5" },
  { id: "instagram", name: "Instagram", label: "Followers", metric: "followers", tone: "#cba5d5" },
  { id: "tiktok", name: "TikTok", label: "Followers", metric: "followers", tone: "#87c9c0" },
  { id: "linkedin", name: "LinkedIn", label: "Followers", metric: "followers", tone: "#9db7df" },
] as const;
/** Profile link labels that map onto an audience platform card. Anything else stays a plain linked profile. */
const LINK_PLATFORMS: Record<string, AudiencePlatform> = {
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  linkedin: "linkedin",
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatDate = (value: string) => {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`;
};
const formatAmount = (amount: number, currency: string | null, compact = false) =>
  currency
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: compact ? 1 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(amount)
    : amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
const hostLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function SparkArt({
  values,
  className = "",
  filled = true,
}: {
  values: number[];
  className?: string;
  filled?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const lo = Math.min(...values),
    hi = Math.max(...values);
  const points = values.map((value, index) => ({
    x: values.length > 1 ? (index / (values.length - 1)) * 400 : 200,
    y: 82 - ((value - lo) / (hi - lo || 1)) * 60,
  }));
  const end = points.at(-1);
  const fixed = (value: number) => value.toFixed(3);
  let path = points.length ? `M${fixed(points[0].x)},${fixed(points[0].y)}` : "";
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1],
      point = points[i],
      middle = (previous.x + point.x) / 2;
    path += `C${fixed(middle)},${fixed(previous.y)},${fixed(middle)},${fixed(point.y)},${fixed(point.x)},${fixed(point.y)}`;
  }
  return (
    <svg className={className} viewBox="0 0 400 105" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`overview-area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="currentColor" stopOpacity=".16" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled && path && (
        <path d={`${path}L400,105L0,105Z`} fill={`url(#overview-area-${id})`} stroke="none" />
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
      {end && (
        <>
          <circle cx={fixed(end.x)} cy={fixed(end.y)} r="8" fill="currentColor" opacity=".08" />
          <circle cx={fixed(end.x)} cy={fixed(end.y)} r="2.8" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function TargetRing({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="biz-overview-target-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        {Array.from({ length: 40 }, (_, index) => {
          const angle = (index / 40) * Math.PI * 2;
          return (
            <line
              key={index}
              x1={(90 + Math.sin(angle) * 86).toFixed(3)}
              y1={(90 - Math.cos(angle) * 86).toFixed(3)}
              x2={(90 + Math.sin(angle) * 82).toFixed(3)}
              y2={(90 - Math.cos(angle) * 82).toFixed(3)}
              stroke="currentColor"
              strokeOpacity={index / 40 < clamped / 100 ? 0.65 : 0.2}
            />
          );
        })}
        <circle className="track" cx="90" cy="90" r="67" />
        <circle
          className="value"
          cx="90"
          cy="90"
          r="67"
          pathLength="100"
          strokeDasharray={`${clamped} 100`}
          transform="rotate(-90 90 90)"
        />
      </svg>
      <span>
        {clamped.toFixed(0)}
        <small>%</small>
        <em>of your goal</em>
      </span>
    </div>
  );
}

/** Click to edit. Saves on Enter or blur, Escape cancels. Targets are stored in USD. */
function TargetEditor({
  value,
  onSave,
}: {
  value?: number;
  onSave: (target: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(value ? String(Math.round(value)) : "");
      requestAnimationFrame(() => input.current?.select());
    }
  }, [editing, value]);
  async function commit() {
    const parsed = Number(draft.replace(/[^0-9.]/g, ""));
    if (!draft.trim()) {
      setEditing(false);
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a number above zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(parsed);
      setEditing(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    }
    if (event.key === "Escape") {
      setEditing(false);
      setError("");
    }
  }
  if (editing)
    return (
      <span className="biz-overview-target-editor">
        <label>
          <span className="sr-only">Monthly revenue target in US dollars</span>
          <b>$</b>
          <input
            ref={input}
            type="text"
            inputMode="numeric"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keys}
            onBlur={() => void commit()}
            aria-invalid={!!error}
          />
          <small>USD / month</small>
        </label>
        <button type="button" aria-label="Save target" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void commit()}>
          <Check size={13} />
        </button>
        <button type="button" aria-label="Cancel" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => { setEditing(false); setError(""); }}>
          <X size={13} />
        </button>
        {error && <em role="alert">{error}</em>}
      </span>
    );
  return (
    <button type="button" className="biz-overview-target-edit" onClick={() => setEditing(true)}>
      {value ? formatAmount(value, "USD") : "Set a monthly target"}
      <Pencil size={11} />
    </button>
  );
}

function LiveFinanceCards({
  finances,
  target,
  onFinances,
  onSaveTarget,
  onRefreshed,
}: {
  finances: NonNullable<BusinessWorkspace["finances"]>;
  target?: number;
  onFinances: () => void;
  onSaveTarget: (target: number | null) => Promise<void>;
  onRefreshed: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const accounts = finances.accounts;
  const groups = [...accounts.reduce((map, account) => {
    const key = account.currency || "";
    map.set(key, (map.get(key) || 0) + account.balance);
    return map;
  }, new Map<string, number>())].map(([currency, total]) => ({ currency: currency || null, total }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const primary = groups[0];
  const primaryAccounts = accounts.filter((account) => (account.currency || null) === primary.currency);
  const primaryPositive = primaryAccounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
  const income: MonthlyIncome | undefined = finances.monthlyIncome;
  const source = finances.sourceLabel.split("·")[0].trim() || "Connected bank";
  const progress = income && target ? Math.min(100, (income.amount / target) * 100) : 0;
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await operatorRequest<{ monthlyIncomeError?: string }>("/business/mercury/sync", {});
      await onRefreshed();
      if (result.monthlyIncomeError) setRefreshError(result.monthlyIncomeError);
    } catch (cause) {
      setRefreshError((cause as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  const incomeWindow = income
    ? `${formatDate(income.windowStart || new Date(Date.parse(income.recordedAt) - income.days * 86400000).toISOString())} – ${formatDate(income.windowEnd || income.recordedAt)}`
    : "";
  return (
    <>
      <OverviewCards
        caption={
          <>
            Live · {source}, recorded {formatDate(finances.recordedAt)}
            <button type="button" className="biz-overview-refresh" disabled={refreshing} onClick={() => void refresh()} aria-label="Refresh balances and income from Mercury">
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </>
        }
        cards={[
          {
            id: "cash",
            label: "Cash on hand",
            content: (
              <section className={`biz-bank biz-overview-money-card is-overview-cash is-live${expanded ? " is-expanded" : ""}`}>
                <div className="biz-bank-top">
                  <InstrumentMark kind="bank" />
                  <h2>Cash on hand</h2>
                  <span className="biz-overview-live-chip">Live</span>
                </div>
                <div className="biz-bank-caption">
                  {accounts.length === 1 ? "One connected account" : `All ${accounts.length} connected accounts`}
                  {groups.length > 1 ? " · by currency" : ""}
                </div>
                <div className="biz-bank-number">
                  {formatAmount(primary.total, primary.currency)}
                  {!primary.currency && <small className="biz-overview-currency-note">currency not supplied</small>}
                </div>
                {groups.length > 1 && (
                  <ul className="biz-overview-currency-groups" aria-label="Totals in other currencies">
                    {groups.slice(1).map((group) => (
                      <li key={group.currency || "unspecified"}>
                        <span>{group.currency || "No currency"}</span>
                        <strong>{formatAmount(group.total, group.currency)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="biz-overview-money-sub">
                  <span className="biz-overview-small-dot" /> {source} · {formatDate(finances.recordedAt)}
                </div>
                <div className="biz-overview-share" role="img" aria-label={`Share of ${primary.currency || "combined"} cash by account`}>
                  {primaryAccounts.map((account, index) => (
                    <span
                      key={account.sourceId || `${account.name}-${index}`}
                      style={{ flexGrow: Math.max(0.04, primaryPositive ? Math.max(0, account.balance) / primaryPositive : 1 / primaryAccounts.length) }}
                      title={`${account.name}: ${formatAmount(account.balance, account.currency)}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="biz-bank-footer"
                  aria-expanded={expanded}
                  aria-controls="overview-account-breakdown"
                  onClick={() => setExpanded(!expanded)}
                >
                  <span>
                    <span className="biz-account-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
                  </span>
                  <span>
                    {expanded ? "Hide breakdown" : "Show breakdown"} <ChevronDown size={13} />
                  </span>
                </button>
                {expanded && (
                  <div id="overview-account-breakdown" className="biz-overview-breakdown">
                    {accounts.map((account, index) => (
                      <div key={account.sourceId || `${account.name}-${index}`}>
                        <span>
                          <strong>{account.name}</strong>
                          <small>{account.currency || "Currency not supplied"}</small>
                        </span>
                        <b>{formatAmount(account.balance, account.currency)}</b>
                      </div>
                    ))}
                    <button type="button" onClick={onFinances}>
                      Open finances <ArrowUpRight size={12} />
                    </button>
                  </div>
                )}
              </section>
            ),
          },
          {
            id: "income",
            label: "Monthly income",
            content: (
              <section className="biz-bank biz-overview-money-card is-overview-income is-live">
                <div className="biz-bank-top">
                  <InstrumentMark kind="invoice" tone="mint" />
                  <h2>Monthly income</h2>
                  <span className="biz-overview-live-chip">Live</span>
                </div>
                <div className="biz-bank-caption">Last 30 days · Mercury</div>
                {income ? (
                  <>
                    <div className="biz-bank-number">{formatAmount(income.amount, income.currency)}</div>
                    <div className="biz-overview-money-sub">
                      <span className="biz-overview-small-dot" />
                      {income.transactions} settled {income.transactions === 1 ? "payment" : "payments"} in · {incomeWindow}
                    </div>
                    <dl className="biz-overview-income-facts">
                      <div>
                        <dt>Per day</dt>
                        <dd>{formatAmount(income.amount / income.days, income.currency)}</dd>
                      </div>
                      <div>
                        <dt>Per payment</dt>
                        <dd>{income.transactions ? formatAmount(income.amount / income.transactions, income.currency) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Read</dt>
                        <dd>{formatDate(income.recordedAt)}</dd>
                      </div>
                    </dl>
                    {target ? (
                      <div className="biz-overview-income-track" role="img" aria-label={`${progress.toFixed(0)} percent of the monthly target`}>
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="biz-bank-number is-unavailable">Not read yet</div>
                    <p className="biz-overview-income-hint">
                      Refresh from Mercury to total the settled payments that came in over the last 30 days. Internal transfers are left out.
                    </p>
                  </>
                )}
                {(refreshError || finances.monthlyIncomeError) && (
                  <p className="biz-overview-income-error" role="status">
                    {refreshError || `Last read failed: ${finances.monthlyIncomeError?.message}`}
                  </p>
                )}
                <button type="button" className="biz-bank-footer" disabled={refreshing} onClick={() => void refresh()}>
                  <span>
                    <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                    {refreshing ? "Reading Mercury…" : income ? "Refresh income" : "Read from Mercury"}
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </section>
            ),
          },
          {
            id: "target",
            label: "Revenue target",
            content: (
              <section className="biz-bank biz-overview-money-card is-overview-target is-live">
                <div className="biz-bank-top">
                  <span className="biz-overview-target-icon">
                    <Target size={19} strokeWidth={1.4} />
                  </span>
                  <h2>Revenue target</h2>
                  <span className="biz-overview-live-chip">Monthly</span>
                </div>
                <div className="biz-overview-target-body">
                  <TargetRing
                    percent={progress}
                    label={
                      target && income
                        ? `${progress.toFixed(0)} percent of the monthly revenue target reached`
                        : target
                          ? "Monthly target set. Read income from Mercury to track progress."
                          : "No monthly target set yet"
                    }
                  />
                  <div className="biz-overview-target-values">
                    <strong>{income ? formatAmount(income.amount, income.currency) : "—"}</strong>
                    <span>
                      of <TargetEditor value={target} onSave={onSaveTarget} />
                    </span>
                    <small>
                      {target && income
                        ? "Income, last 30 days · click the target to change it"
                        : target
                          ? "Refresh income from Mercury to see progress"
                          : "Click to set what you want to bring in each month"}
                    </small>
                  </div>
                </div>
                <button type="button" className="biz-bank-footer" onClick={onFinances}>
                  <span>Open finances</span>
                  <ArrowUpRight size={14} />
                </button>
              </section>
            ),
          },
        ]}
      />
    </>
  );
}

type Integration = { id: string; configured: boolean; keyConfigured?: boolean; channelId?: string };

export function WorkspaceOverview({
  money,
  onAudience,
  onFinances,
  onProgress,
}: {
  money: (value: number, compact?: boolean) => string;
  onAudience: (platform?: AudiencePlatform) => void;
  onFinances: () => void;
  onProgress: () => void;
}) {
  const { data, refresh, saveProfile } = useBusinessWorkspace();
  const demo = useBusinessDemo();
  const profile = useWorkspaceProfile();
  const integrations = useQuery<{ integrations: Integration[] }>({
    queryKey: ["business-integrations"],
    queryFn: () => operatorRequest("/business/integrations"),
    staleTime: 30_000,
    retry: 1,
  });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const workspace = hydrated ? data : undefined;
  const snapshots = workspace?.snapshots ?? [];
  const showAudience = workspace?.widgets?.audience !== false;
  const sample = OVERVIEW_FINANCE_DEMO;
  const revenueProgress = Math.min(100, (sample.quarterRevenue / sample.quarterTarget) * 100);
  const importedAccounts = workspace?.finances?.accounts ?? [];
  const liveFinances = !demo.enabled && workspace?.finances && importedAccounts.length > 0 ? workspace.finances : undefined;
  const links = profile.data?.publicProfiles ?? [];
  const youtube = integrations.data?.integrations.find((item) => item.id === "youtube");
  const linkFor = (platform: AudiencePlatform) =>
    links.find((link) => LINK_PLATFORMS[link.label.trim().toLowerCase()] === platform || hostLabel(link.url).startsWith(`${platform}.`));
  const platformCards = SOCIAL_PREVIEWS.map((platform) => {
    const series = audienceSeries(snapshots, platform.id, platform.metric);
    const latest = series.at(-1);
    return { platform, series, latest, link: linkFor(platform.id) };
  });
  const otherLinks = demo.enabled ? [] : links.filter((link) => !LINK_PLATFORMS[link.label.trim().toLowerCase()]);
  /** Open the Audience tab with the record form ready for this platform. */
  const recordNumbers = (platform: AudiencePlatform) => {
    const url = new URL(window.location.href);
    url.searchParams.set("record", "1");
    window.history.replaceState(null, "", url);
    onAudience(platform);
  };
  /**
   * One honest next step for a platform without numbers: an API key for YouTube when the
   * channel is saved, numbers for a linked profile, or the profile link itself. Never a figure.
   */
  const emptyAction = (platform: AudiencePlatform, link?: { url: string }) => {
    if (platform === "youtube" && youtube && !youtube.configured)
      return youtube.keyConfigured
        ? { label: "Choose channel", hint: "API key saved · choose your channel", onClick: openBusinessAccounts, Icon: KeyRound }
        : { label: "Add API key", hint: youtube.channelId ? "Channel saved · needs an API key" : "Pulls subscribers automatically", onClick: openBusinessAccounts, Icon: KeyRound };
    if (link) return { label: "Add numbers", hint: `${hostLabel(link.url)} · numbers not included`, onClick: () => recordNumbers(platform), Icon: Plus };
    return { label: "Link profile", hint: "No profile linked yet", href: "/setup", Icon: Link2 };
  };
  return (
    <div className="biz-overview-finance-style">
      {workspace?.widgets?.cash !== false && liveFinances && (
        <LiveFinanceCards
          finances={liveFinances}
          target={workspace?.profile?.revenueTargetMonthly}
          onFinances={onFinances}
          onSaveTarget={async (target) => {
            await saveProfile({ revenueTargetMonthly: target as number });
          }}
          onRefreshed={refresh}
        />
      )}
      {workspace?.widgets?.cash !== false && !demo.enabled && !liveFinances && (
        <FinanceSnapshotState finances={workspace?.finances} onExamples={demo.liveData ? undefined : () => demo.setEnabled(true)} />
      )}
      {workspace?.widgets?.cash !== false && demo.enabled && (
        <>
          <OverviewCards
            caption={<>Financial preview · Demo snapshot, {formatDate(sample.asOf)}</>}
            cards={[
              {
                id: "cash",
                label: "Cash on hand",
                content: (
                  <section className="biz-bank biz-overview-money-card is-overview-cash">
                    <div className="biz-bank-top">
                      <InstrumentMark kind="bank" />
                      <h2>Cash on hand</h2>
                      <span className="biz-overview-demo-chip">Demo</span>
                    </div>
                    <div className="biz-bank-caption">Room for your next move</div>
                    <div className="biz-bank-number">{money(sample.totalCash)}</div>
                    <div className="biz-overview-money-sub">
                      <span className="biz-overview-small-dot" /> Combined example accounts
                    </div>
                    <div className="biz-overview-balance-art">
                      <SparkArt values={BUSINESS_SAMPLE.balanceHistory.slice(-31)} />
                    </div>
                    <button type="button" className="biz-bank-footer" onClick={onFinances}>
                      <span>
                        <span className="biz-account-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                        {importedAccounts.length
                          ? `${importedAccounts.length} actual account snapshots`
                          : "Your account balances"}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  </section>
                ),
              },
              {
                id: "income",
                label: "Monthly income",
                content: (
                  <section className="biz-bank biz-overview-money-card is-overview-income">
                    <div className="biz-bank-top">
                      <InstrumentMark kind="invoice" tone="mint" />
                      <h2>Monthly income</h2>
                      <span className="biz-overview-demo-chip">Demo</span>
                    </div>
                    <div className="biz-bank-caption">Month to date · September preview</div>
                    <div className="biz-bank-number">{money(sample.monthIncome)}</div>
                    <div className="biz-overview-income-bars" aria-label="Example income over six months">
                      {BUSINESS_SAMPLE.months.slice(-6).map((month) => (
                        <div key={month.month}>
                          <span
                            style={{ height: `${Math.max(7, (monthTotal(month) / Math.max(...BUSINESS_SAMPLE.months.slice(-6).map(monthTotal))) * 100)}%` }}
                            title={`${month.label}: ${money(monthTotal(month))}`}
                            className={month.partial ? "is-partial" : ""}
                          />
                          <small>{month.label}</small>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="biz-bank-footer" onClick={onFinances}>
                      <span>Explore your income</span>
                      <ArrowUpRight size={14} />
                    </button>
                  </section>
                ),
              },
              {
                id: "target",
                label: "Revenue target",
                content: (
                  <section className="biz-bank biz-overview-money-card is-overview-target">
                    <div className="biz-bank-top">
                      <span className="biz-overview-target-icon">
                        <Target size={19} strokeWidth={1.4} />
                      </span>
                      <h2>Revenue target</h2>
                      <span className="biz-overview-demo-chip">Demo</span>
                    </div>
                    <div className="biz-overview-target-body">
                      <TargetRing percent={revenueProgress} label={`Demo quarter revenue target ${revenueProgress.toFixed(0)} percent reached`} />
                      <div className="biz-overview-target-values">
                        <strong>{money(sample.quarterRevenue)}</strong>
                        <span>of {money(sample.quarterTarget)}</span>
                        <small>Q3 revenue · Demo</small>
                      </div>
                    </div>
                    <button type="button" className="biz-bank-footer" onClick={onProgress}>
                      <span>Set your real revenue target</span>
                      <ArrowUpRight size={14} />
                    </button>
                  </section>
                ),
              },
            ]}
          />
        </>
      )}

      {showAudience && (
        <section className="biz-overview-audience" aria-labelledby="overview-audience-heading">
          <div className="biz-overview-section-heading">
            <h2 id="overview-audience-heading">Your audience.</h2>
            <button type="button" onClick={() => onAudience()}>
              See the bigger picture <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="biz-overview-audience-grid">
            {platformCards.map(({ platform, series, latest, link }) => {
              const hasHistory = series.length > 1;
              const values = series.slice(-30).map((point) => point.value);
              const action = latest ? undefined : emptyAction(platform.id, link);
              const source = !latest
                ? ""
                : latest.snapshot.sourceLabel.startsWith("Demo") || latest.snapshot.id.startsWith("demo-")
                  ? "Demo · fictional audience"
                  : `${formatDate(latest.snapshot.recordedAt)} · ${latest.snapshot.origin === "connector" ? "Synced" : "Recorded"}${link ? " · linked" : ""}`;
              return (
                <article
                  key={platform.id}
                  className={`biz-overview-audience-card is-${platform.id}${latest ? "" : " is-empty"}`}
                  style={{ "--overview-brand-tone": platform.tone } as CSSProperties}
                  aria-label={`${platform.name}: ${latest ? `${latest.value.toLocaleString("en-US")} ${platform.label.toLowerCase()}` : "no numbers yet"}`}
                >
                  <div className="biz-overview-audience-top">
                    <span className="biz-overview-audience-brand">
                      <span className="biz-overview-audience-avatar">
                        <AudienceLogo platform={platform.id} />
                      </span>
                      {platform.name}
                    </span>
                    <button
                      type="button"
                      className="biz-overview-audience-round"
                      aria-label={`Open ${platform.name} in Audience`}
                      onClick={() => onAudience(platform.id)}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {latest ? (
                    <>
                      <strong className="biz-overview-audience-value">{latest.value.toLocaleString("en-US")}</strong>
                      <span className="biz-overview-audience-measure">{platform.label}</span>
                      <div className="biz-overview-audience-chart" aria-hidden="true">
                        {hasHistory && <SparkArt values={values} />}
                      </div>
                    </>
                  ) : (
                    <>
                      <strong className="biz-overview-audience-value is-empty">No numbers yet</strong>
                      <span className="biz-overview-audience-measure">{platform.label}</span>
                    </>
                  )}
                  <div className="biz-overview-audience-foot">
                    <small className="biz-overview-audience-hint" title={latest?.snapshot.sourceLabel || action?.hint}>
                      {latest ? source : action?.hint}
                    </small>
                    {latest ? (
                      <button type="button" className="biz-overview-audience-pill" onClick={() => onAudience(platform.id)}>
                        View
                      </button>
                    ) : action?.href ? (
                      <a className="biz-overview-audience-pill" href={action.href}>
                        <action.Icon size={12} /> {action.label}
                      </a>
                    ) : (
                      <button type="button" className="biz-overview-audience-pill" onClick={action?.onClick}>
                        {action && <action.Icon size={12} />} {action?.label}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!demo.enabled && otherLinks.length > 0 && (
            <div className="biz-overview-linked" aria-label="Linked profiles">
              <span className="biz-overview-linked-label">
                <Link2 size={12} /> Other links
              </span>
              <div className="biz-overview-linked-row">
                {otherLinks.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="biz-overview-linked-chip"
                    title={`${link.label} · numbers are not provided by this link`}
                  >
                    <span className="biz-overview-linked-avatar is-letter" aria-hidden="true">
                      {link.label.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{link.label}</strong>
                      <small>{hostLabel(link.url)}</small>
                    </span>
                    <ArrowUpRight size={12} />
                  </a>
                ))}
              </div>
              <small className="biz-overview-linked-note">Links only. Follower counts appear once a source that reports them is connected.</small>
            </div>
          )}
        </section>
      )}

      {workspace?.widgets?.dailyBrief !== false && (
        <Suspense fallback={<BriefPlaceholder />}>
          <DailyBrief />
        </Suspense>
      )}
    </div>
  );
}
