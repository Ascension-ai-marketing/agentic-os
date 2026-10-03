#!/bin/zsh
set -eu
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
fail() { print -r -- "$1"; print -r -- "Press Return to close."; read -r answer; exit 1; }
command -v bun >/dev/null 2>&1 || fail "Install Bun from https://bun.sh, then open this launcher again."
command -v node >/dev/null 2>&1 || fail "Install Node.js 22.12 or newer from https://nodejs.org, then try again."
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)' || fail "Node.js 22.12 or newer is required."
print -r -- "Agentic OS: installing locked dependencies. No personal data is imported."
bun install --frozen-lockfile || fail "Dependencies could not be installed. Check your network connection and try again."
print -r -- "Open http://localhost:8081/setup. Keep this terminal open; Control+C stops the app."
bun run start || fail "The server stopped. If port 8081 is busy, stop the older server or see START-HERE.md."
