# Use your own Claude or ChatGPT account

Choose one assistant to start. You can explore the app before connecting either. The OS launches supported local tools with their own sign-in; it does not receive the creator's account or copy browser tokens.

## Claude Code

Install Claude Code using [Anthropic's quickstart](https://code.claude.com/docs/en/quickstart). In your terminal, run:

```sh
claude auth login
claude auth status
```

Complete the browser sign-in with your own account. If your installed version uses interactive sign-in, run `claude`, then `/login`. Confirm sign-in before returning to Agentic OS. Supported account access follows your Claude plan or provider configuration.

In Agentic OS, open **Setup → Connections → Begin your scan**, then **Models**. Refresh status and select an available Claude model in Chat. An available sign-in does not prove a generation or a specific connector works; test a simple, non-sensitive question first.

## ChatGPT through Codex

Install the official Codex CLI or supported desktop runtime. Run:

```sh
codex login
codex login status
```

Choose **Sign in with ChatGPT** and use your own account. Codex also supports API-key access, which has separate usage billing. See [OpenAI's authentication guide](https://developers.openai.com/codex/auth).

Return to Agentic OS, rescan and open **Models**. Pick an available Codex model in Chat. A ChatGPT web login alone does not establish a local Codex session.

## Connect your accounts

Agentic OS connects to each account itself. Gmail, Outlook, Slack and Google Calendar are connected in Settings → Connections (Google and Outlook need your own OAuth client ID). Notion and Mercury use their own browser sign-in. Granola uses an API key. Syncing through these connections only reads; replying, labelling and booking need the extra access you grant in Connections. Codex is not needed for any of them.

During setup the scan also lists the tools connected in Claude Code, by name and health only. It keeps names and status, not a copy of Claude's credentials, and the list cannot guarantee every remote connector appears.

For Claude, inspect `/mcp` inside Claude Code if a connection is missing. Supported claude.ai connectors depend on the active sign-in, runtime version and workspace controls; see [Claude's connection guide](https://code.claude.com/docs/en/mcp). Then use **Rescan connections** in this OS.

**Installed** means a tool was detected on this computer; it does not verify sign-in or model access. **Connect in Settings** or **Not connected yet** means the account has no connection in this app. An account name or **Connected** means this app can read it; the exact task may still require approval.

Importing history is separate from connecting a model. Choose optional local histories or add your own supported ChatGPT export in Memory. Native Inbox and Calendar controls need their own supported connection; read access does not grant sending or booking. Selecting Claude does not transfer Codex connections into Claude, or the reverse.

## Check an agent when you need it

**Check agents** starts a small real task through the selected local runtimes and creates a test file. It can consume provider allowance. Inspect any approval or input request in the task panel. You do not need this check to browse the dashboard or save a note.

## Other providers are optional

Hermes uses its own installation and provider configuration. Ollama and LM Studio need a running local server with a loaded model. Optional DeepSeek Harness setup is documented in [advanced assistant setup](ADVANCED-ASSISTANT-SETUP.md).

Voice and media generation use separate provider configuration and can incur charges. A local text model does not install speech or image tools. Source selection affects future retrieval; it cannot retract context already sent to a model.
