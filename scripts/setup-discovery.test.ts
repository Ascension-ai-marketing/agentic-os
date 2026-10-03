import { expect, test } from "bun:test";
import { privacyPaneAction, setupDiscovery } from "./setup-discovery";

// A synthetic Windows machine. Every platform fact is a parameter, so these
// branches are proven from any host without touching the real file system.
const windowsEnv = {
  PATH: "C:\\Windows\\System32;C:\\Users\\example\\AppData\\Roaming\\npm;C:\\Users\\example\\AppData\\Local\\Programs\\Microsoft VS Code\\bin",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  APPDATA: "C:\\Users\\example\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  SystemRoot: "C:\\Windows",
};
const windows = (present: string[], folders: Record<string, string[]> = {}) => {
  const files = new Set(present);
  const probed: string[] = [];
  const result = setupDiscovery("C:\\Users\\example\\agentic-os", "C:\\Users\\example", {
    platform: "win32",
    env: windowsEnv,
    exists: (candidate) => { probed.push(candidate); return files.has(candidate); },
    list: (directory) => folders[directory] ?? [],
  });
  return { installed: Object.fromEntries(result.tools.map((tool) => [tool.id, tool.installed])), probed, result };
};

test("Windows finds npm .cmd shims, native installs, per-user Programs folders and Store packages", () => {
  const { installed, probed } = windows([
    "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd",
    "C:\\Users\\example\\.local\\bin\\claude.exe",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Cursor",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Windsurf",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Ollama",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Notion",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Obsidian",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Granola",
    "C:\\Users\\example\\AppData\\Local\\LM-Studio",
    "C:\\Users\\example\\AppData\\Local\\AnthropicClaude",
    "C:\\Users\\example\\AppData\\Local\\Packages\\OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Users\\example\\.hermes\\hermes-agent\\venv\\Scripts\\python.exe",
    "C:\\Users\\example\\.hermes\\hermes-agent\\hermes_cli\\main.py",
    "C:\\Users\\example\\.opencode\\bin\\opencode.exe",
  ]);
  for (const id of ["codex", "claude", "vscode", "cursor", "windsurf", "ollama", "notion", "obsidian", "granola", "lmstudio", "chatgpt", "terminal", "hermes", "opencode"])
    expect([id, installed[id]]).toEqual([id, true]);
  for (const id of ["xcode", "iterm", "zed", "jetbrains", "kiro", "trae", "deepseek", "warp", "openclaw"])
    expect([id, installed[id]]).toEqual([id, false]);
  // Only Windows-shaped paths are probed: no /Applications, no bare command names.
  expect(probed.every((candidate) => /^[A-Z]:\\/.test(candidate))).toBe(true);
  expect(probed.some((candidate) => /\\(?:codex|claude|code)$/.test(candidate))).toBe(false);
  // A native .exe is probed before the npm .cmd shim in the same folder.
  const npm = probed.filter((candidate) => candidate.startsWith("C:\\Users\\example\\AppData\\Roaming\\npm\\codex."));
  expect(npm.slice(0, 2)).toEqual(["C:\\Users\\example\\AppData\\Roaming\\npm\\codex.exe", "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd"]);
});

test("Windows: JetBrains versioned folders, Toolbox, Windows Terminal aliases and Program Files installs", () => {
  const programs = "C:\\Users\\example\\AppData\\Local\\Programs";
  const ide = windows([], { [programs]: ["IntelliJ IDEA 2026.1", "Something else"] });
  expect(ide.installed.jetbrains).toBe(true);
  const toolbox = windows(["C:\\Users\\example\\AppData\\Local\\JetBrains\\Toolbox"]);
  expect(toolbox.installed.jetbrains).toBe(true);
  const machineWide = windows(["C:\\Program Files\\Microsoft VS Code", "C:\\Program Files (x86)\\Zed"]);
  expect(machineWide.installed.vscode).toBe(true);
  expect(machineWide.installed.zed).toBe(true);
  const alias = windows(["C:\\Users\\example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"]);
  expect(alias.installed.terminal).toBe(true);
  const store = windows(["C:\\Users\\example\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe"]);
  expect(store.installed.terminal).toBe(true);
  const deepseek = windows(["C:\\Users\\example\\agentic-os\\.operator-data\\dsh-venv\\Scripts\\python.exe"]);
  expect(deepseek.probed.some((candidate) => candidate.endsWith("Scripts\\python.exe") || candidate.endsWith("Scripts/python.exe"))).toBe(true);
  const bare = windows([]);
  expect(Object.values(bare.installed).every((value) => value === false)).toBe(true);
  expect(bare.result.connectionsEndpoint).toBe("/__operator/setup/connections");
});

test("macOS keeps its bundle and Homebrew checks and never probes Windows folders", () => {
  const present = new Set(["/Applications/Cursor.app", "/opt/homebrew/bin/codex", "/System/Applications/Utilities/Terminal.app", "/Users/example/Applications/Obsidian.app"]);
  const probed: string[] = [];
  const result = setupDiscovery("/Users/example/agentic-os", "/Users/example", {
    platform: "darwin",
    env: { PATH: "/usr/bin:/opt/homebrew/bin" },
    exists: (candidate) => { probed.push(candidate); return present.has(candidate); },
  });
  const installed = Object.fromEntries(result.tools.map((tool) => [tool.id, tool.installed]));
  expect(installed).toMatchObject({ cursor: true, codex: true, terminal: true, obsidian: true, claude: false, vscode: false });
  expect(probed.some((candidate) => /^[A-Z]:\\|\.exe$|\.cmd$/.test(candidate))).toBe(false);
});

test("the privacy pane is a macOS action, a Windows hint and unsupported elsewhere", () => {
  expect(privacyPaneAction("darwin")).toEqual({ kind: "open", target: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders" });
  expect(privacyPaneAction("win32")).toEqual({ kind: "not-needed", hint: "Windows does not need folder permission for Documents." });
  expect(privacyPaneAction("linux")).toEqual({ kind: "unsupported", message: "Folder permissions are managed by your operating system." });
});
