# Voice and Jev: set up in 5 minutes

Talk to your workspace. It hears you, answers out loud, opens pages, finds memories and hands real work to Claude Code or Codex. You can interrupt it at any time.

## What does what

| Part | Job | Key |
|---|---|---|
| **OpenAI Realtime** | Hears you, knows when you stop or interrupt, thinks, and uses the app (pages, memory, inbox, calendar, usage, web) | `OPENAI_API_KEY` |
| **Fish Audio** | The voice you hear. Jarvis by default. Atlas, Raven and Sage are in voice settings | `FISH_API_KEY` |
| **Jev** (on OpenRouter) | Picks who does real work (Claude Code or Codex) and which model, with odds, in about half a second. Also sorts the inbox, finds invoices and picks Reels styles | `OPENROUTER_API_KEY` |
| **Claude Code / Codex** | Do the real work you ask for ("research…", "build…") | Your own sign-in, no key |

Normal talking does not use Jev. Jev only steps in when you ask for real work, so replies stay fast.

## 1. Get the keys

1. **Fish Audio:** create a free account at **https://bit.ly/4xgI73C**. Open API Keys and copy a key.
2. **OpenAI:** https://platform.openai.com/api-keys. Voice uses `gpt-realtime` and costs a few cents per conversation minute.
3. **OpenRouter:** https://openrouter.ai/keys. A Jev decision costs about $0.00005.

## 2. Save them

In a terminal in this folder:

```sh
bun run setup:voice
```

Paste each key when it asks. What you type stays hidden. The keys go to `~/.config/agentic-os.env`, written as a new file that only your user can read. Then each key is checked with one free request:

```
✓ OpenAI      key accepted
✓ Fish Audio  key accepted
✓ OpenRouter  key accepted
```

Run `bun run setup:voice --check` any time to check again. The keys themselves are never printed. "Key accepted" means the provider knows the key; paid calls also need credit on that account.

Optional tools: `ffmpeg` (backup speech-to-text and Reels audio; `brew install ffmpeg` on macOS), and Claude Code and/or Codex signed in for real work (see [assistant setup](ASSISTANT-SETUP.md)).

## 3. Talk

1. Start the app: `bun run start`, then open http://localhost:8081.
2. Tap the orb in the sidebar. Allow the microphone.
3. Just talk. Try:
   - "Take me to my memory"
   - "What's on my calendar today?"
   - "Show me my usage"
   - "Sort my inbox" (on the demo inbox: Inbox, then **Hide emails for demo**)
4. Talk over it to interrupt. Tap the orb again to stop.

Open **Chat** while voice is on to see the conversation, the voice picker, speed (0.5 to 2x), the humour slider and "How Jarvis talks", a prompt for its personality.

## Real work

Say "research the best note apps and write me a summary", or name the agent: "ask Codex to…". Jarvis first shows a **Start this task?** card and asks. Say a plain "yes" or tap **Start** (within a minute). Anything else, like "no" or "yes, but…", starts nothing. Then a task chat opens with Jev's pick and a live progress card. If the agent needs an answer from you, the question shows there. Real work runs on your own Claude Code or Codex account with its own permissions.

Text inside an email, web page or memory cannot say yes for you: only your own microphone or a click can. Read the card before you say yes.

## Trouble

| You see | Do this |
|---|---|
| "Add an OpenAI API key" | Run `bun run setup:voice`, then restart the app |
| It answers but you hear nothing | Check **Sound on** in the Chat voice strip. Check `FISH_API_KEY` with `bun run setup:voice --check` |
| "Create a free Fish Audio account" | You have no Fish key yet: https://bit.ly/4xgI73C |
| Real work does not start | Sign in to Claude Code (`claude`) or Codex (`codex login`) in a terminal |
| Microphone blocked | Allow the microphone for localhost in your browser settings |

Keys stay on your computer. Never paste them into a chat, a screenshot or a shared folder. Share the original ZIP, never your configured folder.
