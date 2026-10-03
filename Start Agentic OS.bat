@echo off
setlocal
rem Windows launcher. Mirrors "Start Agentic OS.command": check Bun and Node, install locked dependencies, start the local app.
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

where bun >nul 2>nul || goto :nobun
where node >nul 2>nul || goto :nonode
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)" || goto :oldnode

echo Agentic OS: checking and installing locked dependencies. No personal data is imported.
call bun install --frozen-lockfile || goto :installfail

echo Open http://localhost:8081/setup. Keep this window open; Control+C stops the app.
call bun run start || goto :serverfail
exit /b 0

:nobun
echo Install Bun, then open this launcher again. In PowerShell run:
echo   powershell -c "irm bun.sh/install.ps1 | iex"
echo or with winget:
echo   winget install --id Oven-sh.Bun
goto :fail

:nonode
echo Install Node.js 22.12 or newer, then try again. With winget:
echo   winget install --id OpenJS.NodeJS.LTS
echo or download it from https://nodejs.org
goto :fail

:oldnode
echo Node.js 22.12 or newer is required. Update it with:
echo   winget upgrade --id OpenJS.NodeJS.LTS
goto :fail

:installfail
echo Dependencies could not be installed. Check your network connection and try again.
goto :fail

:serverfail
echo The server stopped. If port 8081 is busy, stop the older server or see START-HERE.md.
goto :fail

:fail
echo Press any key to close.
pause >nul
exit /b 1
