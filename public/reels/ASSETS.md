# Reels visual assets

## Upload illustration

- File: `upload-sculpture.png` (transparent PNG).
- Created for this project with the built-in `image_gen` tool on 2026-09-28. No fallback CLI or Higgsfield call was used.
- The processing illustrations are original inline SVGs in `src/components/operator/reels-setup.tsx`.

Final generation prompt:

> Use case: stylized-concept. Asset type: a small premium illustration inside the upload area of a video editing app. Create an original sculptural still life: three overlapping vertical film frames with rounded corners, a translucent smoky-glass front frame containing a single pearlescent play triangle, one soft peach frame and one brushed silver frame behind it, and a small polished audio waveform made of five rounded bars at the base. Restrained, beautifully lit tactile 3D materials, close studio product rendering, subtle coral and cool blue edge reflections, clear silhouette, calm precise composition, front three-quarter view, centered horizontally. Transparent background with genuine alpha, no background plane, no text, no lettering, no logos, no gradients spilling outside the objects, no confetti, no additional decorative objects. Wide composition around 3:2 with the object filling most of the image. It will appear about 260 pixels wide on an off-white surface. Keep shapes immediately readable at this size.

## Platform marks

- `instagram.svg`: the existing Instagram path from this repository's `InstagramMark` component.
- `tiktok.svg`: [Simple Icons TikTok](https://github.com/simple-icons/simple-icons/blob/develop/icons/tiktok.svg).
- `youtubeshorts.svg`: [Simple Icons YouTube Shorts](https://github.com/simple-icons/simple-icons/blob/develop/icons/youtubeshorts.svg).

Instagram is used in the Reels heading. The TikTok and YouTube Shorts marks are retained as source assets from the earlier design; the three-logo strip has been removed. The SVGs are served locally.

## UI references

- [21st.dev: Video Upload Card by Isaiah](https://21st.dev/@isaiahbjork/components/video-upload-card): contained dropzone and compact upload action.
- [Mobbin: Video or Audio Editing bar](https://mobbin.com/collections/0b94ba83-0ccd-4f74-97ce-2feeb9920f60/web/screens): compact editor controls and clear grouping.

Both public previews were inspected. Their MCP tools were unavailable in this session. 21st.dev's component source required sign-in; no gated code was copied. This implementation and its processing graphics were written for Agentic OS.
