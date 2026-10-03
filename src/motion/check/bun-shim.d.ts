/** Minimal Bun globals for the check script, so `tsc` passes without bun-types. */
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser" | "bun" | "node";
    minify?: boolean;
  }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
  serve(options: {
    port: number;
    hostname?: string;
    fetch(request: Request): Response | Promise<Response>;
  }): { port: number; stop(force?: boolean): void };
};

interface ImportMeta {
  /** Bun: the directory of the current module. */
  readonly dir: string;
}
