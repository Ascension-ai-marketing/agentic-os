#Requires -Version 5.1
# Windows launcher (PowerShell). Mirrors "Start Agentic OS.command": check Bun and Node,
# install locked dependencies, start the local app. Right-click > Run with PowerShell,
# or run:  powershell -ExecutionPolicy Bypass -File ".\Start Agentic OS.ps1"
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$env:Path = "$env:USERPROFILE\.bun\bin;$env:APPDATA\npm;$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\nodejs;$env:Path"

function Fail([string] $message) {
  Write-Host $message
  Read-Host "Press Return to close" | Out-Null
  exit 1
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Fail @"
Install Bun, then open this launcher again. In PowerShell run:
  powershell -c "irm bun.sh/install.ps1 | iex"
or with winget:
  winget install --id Oven-sh.Bun
"@
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail @"
Install Node.js 22.12 or newer, then try again. With winget:
  winget install --id OpenJS.NodeJS.LTS
or download it from https://nodejs.org
"@
}
& node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)"
if ($LASTEXITCODE -ne 0) { Fail "Node.js 22.12 or newer is required. Update it with: winget upgrade --id OpenJS.NodeJS.LTS" }

Write-Host "Agentic OS: checking and installing locked dependencies. No personal data is imported."
& bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Fail "Dependencies could not be installed. Check your network connection and try again." }

Write-Host "Open http://localhost:8081/setup. Keep this window open; Control+C stops the app."
& bun run start
if ($LASTEXITCODE -ne 0) { Fail "The server stopped. If port 8081 is busy, stop the older server or see START-HERE.md." }
