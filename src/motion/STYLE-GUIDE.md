# Adding a motion style

A style is one file, `src/motion/styles/<id>.ts`, that exports `style`. Nothing
in `src/motion/engine` or `src/motion/styles` may import React, the router or
any server module: styles are plain render functions so the engine can ship as
its own package.

## The contract

```ts
import type { MotionStyle } from "../engine/types";

export const style: MotionStyle = {
  id: "my-style", // equals the file name
  name: "My Style",
  tagline: "A few words for the tile", // optional; one line on the wall
  look: "One line: what it looks like.",
  move: "One line: how it moves.",
  rules: ["5 to 8 short craft rules"],
  prompt: `R — References ... I — Idea ... S — Style ... E — Examine ...`,
  ref: "https://…", // optional link to the real-world source
  theme: { bg, ink, accent, accent2, font }, // the style's own palette
  fonts: ["Inter:wght@100..900"], // Google Fonts specs it needs
  tags: ["words", "the improver", "matches"],
  word: "Motion", // the word it sets when no brand name is present
  duration: 5, // optional; showcase pieces may loop longer (seconds)
  render(ctx, t, theme, w, h) {
    /* draw frame t */
  },
};
```

Then import it in `src/motion/styles/index.ts` (the order there is the order on
the wall) and run `bun run check:motion my-style`.

## Rules for `render(ctx, t, theme, w, h)`

1. **Pure.** Same `(t, theme, w, h)`, same pixels, in any order. Use `hash`,
   `rng(seed)` and the periodic noise in `engine/kit.ts`; never `Math.random()`
   and never keep state between frames. Caches (`bake`, `once`, `buffer`) must
   be deterministic.
2. **A 5 s seamless loop.** `render(ctx, 0, …)` must equal `render(ctx, 5, …)`.
   Build motion from `seg(t, a, b)` windows that return to the start state,
   `wave(t, cycles)` with whole cycles, or `noise3(x, y, k * t / 5, 0, 0, k)`
   (periodic in z).
3. **Every colour from the theme.** `theme.bg` is always dark; `ink` is the
   light foreground; `accent` is the one accent; `accent2` is quieter. Derive
   tints with `mix()`/`rgba()` from `engine/color.ts`. This is what lets
   "Brand from URL" and a dropped logo re-skin every style.
4. **Any aspect ratio.** Lay out from `frameOf(w, h)` (`u` = short side,
   `portrait`, `square`). Check 16:9, 9:16 and 1:1.
5. **Crafted, not flat.** Finish with `vignette()` and `grain()`; add light
   falloff (`light()`), texture and ease in/out on every move. Hold any text at
   least 1.2 s; never clip descenders; never leave one word alone on a line.
6. **Text** uses `theme.font` for display type (it becomes the brand's font) or
   a font that is the style's signature (list it in `fonts`).
7. **Logos.** If a logo fits the style, draw `tintedLogo(theme, color, w, h)`
   from `engine/assets.ts`; it returns `null` until a logo is loaded, so the
   style must look complete without it.
8. **Cheap enough for the wall.** Tiles render at about 520–760 px wide, many at
   once. Do per-pixel work on a small `buffer()` and upscale it.

## The prompt (RISE)

`prompt` is what members copy. Four sections, each header on its own line:

- `R — References`: real, searchable sources for the look.
- `I — Idea`: one image with a beginning, middle and end, as a 5 s loop.
- `S — Style`: `Looks:`, `Moves:` and numbered `Rules:`.
- `E — Examine`: the build contract (one HTML file, one pure `render`), then
  "render 5 frames (t = 0, 1.25, 2.5, 3.75, 5), check …, fix, repeat".

Use `{{bg}} {{ink}} {{accent}} {{accent2}} {{font}} {{name}}`; the studio fills
them from the active theme and adds any dropped logo's path to R.

## The check

`bun run check:motion [id …]` builds the engine for the browser, renders every
style in headless Chrome and fails on: blank frames, exceptions, non-finite
numbers reaching the canvas, a loop seam (t = 0 vs t = 5), non-determinism,
`Math.random`, a missing contract field, or a failure when re-branded with a
foreign theme and logo. Stills land in `outputs/motion-check/<id>/`; look at
them before you ship.
