import * as nodePath from "node:path";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

/** Platform facts are parameters, so every Windows branch can be proven from a macOS host. */
export type PlatformOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};
export type LookupOptions = PlatformOptions & {
  home?: string;
  path?: string;
  /** Replaces the file-system probe; tests point it at synthetic Windows paths. */
  exists?: (candidate: string) => boolean;
};

const platformPath = (platform: NodeJS.Platform) =>
  platform === "win32" ? nodePath.win32 : nodePath.posix;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const isExecutableFile = (platform: NodeJS.Platform) => (candidate: string) => {
  try {
    if (platform !== "win32") accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

/** Suffixes Windows launches for a bare command name. `.exe` first: a native
 * install starts directly, an npm `.cmd` shim needs cmd.exe. PATHEXT can narrow
 * the list but never adds script kinds this OS does not spawn. */
export function windowsExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const allowed = new Set(
    (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((extension) => extension.trim().toLowerCase())
      .filter(Boolean),
  );
  const ordered = [".exe", ".cmd", ".bat", ".com"].filter((extension) => allowed.has(extension));
  return ordered.length ? ordered : [".exe", ".cmd", ".bat", ".com"];
}

/** Folders where a CLI is commonly installed, PATH first, then well-known per-user locations. */
export function executableDirectories(name: string, options: LookupOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const p = platformPath(platform);
  const searchPath = options.path ?? env.PATH ?? env.Path ?? "";
  const fromPath = searchPath
    .split(p.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  if (platform === "win32") {
    const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    const programFiles = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    return unique([
      ...fromPath,
      // npm global shims: codex.cmd and claude.cmd live here.
      p.join(appData, "npm"),
      p.join(localAppData, "pnpm"),
      p.join(localAppData, "Volta", "bin"),
      p.join(home, ".bun", "bin"),
      // Claude Code's native installer.
      p.join(home, ".local", "bin"),
      p.join(home, "scoop", "shims"),
      p.join(localAppData, "Programs", name),
      p.join(localAppData, "Programs", name, "bin"),
      p.join(localAppData, "Programs", title),
      p.join(localAppData, "Programs", title, "bin"),
      p.join(programFiles, title),
      p.join(programFiles, title, "bin"),
      // Microsoft Store execution aliases are readable without elevation.
      p.join(localAppData, "Microsoft", "WindowsApps"),
    ]);
  }
  return unique([
    ...fromPath,
    p.join(home, ".local", "bin"),
    p.join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]);
}

/** Every file the OS would accept as the named command, in probe order. */
export function executableCandidates(name: string, options: LookupOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const p = platformPath(platform);
  const files =
    platform === "win32"
      ? windowsExtensions(options.env ?? process.env).map((extension) => name + extension)
      : [name];
  const candidates = executableDirectories(name, options).flatMap((directory) =>
    files.map((file) => p.join(directory, file)),
  );
  if (platform !== "win32" && name === "codex")
    candidates.push("/Applications/Codex.app/Contents/Resources/codex");
  return unique(candidates);
}

export function findExecutable(name: string, options: LookupOptions = {}): string | undefined {
  const exists = options.exists ?? isExecutableFile(options.platform ?? process.platform);
  return executableCandidates(name, options).find(exists);
}

export function assistantBinary(
  name: "codex" | "claude",
  home = homedir(),
  path?: string,
  options: LookupOptions = {},
): string | undefined {
  return findExecutable(name, { ...options, home, path });
}

export type CommandLaunch = { file: string; args: string[]; windowsVerbatimArguments: boolean };

/** cmd.exe must run `.cmd`/`.bat` shims (the npm layout on Windows); a native `.exe` or a POSIX binary starts directly. */
export function needsCommandShell(binary: string, platform: NodeJS.Platform = process.platform) {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(binary);
}

/** Quote one argument for `cmd.exe /s /c` so the program parses the same argv as a
 * direct spawn (CommandLineToArgvW rules). Arguments here are fixed CLI flags; an
 * argument that mixes `"` with cmd metacharacters (& | < > ^) is not supported. */
export function quoteCommandArgument(argument: string): string {
  if (argument !== "" && !/[\s"&|<>^()%!]/.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const char of argument) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes) + char;
    backslashes = 0;
  }
  return quoted + "\\".repeat(backslashes * 2) + '"';
}

/** What to hand `spawn`/`execFile` for a binary: unchanged on POSIX and for a
 * Windows `.exe`; wrapped in `cmd.exe /d /s /c` with verbatim quoting for a shim. */
export function commandLaunch(
  binary: string,
  args: string[],
  options: PlatformOptions = {},
): CommandLaunch {
  const platform = options.platform ?? process.platform;
  if (!needsCommandShell(binary, platform))
    return { file: binary, args, windowsVerbatimArguments: false };
  const env = options.env ?? process.env;
  const shell = env.ComSpec || env.COMSPEC || "cmd.exe";
  const command = [binary, ...args].map(quoteCommandArgument).join(" ");
  return { file: shell, args: ["/d", "/s", "/c", `"${command}"`], windowsVerbatimArguments: true };
}

/** Stop a runtime child. POSIX signals the process (or its detached group).
 * Windows has no signals: `taskkill /t` ends the tree, because killing only a
 * cmd.exe shim would leave the real Codex or Claude process running. */
export function terminateChild(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
  options: PlatformOptions & { detached?: boolean; run?: typeof spawn } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (child.pid) {
      const env = options.env ?? process.env;
      const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
      try {
        const killer = (options.run ?? spawn)(
          nodePath.win32.join(systemRoot, "System32", "taskkill.exe"),
          ["/pid", String(child.pid), "/t", "/f"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.on("error", () => {});
        killer.unref?.();
      } catch {
        /* taskkill is optional; the direct kill below still runs. */
      }
    }
    try {
      child.kill();
    } catch {
      /* It has already exited. */
    }
    return;
  }
  try {
    if (options.detached && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* It has already exited. */
    }
  }
}

export async function claudeSignInStatus(
  binary = assistantBinary("claude"),
  run: (file: string, args: string[], options: any) => Promise<{ stdout: string }> = async (
    file,
    args,
    options,
  ) => {
    const result = await promisify(execFile)(file, args, { ...options, encoding: "utf8" });
    return { stdout: String(result.stdout) };
  },
  options: PlatformOptions = {},
) {
  if (!binary)
    return {
      id: "claude",
      installed: false,
      ready: false,
      detail: "Install Claude Code, then sign in there.",
    };
  try {
    const launch = commandLaunch(binary, ["auth", "status", "--json"], options);
    const { stdout } = await run(launch.file, launch.args, {
      timeout: 4000,
      maxBuffer: 32000,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    const ready = JSON.parse(stdout).loggedIn === true;
    return {
      id: "claude",
      installed: true,
      ready,
      detail: ready
        ? "Claude Code reports signed in; generation and app access are not verified."
        : "Open Claude Code and sign in. A Claude desktop login alone is not confirmation.",
    };
  } catch (error) {
    // Claude returns exit 1 with valid status JSON when signed out. That is a
    // confirmed signed-out state, not a broken discovery or a missing history.
    try {
      if (JSON.parse(String((error as any)?.stdout || "")).loggedIn === false)
        return { id: "claude", installed: true, ready: false,
          detail: "Claude Code is installed but signed out. Open Claude Code and run /login. Saved local history can still be imported." };
    } catch { /* Unreadable status remains unverified below. */ }
    return {
      id: "claude",
      installed: true,
      ready: false,
      detail: "Could not verify Claude Code sign-in. Open Claude Code and check /login.",
    };
  }
}

export function assistantPython(root: string, platform: NodeJS.Platform = process.platform): string {
  return platformPath(platform).resolve(
    root,
    ".operator-data",
    "dsh-venv",
    ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
}

export function hermesInstalled(
  home = homedir(),
  path?: string,
  options: LookupOptions = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const p = platformPath(platform);
  const exists = options.exists ?? existsSync;
  const runtime = p.join(home, ".hermes", "hermes-agent");
  const python = p.join(
    runtime,
    "venv",
    ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  if (exists(python) && exists(p.join(runtime, "hermes_cli", "main.py"))) return true;
  return !!findExecutable("hermes", { ...options, home, path });
}
