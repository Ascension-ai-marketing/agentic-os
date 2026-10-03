import { useLiveData } from "@/lib/use-live-data";
import { localDay } from "@/lib/operator";
import claudeLogo from "@/assets/claude-logo.png";
import openaiLogo from "@/assets/logo-openai.svg";
import codexLogo from "@/assets/logos/codex.png";
import openrouterLogo from "@/assets/logos/openrouter.png";
import openclawLogo from "@/assets/openclaw.png";
import "./ai-spend-panel.css";
const planLogos: Record<string, string> = {
  claude: claudeLogo,
  chatgpt: openaiLogo,
  codex: codexLogo,
  openrouter: openrouterLogo,
  openclaw: openclawLogo,
};
const plans: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
  openrouter: "OpenRouter",
  openclaw: "OpenClaw",
};
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
export function AiSpendPanel({ money }: { money: (value: number, compact?: boolean) => string }) {
  const ld = useLiveData();
  const live = ld?.isExample !== true;
  const subscriptions = live
    ? Object.entries(ld?.subscriptions ?? {}).flatMap(([key, value]) => {
        if (!value || typeof value !== "object") return [];
        const row = value as Record<string, unknown>;
        if (
          row.present === false ||
          typeof row.monthlyPrice !== "number" ||
          !Number.isFinite(row.monthlyPrice) ||
          row.monthlyPrice < 0
        )
          return [];
        if (!row.present && !row.authMode && !row.plan) return [];
        return [
          {
            id: key,
            name: plans[key] ?? key,
            plan: String(row.planName ?? row.plan ?? "Detected plan"),
            monthlyPrice: row.monthlyPrice,
          },
        ];
      })
    : [];
  const monthlyFees = subscriptions.reduce((sum, plan) => sum + plan.monthlyPrice, 0);
  const today = new Date();
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const lastWeek =
    live && Array.isArray(ld?.daily)
      ? ld.daily.filter(
          (day: any) =>
            typeof day.day === "string" &&
            day.day >= localDay(weekStart) &&
            day.day <= localDay(today),
        )
      : [];
  const equivalent = lastWeek.reduce((sum: number, day: any) => sum + number(day.cost), 0);
  return (
    <section className="biz-finance-ai" aria-label="AI spend breakdown">
      <div className="biz-finance-ai-heading">
        <div>
          <span className="biz-overline">YOUR AI STACK</span>
          <h2>A clear view of your AI costs.</h2>
          <p>Plan estimates and token usage, each on its own terms.</p>
        </div>
        <div className="biz-finance-ai-total">
          <strong>{subscriptions.length ? money(monthlyFees) : "—"}</strong>
          <span>/ month</span>
          <small>Detected plan fees · estimate</small>
        </div>
      </div>
      <div className="biz-finance-ai-grid">
        <div className="biz-plan-list">
          {subscriptions.map((plan) => (
            <div key={plan.id}>
              <span>
                <span className={`biz-plan-logo is-${plan.id}`}>
                  {planLogos[plan.id] ? (
                    <img src={planLogos[plan.id]} alt={`${plan.name} logo`} />
                  ) : (
                    <span>{plan.name.slice(0, 2)}</span>
                  )}
                </span>
                <span>
                  {plan.name}
                  <small>{plan.plan}</small>
                </span>
              </span>
              <strong>{plan.monthlyPrice ? money(plan.monthlyPrice) : "Included"}</strong>
            </div>
          ))}
          {!subscriptions.length && <p>No subscription prices detected on this Mac.</p>}
        </div>
        <div className="biz-finance-token-card">
          <span>Token API equivalent</span>
          <strong>{lastWeek.length ? money(equivalent) : "—"}</strong>
          <small>Recorded usage · last 7 days</small>
          <p>
            What this recorded token usage would cost at API prices. It is separate from your
            subscription bill.
          </p>
        </div>
      </div>
      <p className="biz-cost-note">
        Plan fees are estimated from local detection, not invoices. Metered charges outside these
        detected plans are not included.
      </p>
    </section>
  );
}
