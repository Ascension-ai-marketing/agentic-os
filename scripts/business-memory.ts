import { audienceMeasurementIdentity } from "../src/lib/audience-measurement";
/** Dated observations, shared by the dashboard and the searchable local brain. */
export function businessMemoryDocuments(workspace: any) {
  const documents: Array<{ id: string; title: string; text: string }> = [];
  const finances = workspace.finances;
  if (finances?.accounts?.length)
    documents.push({
      id: "finances",
      title: "Business account balances",
      text: [
        "# Business account balances",
        `Observed: ${finances.recordedAt}`,
        `Source: ${finances.sourceLabel || "Imported balances"}`,
        finances.sourceUrl ? `Source URL: ${finances.sourceUrl}` : "",
        "These are observed account balances, not revenue, profit, or a live bank connection. Keep currencies separate; an unknown currency must stay unknown.",
        ...finances.accounts.map(
          (a: any) =>
            `- ${a.name}: ${a.balance} ${a.currency || "(currency unknown)"}${a.sourceId ? `; source account ${a.sourceId}` : ""}`,
        ),
        finances.monthlyIncome && typeof finances.monthlyIncome.amount === "number"
          ? `Incoming payments, trailing ${finances.monthlyIncome.days || 30} days to ${finances.monthlyIncome.recordedAt}: ${finances.monthlyIncome.amount} ${finances.monthlyIncome.currency} across ${finances.monthlyIncome.transactions} settled credits (internal transfers excluded). This is gross money in, not profit or recognised revenue.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  const byPlatform = new Map<string, any[]>();
  for (const s of workspace.snapshots || []) {
    if (!byPlatform.has(s.platform)) byPlatform.set(s.platform, []);
    byPlatform.get(s.platform)!.push(s);
  }
  for (const [platform, snapshots] of byPlatform) {
    const ordered = [...snapshots].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const latest = ordered.at(-1);
    const identity = audienceMeasurementIdentity(platform, latest?.measurementScope, latest?.sourceUrl);
    // Keep all original observations in private storage. Shared memory contains
    // only the latest confirmed series, or one current unscoped observation.
    // This prevents a model reconstructing growth from incompatible raw totals.
    const usable = identity ? ordered.filter(row => row.measurementScope === latest.measurementScope && audienceMeasurementIdentity(platform, row.measurementScope, row.sourceUrl) === identity) : latest ? [latest] : [];
    documents.push({
      id: `audience-${platform}`,
      title: `${platform[0].toUpperCase() + platform.slice(1)} audience history`,
      text: [
        `# ${platform} audience observations`,
        "Each line is an observation at its stated date. Missing dates are not zero values. Follower/member counts are not revenue.",
        identity ? `Measurement scope: ${latest.measurementScope}. Source identity: ${identity}. Compare only observations with this exact scope and identity.` : "Measurement scope or source identity is unknown. Only the latest observation is included. Do not infer growth or decline.",
        ordered.length > usable.length ? `${ordered.length - usable.length} observations with different or unknown measurement scope or identity are retained in the dashboard history and omitted here. They are not comparison baselines.` : "",
        ...usable.map(s => `${s.recordedAt} | ${Object.entries(s.metrics).map(([key, value]) => `${key}: ${value}`).join(", ")} | ${s.sourceLabel || "Observation"} (${s.origin || "import"})${s.sourceUrl ? ` | ${s.sourceUrl}` : ""} | scope: ${identity ? s.measurementScope : "unknown"}`),
      ].filter(Boolean).join("\n"),
    });
  }
  return documents;
}

export function businessEvidence(workspace: any) {
  const latest = new Map<string, any>();
  for (const s of workspace.snapshots || [])
    if (!latest.has(s.platform) || s.recordedAt >= latest.get(s.platform).recordedAt)
      latest.set(s.platform, s);
  return {
    interpretation:
      "These are saved observations, not guaranteed live values. Cite each observation date and source. Account balances are not revenue or profit; never aggregate different or unknown currencies. Audience growth requires equal explicit measurement scope and source identity; unknown scopes cannot be compared.",
    finances: workspace.finances
      ? {
          recordedAt: workspace.finances.recordedAt,
          sourceLabel: workspace.finances.sourceLabel,
          sourceUrl: workspace.finances.sourceUrl,
          measurement: "account_balances",
        }
      : null,
    audience: [...latest.values()].map((s) => ({
      platform: s.platform,
      recordedAt: s.recordedAt,
      sourceLabel: s.sourceLabel,
      origin: s.origin,
      sourceUrl: s.sourceUrl,
      measurementScope: audienceMeasurementIdentity(s.platform, s.measurementScope, s.sourceUrl) ? s.measurementScope : "unknown",
      sourceIdentity: audienceMeasurementIdentity(s.platform, s.measurementScope, s.sourceUrl),
    })),
    history: {
      observations: (workspace.snapshots || []).length,
      searchableIn: "Memory sources named '[platform] audience history'",
    },
  };
}
