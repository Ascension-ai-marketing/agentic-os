# Your data stays out of the download

This community package contains source code, interface artwork and labelled fictional examples. It does not include the creator's personal profile, photos, financial records, Mercury account data, community records, messages or session cookies, mail, calendar entries, meeting notes, memories, conversations, provider keys or account grants.

Public attribution remains: the creator's name in author and licence credits, public repository and website links, public profile-building templates, and the public news-feed address. These are public product references, not a private profile or an account connection. The included graph is a labelled example of a public design project.

## What happens after you install it

Your own profile, conversations, imports and account configuration are saved locally. Much of the app's workspace state lives in `.operator-data`. Some optional integrations also use private configuration in your user account, such as `~/.claude-os`, `~/.hermes` or `~/.config/agentic-os.env`.

Connecting a provider or importing a source is your choice. An installed app, an authenticated model and permission to read an external service are different states. The connection UI reports the access currently available.

Sign-in tokens for connected accounts are stored only on this computer, in `.operator-data`, readable by your user account only. They are never copied to or from another app.

When you choose a cloud model, selected conversation context is sent to that provider. Voice, media generation, news and optional integrations can make network requests. The app is not an offline-only system.

## Voice and Jev

Voice is off until you tap the orb. While it is on, your microphone audio goes to OpenAI Realtime, and the reply text goes to Fish Audio to be spoken. Jev decisions and quick typed answers go to OpenRouter. Each uses your own key from `~/.config/agentic-os.env` (written by `bun run setup:voice`, readable only by your user). Sources you switch off in Memory are not sent. Real work starts only after you say yes or tap Start, and then runs on your own Claude Code or Codex account.

## Sharing with someone else

Share the original clean ZIP. Once you have used the app, do not ZIP the whole configured folder. It may contain your records, files and credentials even if Git ignores them.

Git history, `.operator-data`, non-example `.env` files, generated live data, private graphs, dependencies, build output, screenshots, logs and local review artifacts are outside this release package.

## Starting again

Extract the original ZIP into a new folder. Your old private installation remains available for backup and recovery. Do not delete it until you have checked the records you want to keep.
