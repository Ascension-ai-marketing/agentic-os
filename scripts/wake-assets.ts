/**
 * wake-assets.ts
 *
 * The files the "Hey Jarvis" listener loads in the page: the openWakeWord models
 * and the ONNX runtime that runs them. They are served from the installed
 * packages, by name from a fixed list, so nothing is fetched from the internet
 * and nothing else in node_modules can be read through here.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const WAKE_MODELS = ["melspectrogram.onnx", "embedding_model.onnx", "silero_vad.onnx", "hey_jarvis_v0.1.onnx"];
const RUNTIME = /^ort-wasm-simd-threaded(\.(jsep|asyncify|jspi))?\.(wasm|mjs)$/;

/** The file on disk for a request path such as `/models/hey_jarvis_v0.1.onnx`, or nothing when it is not on the list. */
export function wakeAsset(root: string, path: string): { file: string; type: string } | undefined {
  const [, folder, name, ...rest] = path.split("?")[0].split("/");
  if (rest.length || !name) return undefined;
  if (folder === "models" && WAKE_MODELS.includes(name)) return { file: join(root, "node_modules", "openwakeword-wasm-browser", "models", name), type: "application/octet-stream" };
  if (folder === "ort" && RUNTIME.test(name)) return { file: join(root, "node_modules", "onnxruntime-web", "dist", name), type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript" };
  return undefined;
}

type Reply = { statusCode: number; setHeader: (name: string, value: string | number) => void; end: (body?: string) => void };

/** Middleware for `/__wake`. */
export function wakeAssets(root: string) {
  return (req: { url?: string; method?: string }, res: Reply) => {
    const asset = req.method === "GET" || req.method === "HEAD" ? wakeAsset(root, req.url || "") : undefined;
    if (!asset || !existsSync(asset.file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", asset.type);
    res.setHeader("Content-Length", statSync(asset.file).size);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") return res.end();
    createReadStream(asset.file).pipe(res as never);
  };
}
