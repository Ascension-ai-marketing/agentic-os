import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerKey } from "./provider-config";

test("fresh provider is unconfigured; explicit local settings override legacy store", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-provider-"));
  const options = { home: root, env: {} };
  try {
    expect(providerKey(root, "OPENROUTER_API_KEY", options)).toBe("");
    mkdirSync(join(root, ".hermes"));
    writeFileSync(join(root, ".hermes/.env"), "OPENROUTER_API_KEY=legacy-fixture\n");
    expect(providerKey(root, "OPENROUTER_API_KEY", options)).toBe("legacy-fixture");
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config/agentic-os.env"), "export OPENROUTER_API_KEY='generic-fixture'\n");
    expect(providerKey(root, "OPENROUTER_API_KEY", options)).toBe("generic-fixture");
    writeFileSync(join(root, ".env.local"), "OPENROUTER_API_KEY=project-fixture # example\n");
    expect(providerKey(root, "OPENROUTER_API_KEY", options)).toBe("project-fixture");
    expect(providerKey(root, "OPENROUTER_API_KEY", { home: root, env: { OPENROUTER_API_KEY: "env-fixture" } })).toBe("env-fixture");
    expect(providerKey(root, ".*", options)).toBe("");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a setting left empty never takes the next line as its value", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-provider-"));
  const options = { home: root, env: {} };
  try {
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config/agentic-os.env"), "FIRST_API_KEY=\nSECOND_API_KEY=second-fixture\n  THIRD_API_KEY = third-fixture\n");
    expect(providerKey(root, "FIRST_API_KEY", options)).toBe("");
    expect(providerKey(root, "SECOND_API_KEY", options)).toBe("second-fixture");
    expect(providerKey(root, "THIRD_API_KEY", options)).toBe("third-fixture");
    mkdirSync(join(root, ".hermes"));
    writeFileSync(join(root, ".hermes/.env"), "FIRST_API_KEY=legacy-fixture\n");
    expect(providerKey(root, "FIRST_API_KEY", options)).toBe("legacy-fixture");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
