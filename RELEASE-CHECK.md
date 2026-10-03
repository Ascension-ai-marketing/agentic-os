# Community release checks · 2 October 2026 (Agentic OS V4.5)

This release adds Hermes chat in the Chat page (GPT-6.1 Sol through your Codex sign-in) with a live action window, "Ask Hermes" by voice, voice-controlled humour and speed with animated controls, saved files that open from Memory and by voice, community fixes (Gmail cleanup, chat fallback, Gmail badge, repeating meetings) and the new Higgsfield console with exact per-version prices. It builds on V4.4 below. It is assembled from an explicit file list; the creator's configured installation and personal data are not part of the download.

## V4.5 checks

- A clean extraction with an empty home folder and no keys passed `bun install --frozen-lockfile`, all tests, `bun run typecheck` and `bun run build`, and every main page opened with no JavaScript errors.
- Hermes chat, the Hermes window, "Ask Hermes" by voice with the Start card, humour and speed by voice, and opening saved files by voice were exercised end to end on macOS with the reviewer's own accounts.
- GPT-6 Astra reviewed the changes adversarially over several rounds (7 to 11); each round's findings were fixed and checked again in the next. Covered: a spoken yes counts only while the task card is on screen; a cut-off Gmail list keeps mail on the boundary, drafts and older mail; repeating meetings stay in the calendar and show once per calendar series in Memory; Memory files open on Windows paths and only from this server; a voice style change needs a clear request about how Jarvis sounds, and negations ("don't", "no more") or requests about something else ("make this email funnier") change nothing.
- Keys in Hermes output: values of credentials saved in `.env.local`, `~/.config/agentic-os.env` and `~/.hermes/.env` (read the same way the app reads them) are hidden wherever they appear, live and when a chat is saved, as long as they are at least 12 characters long (shorter values are not matched, so ordinary words are never hidden by mistake). Pattern rules also hide common key shapes on whole lines. A key in a format the rules don't know, and that isn't saved in those files, can still show, so don't film Hermes handling an unsaved key.
- Hermes runs with its own tool approvals switched off (as on the Hermes page) once you start it. Start it only for work you want it to do.

## V4.4 checks (still apply)


- A clean extraction with an empty home folder and no keys passed `bun install --frozen-lockfile`, all 975 tests, `bun run typecheck` and `bun run build`.
- The main pages opened with no JavaScript errors as a brand-new user: setup, Business, Inbox (and the demo sort), Calendar, Memory, Chat, Design, Reels, Websites, Settings, Live, Motion and Skills. The only failed requests were the missing tab icon and optional balance checks.
- `bun run setup:voice` saved keys with mode 600, never printed them, and checked each one with one read-only request.
- Live voice was exercised end to end with a recorded voice: a request for real work showed a "Start Codex on this?" card and started nothing until the recorded "yes". The job request itself was blocked by the test, so no agent ran.
- Requests from another website to local API routes were refused (403), including `text/plain` posts and a rebound host name. The app's own requests passed.

## Independent review

Two reviewers checked this package: GPT-6 Astra (Codex CLI, adversarial, four rounds) and a separate Claude privacy audit that read every text file, looked at all 134 images and at start, middle and end frames of all 32 videos, and checked media metadata.

Round 1 found 12 issues. All were fixed before packaging:

- Other websites could post to some local routes. A guard now refuses any cross-site request to a local API route.
- Voice could start real work from a model decision alone. Real work now needs your spoken yes or the Start button.
- The quick assistant and the inbox sort could send email and meetings after you switched those sources off. Both now honour the switches.
- Opening Memory started imports by itself. The first import now waits for a click, and later runs keep your opt-outs.
- The ChatGPT export import had no unpacked size or time limit and a weak file check. Both are fixed; a bad file never replaces a good one.
- An Outlook draft could end the mail history import early. Fixed.
- Opening a record's original worked on macOS only. It now uses the system launcher on Windows and Linux too.
- Voice stayed silent without a Fish Audio key. It now says so and links the sign-up page.
- The file manifest described an older folder, and the voice code had the creator's name in it. Both fixed.

Rounds 2 to 4 checked every fix, tried to break it, and found more. Those were fixed too:

- The guard lets sign-in callbacks through, compares the exact origin, and blocks other local servers from reading the API or the generated live data. Vite CORS is off.
- A spoken yes counts only when it is a plain yes, spoken after the card appeared, bound to that exact recording, within one minute. "Yes, but cancel that" starts nothing.
- Business context follows its switch. The saved daily brief goes to a model only while every Memory source is on.
- The first import cannot be started by a timer, only by your click. Refreshes keep mail, calendar and ChatGPT opt-outs.
- ChatGPT exports up to 512 MB are parsed and checked in full; larger ones are checked at both ends. The export being replaced is always kept as `conversations.previous.json`. Temporary files are private and one-time.
- Files served from the design folder (including SVG) are sandboxed, so they cannot run code in the app.
- `bun run setup:voice` writes the key file atomically as a new private file, never through a link, and checks the key the app will really use.

## Privacy

No live secret, credential, personal record or financial record was found. The privacy audit found and this release removed: real community member names and a real group name in test fixtures, a real sponsor and amount in the demo invoices (now fictional), the private repository name in request headers, creator-specific defaults (community group, author, own voice clone), an unused portrait, and local folder paths in code comments. Every email, sender, company, invoice and amount in the demo inbox is fictional.

Two classical engravings in the Hermes artwork (`src/assets/hermes-art/`) show nude figures.

## What is excluded

Private workspace storage (`.operator-data`), profiles, photos, imported histories, saved voice lessons (`data/voice`), the transcript corpus (`data/youtube-transcripts`), internal build notes and screenshots (`docs/jev-build`), account grants, environment files, generated live data, private graphs, Git history, dependency folders, build output and logs.

`MANIFEST.sha256` records every included file except itself.

## Public references that remain

Author and licence credits, public repository and website links, the creator's public Instagram handle on the sample reel, the optional advisor and news services named in `docs/DASHBOARD-RELEASE.md`, the Fish Audio sign-up link (https://bit.ly/4xgI73C), and the public voice ids of four Fish Audio library voices (Jarvis, Atlas, Raven, Sage).

## Limits

This is an evidence-based review, not a zero-risk guarantee. macOS was tested end to end. Windows and Linux were reviewed in code only. Live replies used the reviewer's own keys in a separate test; recipients must set up their own keys and accounts. Voice and cloud models send the audio and text you give them to those providers. Earlier messages of a chat you continue are sent as context even if you switch a source off later. The local API guard stops browsers; other programs on your own computer are limited only by each route's own token checks.

Share this clean ZIP, never a folder after it has been configured or used.
