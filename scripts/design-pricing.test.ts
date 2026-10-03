import { describe, expect, test } from "bun:test";
import {
  compactUsd,
  modelRateDetail,
  modelRateLabel,
  usdGenerationEstimate,
  type PricedModel,
} from "../src/lib/design-pricing";
const soul: PricedModel = {
  id: "higgsfield-ai/soul/v2/standard",
  label: "Soul 2",
  kind: "image",
  perUnit: null,
  pricingSource: "live",
  pricing: [
    {
      billable: "output_image",
      unit: "image",
      costUsd: 0.0032,
      provider: "Higgsfield",
      qualifier: "from",
    },
    {
      billable: "output_image",
      unit: "image",
      costUsd: 0.0032,
      provider: "Higgsfield",
      qualifier: "exact",
      conditions: { resolution: "720p", aspect_ratio: "4:3" },
    },
    {
      billable: "output_image",
      unit: "image",
      costUsd: 0.0057,
      provider: "Higgsfield",
      qualifier: "exact",
      conditions: { resolution: "1080p", aspect_ratio: "4:3" },
    },
  ],
};
describe("Design pricing labels and selected settings", () => {
  test("Higgsfield account credits never become a USD API estimate", () => {
    const accountModel: PricedModel = {id: "mcp/nano_banana_2", label: "Nano Banana 2", kind: "image", perUnit: null, billing: "credits", creditRate: 1.5};
    expect(modelRateLabel(accountModel)).toBe("from 1.5 credits / image");
    expect(usdGenerationEstimate(accountModel, 1, {resolution: "1k"})).toBeNull();
    expect(modelRateLabel({...accountModel, creditRate: undefined})).toBe("Higgsfield credits");
  });
  test("shows exact small published rates instead of rounding them to another price", () => {
    expect(compactUsd(0.0032)).toBe("$0.0032");
    expect(compactUsd(0.0715)).toBe("$0.0715");
    expect(compactUsd(0.0057)).toBe("$0.0057");
  });
  test("Soul2 picker says From while the composer calculates the matching 720p and1080p rates", () => {
    expect(modelRateLabel(soul)).toBe("from $0.0032 / image");
    expect(usdGenerationEstimate(soul, 1, { resolution: "720p", aspect_ratio: "4:3" })?.label).toBe(
      "≈$0.0032",
    );
    expect(
      usdGenerationEstimate(soul, 4, { resolution: "1080p", aspect_ratio: "4:3" })?.label,
    ).toBe("≈$0.0228");
    expect(modelRateDetail(soul)).toContain("1080p · 4:3: $0.0057 / image");
  });
  test("does not price an undocumented aspect or resolution at the cheapest tier", () => {
    expect(usdGenerationEstimate(soul, 1, { resolution: "4k", aspect_ratio: "4:3" })).toBeNull();
    expect(usdGenerationEstimate(soul, 1, { resolution: "1080p", aspect_ratio: "1:1" })).toBeNull();
  });
  test("video minimum is per second, never silently the total for a run", () => {
    const model: PricedModel = {
      id: "bytedance/seedance-2.5/text-to-video",
      label: "Seedance2.5",
      kind: "video",
      perUnit: null,
      pricing: [
        {
          billable: "output_video",
          unit: "second",
          costUsd: 0.144,
          provider: "Higgsfield",
          qualifier: "from",
        },
        {
          billable: "output_video",
          unit: "second",
          costUsd: 0.3236,
          provider: "Higgsfield",
          qualifier: "exact",
          conditions: { resolution: "720p", duration: "30" },
        },
      ],
    };
    expect(modelRateLabel(model)).toBe("from $0.144 / second");
    expect(usdGenerationEstimate(model, 1, { resolution: "720p", duration: 5 })).toBeNull();
    expect(
      usdGenerationEstimate(model, 1, { resolution: "720p", duration: 30 })?.perOutput,
    ).toBeCloseTo(9.708);
  });
  test("output-token billing shows the provider rate, without inventing a per-image minimum", () => {
    const tokenModel: PricedModel = {
      id: "openai/gpt-image-2",
      label: "GPT Image2",
      kind: "image",
      perUnit: null,
      pricing: [{ billable: "output_image", unit: "token", costUsd: 0.00003 }],
    };
    expect(modelRateLabel(tokenModel)).toBe("$30 / 1M output tokens");
    expect(usdGenerationEstimate(tokenModel, 1, { quality: "high" })).toBeNull();
  });
  test("unknown rates are explicit, never a zero-dollar quote", () => {
    expect(modelRateLabel({ ...soul, pricing: [] })).toBe("See provider pricing");
    expect(usdGenerationEstimate({ ...soul, pricing: [] }, 1, {})).toBeNull();
  });
});
