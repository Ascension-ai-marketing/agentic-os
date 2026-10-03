# Working on Agentic OS

Read START-HERE.md, docs/COMMUNITY-START.md and RELEASE-CHECK.md. This community source starts without personal state. The optional `bun run setup` installer is not needed to preview it.

## Protect the operator's data

Preserve `.operator-data`, personal profiles, conversations, imports and provider configuration. Test with synthetic temporary fixtures. Do not overwrite real records with demonstration data.

An installed tool, an authenticated runtime and external app permissions are separate facts. Do not copy authentication tokens between applications or claim that one app's grant authorizes another app.

Keep bulk emails, encoded media, credentials and raw provider payloads out of chat output, source files and release archives. Use bounded imports and file-backed checkpoints.

## Work within the request

Do not scan personal files, import histories, install jobs, send messages, create calendar events, generate paid media or publish content merely to verify the interface. Follow explicit user authorization and native approval controls.

Keep optional platforms independent. Preserve empty states, source labels, responsive layout, keyboard access and reduced motion. Report what is live, simulated, imported or still unconfigured.

## Verify and package

Run focused checks while editing. Before release run `bun test scripts`, `bun run typecheck` and `bun run build`, then check a clean source copy with a frozen lockfile install and fresh workspace. Browser checks require the local server, not just a static build.

Package only reviewed source and interface assets. Exclude private storage, non-example environment files, generated live data, private graphs, dependencies, build output, Git history, logs and screenshots. Verify the final archive contents and checksum. Never distribute a configured working folder.
