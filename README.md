# Agentic OS · Community Edition

A local workspace for your priorities, inbox, calendar, memory, AI conversations and creative work.

**Open [START-HERE.html](START-HERE.html) for the visual walkthrough, or [START-HERE.md](START-HERE.md) for the written steps.** This source package is version 4.5, prepared on 2 October 2026. It adds live voice (OpenAI Realtime + Fish Audio), Jev routing for real work, Claude and Codex usage meters, Memory with more sources and a timeline, inbox sorting and invoice search, and the Reels studio.

## Run your copy

Install [Bun](https://bun.sh) and [Node.js 22.12+](https://nodejs.org), then open a terminal in the extracted folder:

```sh
bun install --frozen-lockfile
bun run start
```

Open **http://localhost:8081/setup**. On macOS, the included **Start Agentic OS.command** runs the same steps. Keep the terminal open while using the app.

## Talk to it (voice + Jev)

Tap the orb in the sidebar and talk. OpenAI Realtime hears you and uses the app, Fish Audio speaks (Jarvis by default), and Jev picks Claude Code or Codex when you ask for real work. Set it up in 5 minutes with one command:

```sh
bun run setup:voice
```

It needs 3 keys: OpenAI, OpenRouter and Fish Audio. Create a free Fish Audio account at **https://bit.ly/4xgI73C**. Full steps: [voice setup](docs/VOICE-SETUP.md).

## A fresh workspace

The release contains application source, interface artwork, provider logos and labelled fictional examples. Personal profiles, photographs, emails, meetings, calendars, financial records, account connections, credentials and imported memories are excluded. There is no connected Mercury account or financial export in the download.

The app can discover supported tools installed on your own machine when you request that discovery. Choose which sources to connect or import. Cloud models, voice and image generation use your own provider account and may incur charges. See [privacy and sharing](PRIVACY-AND-SHARING.md).

## Choose a useful starting point

**Dashboard:** keep priorities, goals and a daily brief together. Financial and audience features are optional; sample figures are labelled.

**Inbox and Calendar:** connect your own supported sources or import a snapshot. Read access, sending and booking are separate capabilities. Review an action before sending a message or creating an event.

**Chat and Memory:** choose the context a conversation can use. Save useful facts, search them and correct them. Photos and local histories are optional imports.

**Design and Website:** create and manage your own work after configuring the required tools. The private business-advisor connection is not configured in this download.

Read [the community guide](docs/COMMUNITY-START.md) for first-run setup, [the app guide](docs/FULL-OS-GUIDE.md) for the main areas and [assistant setup](docs/ASSISTANT-SETUP.md) for models.

## Updating an existing installation

Stop the old server and back up its folder. Extract this release separately and install the locked dependencies. Transfer your own `.operator-data`, local environment configuration and any generated personal data only between your private installations. Do not overwrite the new source with the old source or copy old dependencies.

Keep the backup until your own records and accounts work in the new installation. Never redistribute the folder after adding personal data or credentials. Share the original clean ZIP.

## Platform and validation

This is a local source application, not a signed desktop installer. The local development server provides integration and agent endpoints. A static upload or `bun run preview` does not provide the complete app. Keep the server bound to loopback.

See [RELEASE-CHECK.md](RELEASE-CHECK.md) for the exact checks and remaining limitations. The source includes automated tests; live third-party access requires each recipient's own setup.

```sh
bun test scripts
bun run typecheck
bun run build
```

## License

Created by Jack Roberts. [LICENSE](LICENSE) and [NOTICE](NOTICE) apply. Third-party names and logos identify integrations and do not imply endorsement. Provider services and remotely loaded references retain their own terms.
