# A practical guide to Agentic OS

Use [Start here](../START-HERE.md) to run the app. You can skip every external integration and add your own sources later.

## Start with context

Add your name, timezone and a current goal in setup. Business context and a photo are optional. Example profiles are fictional. They are useful for exploring, but they do not establish an authenticated identity or connect an account.

## Dashboard

Use the overview to see goals and the next useful action. A daily brief needs a configured model and the sources you choose to include. Demo numbers are fictional; the live view uses your saved observations and connected data. See [Dashboard](DASHBOARD-RELEASE.md).

## Inbox

Use your own Google or Microsoft connection, a supported native read connection or an import. The app distinguishes saved records from live access. Sending a message needs its own supported authorization and an explicit action. Do not treat a generated draft as a sent message.

## Calendar

Check the connected account, loaded date range and last refresh. Calendar chat can help with meeting preparation, planning and conflicts using that available context. A partial snapshot cannot establish that your whole calendar is free. Event creation requires separate write access and review.

## Chat

Choose a configured runtime and model. Select the sources to include in the conversation. Saved conversations can be reopened; failures remain visible. A working model sign-in does not transfer permission from every app connected elsewhere.

## Memory

Save a short note, document or optional photo, then search for it. Review imported sources and pause anything you do not want used in context. Existing conversations may retain text used earlier, even after a memory is removed from future retrieval. See [Memory](MEMORY-RELEASE.md).

## Voice

Voice uses its own provider setup. Choose the context you want available and review proposed actions. A saved photo can be shown locally; discussing its visual contents can send it to the selected model when you choose that action. See [Voice](VOICE-RELEASE.md).

## Design and Website

Connect your own generation provider and inspect the price shown for the selected model and settings. Account credits and API billing are separate. Keep local website changes reviewable, and check the result before publishing it. See [Higgsfield](HIGGSFIELD-API.md).

## Troubleshooting

Check the server terminal for errors and confirm the URL uses its port. For account failures, inspect the connection's setup or retry control. For a model failure, check that runtime's sign-in and provider credits. A static frontend preview does not include the local server features.

Use the focused setup controls first. The optional `bun run setup` script performs a broader machine scan and installs skills and a scheduler. It is not required to try Agentic OS.

## Keep your copy private

Share the original community ZIP, not the folder after using it. Read [Privacy and sharing](../PRIVACY-AND-SHARING.md) before distributing a modified version.

## Optional weather

The community copy has no preset city and sends no weather request until configured. To use weather, set `AGENTIC_WEATHER_CITY`, `AGENTIC_WEATHER_LATITUDE` and `AGENTIC_WEATHER_LONGITUDE` in the server's environment before starting it. Use city-level coordinates you choose to share with Open-Meteo. This does not enable browser geolocation.
