import { expect, test } from "bun:test";
import { installedCodex } from "./account-discovery";

// Windows branches are proven by parameter: no real process, no real file system.
const windowsEnv = {
  PATH: "C:\\Windows\\System32;C:\\Users\\example\\AppData\\Roaming\\npm",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  APPDATA: "C:\\Users\\example\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};
const npmShim = "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd";

test("Windows finds the npm codex.cmd shim, prefers .exe, probes bun/volta/pnpm/scoop folders and keeps the AGENTIC_OS_NO_CODEX switch", () => {
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => candidate === npmShim })).toBe(npmShim);
  // With nothing installed every well-known Windows folder is probed, and only Windows-shaped files are.
  const probed: string[] = [];
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => { probed.push(candidate); return false; } })).toBeNull();
  expect(probed.every((candidate) => /^[A-Z]:\\.*\.(?:exe|cmd|bat|com)$/.test(candidate))).toBe(true);
  for (const folder of ["C:\\Users\\example\\AppData\\Local\\Volta\\bin", "C:\\Users\\example\\.bun\\bin", "C:\\Users\\example\\AppData\\Local\\pnpm", "C:\\Users\\example\\scoop\\shims", "C:\\Users\\example\\.local\\bin", "C:\\Users\\example\\AppData\\Local\\Programs\\Codex"])
    expect(probed).toContain(folder + "\\codex.exe");
  // Same folder, both kinds present: the native .exe wins so no shell is needed.
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => candidate.startsWith("C:\\Users\\example\\AppData\\Roaming\\npm\\codex.") })).toBe("C:\\Users\\example\\AppData\\Roaming\\npm\\codex.exe");
  // PATHEXT without .CMD means Windows itself would not run the shim either.
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: { ...windowsEnv, PATHEXT: ".EXE" }, exists: (candidate) => candidate === npmShim })).toBeNull();
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: { ...windowsEnv, AGENTIC_OS_NO_CODEX: "1" }, exists: () => true })).toBeNull();
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: () => false })).toBeNull();
});
