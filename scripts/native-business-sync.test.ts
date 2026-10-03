import { expect, test } from "bun:test";
import { INCOME_MAX_PAGES, INCOME_PAGE_SIZE, mercuryBalances, mercuryMonthlyIncome, nativeBusinessSync } from "./native-business-sync";
import type { withConnectedRead } from "./codex-connected-read";

const account = { id: "account-123", name: "Checking", currentBalance: 120.5, availableBalance: 119, accountNumber: "SENSITIVE", routingNumber: "PRIVATE" };
test("Mercury minimizes the balance snapshot and never invents currency", () => {
  const result = mercuryBalances({ accounts: [account], page: {} }, "2026-09-17T10:00:00Z");
  expect(result.accounts).toEqual([{ name: "Checking", balance: 120.5, currency: "USD", sourceId: "account-123" }]);
  expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|PRIVATE|routingNumber|accountNumber|availableBalance/);
  expect(mercuryBalances({ accounts: [{ ...account, currentBalance: 0, currency: "EUR" }] }).accounts[0]).toMatchObject({ balance: 0, currency: "EUR" });
});
test("partial, duplicate and invalid balances cannot replace saved data", () => {
  for (const raw of [{ accounts: [] }, { accounts: [account], page: { next_cursor: "next" } }, { accounts: [account, account] }, { accounts: [{ ...account, currentBalance: null }] }, { accounts: Array(50).fill(account) }]) expect(() => mercuryBalances(raw)).toThrow();
});
test("discovery reads metadata only and balance sync uses the single allowed account tool", async () => {
  const calls: string[] = [];
  const connectedRead = (async (_root: string, work: any) => work({ tools: { "mercury.getAccounts": { annotations: { readOnlyHint: true } }, "granola.list_meetings": { annotations: { readOnlyHint: true } }, "granola.get_meetings": { annotations: { readOnlyHint: true } } }, call: async (name: string, args: any) => { calls.push(name); expect(args).toEqual({ limit: 50, order: "asc" }); return { accounts: [account] }; } })) as typeof withConnectedRead;
  const service = nativeBusinessSync("/synthetic", { connectedRead });
  const status = await service.status();
  expect(status.mercury.available).toBe(true); expect(status.granola).toEqual({ available: true, importSupported: true }); expect(status.tiktok.available).toBe(false); expect(calls).toEqual([]);
  await service.balances(); expect(calls).toEqual(["mercury.getAccounts"]);
});

test("manual rescan refreshes Granola tool availability instead of returning an old miss", async () => {
  let connected = false, probes = 0;
  const connectedRead = (async (_root, work) => { probes++; return work({tools: connected ? {"granola.list_meetings":{name:"granola.list_meetings",annotations:{readOnlyHint:true}},"granola.get_meetings":{name:"granola.get_meetings",annotations:{readOnlyHint:true}}} : {},call:async()=>{throw Error("Metadata only");}}); }) as typeof withConnectedRead;
  const service=nativeBusinessSync("/synthetic",{connectedRead});
  expect((await service.status()).granola.available).toBe(false); connected=true;
  expect((await service.status()).granola.available).toBe(false); expect(probes).toBe(1);
  expect((await service.status(true)).granola.available).toBe(true); expect(probes).toBe(2);
});

const transaction = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({ id, amount, status: "sent", kind: "externalTransfer", createdAt: "2026-09-10T09:00:00Z", postedAt: "2026-09-10T12:00:00Z", counterpartyName: "PRIVATE_COUNTERPARTY", bankDescription: "PRIVATE_DESCRIPTION", dashboardLink: "https://app.mercury.com/PRIVATE", ...extra });
const now = new Date("2026-09-17T10:00:00Z");
test("monthly income totals settled incoming credits only and keeps no transaction detail", () => {
  const rows = [
    transaction("a", 1200.5), transaction("b", 300.25),
    transaction("debit", -80), transaction("pending", 500, { status: "pending" }), transaction("failed", 900, { status: "failed" }),
    transaction("old", 2000, { createdAt: "2026-08-01T00:00:00Z", postedAt: "2026-08-01T00:00:00Z" }),
    transaction("internal", 5000, { kind: "internalTransfer" }), transaction("treasury", 4000, { kind: "treasuryTransfer" }),
    transaction("own", 700, { counterpartyId: "acct-own-2" }), transaction("own-details", 650, { details: { internalTransfer: { toAccountId: "acct-own-1" } } }),
    transaction("a", 1200.5), transaction("nan", Number.NaN), { amount: 10, status: "sent" },
  ];
  const result = mercuryMonthlyIncome([{ transactions: rows, total: rows.length }], { ownAccountIds: ["acct-own-1", "acct-own-2"], now });
  expect(result).toEqual({ amount: 1500.75, currency: "USD", days: 30, recordedAt: "2026-09-17T10:00:00.000Z", transactions: 2, windowStart: "2026-08-18T10:00:00.000Z", windowEnd: "2026-09-17T10:00:00.000Z", today: { amount: 0, transactions: 0 }, week: { amount: 0, transactions: 0 } });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|counterparty|dashboardLink|bankDescription/);
});
test("monthly income refuses unreadable, oversized or incomplete transaction pages", () => {
  const full = Array.from({ length: 3 }, (_, i) => transaction(`p${i}`, 10));
  for (const pages of [[], [{}], [{ transactions: "no" }], [{ transactions: full }], [{ transactions: full }, { transactions: full }], [{ transactions: full.slice(0, 1) }, { transactions: full.slice(0, 1) }], [{ transactions: full.slice(0, 2), total: 50 }]])
    expect(() => mercuryMonthlyIncome(pages as any, { now, pageSize: 3 })).toThrow();
  const tail = [transaction("q0", 10), transaction("q1", 10)];
  expect(mercuryMonthlyIncome([{ transactions: full }, { transactions: tail }], { now, pageSize: 3 }).transactions).toBe(5);
  expect(mercuryMonthlyIncome([full.slice(0, 2)], { now, pageSize: 3 }).amount).toBe(20);
});
test("finance snapshot reads balances then bounded transaction pages, and an income failure never blocks balances", async () => {
  const calls: Array<{ name: string; args: any }> = [];
  let pages: any[] = [];
  const connectedRead = (async (_root: string, work: any) => work({ tools: {}, call: async (name: string, args: any) => { calls.push({ name, args }); if (name === "mercury.getAccounts") return { accounts: [account, { ...account, id: "account-456", name: "Savings" }] }; const page = pages.shift(); if (page instanceof Error) throw page; return page; } })) as typeof withConnectedRead;
  const service = nativeBusinessSync("/synthetic", { connectedRead, now: () => now });
  const fullPage = Array.from({ length: INCOME_PAGE_SIZE }, (_, i) => transaction(`t${i}`, 1));
  pages = [{ transactions: fullPage }, { transactions: [transaction("last", 5), transaction("own", 99, { counterpartyId: "account-456" })] }];
  const snapshot = await service.financeSnapshot();
  expect(snapshot.accounts.map(a => a.name)).toEqual(["Checking", "Savings"]);
  expect(snapshot.monthlyIncome).toMatchObject({ amount: INCOME_PAGE_SIZE + 5, transactions: INCOME_PAGE_SIZE + 1, currency: "USD", days: 30 });
  expect(calls.map(c => c.name)).toEqual(["mercury.getAccounts", "mercury.listTransactions", "mercury.listTransactions"]);
  expect(calls[1].args).toEqual({ status: ["sent"], start: "2026-08-18T10:00:00.000Z", end: "2026-09-17T10:00:00.000Z", limit: INCOME_PAGE_SIZE, order: "desc" });
  expect(calls[2].args.start_after).toBe(`t${INCOME_PAGE_SIZE - 1}`);
  expect(JSON.stringify(snapshot)).not.toMatch(/SENSITIVE|PRIVATE/);
  calls.length = 0; pages = [new Error("PRIVATE transaction failure")];
  const degraded = await service.financeSnapshot();
  expect(degraded.accounts).toHaveLength(2); expect(degraded.monthlyIncome).toBeUndefined(); expect(degraded.monthlyIncomeError).toContain("PRIVATE transaction failure");
  calls.length = 0; pages = Array.from({ length: INCOME_MAX_PAGES + 2 }, () => ({ transactions: fullPage }));
  const capped = await service.financeSnapshot();
  expect(capped.monthlyIncome).toBeUndefined(); expect(capped.monthlyIncomeError).toMatch(/more transactions/);
  expect(calls.filter(c => c.name === "mercury.listTransactions")).toHaveLength(INCOME_MAX_PAGES);
});
