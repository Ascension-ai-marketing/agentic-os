# Dashboard, daily brief and business advisor

September 2026 workspace update. This page describes the dashboard changes and the distinction between the interface, saved observations and live account access.

## Start with the work that matters today

The Dashboard opens at `/business` and brings the business design language into the daily workspace. The main views are Overview, Finances, Progress and Audience. Connections live in one account surface, opened from **Connect accounts** or the setup flow.

Overview contains the cash, income and revenue-target cards; a row for YouTube, Instagram, TikTok and LinkedIn; and the daily brief. Subtle motion adds life to the graphics. The interface supports light/dark themes, narrow screens and reduced motion. Illustrative figures and growth series are labelled **Demo** and are not saved as observed results.

Finances keeps combined balances, income, runway, spending and invoices together, with account/income, partnership and AI-spend details. The richer financial charts include demonstration data until a corresponding real data source exists. A bank balance snapshot does not establish monthly revenue, profit, runway or invoice status. Different currencies stay separate; missing currency remains unknown.

## An actionable daily brief

**Focus your attention** shows up to three concrete priorities. Tick a priority to save completion and celebrate with confetti; untick to undo. Confetti runs only after a successful save and respects reduced-motion preferences. Archived reports retain their own action state. Regenerating the same sourced action can preserve its completion; a different task or deliverable must not inherit the old tick.

The full report uses up to six concise illustrated recommendation cards. Source disclosures show where the evidence came from and when it was observed. The background is a silent looping video with a pause control and a still-image fallback.

The brief gathers enabled local memory, imported messages, calendar/meeting records, business observations, current goals and available Dream findings. Inbox retrieval examines the eligible saved corpus before selecting threads. It considers authored requests, delivery commitments, deadlines, payment blockers, drafts, sent replies and waiting states. This improves the selection of evidence; it does not establish that an external task has been completed or that a payment has settled.

**Regenerate** needs a configured supported model/harness. The initial download has no personal report, private inbox or active daily schedule. The app can record a 07:00 schedule only after a real scheduler/automation has been created. Merely launching the app or enabling a display option does not install an operating-system scheduler. A local scheduled run requires its host and app to be available and uses that installation's timezone, credentials and saved source preferences.

A brief is only as current and complete as its sources. Disabled sources are excluded. Imported snapshots are dated observations, not evidence of a continuously connected mailbox or account.

## Strategy conversation at the bottom

**Your business advisor** lives below the dashboard. **Talk strategy**, **Open conversation** and the composer expand the conversation in that bottom panel. The shared assistant provides model selection, conversation history, enabled memory sources and page context. Collapsing the panel preserves the conversation; opening the full chat page continues the same thread.

The advisor can discuss goals, decisions, offers and audience evidence. It is an AI assistant, not a named business expert. Selecting a cloud model can send enabled context to that provider and incur the user's provider charges. Available models are discovered from configured accounts and installed local tools. No model account, API key or usage allowance is included with the download.

## Setup: context, accounts, goals

The setup section pairs a large looping visual with three focused steps. It stays accessible for later changes.

1. **Context:** name, business, who you help, what you help them achieve and long-term direction. Optional personal questions let the workspace reflect how you want to work.
2. **Accounts:** open the common connection surface; distinguish an actual connection from a saved snapshot or a manual observation.
3. **Goals:** define the quarter's outcome, the month's milestone and this week's commitment. Choose which parts of the Overview are visible.

The optional **Give your business a memory** area accepts notes, links, documents and images through the existing memory importer. It exposes indexing and error states and saves to the selected business collection. Images use supported text recognition; an image with no readable text needs an appropriate description before its visual contents can be discussed reliably. Adding information to memory and connecting an external account are separate actions.

The reusable layout export contains display settings. It is not a backup or transfer of private account credentials, business records or memory.

## Goals and the Sunday review

Quarter, month and week goals share the Progress store. Each new goal has a calendar date range and timezone. A week runs Monday through Sunday in that timezone; the date calculation handles daylight-saving boundaries.

When the next week starts, the previous commitment remains in history and the setup can prompt for review. Carrying it forward is an explicit action that creates a new goal, preserving the earlier status and update trail. Goals are not silently rolled into the next week or deleted. Legacy goals without dates remain available for review and are not presented as current commitments until the user chooses a period.

Progress and the shared advisor distinguish current goals from past, future and undated records. The weekly prompt is an in-app review, not a separately installed reminder notification.

## What connects today

| Source | Current behavior | What a new installation needs |
| --- | --- | --- |
| Mercury | Dated account-balance import via a connected external assistant; shows observation date and stated currency | The user's own Mercury access and a deliberate snapshot import; a logo does not establish a direct OAuth connection |
| Stripe | Opens the provider dashboard | Direct Stripe synchronization is not included |
| YouTube | Subscriber/view observations; recent videos longer than three minutes; sampled comments and theme counts | The user's configured API access and channel; API quotas and comment availability apply |
| Instagram, TikTok, LinkedIn | Manual numbers and imported dated history | Add observations/CSV data; direct provider synchronization is not included |
| Email and calendar | Brief can use locally saved records and configured provider sync | Separate provider setup/consent; a ChatGPT or Claude connection is not copied into this app |
| Memory and meetings | Uses enabled imported/indexed records | The user's selected sources and any required exports/integration permissions |
| Dream and AI usage | Uses available local telemetry and Dream output | Optional collection/Dream setup on the recipient's machine; missing observations stay missing |

### Configure your YouTube channel

Save these two values in your private `~/.config/agentic-os.env` file:

```dotenv
YOUTUBE_API_KEY=YOUR_YOUTUBE_DATA_API_KEY
YOUTUBE_CHANNEL_ID=YOUR_CHANNEL_ID_STARTING_WITH_UC
```

Use the channel ID, not an `@handle` or URL. Both values are required; an API key alone never selects a creator's channel. Keep this configuration out of Git and restrict its file permissions to your user. The community copy reads only this named configuration file for YouTube. The release contains no key and no default creator channel.

Then use **Connect accounts → YouTube → Refresh** for channel metrics and **Audience → YouTube → Load recent videos** for uploads and comments. Cached video insights are bound to the configured channel. Changing channels hides another channel's cache until a successful refresh; it does not erase the previous file on a failed request.

YouTube's greater-than-three-minute rule is a conservative long-form filter, not an official platform classification. Comment summaries use a bounded recent sample and keyword themes. They describe the returned sample, not every comment, an exhaustive audience survey or a demand forecast. Audience charts display saved observations and do not invent historical values between them. Example growth remains explicitly labelled.

The existing AI-news endpoint reads a remote feed associated with AI with Jack. It is an external dependency rather than a bundled archive or a new business-data connection. It is not guaranteed to be continuously available and is not a substitute for a sourced daily brief.

## Updating an existing installation

Keep the old installation until the new download has started successfully. Stop both instances before moving local records, and make a private backup of `.operator-data/` before any migration. That directory can contain memory, imported messages, conversations, photos, account tokens, goals, reports and preferences; it must never be committed or redistributed.

Install the new source and its dependencies first. Move only the data that belongs to the same local user, then reconnect or revalidate providers and check Memory, Inbox, Calendar and Progress. Machine-specific Python environments and installed binaries should be recreated using the release setup instructions rather than copied between machines. Other local tools retain their own account stores outside this application.

Do not overwrite your data with an empty release seed. The release includes no personal account tokens or imported business records. Unknown, missing or invalid records must be reviewed rather than replaced with fabricated values.

## Verification scope

During development, the dashboard's relevant backend checks covered brief ranking, source exclusion, action persistence/archive isolation, canonical goals, local Sunday rollover, daylight-saving changes, atomic setup saves and memory ingestion. Browser checks covered completion failures/undo, confetti, concise reports, the split setup, model routing fixtures, advisor continuity, narrow layouts and light/dark themes.

The release's fresh-download verification and platform limitations are recorded separately in `RELEASE-CHECK.md`. A successful production build does not turn these local file/agent adapters into a hosted multi-user service. Provider authentication, quotas, paid model calls and every external account are not bundled into an offline test.
