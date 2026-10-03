# Motion Library

A tab in the sidebar (Tools, bottom left) at `/motion`: unlimited motion
styles, each a seamless loop drawn in code by one pure render function, and
one box that turns any mix of them, your idea and your files into a RISE
prompt for Claude, Claude Code, ChatGPT or Codex.

## Use it

- **The box.** Click any tiles (or drag them in) to add them as references;
  they show as chips. Type the idea. Drop or paste images, videos, links or a
  logo:
  - a **website link** pulls the brand with Firecrawl and re-skins the wall in
    its colours, font and name;
  - a **logo** (SVG, or a PNG with transparency) re-brands the wall live from
    its colours and is referenced by path in the prompt;
  - an **image or video** becomes a reference (videos also give four key
    frames), saved to `~/motion-studio-projects/assets/`.
  Pick the **length** (3 to 60 s). **Auto-enhance** (on by default) turns it
  into a full RISE prompt (References, Idea, Style, Examine) with `claude -p`
  on your own Claude Code login, or the built-in writer when Claude Code isn't
  there; off, it sends your words as written. **Write prompt**, then open it
  where the **Open in** picker says:
  - **Claude** / **ChatGPT**: opens `claude.ai/new?q=…` or `chatgpt.com/?q=…`
    pre-filled and copies the prompt too (paste with ⌘V if the box is empty).
  - **Claude Code** / **Codex**: shows the exact command first; on click makes
    `~/motion-studio-projects/<slug>/` with `PROMPT.md` and `assets/`, then
    opens a new Terminal running `claude "$(cat PROMPT.md)"` or
    `codex "$(cat PROMPT.md)"` there (macOS). Elsewhere, copy the command.
- **Styles.** Every tile is live; only tiles on screen animate. Hover a tile
  for **Show prompt** (the tile turns over to its prompt, with Copy), Preview
  and Copy prompt. Preview opens the detail: a big live preview (16:9, 9:16,
  1:1, scrub), its rules, the full prompt and **Export mp4** (3840×2160,
  2160×3840 or 2160×2160, 30 fps H.264, to `~/motion-studio-projects/exports/`).
- **Made in this video.** The pieces from the Motion video with the prompts
  that made them: live code where it exists, short muted loops otherwise.
- **Inspiration.** Links and official embeds only, each credited to its
  maker. Nothing is downloaded or re-hosted.

## Setup

Nothing is required for the wall, the box, Copy, Claude/ChatGPT and the
built-in writer. Optional:

| Feature | Needs |
| --- | --- |
| Claude Code writer, Open in Claude Code | `claude` installed and signed in |
| Open in Codex | `codex` installed and signed in |
| Brand from a link | `FIRECRAWL_API_KEY` in your environment, `.env.local` or `~/.config/agentic-os.env` (get a key at firecrawl.dev) |
| Export mp4, video key frames | Google Chrome (or Chromium/Edge/Brave; `MOTION_STUDIO_CHROME` to override) and `ffmpeg` |

Environment switches: `MOTION_STUDIO_DRY_RUN=1` never opens Terminal or Finder
windows; `MOTION_STUDIO_IMPROVER=template` always uses the built-in writer;
`MOTION_STUDIO_HOME` moves `~/motion-studio-projects`; `MOTION_STUDIO_MODEL`
picks the writer's model; `MOTION_STUDIO_EXPORT_SCALE` (0.1–1) exports smaller
files for quick tests.

## How it is built

```
src/motion/                  framework-free, can ship as its own package
  engine/                    types, colour, kit (hash, periodic noise, easing,
                             grain, light), fonts, runner, render, prompt (RISE),
                             brand (theme from colours), assets (logos)
  styles/<id>.ts             one file per style + index.ts (wall order);
                             files starting with "_" are helpers, not styles
  collections/               Made in this video, Inspiration
  render/frame-page.ts       headless page for export and the check
  server/                    Node: prompt writer (claude -p), Firecrawl brand,
                             uploads, Claude Code / Codex launch, mp4 export,
                             CDP driver, Vite middleware (/__motion/*, local only)
  check/check.ts             bun run check:motion
  STYLE-GUIDE.md             how to add a style
src/components/motion/       the React page (box, wall, tiles, detail, hero beam)
public/motion/               Made-in-this-video loops and code, the hero beam
src/routes/motion.tsx        the /motion route (?style=<id> opens a detail)
```

`/motion?stress=120` repeats the wall to 120 tiles to check smoothness.

## Add a style

Follow `src/motion/STYLE-GUIDE.md`: one file in `src/motion/styles/`, import it
in `styles/index.ts`, then `bun run check:motion <id>` until it passes and the
stills in `outputs/motion-check/<id>/` look right.
