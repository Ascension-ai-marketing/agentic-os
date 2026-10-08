declare module "openwakeword-wasm-browser" {
  export class WakeWordEngine {
    constructor(options?: { keywords?: string[]; baseAssetUrl?: string; ortWasmPath?: string; detectionThreshold?: number; cooldownMs?: number; debug?: boolean });
    load(): Promise<void>;
    start(options?: { deviceId?: string; gain?: number }): Promise<void>;
    stop(): Promise<void>;
    on(event: "detect", handler: (hit: { keyword: string; score: number }) => void): () => void;
    on(event: "error", handler: (error: unknown) => void): () => void;
  }
}
