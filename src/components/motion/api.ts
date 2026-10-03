/** Client calls to the Motion Library local API (/__motion/*). */
import type { PromptAsset } from "@/motion/engine/prompt";
import type { Theme } from "@/motion/engine/types";

export interface Status {
  claude: boolean;
  claudeCli: boolean;
  codex: boolean;
  firecrawl: boolean;
  firecrawlSetup: string;
  chrome: boolean;
  ffmpeg: boolean;
  terminal: boolean;
  dryRun: boolean;
  home: string;
}

export interface Uploaded {
  path: string;
  display: string;
  name: string;
  kind: "image" | "video";
  bytes: number;
  frames: string[];
}

export interface ExportJob {
  id: string;
  style: string;
  aspect: "16:9" | "9:16" | "1:1";
  seconds: number;
  state: "starting" | "rendering" | "encoding" | "done" | "error" | "cancelled";
  frames: number;
  total: number;
  file?: string;
  display?: string;
  bytes?: number;
  error?: string;
}

export type Tool = "claude" | "codex";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new ApiError(
      String(data.message || `Request failed (${response.status})`),
      response.status,
      data,
    );
  return data as T;
}

const portable = (assets: PromptAsset[]) =>
  assets.map(({ name, path, kind, frames }) => ({ name, path, kind, frames }));

export const api = {
  status: () => call<Status>("/__motion/status"),
  improve: (body: {
    idea: string;
    theme: Theme;
    styleIds: string[];
    urls: string[];
    assets: PromptAsset[];
    seconds: number;
    branded: boolean;
    engine?: "auto" | "template";
  }) =>
    call<{ prompt: string; engine: "claude" | "template"; note?: string; ms: number }>(
      "/__motion/improve",
      { ...body, theme: { ...body.theme, logo: null }, assets: portable(body.assets) },
    ),
  brand: (url: string) =>
    call<{ theme: Theme; logoUrl: string | null; site: string; colors: string[] }>(
      "/__motion/brand",
      { url },
    ),
  /** Stream a file to ~/motion-studio-projects/assets (with progress). */
  upload: (file: File, onProgress?: (k: number) => void) =>
    new Promise<Uploaded>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/__motion/upload?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          /* not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as Uploaded);
        else reject(new ApiError(String(data.message || "Upload failed."), xhr.status, data));
      };
      xhr.onerror = () => reject(new ApiError("Upload failed.", 0, {}));
      xhr.send(file);
    }),
  launchPreview: (name: string, tool: Tool) =>
    call<{
      folder: string;
      display: string;
      command: string;
      terminal: boolean;
      dryRun: boolean;
      tool: Tool;
    }>("/__motion/launch", { name, preview: true, tool }),
  launch: (name: string, prompt: string, assets: PromptAsset[], tool: Tool) =>
    call<{
      folder: string;
      display: string;
      command: string;
      launched: boolean;
      dryRun: boolean;
      terminal: boolean;
      tool: Tool;
    }>("/__motion/launch", { name, prompt, assets: portable(assets), tool }),
  reveal: (path: string) =>
    call<{ revealed: boolean; dryRun?: boolean }>("/__motion/reveal", { path }),
  exportStart: (style: string, theme: Theme | null, aspect: string, seconds: number) =>
    call<ExportJob>("/__motion/export", { style, theme, aspect, seconds }),
  exportStatus: (id: string) => call<ExportJob>(`/__motion/export?id=${encodeURIComponent(id)}`),
  exportCancel: (id: string) => call<{ cancelled: boolean }>("/__motion/export/cancel", { id }),
};

/** Copy text, with a fallback for browsers that block the async clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0;left:-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** claude.ai prefill. Documented for Claude Desktop (claude://claude.ai/new?q=, ~14,000 chars). */
export function claudeUrl(prompt: string): string {
  return prompt.length <= 14000
    ? `https://claude.ai/new?q=${encodeURIComponent(prompt)}`
    : "https://claude.ai/new";
}

/** chatgpt.com prefill (?q=, about 6,000 characters). */
export function chatgptUrl(prompt: string): string {
  return prompt.length <= 6000
    ? `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
    : "https://chatgpt.com/";
}
