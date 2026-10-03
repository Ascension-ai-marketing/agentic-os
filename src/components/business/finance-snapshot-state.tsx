import type { BusinessWorkspace } from "@/lib/business-workspace";
import { useState } from "react";

const amount = (value: number, currency: string | null) =>
  currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * A fresh workspace never substitutes example balances for missing records.
 * Once live balances exist the fictional walkthrough is not offered here.
 */
export function FinanceSnapshotState({ finances, onExamples }: {
  finances?: BusinessWorkspace["finances"];
  onExamples?: () => Promise<void>;
}) {
  const accounts = finances?.accounts ?? [];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const groups = [...accounts.reduce((map, account) => {
    const key = account.currency || "";
    map.set(key, (map.get(key) || 0) + account.balance);
    return map;
  }, new Map<string, number>())].map(([currency, total]) => ({ currency: currency || null, total }));
  const income = finances?.monthlyIncome;
  async function showExamples() {
    if (!onExamples) return;
    setPending(true);
    setError("");
    try { await onExamples(); }
    catch { setError("The example view could not be opened. Please try again."); }
    finally { setPending(false); }
  }
  return (
    <section className="biz-card" style={{ padding: "28px", marginBottom: "24px" }}>
      <div className="biz-card-heading">
        <h2>{accounts.length ? "Your connected balances" : "Your finances start empty."}</h2>
        <span className="biz-small-tag">{accounts.length ? "Live snapshot" : "Not connected"}</span>
      </div>
      {accounts.length ? (
        <>
          <p>{finances?.sourceLabel} · Recorded {finances?.recordedAt?.slice(0, 10)}</p>
          <dl className="biz-finance-live-totals">
            {groups.map((group) => (
              <div key={group.currency || "unspecified"}>
                <dt>Cash on hand{groups.length > 1 ? ` · ${group.currency || "no currency"}` : ""}</dt>
                <dd>{amount(group.total, group.currency)}</dd>
              </div>
            ))}
            <div>
              <dt>Income, last 30 days</dt>
              <dd>
                {income ? amount(income.amount, income.currency) : "Not read yet"}
                {income ? <small> · {income.transactions} settled payments · read {income.recordedAt.slice(0, 10)}</small> : <small> · refresh from Mercury on the overview</small>}
              </dd>
            </div>
          </dl>
          <dl style={{ display: "grid", gap: "12px", marginTop: "20px" }}>
            {accounts.map((account, index) => (
              <div key={`${account.sourceId || account.name}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: "24px" }}>
                <dt>{account.name}</dt>
                <dd>{amount(account.balance, account.currency)}{account.currency ? "" : " (currency not supplied)"}</dd>
              </div>
            ))}
          </dl>
          <p style={{ marginTop: "20px" }}>Income is the sum of settled incoming payments, with transfers between your own accounts left out. Expenses and profit need their own records.</p>
        </>
      ) : (
        <p style={{ margin: "16px 0" }}>Use Connect accounts to add your own financial source when you need it. This copy contains no personal balances or transactions.</p>
      )}
      {onExamples && !accounts.length && (
        <button type="button" className="biz-demo-toggle" disabled={pending} onClick={showExamples} style={{ marginTop: "12px" }}>{pending ? "Opening examples…" : "Explore fictional examples"}</button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
