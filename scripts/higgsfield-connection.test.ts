import { expect, test } from "bun:test";
import { higgsfieldCredential, preferredHiggsfieldMode } from "../src/lib/higgsfield-connection";
test("an explicit API choice stays selected even before the key is connected", () => {
  expect(preferredHiggsfieldMode("api", false, true)).toBe("api");
  expect(preferredHiggsfieldMode("api", true, true)).toBe("api");
  expect(preferredHiggsfieldMode("account", true, false)).toBe("account");
  expect(preferredHiggsfieldMode("account", false, true)).toBe("account");
  expect(preferredHiggsfieldMode(null, false, true)).toBe("account");
  expect(preferredHiggsfieldMode(null, true, true)).toBe("api");
});
test("the form combines separate credential parts and accepts the full copied credential", () => {
  expect(higgsfieldCredential(" example-id ", " example-secret ")).toBe("example-id:example-secret");
  expect(higgsfieldCredential("Key example-id:example-secret", "ignored")).toBe("example-id:example-secret");
  expect(higgsfieldCredential("example-id:example-secret")).toBe("example-id:example-secret");
});
test("an incomplete key is rejected immediately without a credential request", () => {
  expect(() => higgsfieldCredential("example-id")).toThrow("ID alone cannot connect");
  expect(() => higgsfieldCredential("example-id:")).toThrow("complete API key");
  expect(() => higgsfieldCredential("example-id:secret\nAuthorization: bad")).toThrow("complete API key");
});
