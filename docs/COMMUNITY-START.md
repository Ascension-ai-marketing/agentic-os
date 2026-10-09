# Make Agentic OS yours

Start small. Add your name, choose one useful source and open your workspace. You can skip business details, photos, social profiles and every external platform. An AI subscription or API key is not required to explore the app.

## Open your own workspace

Install [Bun](https://bun.sh) and [Node.js 22.12 or newer](https://nodejs.org). Extract the community ZIP into a new folder. In a terminal opened in that folder, run:

```sh
bun install --frozen-lockfile
bun run start
```

Open [your setup](http://localhost:8081/setup). Keep the terminal running while using Agentic OS. If that port is busy, stop the older Agentic OS server first or choose a different port and open the matching address.

This is a local source download, not a signed desktop installer. The verified platform is macOS. Windows and Linux have portable paths in several integrations but have not received equivalent end-to-end verification. The local server provides the account, file and agent features; a static website upload does not.

## Windows

Windows portability is covered by unit tests that exercise the Windows branches by parameter. macOS remains the platform the release checks run on; this release has not had an end-to-end run on a Windows machine.

**You need:** Windows 10 or 11, [Bun](https://bun.sh) (`powershell -c "irm bun.sh/install.ps1 | iex"` or `winget install --id Oven-sh.Bun`), [Node.js 22.12 or newer](https://nodejs.org) (`winget install --id OpenJS.NodeJS.LTS`), and Codex and/or Claude Code installed and signed in through their own sign-in. A ChatGPT or Claude website login by itself does not install the local tool.

**Start it:** extract the ZIP into its own folder, then double-click **Start Agentic OS.bat**. It checks Bun and Node, prints the install command for anything missing, checks and installs dependencies with `bun install --frozen-lockfile` on every launch, then runs `bun run start`. **Start Agentic OS.ps1** does the same from PowerShell (right-click, Run with PowerShell). Or open a terminal in the folder and run the two commands above. Then open http://localhost:8081/setup and keep the window open.

**What works the same:** Codex and Claude Code memory live in the same folders as on macOS, under your user profile: `%USERPROFILE%\.codex` (sessions, archived_sessions, memories, skills) and `%USERPROFILE%\.claude` (projects, memory, skills, CLAUDE.md). `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are honoured when set. Obsidian vaults are read from `%APPDATA%\obsidian\obsidian.json`, and ChatGPT exports from Downloads or Documents, including the OneDrive copies of those folders. Setup finds `codex.cmd` and `claude.cmd` (npm) or `.exe` installs on PATH, in `%APPDATA%\npm`, `%USERPROFILE%\.local\bin`, bun, volta, pnpm and scoop folders, and launches `.cmd` shims through cmd.exe. Windows does not ask for folder permission to read Documents, so the macOS privacy prompt does not apply.

**Not verified on a real Windows machine:** the Codex and Claude app-server sessions over cmd.exe shims, `taskkill` shutdown of a task's process tree, Microsoft Store detection for ChatGPT and Windows Terminal, Granola's Windows data folder, and the voice, image and DeepSeek harness features. If something differs on your machine, the connection status inside the app shows what it could verify.

## A little context is enough

Your name, preferred currency and timezone help personalize the workspace. Add business context only if it is useful to you. The Life and Business Profile links are optional guided resources, not required accounts or homework.

Import only the memories you want to use. Setup groups sources into AI, Memory, Communication and Finances. How we found these explains each source; detailed Memory settings expose local file counts and examples. Sync all queues enabled sources in bounded passes; if files remain, run another pass to continue from saved checkpoints. Unavailable or oversized sources stay visibly incomplete. A fresh download contains no other member's conversations, emails, photos, account data or credentials. Selecting a source controls whether its content can be used as assistant context. Photos stay optional; review the indexing method and any cloud processing before starting.

Public profile links are optional. Review any suggested link before saving it: a link mentioned in a conversation does not establish that the account belongs to you. Adding a URL is context, not account authentication, analytics access or permission to post.

## Use the tools you already have

Agentic OS can use configured local AI tools such as Codex and Claude Code. A tool being installed, an account being signed in, and a specific external app being callable are separate states. Connection checks show the state they can actually verify.

Agentic OS connects to each account itself. Gmail, Outlook, Slack and Google Calendar are connected in Settings → Connections (Google and Outlook need your own OAuth client ID). Notion and Mercury use their own browser sign-in. Granola uses an API key. Syncing through these connections only reads; replying, labelling and booking need the extra access you grant in Connections. Codex is not needed for any of them.

Tools connected inside Codex or Claude Code stay with that runtime: an agent task uses them with that account's permissions, and choosing a different model does not transfer them. Import refreshes the selected sources in the visible category; Copy setup list gives you a checklist for missing connections. A checklist does not verify access or import history.

Inbox and Calendar use those account connections. They do not receive Google or Microsoft tokens from ChatGPT or any other app. Imported snapshots remain useful without continuous sync, and you can add accounts later.

Workspace Chat supports answers, drafting and a reviewed calendar-booking flow. For a booking, select an authorized account and writable calendar, review the exact event and guests, then confirm. A model reply alone cannot create the event. Other agent actions remain in the host runtime and its approval interface. Voice, cloud models and optional image understanding may require separate configuration or usage credits.

See [assistant setup](ASSISTANT-SETUP.md) and the connection status inside the app for the actual options on your machine.

## Keep mail lightweight

Use provider search for mail that is not saved locally. New indexing stores headers and short snippets. Full bodies are fetched on demand and cached up to 100 MiB of readable payload for seven days, with older entries evicted as needed. Attachments are not downloaded automatically.

The cache cap does not include existing imported archives, metadata or SQLite overhead. Saved-mail search and provider search are labeled separately; a paused or partial index is not a complete mailbox. Pinecone and a bulk mailbox download are not required.

## Update without losing your work

Back up your old folder before replacing an installation. Extract the new version separately, then copy your own `.operator-data` folder into it locally before first launch. Preserve your own `.env.local`, generated live-data file and any local graphs you use. Keep the old folder until you have checked your profile, memories, conversations and accounts in the new version.

Never share that restored folder as the community download. Share the clean release ZIP. It excludes private runtime data, keys, dependencies and build output. For the complete update procedure, see the [README](../README.md#updating-an-existing-installation).

## If something needs attention

If a connection cannot be verified, use its retry or setup control. Reconnect an expired account in its owning app. A provider permission error does not mean your saved records are gone.

If a reply stops, keep the draft and retry after checking the selected model. Large imports belong in the local store, not pasted into a long agent conversation. Keep agent tasks focused and use compact checkpoints when switching tasks.

The [release check record](../RELEASE-CHECK.md) distinguishes what was tested from what still requires your own sign-in, hardware or operating system.
