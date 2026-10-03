import type { AudiencePlatform, AudienceSnapshot } from "./business-workspace";
/** A presentation layer only. Never saved as observed account data. */
export function demoAudience(now = new Date()): AudienceSnapshot[] {
  const totals: Record<AudiencePlatform, number> = { youtube: 284600, instagram: 92600, tiktok: 163400, linkedin: 48750 };
  return (Object.keys(totals) as AudiencePlatform[]).flatMap((platform, index) => Array.from({ length: 31 }, (_, day) => {
    const recordedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30 + day, 12)).toISOString();
    const growth = .88 + .12 * (day / 30) ** (1.1 + index * .1);
    const total = Math.round(totals[platform] * growth);
    return { id: `demo-${platform}-${day}`, platform, recordedAt, origin: "manual" as const, sourceLabel: "Demo · fictional audience", metrics: { followers: total, views: Math.round(total * (12 + index) * growth), likes: Math.round(total * 2.8), ...(platform === "youtube" ? { videos: 160 + day } : { posts: 260 + day * 2 }) } };
  }));
}
export function demoBrief(version = 0, now = new Date()) {
  const priorities = ["Publish the next OS demo. YouTube is at 284,600 subscribers in this example; give viewers one clear next step into the community.", "Close the remaining $300,000 gap to the quarterly revenue goal. This demo is at $1.2M of $1.5M, with $400,000 income this month.", "Turn Instagram reach into sign-ups. The sample Instagram audience has 92,600 followers; point this week's posts at one clear offer before the next launch."];
  const ordered = priorities.slice(version % 3).concat(priorities.slice(0, version % 3));
  const source = { label: "Demo scenario · fictional business figures", ref: "/business" };
  return { id: `demo-brief-${version}`, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now), timezone: "Asia/Dubai", headline: "A clear next move.", summary: "Demo scenario: $1M cash, $400K monthly income and 80% of the quarterly revenue target. Use today to publish, convert and welcome your next members.", priorityActions: ordered.map((text, i) => ({ id: `demo-priority-${i}`, text, completed: false })), prioritySources: ordered.map(() => [source]), sections: [{ id: "business-demo", title: "Room to grow", body: "Cash is $1,000,000 across three example accounts. Quarterly revenue is $1,200,000 against a $1,500,000 goal. All business figures and recommendations in this brief are fictional demo data.", sources: [source] }], createdAt: now.toISOString(), updatedAt: now.toISOString() };
}
