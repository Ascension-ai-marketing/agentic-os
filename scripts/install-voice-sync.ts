#!/usr/bin/env bun
/**
 * install-voice-sync.ts
 *
 * Installs (or removes) the daily voice sync on macOS via launchd. The job runs
 * scripts/sync-voice.ts every evening (default 23:30) and once at login, so the
 * repo carries what this machine learned and picks up what the other one did.
 *
 *   bun run scripts/install-voice-sync.ts                # 23:30 daily + at login
 *   bun run scripts/install-voice-sync.ts --time 22:00
 *   bun run scripts/install-voice-sync.ts --uninstall
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HOME = homedir();
const LABEL = "com.agentic-os.voice-sync";
const PLIST = join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const REPO = resolve(import.meta.dir, "..");
const LOG = join(REPO, ".operator-data", "voice-sync.log");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function parseTime(): { hour: number; minute: number } {
  const index = process.argv.indexOf("--time");
  const raw = index >= 0 ? process.argv[index + 1] : "23:30";
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw || "");
  if (!match) throw new Error(`Use --time HH:MM, got "${raw}".`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}
function launchctl(args: string[]) {
  return spawnSync("launchctl", args, { encoding: "utf8" });
}
function uninstall() {
  launchctl(["bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`]);
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log(`Removed ${LABEL}.`);
}
function install() {
  if (process.platform !== "darwin") {
    console.log(`Not macOS. Add this to your scheduler instead:\n  30 23 * * * cd ${REPO} && ${process.execPath} run scripts/sync-voice.ts >> ${LOG} 2>&1`);
    return;
  }
  const { hour, minute } = parseTime();
  mkdirSync(join(HOME, "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(join(REPO, ".operator-data"), { recursive: true, mode: 0o700 });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(process.execPath)}</string>
    <string>run</string>
    <string>${escape(join(REPO, "scripts", "sync-voice.ts"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${escape(REPO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${escape(join(HOME, ".bun", "bin"))}</string>
    <key>HOME</key><string>${escape(HOME)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${escape(LOG)}</string>
  <key>StandardErrorPath</key><string>${escape(LOG)}</string>
</dict>
</plist>
`;
  launchctl(["bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`]);
  writeFileSync(PLIST, plist);
  const load = launchctl(["bootstrap", `gui/${process.getuid?.() ?? 501}`, PLIST]);
  if (load.status !== 0) throw new Error(`launchctl bootstrap failed: ${(load.stderr || load.stdout || "").trim()}`);
  console.log(`Installed ${LABEL}: syncs the voice folder daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} and at login.\nLog: ${LOG}\nRun it now with: bun run sync:voice`);
}

if (process.argv.includes("--uninstall")) uninstall(); else install();
