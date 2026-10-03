import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operatorRequest } from "@/lib/operator";
import type { GoalPeriod } from "./goal-periods";
import { audienceMeasurementIdentity, type AudienceMeasurementScope } from "./audience-measurement";
import { demoAudience, useBusinessDemo } from "./business-demo";

export type AudiencePlatform = "youtube" | "instagram" | "tiktok" | "linkedin";
export type AudienceMetric = "followers" | "views" | "likes" | "posts" | "videos";
export interface AudienceSnapshot {
  id: string;
  platform: AudiencePlatform;
  recordedAt: string;
  metrics: Partial<Record<AudienceMetric, number>>;
  origin: "manual" | "import" | "connector";
  sourceLabel: string;
  sourceUrl?: string;
  measurementScope?: AudienceMeasurementScope;
}
export type SnapshotInput = Omit<AudienceSnapshot, "id" | "sourceLabel"> & { sourceLabel?: string };
export interface BusinessProfile {
  businessName?: string;
  whatYouDo?: string;
  whoYouHelp?: string;
  quarterGoal?: string;
  personalPriorities?: string;
  preferredName?: string;
  longTermDirection?: string;
  /** Monthly revenue target in USD, set inline on the Business overview. */
  revenueTargetMonthly?: number;
}
export interface BusinessWidgets {
  cash: boolean;
  goals: boolean;
  dailyBrief: boolean;
  aiSpend: boolean;
  dream: boolean;
  inbox: boolean;
  calendar: boolean;
  memory: boolean;
  audience: boolean;
}
export interface ProgressGoal {
  id: string;
  title: string;
  horizon: "quarter" | "month" | "week";
  status: "planned" | "active" | "done";
  notes: string;
  updatedAt: string;
  period?: GoalPeriod;
  renewedFromId?: string;
}
export interface ProgressUpdate { id: string; text: string; createdAt: string; goalId?: string }
export interface BusinessWorkspace {
  profile: BusinessProfile;
  snapshots: AudienceSnapshot[];
  widgets: BusinessWidgets;
  progress?: { goals: ProgressGoal[]; updates: ProgressUpdate[] };
  finances?: {
    accounts: Array<{ name: string; balance: number; currency: string | null; sourceId?: string }>;
    recordedAt: string;
    sourceLabel: string;
    sourceUrl?: string;
    /** Settled incoming credits over the trailing 30 days, internal transfers excluded. */
    monthlyIncome?: MonthlyIncome;
    monthlyIncomeError?: { message: string; at: string };
  };
}
export interface MonthlyIncome {
  amount: number;
  currency: string;
  days: number;
  recordedAt: string;
  transactions: number;
  windowStart?: string;
  windowEnd?: string;
  /** Settled income since local midnight and over the last 7 days, from the same read. */
  today?: { amount: number; transactions: number };
  week?: { amount: number; transactions: number };
}

const WORKSPACE_KEY = ["business-workspace"];
export function useBusinessWorkspace() {
  const demo = useBusinessDemo();
  const qc = useQueryClient();
  const query = useQuery<BusinessWorkspace>({
    queryKey: WORKSPACE_KEY,
    queryFn: () => operatorRequest("/business"),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  async function save(path: string, body: unknown) {
    const workspace = await operatorRequest<BusinessWorkspace>(path, body);
    qc.setQueryData(WORKSPACE_KEY, workspace);
    return workspace;
  }
  return {
    ...query,
    data: query.data && demo.enabled ? { ...query.data, snapshots: demoAudience(), finances: undefined } : query.data,
    refresh: () => qc.invalidateQueries({ queryKey: WORKSPACE_KEY }),
    saveSnapshots: (snapshots: SnapshotInput[]) => save("/business/snapshots", { snapshots }),
    saveProfile: (profile: BusinessProfile) => save("/business", { profile }),
    saveWidgets: (widgets: Partial<BusinessWidgets>) => save("/business", { widgets }),
    saveProgress: (body: unknown) => save("/business/progress", body && typeof body === "object" ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...body } : body),
  };
}

/** Focus on the observed interval while keeping every observation in view. */
export function audienceChartDomain(values: number[], platform: AudiencePlatform, metric: AudienceMetric): [number, number] {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!usable.length) return [0, 1];
  const min = Math.min(...usable), max = Math.max(...usable);
  const minimumWindow = platform === "youtube" && metric === "followers" && min >= 20_000 ? 20_000 : 2;
  const width = Math.max((max - min) * 1.2, max * .02, minimumWindow);
  const midpoint = (min + max) / 2;
  let lower = midpoint - width / 2, upper = midpoint + width / 2;
  if (lower < 0) { upper -= lower; lower = 0; }
  const magnitude = Math.pow(10, Math.floor(Math.log10(width / 4)));
  const fraction = width / 4 / magnitude;
  const step = Math.max(1, (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * magnitude);
  lower = Math.max(0, Math.floor(lower / step) * step);
  upper = Math.ceil(upper / step) * step;
  return [Math.min(lower, min), Math.max(upper, max, lower + 1)];
}

/** Observations are never backfilled: absent metrics remain absent. */
export function audienceSeries(
  snapshots: AudienceSnapshot[], platform: AudiencePlatform, metric: AudienceMetric,
  since = -Infinity,
) {
  // A chart must not draw a growth line from period totals into lifetime totals,
  // or join two different channels. Keep legacy records in the history store.
  const latestScoped = snapshots.filter(snapshot => snapshot.platform === platform &&
    Number.isFinite(Date.parse(snapshot.recordedAt)) && typeof snapshot.metrics[metric] === "number" &&
    Number.isFinite(snapshot.metrics[metric]) && snapshot.metrics[metric]! >= 0 &&
    audienceMeasurementIdentity(platform, snapshot.measurementScope, snapshot.sourceUrl))
    .reduce<AudienceSnapshot | undefined>((latest, snapshot) => !latest || Date.parse(snapshot.recordedAt) >= Date.parse(latest.recordedAt) ? snapshot : latest, undefined);
  const sourceIdentity = latestScoped && audienceMeasurementIdentity(platform, latestScoped.measurementScope, latestScoped.sourceUrl);
  const points = new Map<number, { date: number; value: number; snapshot: AudienceSnapshot }>();
  for (const snapshot of snapshots) {
    if (latestScoped && (snapshot.measurementScope !== latestScoped.measurementScope || audienceMeasurementIdentity(platform, snapshot.measurementScope, snapshot.sourceUrl) !== sourceIdentity)) continue;
    const date = Date.parse(snapshot.recordedAt);
    const value = snapshot.metrics[metric];
    if (snapshot.platform !== platform || !Number.isFinite(date) || date < since ||
      typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    points.set(date, { date, value, snapshot });
  }
  return [...points.values()].sort((a, b) => a.date - b.date);
}

const PLATFORMS: AudiencePlatform[] = ["youtube", "instagram", "tiktok", "linkedin"];
const METRICS: AudienceMetric[] = ["followers", "views", "likes", "posts", "videos"];

export function snapshotDate(value: string): string {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) throw new Error("Use dates like 2026-09-16.");
  const calendarDay = new Date(`${text.slice(0, 10)}T12:00:00.000Z`);
  const date = new Date(text.length === 10 ? `${text}T12:00:00.000Z` : text);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== text.slice(0, 10)) {
    throw new Error(`“${text}” is not a valid date.`);
  }
  return date.toISOString();
}

/** Small CSV reader supporting quoted fields, commas and embedded newlines. */
export function parseAudienceCsv(csv: string): SnapshotInput[] {
  if (csv.length > 1_000_000) throw new Error("Keep this import under 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field.length) throw new Error("A CSV quote must start a field.");
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("A quoted CSV field is missing its closing quote.");
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("Add a header row and at least one dated observation.");
  if (rows.length > 501) throw new Error("Import up to 500 observations at a time.");
  const header = rows.shift()!.map((cell) => cell.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[ _-]/g, ""));
  if (new Set(header).size !== header.length) throw new Error("The CSV has duplicate column names.");
  const column = (name: string) => header.indexOf(name.toLowerCase());
  const platformColumn = column("platform"), dateColumn = Math.max(column("date"), column("recordedAt"));
  if (platformColumn < 0 || dateColumn < 0) throw new Error("Your CSV needs platform and date columns.");
  return rows.map((cells, index) => {
    const line = index + 2;
    if (cells.length !== header.length) throw new Error(`Row ${line}: the number of values must match the header.`);
    const platform = cells[platformColumn]?.trim().toLowerCase() as AudiencePlatform;
    if (!PLATFORMS.includes(platform)) throw new Error(`Row ${line}: choose YouTube, Instagram, TikTok or LinkedIn.`);
    const metrics: Partial<Record<AudienceMetric, number>> = {};
    for (const key of METRICS) {
      const at = key === "followers" && platform === "youtube" && column("followers") < 0 ? column("subscribers") : column(key);
      if (at < 0 || !cells[at]?.trim()) continue;
      const raw = cells[at].trim();
      if (!/^\d+(?:,\d{3})*$/.test(raw)) throw new Error(`Row ${line}: ${key} must be a whole number, or left blank.`);
      const count = Number(raw.replace(/,/g, ""));
      if (!Number.isSafeInteger(count)) throw new Error(`Row ${line}: ${key} is too large.`);
      metrics[key] = count;
    }
    if (!Object.keys(metrics).length) throw new Error(`Row ${line}: add at least one supported metric.`);
    let recordedAt: string;
    try { recordedAt = snapshotDate(cells[dateColumn]); }
    catch (error) { throw new Error(`Row ${line}: ${(error as Error).message}`); }
    return {
      platform, recordedAt, metrics, origin: "import",
      sourceLabel: column("sourceLabel") >= 0 && cells[column("sourceLabel")].trim() ? cells[column("sourceLabel")].trim().slice(0, 160) : "CSV import",
    };
  });
}
