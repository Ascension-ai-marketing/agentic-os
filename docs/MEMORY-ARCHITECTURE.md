# How Jarvis, agent actions and memory fit together

## Execution

Jarvis is the voice and visual control surface. An explicit delegated task starts a real native Codex or Claude Code session. That agent uses its own tools, account connections and permissions. Jarvis shows progress, approval questions and results; it does not copy credentials or turn the Inbox read bridge into a write bridge.

Both mode starts Codex execution and an independent read-only Claude review at the same time. Each agent selected alone can execute. A result that says an action succeeded still needs the corresponding tool evidence or provider receipt.

Both native agents pass isolated Write/Read checks once Claude's sign-in is fresh. Both native session transcripts subsequently appeared in the existing Memory importer and were returned by `/memory/search`. No external messages were sent for verification.

## Where things live

These are local files under the running OS checkout, not a Desktop export or a new cloud repository. The private data directory is excluded from release packages.

| Record | Location relative to the OS checkout |
| --- | --- |
| Saved OS chats and completed Jarvis voice text | `.operator-data/conversations.json` |
| Recent Jarvis task status, progress and results | `.operator-data/agent-jobs.json` |
| Agent task working directories and generated files | `.operator-data/agent-tasks/<job-id>/<agent>/` |
| Authoritative saved Memory sources | `.operator-data/workspace.json` |
| Portable Markdown copies of Memory | `.operator-data/vault/` |
| Memory import settings and checkpoints | `.operator-data/memory-apps.json` |

Native Codex history remains in the user's `.codex/sessions` and `.codex/archived_sessions`; Claude Code history remains in `.claude/projects`. The Memory importer reads permitted conversation text from those stores when the relevant source and conversation scope are enabled. It deliberately excludes tool payloads, image data and hidden reasoning. It is a bounded sync, not a promise to ingest every file immediately.

The current installation has Codex and Claude conversation auto-sync enabled. Its existing timer runs every five minutes while the local OS is running. Fresh installations do not inherit that choice: source import and automatic sync default off until configured.

The Jarvis task panel retains the 30 most recent job records. Native session history and imported Memory sources are separate from that recent-task list. Generated artifacts stay in their task directory unless the user asks the agent to put them elsewhere. Memory's Markdown vault is a one-way portable copy; editing it does not automatically update the authoritative workspace.

## Three useful kinds of memory

1. **Current conversation:** immediate working context for the current request. It can be bounded without erasing the saved transcript.
2. **Searchable history:** conversations, completed tasks, meetings and their sources. It answers what happened and where the evidence came from; an assistant's statement is not automatically a verified fact.
3. **Lasting knowledge:** chosen preferences, business facts, decisions and project instructions. These should be editable, attributable and replaceable when a newer decision supersedes them.

The existing system provides native conversation import, source switches, searchable stored sources, manual Remember actions and a Markdown vault. A separate memory framework is not required to connect those pieces. Jarvis now saves finished voice text into dedicated conversations in the existing saved-chat store. They appear as `Jarvis · <first request>` in Chat history. Raw audio and interim captions are not archived. Pending saves retain a browser recovery copy; the UI shows save failures and offers retry or a separate copy when another tab changed the chat. Browser recovery storage belongs to the exact origin, so use the same `127.0.0.1:8081` address after a failed save.

The persistence checks cover an actual temporary conversation store on disk, a failed save followed by page reload and recovery, and opening the recovered transcript in Chat. Existing Chat conversations and drafts remain separate. Realtime turns without sufficiently scoped provenance stay visible in history but are excluded from subsequent model context; scoped workspace answers retain their source restrictions. This is verified text persistence, not a new live microphone/provider test.

Automatic inclusion of OS chat/voice transcripts in general knowledge retrieval is a separate policy from saving the local history. Indexing them automatically with an off switch, or only on Remember, is a product choice. Do not claim that every saved chat is automatically searchable Memory until that behavior is implemented and checked.

## Retrieval and source choices

Chat already retains each turn's source IDs, global `brainRevision` and per-chat `contextKey`. Disabled sources must not return through a flattened chat transcript. Any new automatic history index must preserve those restrictions and original provenance, and distinguish source evidence, assistant conclusions, errors and confirmed actions. A deleted or excluded source must stay excluded from recall.

Keep the existing local source records and readable Markdown vault as the foundation. Improvements should focus on faithful transcript saving, explicit indexing status, source-aware retrieval, editable lasting notes and backups. A semantic index can be added if measured recall quality calls for it. Installing another repository by itself would not solve missing history, incorrect provenance or stale decisions.
