# Connectors without Codex

Date: 2026-10-08
Status: awaiting review

## Goal

Every connector in Agentic OS reads its data through a connection the app owns: a direct provider API or the provider's official MCP server. No connector depends on Codex being installed or signed in.

Success means `scripts/codex-connected-read.ts` is deleted, nothing imports it, and each connector below works from a connection made inside Agentic OS.

## Out of scope

- Codex as an agent or model runtime (`agent-jobs-codex.ts`, `assistant-runtime.ts`, chat model lanes, usage and plan-limit panels). Codex agents keep running and keep whatever apps Codex itself gives them.
- Higgsfield. `higgsfield-mcp.ts` already owns its connection and is not refactored.
- New write capabilities. Every route below stays read-only.

## Current state

One bridge, `scripts/codex-connected-read.ts`, spawns `codex app-server --stdio`, lists the `codex_apps` tools and calls an allowlisted set of read tools. Seven modules use it:

| Module | Reads through Codex |
|---|---|
| `native-inbox-sync.ts` | Gmail, Outlook mail, Slack search |
| `mail-backfill.ts` | A year of Gmail and Outlook headers |
| `native-calendar-sync.ts` | Google and Outlook primary calendar |
| `native-business-sync.ts` | Mercury accounts and transactions; availability of Notion and Granola |
| `notion-connected.ts` | Recent Notion pages |
| `granola-connected.ts` | A year of Granola meetings |
| `agent-jobs.ts` (status) | The list of Codex connector tool names shown in the agent-jobs panel |

App-owned lanes that already exist:

- `account-connections.ts`: OAuth for Google (Gmail and Calendar) and Outlook (Mail and Calendars), with `readMail`, `mailIdentity` and a `/connections/sync` handler. Used by `mail-provider`, `mail-archive` and `inbox-imports`.
- `slack-connection.ts`: a Slack user token with `auth.test` and `conversations.history`.
- `granola-api.ts`: Granola's public API with a stored API key.
- `higgsfield-mcp.ts`: the pattern for an app-owned MCP client (protected-resource discovery, dynamic client registration, PKCE, a private token store).

## Target routes

| Connector | Route | Sign-in |
|---|---|---|
| Gmail, Outlook mail, mail history | `account-connections.ts` | Existing in-app OAuth (user's own client ID) |
| Google and Outlook calendar | `account-connections.ts` | Same grant, calendar scopes |
| Slack | `slack-connection.ts` | Existing Slack token |
| Granola | `granola-api.ts` | Existing API key |
| Notion | MCP, `https://mcp.notion.com/mcp` | Browser sign-in, dynamic client registration |
| Mercury | MCP, `https://mcp.mercury.com/mcp` | Browser sign-in, dynamic client registration |

Mercury's discovery documents are at `https://mcp.mercury.com/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, with registration at `https://mcp.mercury.com/register`. Notion's endpoints are read from its own discovery documents at implementation time rather than hard-coded from memory.

## Design

### 1. `scripts/mcp-connection.ts` (new)

A small app-owned client for a remote MCP server over streamable HTTP.

```ts
mcpConnection({ id, url, scopes?, storePath, allowedTools, fetcher? })
  -> { status(), begin(redirectUri), finish(url), disconnect(), read(work) }
```

- `begin` discovers the protected resource and authorization server, registers a public client, and returns an authorization URL with PKCE (S256) and the `resource` parameter. `finish` exchanges the code. Tokens refresh on expiry.
- The store is one file per provider under `.operator-data/mcp/<id>.json`, written atomically with mode `0600` in a `0700` directory, the same way `higgsfield-mcp.ts` writes its store.
- Discovery is pinned: the authorization server must be the one the protected-resource document names, registration and token endpoints must be HTTPS on the expected host, and S256 must be supported. Anything else fails closed with a plain message.
- `read(work)` gives the caller `{ tools, call }`, the same shape the Codex bridge gave, so callers and their tests change little. `call` refuses any tool that is not in `allowedTools`, or whose annotations are not `readOnlyHint: true`, or that has `destructiveHint: true`.
- Response bodies are size-bounded and each call has a timeout. Tokens and raw payloads never appear in errors or logs.

Tool names are the provider's own (for example `getAccounts`), without the `mercury.` or `notion.` prefix Codex added. Each caller's allowlist is confirmed against the server's live `tools/list` during implementation.

### 2. Notion: `notion-connected.ts`

Keeps `notionRecentPages` and `notionPageDocument`. `connectedNotionPages(root, read)` takes a reader from `mcpConnection` for Notion instead of the Codex bridge. The parsing functions are adjusted only if Notion's native MCP returns a different shape from the Codex wrapper, verified against a recorded synthetic fixture.

### 3. Mercury: `native-business-sync.ts`

Keeps `mercuryBalances`, `mercuryMonthlyIncome` and the paging logic. The reader comes from `mcpConnection` for Mercury. `status()` reports only Mercury; the `notion` and `granola` availability fields move to their own connections.

### 4. Mail: `native-inbox-sync.ts` and `mail-backfill.ts`

Both stop taking `connectedRead` and take the account lane instead (`accounts.readMail`, `accounts.mailIdentity`), which already issues authenticated Gmail and Graph requests.

- Identity comes from the connected account rather than a Codex `link_id`. The `connected-account-preferences.json` lookup is removed.
- Gmail reads use `users/me/messages` with the same queries and bounds as today. Outlook reads use Graph `/me/messages`.
- Stored state files (`native-connections.json`, `mail-backfill.json`) keep their shape so existing selections and checkpoints survive. A selection whose account no longer matches the connected account is shown as needing reconnection, as it is today.
- Where `native-inbox-sync` duplicates `mail-provider`, it calls `mail-provider` rather than keeping a second implementation.

### 5. Calendar: `native-calendar-sync.ts`

Reads the primary calendar through the account lane (Google Calendar `events.list`, Graph `/me/calendarView`). State file and route shapes are unchanged. Stays read-only.

### 6. Slack

`native-inbox-sync` drops its Slack search path and its text parser. Slack messages come from `slack-connection.ts`, which reads history from the channels the user selected. Cross-workspace search is no longer available.

### 7. Granola

`granola-connected.ts` is deleted. `operator-plugin.ts` uses `granola-api.ts` only: `granolaConnection` returns `"api"` or `undefined`, and `voiceRecall.recentMeetings` uses `granola.notes()`. The `"codex"` method is removed from `memory-apps.ts`.

### 8. Agent-jobs status

`agent-jobs.ts` stops calling the bridge and reports an empty connector-tool list. The panel hides that list when empty. Codex model discovery and Codex job execution are untouched.

### 9. Routes and UI

- New routes in `operator-plugin.ts`: `GET /mcp/<id>/status`, `POST /mcp/<id>/connect`, the OAuth callback, and `POST /mcp/<id>/disconnect`, for `notion` and `mercury`.
- The Accounts screen gains Connect and Disconnect for Notion and Mercury.
- Every message that sends the user to Codex ("Check its connection in Codex", "Install and sign in to Codex to use its existing connections", and similar in `src/components/operator`, `src/components/business` and `src/components/brain`) is rewritten to point at the in-app connection. Messages about Codex as a model or agent are left alone.
- `docs/ASSISTANT-SETUP.md`, `docs/ADVANCED-ASSISTANT-SETUP.md`, `docs/COMMUNITY-START.md`, `docs/MEMORY-RELEASE.md`, `START-HERE.md`, `START-HERE.html`, `public/community-guide.html`, `PRIVACY-AND-SHARING.md` and `CHANGELOG.md` are updated where they describe connectors going through Codex.

### 10. Removal

Deleted: `codex-connected-read.ts`, `codex-connected-read.test.ts`, `granola-connected.ts`, `granola-connected.test.ts`. `account-discovery.ts` keeps `installedCodex` only if the agent runtime still uses it. `MANIFEST.sha256` is regenerated by the existing release step, not by hand.

## Error handling

- Not connected: status reports `available: false` with a message naming the in-app screen. No sync is attempted.
- Expired or revoked grant: one refresh attempt, then the connection is marked as needing sign-in. Saved data is left unchanged.
- A tool missing from the server or not marked read-only: that read fails with a plain message; other reads continue.
- Timeouts and oversized responses fail the single read, not the connection.

## Testing

- All tests use synthetic fixtures and injected fetchers or readers. No real sign-in, no real provider call, no write to a real `.operator-data`.
- `mcp-connection.test.ts`: discovery pinning, registration, PKCE, token refresh, store permissions, allowlist and annotation gate, size and time limits.
- Existing tests for each rewired module are updated to inject the new reader or fetcher and keep their current assertions.
- A test asserts nothing under `scripts` or `src` imports `codex-connected-read`.
- Final checks: `bun test scripts`, `bun run typecheck`, `bun run build`.

## Order of work

1. Mail, calendar, Slack and Granola onto their existing lanes.
2. `mcp-connection.ts`, then Notion and Mercury.
3. Agent-jobs status, deletion of the bridge, UI copy, docs, final checks.

Each step leaves the test suite passing.

## What the user will notice

- Every account is connected again inside Agentic OS. Codex's grants are not reused, as `AGENTS.md` requires.
- Google and Outlook need the user's own OAuth client IDs.
- Slack reads selected channels instead of searching everything.
- Granola needs an API key.
- The agent-jobs panel no longer lists Codex connector tools.
