# Advanced assistant setup

The OS starts without an AI account. Asking a model, generating a brief or starting cloud voice requires a configured provider. A working local Codex or Claude installation can reuse its own sign-in. Existing apps and MCP tools remain scoped to the runtime that owns them; tokens and subscriptions are not copied into the downloaded project. Direct Inbox/Calendar integrations still need their own account setup. See [Use the tools you already have](COMMUNITY-START.md#use-the-tools-you-already-have).

## DeepSeek Harness through OpenRouter

Install Python 3.10 or newer, then run from the repository directory:

```sh
bun run setup:assistant
```

This creates `.operator-data/dsh-venv` and installs `deepseek-harness-sdk==0.1.5rc1` and `deepseek-harness-runtime-bin==0.1.5rc1`. It does not alter your system Python or call a paid model. If `python3` is an older Python, run `scripts/install-assistant.py` explicitly with your newer interpreter. The installer and runtime were verified on macOS; other platforms depend on availability of the upstream native wheel.

Create `.env.local` in the project root and enter your own key:

```dotenv
OPENROUTER_API_KEY=your-key-here
```

Restart the local server. The key stays in server configuration; do not prefix it with `VITE_`, commit it or include it in an archive. Provider-key precedence is the process environment, project `.env.local`, `~/.config/agentic-os.env`, then the existing Hermes `~/.hermes/.env` store. A previously saved Hermes key remains supported.

Choose an available DeepSeek model in the shared assistant. The inbox's dedicated grounded-answer path uses the exact model `deepseek/deepseek-v4.1-flash`. Availability and charges depend on your provider account. If the model or SDK is unavailable, matching inbox conversations remain available through local search.

The harness is an optional developer-preview dependency. This release pins the tested SDK/runtime rather than installing its latest version on every launch. See the [upstream project](https://github.com/deepseek-ai/deepseek-harness) and [SDK package](https://pypi.org/project/deepseek-harness-sdk/0.1.5rc1/).

## Other text assistants

- **Hermes:** install and configure Hermes separately; the OS uses its local executable and provider configuration. A local harness can still call a cloud model.
- **Codex:** requires a working local Codex installation, sign-in and an available model. Model discovery reflects that installation; it does not grant access to arbitrary model IDs.
- **Ollama / LM Studio:** run a local server with a loaded model on `127.0.0.1:11434` / `127.0.0.1:1234`. The OS discovers available local models. A local text selection blocks cloud voice from silently replacing it.

Conversations can include enabled memory and current-page context. Switching off a source controls subsequent retrieval; it does not retract information already sent or remove prior messages.

## Voice

Open Jarvis and use its voice configuration. OpenAI Realtime and ElevenLabs use your own account credentials and may incur provider charges. A local text model alone does not install a local speech engine. See [Voice release and setup](VOICE-RELEASE.md) for storage, microphone, image-sharing and platform details.
