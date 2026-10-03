import { existsSync, readdirSync } from "node:fs";
import * as nodePath from "node:path";
import { homedir } from "node:os";
import {
  assistantPython,
  findExecutable,
  hermesInstalled,
  type LookupOptions,
} from "./assistant-runtime";
import { providerKey } from "./provider-config";

export type DiscoveryOptions = LookupOptions & {
  /** Bounded folder listing for versioned install folders (JetBrains IDEs). */
  list?: (directory: string) => string[];
};

/** Where the operator grants folder access. Only macOS gates Documents behind a
 * Files and Folders prompt; Windows reads the user's own Documents without one. */
export function privacyPaneAction(
  platform: NodeJS.Platform = process.platform,
):
  | { kind: "open"; target: string }
  | { kind: "not-needed"; hint: string }
  | { kind: "unsupported"; message: string } {
  if (platform === "darwin")
    return {
      kind: "open",
      target: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
    };
  if (platform === "win32")
    return { kind: "not-needed", hint: "Windows does not need folder permission for Documents." };
  return { kind: "unsupported", message: "Folder permissions are managed by your operating system." };
}

/** Microsoft Store package families. Their per-user package folder is readable
 * without elevation, unlike Program Files\WindowsApps. */
const STORE_PACKAGES = {
  chatgpt: "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0",
  windowsTerminal: "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
};

export function setupDiscovery(root: string, home = homedir(), options: DiscoveryOptions = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const list =
    options.list ??
    ((directory: string) => {
      try {
        return readdirSync(directory).slice(0, 500);
      } catch {
        return [];
      }
    });
  const windows = platform === "win32";
  const p = windows ? nodePath.win32 : nodePath.posix;
  const searchPath = options.path ?? env.PATH ?? env.Path ?? "";
  const lookup = { ...options, platform, env, home, path: searchPath };
  const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 =
    env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
  const programs = p.join(localAppData, "Programs");
  const packages = p.join(localAppData, "Packages");

  /** A command on PATH or in a known shim folder. Windows accepts .exe and npm .cmd shims. */
  const installed = (name: string) => !!findExecutable(name, lookup);
  /** A desktop app: macOS bundles, or the per-user and machine-wide Windows install folders. */
  const app = (name: string, windowsFolders: string[] = []) =>
    windows
      ? [
          p.join(programs, name),
          p.join(localAppData, name),
          p.join(programFiles, name),
          p.join(programFilesX86, name),
          ...windowsFolders,
        ].some(exists)
      : [p.join("/Applications", `${name}.app`), p.join(home, "Applications", `${name}.app`)].some(
          exists,
        );
  const storeApp = (packageFamily: string) => windows && exists(p.join(packages, packageFamily));
  /** Versioned install folders share a stable prefix, for example "IntelliJ IDEA 2026.1". */
  const folderStartingWith = (directory: string, prefix: string) =>
    windows &&
    list(directory).some((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
  const jetbrains = () =>
    windows
      ? exists(p.join(localAppData, "JetBrains", "Toolbox")) ||
        exists(p.join(programFiles, "JetBrains")) ||
        ["IntelliJ IDEA", "PyCharm", "WebStorm", "Rider"].some((ide) =>
          folderStartingWith(programs, ide),
        )
      : ["IntelliJ IDEA", "PyCharm", "WebStorm", "Rider"].some((ide) => app(ide));
  const terminal = () => {
    if (windows)
      return (
        exists(p.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")) ||
        storeApp(STORE_PACKAGES.windowsTerminal) ||
        exists(p.join(localAppData, "Microsoft", "WindowsApps", "wt.exe")) ||
        installed("pwsh")
      );
    return exists("/System/Applications/Utilities/Terminal.app") || app("iTerm") || app("Warp");
  };
  const result = [
    {
      id: "codex",
      name: "Codex",
      installed: installed("codex") || app("Codex"),
      detail: "Check existing app connections separately. Model availability does not prove app access.",
    },
    {
      id: "claude",
      name: "Claude Code",
      installed: installed("claude") || app("Claude", [p.join(localAppData, "AnthropicClaude")]),
      detail: "Uses your configured local Claude tool. Its native connections stay in Claude.",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      installed: app("ChatGPT") || storeApp(STORE_PACKAGES.chatgpt),
      detail: "Use existing connections in ChatGPT. This workspace does not inherit its sign-in or tools.",
    },
    {
      id: "hermes",
      name: "Hermes",
      installed: hermesInstalled(home, searchPath, lookup),
      detail: "Uses your configured Hermes harness.",
    },
    {
      id: "openclaw",
      name: "OpenClaw",
      installed: installed("openclaw") || app("OpenClaw"),
      detail: "App detection only. Configure its runtime and choose a history source separately.",
    },
    {
      id: "cursor",
      name: "Cursor",
      installed: installed("cursor") || app("Cursor"),
      detail: "App detection only. Cursor history is not imported by this workspace.",
    },
    ...[
      ["windsurf", "Windsurf", "windsurf"], ["vscode", "Visual Studio Code", "code"],
      ["zed", "Zed", "zed"], ["antigravity", "Antigravity", "antigravity"],
      ["copilot", "GitHub Copilot", "copilot"], ["jetbrains", "JetBrains", "idea"],
      ["aider", "Aider", "aider"], ["continue", "Continue", "cn"], ["goose", "Goose", "goose"],
      ["trae", "Trae", "trae"], ["kiro", "Kiro", "kiro"], ["xcode", "Xcode", "xcodebuild"],
      ["gemini", "Gemini CLI", "gemini"], ["opencode", "OpenCode", "opencode"], ["warp", "Warp", "warp"], ["iterm", "iTerm", "iterm"],
    ].map(([id, name, binary]) => ({
      id,
      name,
      installed:
        installed(binary) ||
        app(name, id === "vscode" ? [p.join(programs, "Microsoft VS Code"), p.join(programFiles, "Microsoft VS Code")] : []) ||
        (id === "jetbrains" && jetbrains()) ||
        (id === "opencode" && exists(p.join(home, ".opencode", "bin", windows ? "opencode.exe" : "opencode"))) ||
        (id === "iterm" && app("iTerm2")) ||
        (id === "kiro" && app("Kiro Desktop")),
      detail: "App or command detected independently. Extensions and model sign-in are managed in the IDE.",
    })),
    {
      id: "terminal",
      name: "Terminal",
      installed: terminal(),
      detail: "A terminal can run local AI tools; shell history is not read or imported.",
    },
    ...["Granola", "Notion", "Obsidian"].map(name => ({
      id: name.toLowerCase(), name, installed: app(name),
      detail: "App detection only. Readable local history and callable account connections are checked separately.",
    })),
    {
      id: "deepseek",
      name: "DeepSeek Harness",
      installed: exists(assistantPython(root, platform)),
      detail: "Requires the optional runtime and an OpenRouter connection.",
    },
    {
      id: "ollama",
      name: "Ollama",
      installed: installed("ollama") || app("Ollama"),
      detail: "Start Ollama and load a model to chat locally.",
    },
    {
      id: "lmstudio",
      name: "LM Studio",
      installed: app("LM Studio", [p.join(localAppData, "LM-Studio"), p.join(programs, "lm-studio")]),
      detail: "Start the local server and load a model.",
    },
  ];
  return {
    tools: result,
    platform: process.platform,
    connectionsEndpoint: "/__operator/setup/connections",
    providers: [
      {
        id: "openrouter",
        name: "OpenRouter",
        configured: !!providerKey(root, "OPENROUTER_API_KEY", { home }),
      },
      {
        id: "openai",
        name: "OpenAI voice",
        configured: !!providerKey(root, "OPENAI_API_KEY", { home }),
      },
    ],
  };
}
