/**
 * A dependency-free headless Chrome driver over the DevTools protocol.
 * Used by the mp4 exporter (inside the dev server, Node) and by the style
 * check (Bun). Needs Google Chrome, Chromium, Edge or Brave on the machine.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export function findChrome(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.MOTION_STUDIO_CHROME;
  if (override && existsSync(override)) return override;
  const home = homedir();
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
      : process.platform === "win32"
        ? [
            join(
              env.PROGRAMFILES || "C:\\Program Files",
              "Google\\Chrome\\Application\\chrome.exe",
            ),
            join(
              env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
              "Google\\Chrome\\Application\\chrome.exe",
            ),
            join(
              env.LOCALAPPDATA || join(home, "AppData\\Local"),
              "Google\\Chrome\\Application\\chrome.exe",
            ),
            join(
              env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
              "Microsoft\\Edge\\Application\\msedge.exe",
            ),
          ]
        : (env.PATH || "")
            .split(delimiter)
            .flatMap((dir) =>
              [
                "google-chrome",
                "google-chrome-stable",
                "chromium",
                "chromium-browser",
                "microsoft-edge",
              ].map((name) => join(dir, name)),
            );
  return candidates.find((c) => existsSync(c)) ?? null;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type ExceptionDetails = { text?: string; exception?: { description?: string } };
type CdpParams = { exceptionDetails?: ExceptionDetails } | undefined;
type EvalResult = { result?: { value?: unknown }; exceptionDetails?: ExceptionDetails };

export interface Page {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  goto(url: string, readyExpression?: string, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export const CHROME_FLAGS = [
  "--headless=new",
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--mute-audio",
  "--hide-scrollbars",
  "--disable-extensions",
  "--disable-sync",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--force-color-profile=srgb",
  "--autoplay-policy=user-gesture-required",
];

export async function launchChrome(options: { chrome?: string | null } = {}): Promise<Browser> {
  const chrome = options.chrome ?? findChrome();
  if (!chrome)
    throw new Error(
      "Export needs Google Chrome (or Chromium, Edge, Brave). Install Chrome, or set MOTION_STUDIO_CHROME to its path.",
    );
  if (typeof WebSocket === "undefined")
    throw new Error("This runtime has no WebSocket. Use Node 22 or newer.");
  const profile = mkdtempSync(join(tmpdir(), "motion-studio-chrome-"));
  const child: ChildProcess = spawn(
    chrome,
    [...CHROME_FLAGS, `--user-data-dir=${profile}`, "about:blank"],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const cleanup = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* temp folder */
    }
  };
  const endpoint = await new Promise<string>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not start within 20 s.")), 20000);
    child.stderr?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = buffered.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (code ${code}).`));
    });
  }).catch((e) => {
    cleanup();
    throw e;
  });

  const ws = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Could not connect to Chrome."));
  });
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(params: CdpParams) => void>>();
  ws.onmessage = (event: MessageEvent) => {
    const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error)
        p.reject(new Error(`${msg.error.message}${msg.error.data ? ": " + msg.error.data : ""}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      const key = `${msg.sessionId || ""}:${msg.method}`;
      listeners.get(key)?.forEach((fn) => fn(msg.params));
    }
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error("Chrome closed the connection."));
    pending.clear();
  };
  const send = <T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: (v) => resolve(v as T), reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const on = (sessionId: string, method: string, fn: (params: CdpParams) => void) => {
    const key = `${sessionId}:${method}`;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => listeners.get(key)?.delete(fn);
  };

  const newPage = async (): Promise<Page> => {
    const { targetId } = await send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const s = <T = unknown>(method: string, params?: Record<string, unknown>) =>
      send<T>(method, params, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    const errors: string[] = [];
    on(sessionId, "Runtime.exceptionThrown", (p) =>
      errors.push(
        p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "error",
      ),
    );
    const evaluate = async <T = unknown>(expression: string): Promise<T> => {
      const r = await s<EvalResult>("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(
          r.exceptionDetails.exception?.description ||
            r.exceptionDetails.text ||
            "Evaluation failed",
        );
      return r.result?.value as T;
    };
    return {
      send: s,
      evaluate,
      async goto(url, readyExpression = "true", timeoutMs = 60000) {
        await s("Page.navigate", { url });
        const until = Date.now() + timeoutMs;
        for (;;) {
          try {
            if (
              await evaluate<boolean>(
                `document.readyState === "complete" && !!(${readyExpression})`,
              )
            )
              return;
          } catch {
            /* page still loading */
          }
          if (errors.length) throw new Error(`Page error: ${errors[0]}`);
          if (Date.now() > until) throw new Error(`Timed out loading ${url}`);
          await new Promise((r) => setTimeout(r, 120));
        }
      },
      async close() {
        await send("Target.closeTarget", { targetId }).catch(() => undefined);
      },
    };
  };

  return {
    newPage,
    async close() {
      try {
        await Promise.race([send("Browser.close"), new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* closing anyway */
      }
      try {
        ws.close();
      } catch {
        /* closed */
      }
      cleanup();
    },
  };
}
