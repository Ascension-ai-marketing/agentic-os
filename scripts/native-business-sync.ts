import type { McpClient, McpReader } from "./mcp-connection";

export const MERCURY_TOOLS = ["getAccounts", "listTransactions"] as const;

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/** Minimized bank snapshot. No account/routing numbers or credentials leave this adapter. */
export function mercuryBalances(raw: any, observedAt = new Date().toISOString()) {
  const list = raw?.accounts;
  if (!Array.isArray(list) || !list.length || list.length >= 50 || raw.page?.next || raw.page?.nextCursor || raw.page?.next_cursor || raw.page?.hasMore || raw.page?.has_more)
    throw new Error("Mercury did not return a complete account list. Saved balances have been kept.");
  const seen = new Set<string>();
  const accounts = list.map((account: any) => {
    const id = clean(account?.id, 100), name = clean(account?.name, 160);
    if (!id || seen.has(id) || !name || typeof account.currentBalance !== "number" || !Number.isFinite(account.currentBalance))
      throw new Error("An account balance is incomplete. Saved balances have been kept.");
    seen.add(id);
    const reportedCurrency = account.currencyCode ?? account.currency;
    // Mercury accounts are US dollar accounts; a missing currency code means USD, not "unknown".
    const currency = typeof reportedCurrency === "string" && /^[A-Z]{3}$/.test(reportedCurrency) ? reportedCurrency : "USD";
    return { name, balance: account.currentBalance, currency, sourceId: id.slice(-12) };
  });
  return { accounts, recordedAt: observedAt, sourceLabel: "Mercury · current balances", sourceUrl: "https://app.mercury.com/" };
}

export const INCOME_WINDOW_DAYS = 30;
/** Each transaction page asks for this many rows; a shorter page marks the end of the list. */
export const INCOME_PAGE_SIZE = 200;
/** Never walk more than this many pages: a creator business with 800+ settled payments a month is a different product. */
export const INCOME_MAX_PAGES = 4;

export type IncomeSlice = { amount: number; transactions: number };
export type MonthlyIncome = { amount: number; currency: string; days: number; recordedAt: string; transactions: number; windowStart: string; windowEnd: string; today?: IncomeSlice; week?: IncomeSlice };

const transactionList = (page: any): any[] | undefined => {
  const list = Array.isArray(page) ? page : page?.transactions ?? page?.data ?? page?.items;
  return Array.isArray(list) ? list : undefined;
};
const stamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;

/**
 * Sum of settled incoming credits over the trailing window. Only totals leave this
 * adapter: no descriptions, counterparties, ids or dashboard links are retained.
 * Transfers between the operator's own accounts are excluded when Mercury labels
 * them as internal, or when the counterparty is one of the listed own accounts.
 */
export function mercuryMonthlyIncome(pages: any[], options: { ownAccountIds?: string[]; now?: Date; pageSize?: number } = {}): MonthlyIncome {
  const now = options.now || new Date(), end = now.getTime(), start = end - INCOME_WINDOW_DAYS * 86400000;
  const own = new Set((options.ownAccountIds || []).filter(id => typeof id === "string" && id));
  const pageSize = options.pageSize ?? INCOME_PAGE_SIZE;
  if (!Array.isArray(pages) || !pages.length || pages.length > INCOME_MAX_PAGES) throw new Error("Mercury did not return a readable transaction list. Income was not recorded.");
  const seen = new Set<string>();
  // Same rows, two shorter windows: since local midnight, and the last 7 days.
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime(), weekStart = end - 7 * 86400000;
  let amount = 0, transactions = 0, rows = 0, todayAmount = 0, todayCount = 0, weekAmount = 0, weekCount = 0;
  pages.forEach((page, index) => {
    const list = transactionList(page);
    if (!list) throw new Error("Mercury did not return a readable transaction list. Income was not recorded.");
    if (list.length > pageSize) throw new Error("Mercury returned more transactions than requested. Income was not recorded.");
    // A full final page means the month may continue past what was read. Refuse an understated total.
    if (index === pages.length - 1 && list.length === pageSize) throw new Error("Mercury has more transactions this month than this reader totals. Income was not recorded.");
    if (index < pages.length - 1 && list.length !== pageSize) throw new Error("Mercury returned an inconsistent transaction page. Income was not recorded.");
    const total = typeof page?.total === "number" ? page.total : undefined;
    if (total !== undefined && total > INCOME_MAX_PAGES * pageSize) throw new Error("Mercury has more transactions this month than this reader totals. Income was not recorded.");
    for (const row of list) {
      rows++;
      const id = clean(row?.id, 100);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (row?.status !== "sent" || typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount <= 0) continue;
      const at = stamp(row.createdAt) ?? stamp(row.postedAt);
      if (at === undefined || at < start || at > end) continue;
      const kind = clean(row.kind, 80);
      if (/internal|treasury/i.test(kind)) continue;
      const counterparties = [row.counterpartyId, row.toAccountId, row.fromAccountId, row.details?.toAccountId, row.details?.fromAccountId, row.details?.internalTransfer?.accountId, row.details?.internalTransfer?.fromAccountId, row.details?.internalTransfer?.toAccountId]
        .filter((value): value is string => typeof value === "string");
      if (counterparties.some(value => own.has(value))) continue;
      amount += row.amount; transactions++;
      if (at >= weekStart) { weekAmount += row.amount; weekCount++; }
      if (at >= todayStart) { todayAmount += row.amount; todayCount++; }
    }
  });
  if (rows > INCOME_MAX_PAGES * pageSize) throw new Error("Mercury has more transactions this month than this reader totals. Income was not recorded.");
  return { amount: Math.round(amount * 100) / 100, currency: "USD", days: INCOME_WINDOW_DAYS, recordedAt: now.toISOString(), transactions, windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString() , today: { amount: Math.round(todayAmount * 100) / 100, transactions: todayCount }, week: { amount: Math.round(weekAmount * 100) / 100, transactions: weekCount } };
}

export function nativeBusinessSync(root: string, options: { read: McpReader; connected?: () => boolean; now?: () => Date }) {
  const read = options.read;
  let cache: { at: number; value: any } | undefined, pending: Promise<any> | undefined;
  const clock = () => options.now?.() || new Date();
  const readIncome = async (client: McpClient, ownAccountIds: string[]) => {
    const now = clock(), start = new Date(now.getTime() - INCOME_WINDOW_DAYS * 86400000);
    const pages: any[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < INCOME_MAX_PAGES; index++) {
      const page = await client.call("listTransactions", { status: ["sent"], start: start.toISOString(), end: now.toISOString(), limit: INCOME_PAGE_SIZE, order: "desc", ...(cursor ? { start_after: cursor } : {}) });
      pages.push(page);
      const list = transactionList(page);
      if (!list || list.length < INCOME_PAGE_SIZE) break;
      const last = clean(list.at(-1)?.id, 100);
      if (!last) break;
      cursor = last;
    }
    return mercuryMonthlyIncome(pages, { ownAccountIds, now });
  };
  return {
    async status(force = false) {
      if (options.connected && !options.connected()) return { mercury: { available: false, transactions: false, requiresSignIn: true }, checkedAt: new Date().toISOString() };
      if (force) cache = undefined;
      if (cache && Date.now() - cache.at < 60000) return cache.value;
      if (!pending) pending = read(async ({ tools }) => {
        const readOnly = (name: string) => tools[name]?.annotations?.readOnlyHint === true && tools[name]?.annotations?.destructiveHint !== true;
        return { mercury: { available: readOnly("getAccounts"), transactions: readOnly("listTransactions"), requiresSignIn: false }, checkedAt: new Date().toISOString() };
      }).then(value => { cache = { at: Date.now(), value }; return value; }).finally(() => { pending = undefined; });
      return pending;
    },
    async balances() {
      return read(async client => mercuryBalances(await client.call("getAccounts", { limit: 50, order: "asc" }), clock().toISOString()));
    },
    /** Balances plus trailing-month income from one short session. A failed income read never blocks the balance import. */
    async financeSnapshot(): Promise<ReturnType<typeof mercuryBalances> & { monthlyIncome?: MonthlyIncome; monthlyIncomeError?: string }> {
      return read(async client => {
        const raw = await client.call("getAccounts", { limit: 50, order: "asc" });
        const balances = mercuryBalances(raw, clock().toISOString());
        const ownAccountIds = (raw.accounts as any[]).map(account => clean(account?.id, 100));
        try { return { ...balances, monthlyIncome: await readIncome(client, ownAccountIds) }; }
        catch (error) { return { ...balances, monthlyIncomeError: (error as Error).message || "Mercury transactions could not be read." }; }
      });
    },
    /** Trailing-month income only, for a lighter refresh when balances are already fresh. */
    async monthlyIncome() {
      return read(async client => {
        const raw = await client.call("getAccounts", { limit: 50, order: "asc" });
        mercuryBalances(raw, clock().toISOString());
        return readIncome(client, (raw.accounts as any[]).map(account => clean(account?.id, 100)));
      });
    },
  };
}
