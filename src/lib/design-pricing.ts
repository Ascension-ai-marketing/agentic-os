export type PriceLine = {
  billable: string;
  unit: string;
  costUsd: number;
  variant?: string | null;
  provider?: string | null;
  qualifier?: "from" | "exact";
  conditions?: Record<string, string>;
  sourceUrl?: string;
  fetchedAt?: string;
};
export type PricedModel = {
  id: string;
  label: string;
  kind: "image" | "video";
  perUnit: number | null;
  billing?: "credits";
  creditRate?: number;
  pricing?: PriceLine[];
  pricingSource?: "live" | "estimate" | "unavailable";
};

export function compactUsd(value: number): string {
  if (!value) return "$0";
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${value.toPrecision(2)}`;
}

export function outputPriceLines(model: PricedModel | null): PriceLine[] {
  return (model?.pricing ?? []).filter((line) => line.billable === "output_image");
}

export function videoPriceLines(model: PricedModel | null): PriceLine[] {
  return (model?.pricing ?? []).filter((line) => line.billable === "output_video");
}

export function modelRateLabel(model: PricedModel | null): string {
  if (!model) return "Price unavailable";
  if (model.billing === "credits")
    return typeof model.creditRate === "number" && Number.isFinite(model.creditRate)
      ? `from ${model.creditRate.toLocaleString(undefined, { maximumFractionDigits: 3 })} credits / image`
      : "Higgsfield credits";
  const lines = outputPriceLines(model);
  const imageRates = lines.filter((line) => line.unit === "image");
  if (imageRates.length) {
    const values = [...new Set(imageRates.map((line) => line.costUsd))].sort((a, b) => a - b);
    return `${values.length > 1 || imageRates.some((line) => line.qualifier === "from") ? "from " : ""}${compactUsd(values[0])} / image`;
  }
  const tokenRate = lines.find((line) => line.unit === "token");
  if (tokenRate) return `${compactUsd(tokenRate.costUsd * 1_000_000)} / 1M output tokens`;
  const mpRate = lines.find((line) => line.unit === "megapixel");
  if (mpRate) return `${compactUsd(mpRate.costUsd)} / MP`;
  const videoLines = videoPriceLines(model);
  const secondRates = videoLines.filter((line) => line.unit === "second");
  if (secondRates.length) {
    const values = [...new Set(secondRates.map((line) => line.costUsd))].sort((a, b) => a - b);
    return `${values.length > 1 || secondRates.some((line) => line.qualifier === "from") ? "from " : ""}${compactUsd(values[0])} / second`;
  }
  const videoRates = videoLines.filter((line) => line.unit === "video");
  if (videoRates.length) {
    const values = [...new Set(videoRates.map((line) => line.costUsd))].sort((a, b) => a - b);
    return `${values.length > 1 || videoRates.some((line) => line.qualifier === "from") ? "from " : ""}${compactUsd(values[0])} / video`;
  }
  if (model.perUnit !== null) return `≈${compactUsd(model.perUnit)} / output`;
  return "See provider pricing";
}

export function modelRateDetail(model: PricedModel): string {
  if (model.billing === "credits") return "Higgsfield account credits. Connect to quote the selected settings.";
  const exact = (model.pricing ?? []).filter(
    (line) => line.conditions && line.qualifier === "exact",
  );
  if (exact.length)
    return exact
      .map(
        (line) =>
          `${Object.values(line.conditions!).join(" · ")}: ${compactUsd(line.costUsd)} / ${line.unit}`,
      )
      .join(" · ");
  const tokenRate = outputPriceLines(model).find((line) => line.unit === "token");
  if (tokenRate)
    return `${compactUsd(tokenRate.costUsd * 1_000_000)} per 1M output tokens. Total depends on the generated output.`;
  return modelRateLabel(model);
}

export function usdGenerationEstimate(
  model: PricedModel | null,
  count: number,
  values: Record<string, unknown>,
): { label: string; detail: string; perOutput: number } | null {
  if (!model) return null;
  if (model.billing === "credits") return null;
  const higgsfieldRates = (model.pricing ?? []).filter((line) => line.provider === "Higgsfield");
  if (higgsfieldRates.length) {
    const exact = higgsfieldRates.find(
      (line) =>
        line.qualifier === "exact" &&
        line.conditions &&
        Object.entries(line.conditions).every(
          ([key, expected]) => String(values[key] ?? "").toLowerCase() === expected.toLowerCase(),
        ),
    );
    if (!exact || !["image", "video", "second"].includes(exact.unit)) return null;
    const duration = Number(values.duration);
    if (exact.unit === "second" && (!Number.isFinite(duration) || duration <= 0)) return null;
    const perOutput = exact.costUsd * (exact.unit === "second" ? duration : 1);
    return {
      label: `≈${compactUsd(perOutput * count)}`,
      detail: `${compactUsd(exact.costUsd)} / ${exact.unit} · ${Object.values(exact.conditions!).join(" · ")}`,
      perOutput,
    };
  }
  const resolution = String(values.resolution ?? values.size ?? "").toLowerCase();
  const imageRates = outputPriceLines(model).filter((line) => line.unit === "image");
  if (imageRates.length) {
    const quality = String(values.quality ?? "").toLowerCase();
    const imageTier = resolution || (quality === "high" ? "2k" : quality === "basic" ? "1k" : "");
    const exact = imageTier
      ? imageRates.filter((line) => line.variant?.toLowerCase().includes(imageTier))
      : [];
    const candidates = exact.length ? exact : imageRates;
    const perOutput = Math.min(...candidates.map((line) => line.costUsd));
    const from = !exact.length && new Set(imageRates.map((line) => line.costUsd)).size > 1;
    return {
      label: `${from ? "from " : ""}${compactUsd(perOutput * count)}`,
      detail: `${compactUsd(perOutput)} per output${from ? " at the lowest available tier" : ""}`,
      perOutput,
    };
  }

  const allVideoRates = videoPriceLines(model);
  if (allVideoRates.length) {
    const duration = Math.max(1, Number(values.duration) || 5);
    const matchingTier = resolution
      ? allVideoRates.filter((line) => line.variant?.toLowerCase().includes(resolution))
      : [];
    const candidates = matchingTier.length ? matchingTier : allVideoRates;
    const perSecond = candidates.filter((line) => line.unit === "second");
    if (perSecond.length) {
      const rate = Math.min(...perSecond.map((line) => line.costUsd));
      const perOutput = rate * duration;
      return {
        label: `≈${compactUsd(perOutput * count)}`,
        detail: `${compactUsd(rate)} per second × ${duration}s per output`,
        perOutput,
      };
    }
    const perVideo = candidates.filter((line) => line.unit === "video");
    if (perVideo.length) {
      const perOutput = Math.min(...perVideo.map((line) => line.costUsd));
      const from = !matchingTier.length && new Set(perVideo.map((line) => line.costUsd)).size > 1;
      return {
        label: `${from ? "from " : ""}${compactUsd(perOutput * count)}`,
        detail: `${compactUsd(perOutput)} per video${from ? " at the lowest available tier" : ""}`,
        perOutput,
      };
    }
  }

  if (model.perUnit !== null) {
    return {
      label: `≈${compactUsd(model.perUnit * count)}`,
      detail: `${compactUsd(model.perUnit)} per output`,
      perOutput: model.perUnit,
    };
  }
  return null;
}
