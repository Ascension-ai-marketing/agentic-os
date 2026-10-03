# Welcome to your Agentic OS

A workspace that becomes useful as you give it context. Start with one goal, one useful memory and one assistant. Add connections when they help you do something real.

**Prefer a visual guide? Open START-HERE.html.** It works directly from this folder, without starting the app. The same guide is linked inside setup.

## 1. Open your copy

Install [Bun](https://bun.sh) and [Node.js 22.12 or newer](https://nodejs.org). Extract the ZIP into its own folder. On macOS, double-click **Start Agentic OS.command**. If Finder does not open it, open a terminal in this folder and run:

```sh
bun install --frozen-lockfile
bun run start
```

Open **http://localhost:8081/setup**. Keep the terminal running. Control+C stops the server. The launcher installs dependencies, then starts the local app. It does not import your history or connect accounts.

## 2. Tell it what matters

In **About you**, add your name and a few sentences about what you are working on. Your photo and business profile are optional. You can leave everything blank and continue. **Generate random profile** creates a fictional example; use your own details when you are ready.

## 3. Use your Claude or ChatGPT account

For Claude, install and sign in to **Claude Code**. For OpenAI, install **Codex** and choose **Sign in with ChatGPT** using your own account. You can use either, or both. A browser login by itself does not install the local tool.

In **Connections**, choose **Begin your scan**, then **Models** or **Models & local runtimes**. Check what is installed, what is signed in and which models are available. Select your preferred model in Chat. [Assistant setup](docs/ASSISTANT-SETUP.md) has the sign-in commands and troubleshooting.

## Optional: talk to it

Run `bun run setup:voice` and paste 3 keys (OpenAI, OpenRouter, Fish Audio). Fish Audio is the voice: create a free account at **https://bit.ly/4xgI73C**. Then tap the orb in the sidebar and talk. See [voice setup](docs/VOICE-SETUP.md).

## 4. Review connections before importing

Open **Your connected apps & plugins** to see the supported connections exposed through Codex and Claude Code. Use **Rescan connections** after changing a connection in its owning app. Discovery can only show what that runtime exposes; it cannot promise every connector in every ChatGPT or Claude workspace.

Move through **AI**, **Memory**, **Communication** and **Finances**. Inspect **How we found these**, choose the sources you want, then use the import control for that category. Scanning and importing are separate. You can continue without importing anything. **Copy setup list** gives you a checklist to use with Claude or Codex when something is missing.

Saved chat history is optional. ChatGPT history uses your own supported export, separate from model sign-in. A connected service may still need an import adapter. Direct sending and calendar booking require their own supported permissions and review.

Audience and finance connections are optional. This download contains no creator community records, messages, cookies, account grants, financial records or photos. Nothing is connected on the creator's behalf.

## 5. Give it a first job

Set one weekly goal and choose **Build my OS**. In Memory, save a short note you can safely use for testing, such as “My sample project is a weekend reading list.” In Chat, choose your configured model, enable that memory source and ask:

> What sample project did I save, and what is one useful next step? Use my saved note and say if it is missing.

A useful answer should match the note. If it cannot find it, check the selected source and model before importing more. Then replace the sample with context that helps your real work.

## How to use it well

Read [The spirit of your OS](docs/THE-SPIRIT-OF-YOUR-OS.md). It explains the eight core areas, how memory and context work together, and how to grow your setup without filling it with noise.

## If something gets stuck

**Port already in use:** stop the old server, or run `bun run dev --port 8083 --strictPort` and open http://localhost:8083/setup.

**Tool found, but replies fail:** sign in through the tool itself, check your plan or API usage, then refresh models. Installed and signed in are different checks.

**Connection missing:** reconnect it in Codex or Claude Code, then rescan. Check the owning account/workspace. Use its supported export or native app if this OS does not have an adapter.

**Task check needs input:** open its review panel and respond there. **Check agents** is an optional real agent task that creates a small test file and can use provider allowance.

**Platform:** this is a local source app, with macOS validation. Windows and Linux have not received equivalent end-to-end testing. Static hosting does not provide its local integrations. Keep the server on localhost.

## Keep this original ZIP

Your profile, mail, photos, memories and connections become private state after setup. Share this original ZIP, never your configured folder. See [Privacy and sharing](PRIVACY-AND-SHARING.md) and [Release checks](RELEASE-CHECK.md).
