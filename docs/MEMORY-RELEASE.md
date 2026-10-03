# Memory and Photos update

Memory now brings your local agent history, saved knowledge, connected account context and photos into one workspace. The visual cortex stays beside its source controls, with a simple capture area and a dedicated conversation beneath it.

## What changed

- **An interactive visual cortex.** Switch between Neural, Sphere and Network views; change detail, fit or zoom the graph, pause motion and open it full screen. Source changes fade nodes and links gradually while preserving the rest of the view.
- **One source panel on the right.** Branded switches show Info, Claude, Codex, ChatGPT, Email, Meetings, Skills, Hermes and Photos, with the remaining categories available through All sources. Toggle individual sources, use All on/off, check status, sync or open setup from the same place.
- **Simpler connection setup.** A single connection window detects supported local apps and guides account connections. Manage exposes import scope, destination, automatic sync and diagnostics without making those details the first screen.
- **A calmer capture area.** A looping brain visual sits beside one input for notes, links and files, plus a destination selector. Successful saves get a short confetti effect; failed submissions keep their content. Reading and indexing continue in the background and have their own status.
- **Chat with your memory.** The gradient conversation panel restores the model selector and voice entry. Ask across enabled sources or about a selected memory. Conversations use the shared assistant; pending source changes settle before a new question is sent.
- **Photos as a source.** Add pictures, browse images already indexed in Design, inspect their saved context and ask about a selected photo. Photo references in answers link back to the image in Memory.
- **Lighter source switching.** Preferences are saved independently from the main memory archive. Toggle updates are immediate in the interface, serialized on save and reconciled after failures. The graph pauses rendering when it is hidden or off screen.

## Start using Memory

Follow the repository [quick start](../README.md) to install dependencies and run the local server, then open **Memory** in the sidebar.

1. Choose **Set up memory** in the source panel and connect an app. Local detections show what can be imported; they do not mean an external account is already authorized.
2. Select the content types and destination you want, then connect or sync. Review any skipped-file explanation through Manage. Large, unreadable, unsupported or changing files can be skipped or deferred; a completed scan does not guarantee every conversation on the computer was imported.
3. Add a note, public article link or supported file in the capture area. Choose its destination before saving. Watch indexing status if a source is still being read.
4. Enable the sources you want, then ask a question in **Chat with your memory**. Select a source or photo when the question concerns that item specifically.

Source switches control inclusion in the graph and subsequent memory retrieval. Switching a source off does not delete its saved files or erase earlier conversation messages. Connection credentials, import schedules and deletion are separate controls.

## Connection requirements

| Source | What the recipient needs |
| --- | --- |
| Claude, Codex and Hermes | Readable data in the supported local app folders under the current user's home directory. Setup discovers memories, conversations and skills where that app supports them. No accounts or histories are bundled. |
| ChatGPT | A supported conversation export. This does not silently connect to a ChatGPT web session or read its private browser storage. |
| Gmail, Outlook and calendar | The recipient's own provider configuration and sign-in/consent. Google setup can accept the Web OAuth client JSON and checks the callback address. A saved snapshot is distinct from a live connection. |
| Granola / meetings | A supported readable local store or exported notes. An encrypted or unsupported cache needs an export. |
| Notion | An integration token and pages shared with that integration. Connect and import the desired pages; this does not grant access to every page in a workspace. |
| Info / business | Data connected in the Business dashboard. Its memory context carries dates and source information; an account balance is not treated as revenue. |
| Photos | Files selected by the user or an existing Design image index. Apple Photos and iCloud libraries are not automatically connected. |

Automatic sync is available for supported local app imports and checks every five minutes while the local server is running. Keep using **Sync all** or the source's own sync control when you need an immediate refresh. External sources retain their connector-specific behavior; not every source has continuous background sync.

## Files and optional tools

The basic Memory page, notes and supported text imports use the app's normal Bun installation. Additional import formats have these requirements:

| Feature | Requirement / limit |
| --- | --- |
| File uploads | Up to 5 MB per file. Supported inputs include PDF, text, Markdown, CSV, JSON, HTML, VTT/SRT transcripts, EML email and common raster images. |
| PDF text | `pdftotext` on the server's PATH, supplied by Poppler. This extracts existing PDF text; it is not scanned-document OCR. |
| YouTube links | `yt-dlp` on PATH and an available English transcript. If unavailable, paste the transcript or upload VTT/SRT instead. The importer requests captions, not the video file. |
| Local image text recognition | macOS with Apple Command Line Tools or Xcode. The bundled Objective-C helper compiles on first use and uses Apple Vision locally. |
| HEIC/TIFF previews | macOS uses the system `sips` tool to make browser-friendly copies. Preview support on other systems depends on the original format and browser. |
| Find local documents | Uses macOS Spotlight (`mdfind`) to match supported filenames in Documents, Desktop and Downloads. Drag-and-drop remains available when this finder has no results. |
| Memory chat / voice | A configured assistant provider or local model, plus the relevant voice setup. A download does not include model accounts, API keys or credits. |

On a Mac using Homebrew, the optional PDF and transcript tools can be installed with `brew install poppler yt-dlp`. Apple Command Line Tools can be installed with `xcode-select --install`. These are optional feature dependencies, not actions performed automatically by opening Memory.

## What photo questions can use

**Local OCR reads visible text.** It does not identify scenes or objects. A photo with little readable text remains available to preview, but needs a written description or a visual description before useful retrieval. Its status explains that limitation.

Use **From Design** to browse an existing image index. Images show whether their available context is OCR text or a visual description. Select up to 24 images for import. Original bytes and the selected evidence are copied into Memory so an imported image can survive a later move of the Design original.

**Describe selected** is an explicit optional action in the Design photo picker. It displays the configured model and an estimated cost before sending the selected files to that provider. The completed index records are checked before the UI claims the descriptions are ready. It does not run over the entire library automatically.

In a photo preview, inspect or edit **What memory knows**, then choose **Ask about this photo**. Questions use the saved evidence and its extraction type. OCR-only records are not presented as full visual understanding.

## Storage and updating an existing installation

Memory data lives in the local project, outside the distributable source package:

- `.operator-data/workspace.json`: saved memory sources and workspace data.
- `.operator-data/brain-preferences.json`: source inclusion preferences.
- `.operator-data/uploads/`: imported photo originals and derived previews.
- `.operator-data/vault/<collection>/`: Markdown mirrors of saved memories, suitable for browsing in tools such as Obsidian.

The Markdown vault is an export mirror, not a two-way Obsidian sync. Independently edited mirror files are protected from silent overwrites. Use the app to update the authoritative saved memory.

For an update, stop the old server and back up the existing project first. Preserve the **entire** `.operator-data` directory, including any connection configuration, along with your existing local settings and generated data. Replace application source according to the main release instructions, reinstall with the included lockfile and restart. A fresh ZIP in a different folder creates a separate empty workspace until existing local state is restored or sources are connected again. Never put that private state back into a shared release ZIP.

This is a local application. Run it through the documented local server: the built frontend alone does not supply the Memory import, file and connection endpoints.

## Verification and current limits

During development, the Memory workstream passed production build, whole-app TypeScript and scoped lint checks. A fresh run from the release checkout passed **31 backend tests with 223 assertions** across Memory apps, imports, photos, vault storage and source preferences. Coverage includes import boundaries, Notion error handling, image storage/preview access and photo imports. The bundled OCR helper also compiled from a fresh folder and read a synthetic text image locally on macOS. Browser checks exercised setup, smooth source toggles, failure recovery, capture, photo previews, selected-photo questions, citations, reduced motion and desktop/mobile layouts.

Mutation and model-dependent photo tests used fixtures. They did not import the developer's personal photo library, spend credits on scene descriptions or verify a recipient's live OAuth credentials. The tested desktop platform was macOS; Windows and Linux OCR/preview parity is not claimed. The graph limits rendered nodes for responsiveness, so it is not a complete on-screen listing of every saved record, and visible connections are not proof of an inferred semantic relationship.

See [release checks](../RELEASE-CHECK.md) for the combined download's installation and packaging verification.
