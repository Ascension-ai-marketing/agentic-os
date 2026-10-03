# Jarvis agent tasks

Jarvis can now hand a task to native Codex or Claude Code and show its progress, questions and result in **Voice → Tasks**. The agents use their own installed runtime and account connections. Credentials are not copied into the OS.

## Use it

1. Open **Voice**, then **Tasks**. This panel works without starting a microphone session.
2. Select **Codex**, **Claude**, or **Both** and describe what you want done.
3. Follow the progress cards. Answer a question, approve or deny a native request, or stop an agent independently.
4. Read the result. **Open in Codex** opens the actual saved native task for inspection.

Either agent selected alone carries out the task. **Both** runs them simultaneously: Codex acts and Claude provides an independent read-only review of the request. Claude does not inspect Codex's eventual result automatically. This avoids performing the same external action twice. Separate individual tasks can also run concurrently, up to four active agent runs.

With OpenAI Realtime voice selected, examples are:

- “Ask Codex to create a short plan in a local file.”
- “Have Codex work on this and Claude review the approach.”
- “Check that Codex and Claude work.”
- “How is that task getting on?”

The new delegation voice tools are specific to OpenAI Realtime. The Tasks panel is available with the other voice engines too; they do not automatically inherit those tools.

## Email and other actions

A task can ask the native agent to use its own connected email or messaging tools. Give a clear recipient, content and action. A draft request does not authorize sending. Native account permissions and approval requirements still apply, and any supported permission question appears in the task card.

Jarvis's existing saved-email review and the Inbox's direct-provider integration remain separate paths. The new task runner does not turn the read-only Inbox sync bridge into a write bridge.

**Finished** means the agent's turn ended. For an external action, inspect its result for a provider receipt or identifier. A successful model answer, discovered tool or signed-in account alone is not evidence of a sent email. An interrupted or uncertain external operation is never automatically retried.

## Connections and checks

**Check agents** starts a harmless task in each runtime. Each creates and reads `agent-check.txt` in its own task directory; the OS independently verifies the file and expected content. This checks native generation and local tools. It does not send email, exercise an external write permission or verify every connector.

The status distinguishes installed, signed in and successfully checked. Claude Code sign-in is its own `/login` flow; a Claude browser or desktop session does not establish that the CLI is signed in.

Verified on 17 September 2026:

- Codex started a real native thread, executed two file commands, returned a result and passed the independent file check. Its saved thread was also read back through the Codex app.
- Claude's native check passed once it was signed in: a specific local Write request was approved, Claude read the file, and the OS independently verified its content. Both Codex and Claude have now passed native generation and local file-tool checks. This does not verify every connected app or external write.
- No external messages were sent during verification.

## Local operation

Task history lives in excluded `.operator-data/agent-jobs.json`, written with private file permissions. Each run has a separate directory below `.operator-data/agent-tasks/`. The last 30 task records are kept; native session history remains with the owning application. Never include either private directory in a release package.

Only the submitted request is forwarded automatically. OS memory, mailbox data, transcripts and credentials are not appended. The executing agent can access its own native tools when needed for the user's task. Claude's simultaneous reviewer is restricted to read-only built-in tools without its configured MCP action tools.

The browser polls active tasks every 1.5 seconds. Jobs continue when the voice call ends or the panel closes, while the local server remains running. Closing or restarting the server stops active jobs and records an interrupted state; tasks are not replayed on restart. Production builds do not initialize or mutate the live task service.

The endpoints inherit the local OS's loopback, origin and CSRF checks. Native task permissions remain visible and are not automatically accepted. Unsupported native dialogs fail with guidance to use the owning runtime. Cancelling a task cannot retract an external operation that has already reached its provider.

## Implementation

- `scripts/agent-jobs.ts`: job coordination, persistence, checks and connection status.
- `scripts/agent-jobs-codex.ts`: native Codex app-server threads, events and approvals.
- `scripts/agent-jobs-claude.ts`: Claude Code streaming control protocol.
- `src/components/operator/agent-jobs-panel.tsx`: task controls, updates and results.
- `scripts/openai-voice.ts` and `voice-companion.tsx`: voice delegation, checks and status tools.

The focused suite passed 77 tests with 361 assertions. It covers native protocol handling, auth failure, questions/approvals, cancellation, simultaneous execution/review, deduplication, restart behavior and actual check-file verification. Whole-app TypeScript and a production build passed. Browser fixtures exercised polling, task submission, explicit approval/denial, question answers, stop controls, retry deduplication, voice delegation/status and a 390px layout, with no browser errors. Live endpoint checks also rejected unauthenticated and cross-origin task creation without starting a job. A live microphone conversation and real external sends were not used for QA. Fixture screenshots and the browser report are in `outputs/agent-jobs-review-2026-09-17/`; these are QA evidence, not release assets.

This is a local implementation checkpoint. It has not been pushed, merged or included in a new downloadable release.
