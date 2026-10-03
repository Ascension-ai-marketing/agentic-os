import type { AudiencePlatform } from "./business-workspace";

/** Presentation examples only. Never save these as observed account metrics. */
export const AUDIENCE_PREVIEW_VALUES: Record<AudiencePlatform, number> = {
  youtube: 273_000,
  instagram: 48_600,
  tiktok: 82_400,
  linkedin: 12_802,
};

/** Relative periods make the example distinct from dated, verified observations. */
export function audienceExampleGrowth(total: number) {
  const shape = [.78, .79, .815, .807, .837, .861, .855, .895, .925, .941, .974, 1];
  return shape.map((ratio, period) => ({ period: period + 1, value: Math.round(total * ratio) }));
}
