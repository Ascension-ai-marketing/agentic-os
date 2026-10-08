import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WAKE_MODELS, wakeAsset } from "./wake-assets";

const ROOT = resolve(import.meta.dir, "..");

test("the wake word files are the installed ones, by name from a fixed list", () => {
  for (const name of WAKE_MODELS) expect(existsSync(wakeAsset(ROOT, `/models/${name}`)!.file)).toBe(true);
  expect(wakeAsset(ROOT, "/ort/ort-wasm-simd-threaded.wasm")).toMatchObject({ type: "application/wasm" });
  expect(wakeAsset(ROOT, "/ort/ort-wasm-simd-threaded.jsep.mjs?import")).toMatchObject({ type: "text/javascript" });
});

test("nothing else can be read through it", () => {
  for (const path of ["/models/alexa_v0.1.onnx", "/models/../package.json", "/models/%2e%2e/package.json", "/ort/ort.min.mjs", "/ort/../package.json", "/models/a/hey_jarvis_v0.1.onnx", "/", "/models", ""])
    expect(wakeAsset(ROOT, path)).toBeUndefined();
});
