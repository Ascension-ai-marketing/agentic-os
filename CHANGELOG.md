# Connections without Codex · 9 October 2026

- Connectors no longer go through Codex. Gmail, Outlook, Slack, Google Calendar and Granola use the app's own connections; Notion and Mercury use their official MCP sign-in. Reconnect each account once: mail, Slack, calendar and Mercury in Settings → Connections, Notion from Memory, Granola from Setup.
- Slack now reads the channels you choose instead of searching every channel.
- Google Calendar reads every calendar your account can read, not only the primary one.
- The setup scan no longer lists Codex's apps, and the agent-jobs panel no longer lists Codex connector tools.

# Hermes, voice and fixes · 2 October 2026 (Agentic OS V4.5)

- Hermes in Chat: a Hermes mode next to General, with its own chat list. Hermes Agent runs on GPT-6.1 Sol through your Codex sign-in, with its own tools, memory and skills, and each chat keeps its Hermes session.
- The Hermes window: Hermes' face, a live timer and every action it takes, opening as soon as it acts and saved with the chat. Keys and tokens are hidden from it.
- Voice: say "Ask Hermes to..." and a Hermes chat opens; say "be funnier" or "talk faster" and the new animated Humour and Speed controls move as Jarvis changes.
- Memory: files the OS saves for you (fact sheets, posters) open from Memory, by voice ("show me my fact sheet", "open it in a new window"), with a live preview in the pop-up. Search forgives plurals and loose wording.
- Community fixes from Sotirios: chat falls back to your model without an OpenRouter key, mail deleted in Gmail leaves the OS (never on a partial or empty list), and the Gmail badge counts unread mail only. Repeating meetings now show as one Memory entry per series instead of hundreds of copies.
- Higgsfield: the console moved to open.higgsfield.ai; all 23 models load again with exact live prices per version.

# Voice + Jev · 29 September 2026 (Agentic OS V4.4)

Talk to your workspace, and let Jev pick who does the real work.

- Live voice: tap the orb in the sidebar and talk. OpenAI Realtime hears you, and you can interrupt it any time. Fish Audio speaks the reply in Jarvis, Atlas, Raven or Sage, at 0.5 to 2x speed.
- Voice uses the app: it opens pages, focuses and opens memories, shows email and calendar cards, reads usage, sorts the demo inbox, finds invoices and searches the web.
- Real work goes to Claude Code or Codex. Jev picks the agent and the model with odds in about half a second. Name the agent and Jev keeps it. Questions from the agent show in the task chat.
- Personality: a humour slider (off, dry, witty, sarcastic) and "How Jarvis talks", your own prompt.
- One command setup: `bun run setup:voice` saves and checks the OpenAI, Fish Audio and OpenRouter keys. Free Fish Audio account: https://bit.ly/4xgI73C
- Dashboard: animated Claude and Codex usage meters (orb or bar) with real plan limits.
- Memory: more sources (Codex, ChatGPT export, email, meetings, Notion, skills), links between them, a timeline with ranges and a detail panel.
- Inbox: "Sort all with Jev" and invoice search on a fictional demo inbox.
- Reels studio: a scroll page with Let Jev pick, transcript, and optional sound effects mixed only when you ask.

# Setup update · 18 September 2026

Connections setup now pulls real data instead of only listing what could be connected.

- Scan finds your AI tools, editors, notes, messages and finances through this Mac, Codex and Claude. Found sources start switched on and show what was found: chat and memory counts, the Gmail, Outlook and Slack accounts, Mercury balances, Notion pages, Obsidian note counts and photo counts.
- Continue imports what is switched on for the visible category, then moves to the next one. No separate import button.
- AI tools and editors can be brought into the OS with a switch; the choice is saved on your profile.
- Notion imports recently edited pages through your existing Codex connection. No integration key needed.
- Obsidian explains when macOS is blocking the Documents folder and how to allow it.
- Editor detection adds Trae, Kiro, Xcode, Gemini CLI, OpenCode, Warp and iTerm.
- The setup film now loops without the freeze at the seam; one film plays across every section.
- Scan shows live progress per category while it runs. Editors show only what was detected, with their logos; every other app connected in Codex or Claude appears under the matching category as "Also connected".
- Google Calendar joins Communication (via Codex). Photos left the setup; they are indexed from Memory.
- Business overview uses live numbers when they exist: cash on hand across all connected accounts, monthly income read from Mercury transactions, an editable monthly revenue target, and audience from the connected YouTube channel and linked profiles. Demo numbers switch off automatically once live data is imported.
- The daily brief shows a preparing state while it generates, matches the height of "In AI today", and only says Demo when demo numbers are really on.
- Memory imports the newest files first, so this morning's conversations arrive in the first pass. Chat understands "this morning", "yesterday" and dates, says plainly when a window has nothing imported yet, and no longer leaves the conversation when the answer mentions another page.
- Setup: every tile is the same card with a switch (AI tools, editors, connected apps); tools that are not installed stay hidden unless asked for; one import at the end with a "Your OS now knows" receipt on the Goals step; a city field on About you (defaults from your time zone) drives the weather; a single guide card explains Codex when it is missing.
- Daily brief redesigned as a calm pastel card system: big-number cards, one focus card, three priority cards, black pill actions, a soft preparing state, and an honest empty state. Audience shows every platform as a card with an "Add" pill on the empty ones.
- Codex Desktop conversations are decoded fully (item_completed messages), the OS's own test and runtime transcripts are kept out of memory and search, chat prefers records from the app you name and points to the closest same-day record when a window is empty. The lifted chat background was removed.
- Test suite no longer spawns the real Codex app (AGENTIC_OS_NO_CODEX=1), so it runs in seconds and never flakes on a slow Codex start.
- Windows: Codex and Claude are found through their .cmd/.exe shims and launched through cmd.exe, app detection covers Windows install folders and Store packages, memory roots honour CODEX_HOME and CLAUDE_CONFIG_DIR, and "Start Agentic OS.bat" / ".ps1" launchers join the .command. macOS stays the verified platform; see docs/COMMUNITY-START.md.
- Daily brief: horizon art band, illustrated priority tiles, icon discs on the number cards, a "Built from" logo row, and a generator switch (click "Generated by Codex" to pick Claude, Codex or Hermes; the choice is remembered). The news rail fills its column with more stories, today's calendar and recent memory.
- Memory keeps importing on its own: a manual sync now runs pass after pass (newest first) until the backlog is gone, instead of 40 files per click.
- Brief: no more decorative photos. The top row is Priorities today, Income today (with the 7-day total, read from Mercury) and Events today with the next event, so it no longer repeats the overview numbers. Priority cards carry a category icon.
- Setup on Windows shows a card with a copyable prompt that asks Claude or Codex to walk you through the differences.
- Chat: a visible New chat button (Cmd/Ctrl+N), a "Checked" line under every answer showing which apps were searched and how many records matched, follow-ups like "How about Claude?" keep the time window, fresher results rank first, and the OS's own Claude side-conversations are filtered out. Codex/Claude syncs that only skipped oversized records finish as idle with a warning instead of an error.

# Community release · 17 September 2026

Version 3.6.0 includes guided optional onboarding, labelled example profiles, dashboard goals and daily briefs, a shared Chat composer, calendar source status, memory and voice views, and creative tools.

This distribution adds a short first-run guide, an optional macOS launcher and explicit privacy/sharing instructions. It excludes configured state, credentials, personal records, internal handoffs and previous review claims.

See RELEASE-CHECK.md for the validation performed on this copy.
