# Jarvis: portable voice, visual memory and local image previews

Jarvis is now a movable companion that stays available while you use the operating system. The voice orb sits above a separate conversation area. A quiet, rotating constellation of enabled memories is the default backdrop; requested memories, calendar entries, business context and images appear in the same panel.

## What changed

- **A simpler visual interface.** A blue, violet and cyan orb replaces the busier voice dashboard. Conversation, call controls and a text composer stay visible; voice configuration and secondary tools live in the options menu.
- **A portable panel.** Drag the title bar, or focus it and use the arrow keys, to reposition Jarvis. The rest of the OS remains clickable. Minimize into a floating orb, drag it anywhere within the screen, and click to restore the panel. Resize handling keeps the controls reachable.
- **A living memory backdrop.** The default constellation represents up to 110 enabled saved memories, grouped by collection. It is ambient animation, not a claim that background agent jobs are running. Open Memory for an interactive map with Orbit and Network layouts, source selection and matching records.
- **Shared memory controls.** Sources exposes the same source switches used by the Memory section, including Claude, Codex, Hermes, OpenClaw, business, meetings, email, Notion and images. Changing source permissions ends the existing voice call and clears its prior context; start another call to use the updated selection.
- **Local image discovery.** Ask Jarvis to find images by filename in Desktop, Downloads or Pictures. The search is read-only and bounded; blank queries browse a sample, sorted newest first within that sample. PNG, JPEG and WebP previews up to 12 MiB open inside the panel. Only choosing **Discuss this image** shares an image with the voice provider.
- **Context-aware voice tools.** Voice can navigate allowed app pages, search enabled memory, read permitted workspace context, display a relevant visual, find local image filenames and open a returned preview. Mute, interruption, typed input and the session transcript remain available.
- **Responsive, accessible motion.** The panel works at laptop and mobile widths, supports keyboard movement and respects reduced-motion preferences.

## Use it after downloading

1. Install Bun and Node.js 22.12 or newer, then install the project dependencies with `bun install --frozen-lockfile` and run `bun run dev` from the extracted project folder. Use the localhost address printed in the terminal and keep that terminal running.
2. Open **Voice** in the app header. Opening the panel does not start microphone recording.
3. Open **Voice options → Voice settings**, choose **OpenAI · Cedar**, enter your own OpenAI API key and save the connection.
4. Choose **Start conversation**, then allow microphone access in your browser. The connected OpenAI voice implementation uses `gpt-realtime` and the `cedar` voice. The text-chat model selector is separate.
5. Add or import your own memories and connect your own accounts. A fresh download does not include the developer's memories, calendars, inbox, keys or financial records.

Try “Show my calendar,” “Find memories about my project,” “Open Memory,” or “Find images on my laptop named logo.” The image search matches filenames; it does not recognise image contents before you share a selected image. ElevenLabs and browser voice remain optional alternatives.

## Updating an existing installation

Stop the old local server and keep a backup of its folder before replacing application files. Your saved voice configuration and other private workspace records live in `.operator-data`; a clean download deliberately does not contain them. Preserve that directory locally when updating an existing installation, or reconnect in Voice settings on a fresh installation. Never add the private directory to the GitHub update or shared ZIP. Your session-only voice transcript is not an upgrade backup.

## Data and connection boundaries

The OpenAI key stays in the local server's ignored `.operator-data/openai-voice.json` file and is not sent to the browser. That entire private directory must be excluded from Git and downloadable packages. Reconnecting requires the recipient's own key and provider account. Paid provider usage uses that account.

The local server exchanges the WebRTC session offer with OpenAI. Conversation audio and deliberately shared images use the selected provider. Enabled workspace facts can be returned to the voice model through its tools. Selecting a private local text model prevents a cloud voice call from starting or continuing.

Voice tools read context and navigate the app. They do not send mail, alter provider records, purchase, publish or execute arbitrary shell commands. Inbox and calendar visuals show saved workspace records and do not themselves promise live synchronization. The voice transcript is session-only. Conversation images are temporary unless saved separately to Memory.

Local image previews use expiring opaque IDs. The server rechecks source permission, containment, file identity and raster type before serving bytes. Hidden folders, symlinks, hardlinks, unsupported files and changed files are omitted. A search result is a bounded sample, not a complete inventory of the computer. The final local-image helper also interleaves the three roots so one busy folder does not consume the entire search budget.

This is a local development application. Use its development server for the local integration endpoints; a successful production build is not a claim that a static upload provides those services. macOS was exercised for the integrated browser and local-image checks. Windows and Linux were not separately tested.

## Verification for these changes

- 57 backend tests, 569 assertions passed again from the release staging directory: OpenAI and ElevenLabs setup/session configuration, secret handling, navigation routing, permission-gated memory images, bounded local image search, containment, expiry and byte retrieval. Fresh-staging provider status correctly requires recipient setup.
- 14 browser checks, no page errors: default view, drag and keyboard movement, navigation underneath the panel, persistent orb, conversation controls, requested memory/calendar views, source controls, docking/restoring, configuration, responsive bounds and reduced motion.
- The browser pass used a simulated voice transport and isolated source-preference writes. Local image search and private image retrieval used the real local API with a temporary PNG fixture removed afterward. No physical microphone or paid provider call was used for this UI pass.
- TypeScript, scoped source ESLint and production build passed.
- Earlier integration checks separately verified real OpenAI generated audio, spoken input, tool-driven calendar/memory/navigation, explicit image understanding, and clean connection/track shutdown. Those checks depend on an individually configured provider account.

## Release integration checklist

Include the voice UI components, portable layout stylesheet, floating-position hook, local-image helper and tests, updated OpenAI tool definitions and corresponding operator routes. Keep the complete lockfile and `@elevenlabs/client` dependency. Exclude all `.operator-data`, generated live data, local QA output and private fixtures. Re-run fresh installation and startup from the final ZIP, because those checks cover the packaged result rather than only the developer's working directory.
