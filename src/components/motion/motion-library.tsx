/**
 * Motion Library (/motion): one box to write a motion prompt, a wall of live
 * styles, the pieces made in the video, and inspiration from other people.
 */
import { INSPIRATION } from "@/motion/collections/inspiration";
import { loadMadeCode, MADE, madeById, type MadeItem } from "@/motion/collections/made";
import { preloadLogo } from "@/motion/engine/assets";
import { loadBrandFont, loadFonts, stylesFonts } from "@/motion/engine/fonts";
import { composePlain, fillPrompt, type PromptAsset } from "@/motion/engine/prompt";
import type { MotionStyle, Theme } from "@/motion/engine/types";
import { FEATURED, STYLES, styleById } from "@/motion/styles";
import { Check, ImageUp, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, copyText, type Status } from "./api";
import {
  drawableLogo,
  looksLikeLogo,
  nameFromFile,
  paletteOf,
  readDataUrl,
  themeFromPalette,
  videoPoster,
} from "./brand-helpers";
import { Composer, Steps } from "./composer";
import { HeroBeam } from "./hero-beam";
import { ItemDetail, type DetailItem } from "./item-detail";
import { newKey, type Chip, type Seconds, type Written } from "./library-types";
import { OpenActions, RiseView, useRunner, type Target } from "./shared";
import { InspirationCard, LiveTile, MadeVideoTile } from "./tiles";
import "./motion-library.css";

const STATE_KEY = "motion-library.state.v2";
type Tab = "styles" | "made" | "inspiration";

interface Saved {
  text: string;
  chips: Chip[];
  seconds: Seconds;
  enhance: boolean;
  target: Target;
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

/** A picked id is a style id or "made-<id>". */
function resolve(id: string): { style?: MotionStyle; made?: MadeItem } {
  if (id.startsWith("made-")) {
    const made = madeById(id.slice(5));
    return { made, style: made?.style };
  }
  return { style: styleById(id) };
}

export function MotionLibrary({
  selected: openId,
  stress,
  onSelect,
}: {
  selected?: string;
  stress?: number;
  onSelect: (id?: string) => void;
}) {
  const ensureRunner = useRunner();
  const [status, setStatus] = useState<Status | null>(null);
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [seconds, setSeconds] = useState<Seconds>(5);
  const [enhance, setEnhance] = useState(true);
  const [target, setTarget] = useState<Target>("claude");
  const [written, setWritten] = useState<Written | null>(null);
  const [writing, setWriting] = useState(false);
  const [tab, setTab] = useState<Tab>("styles");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [docked, setDocked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [madeReady, setMadeReady] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragDepth = useRef(0);
  const slot = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  // Restore, load fonts, ask the server what's available.
  useEffect(() => {
    const s = load();
    void (async () => {
      const restored = (s.chips ?? []).filter(
        (c) => !("status" in c) || (c.status !== "uploading" && c.status !== "pulling"),
      );
      for (const c of restored) {
        if (c.kind === "logo") await preloadLogo(c.dataUrl);
        if (c.kind === "url" && c.brand?.logo) await preloadLogo(c.brand.logo);
        if (c.kind === "url" && c.brand?.font) void loadBrandFont(c.brand.font, "Inter");
      }
      setChips(restored);
      if (typeof s.text === "string") setText(s.text);
      if (typeof s.seconds === "number" && s.seconds >= 3 && s.seconds <= 60)
        setSeconds(Math.round(s.seconds));
      if (typeof s.enhance === "boolean") setEnhance(s.enhance);
      if (s.target) setTarget(s.target);
    })();
    void loadFonts(stylesFonts(STYLES));
    api.status().then(setStatus, () => setStatus(null));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const small = chips.map((c) =>
        c.kind === "logo" || c.kind === "image"
          ? c.dataUrl.length > 1_500_000
            ? { ...c, dataUrl: "" }
            : c
          : c,
      );
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ text, chips: small, seconds, enhance, target } satisfies Saved),
      );
    } catch {
      /* storage full or blocked: the page still works, it just forgets */
    }
  }, [hydrated, text, chips, seconds, enhance, target]);

  // "Made in this video" code loads the first time it is needed.
  const needMade =
    tab === "made" ||
    chips.some((c) => c.kind === "style" && c.id.startsWith("made-")) ||
    Boolean(openId?.startsWith("made-"));
  useEffect(() => {
    if (needMade && !madeReady) void loadMadeCode().then(() => setMadeReady(true));
  }, [needMade, madeReady]);

  // Dock the box at the bottom once its home in the hero scrolls away.
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setDocked(!e.isIntersecting && e.boundingClientRect.top < 0),
      {
        threshold: 0,
        rootMargin: "-40px 0px 0px 0px",
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Keep the box's home the same height while it is docked (no layout jump).
  useEffect(() => {
    const el = dock.current;
    if (!el || docked) return;
    const keep = () => {
      if (slot.current) slot.current.style.minHeight = `${el.offsetHeight}px`;
    };
    keep();
    const ro = new ResizeObserver(keep);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docked]);
  useEffect(() => {
    const set = () => {
      const r = page.current?.getBoundingClientRect();
      if (!r) return;
      document.documentElement.style.setProperty("--ml-dock-left", `${r.left + r.width / 2}px`);
      document.documentElement.style.setProperty(
        "--ml-dock-width",
        `${Math.min(820, r.width - 32)}px`,
      );
    };
    set();
    window.addEventListener("resize", set);
    const ro = new ResizeObserver(set);
    if (page.current) ro.observe(page.current);
    return () => {
      window.removeEventListener("resize", set);
      ro.disconnect();
    };
  }, []);

  // ── brand: a link's brand, else the logo's colours; the logo itself on top ──
  const brand = useMemo<Theme | null>(() => {
    const url = chips.find((c) => c.kind === "url" && c.status === "brand" && c.brand);
    const logo = chips.find((c) => c.kind === "logo" && c.status === "ready");
    const base =
      url && url.kind === "url"
        ? (url.brand ?? null)
        : logo && logo.kind === "logo"
          ? (logo.theme ?? null)
          : null;
    const mark = logo && logo.kind === "logo" ? logo.dataUrl : null;
    if (base) return { ...base, logo: mark ?? base.logo ?? null };
    if (mark) return null;
    return null;
  }, [chips]);
  const logoMark = useMemo(() => {
    const logo = chips.find((c) => c.kind === "logo" && c.status === "ready");
    return logo && logo.kind === "logo" ? logo.dataUrl : null;
  }, [chips]);

  const themes = useMemo(() => {
    const map = new Map<string, Theme>();
    for (const s of STYLES) {
      const base = brand ?? s.theme;
      map.set(s.id, { ...base, logo: logoMark ?? brand?.logo ?? null });
    }
    return map;
  }, [brand, logoMark]);

  const assets: PromptAsset[] = useMemo(
    () =>
      chips.flatMap((c): PromptAsset[] =>
        (c.kind === "logo" || c.kind === "image" || c.kind === "video") &&
        c.status === "ready" &&
        c.path
          ? [
              {
                name: c.path.split("/").pop() || c.name,
                path: c.path,
                kind: c.kind,
                frames: c.kind === "video" ? c.frames : undefined,
              },
            ]
          : [],
      ),
    [chips],
  );
  const urls = useMemo(
    () => chips.flatMap((c) => (c.kind === "url" && c.status !== "pulling" ? [c.url] : [])),
    [chips],
  );
  const pickedIds = useMemo(
    () => chips.flatMap((c) => (c.kind === "style" ? [c.id] : [])),
    [chips],
  );
  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds]);

  const promptOf = useCallback(
    (id: string) => {
      const { style, made } = resolve(id);
      if (made) return made.prompt;
      if (!style) return "";
      return fillPrompt(style, themes.get(style.id) ?? style.theme, assets);
    },
    [themes, assets],
  );

  const copyPrompt = useCallback(
    async (id: string) => {
      const ok = await copyText(promptOf(id));
      const name = resolve(id).style?.name ?? "Style";
      notify(ok ? `${name} prompt copied.` : "Couldn't reach the clipboard.");
      return ok;
    },
    [promptOf, notify],
  );

  // ── chips ──
  const togglePick = useCallback((id: string, thumb: string | null) => {
    setChips((cs) => {
      if (cs.some((c) => c.kind === "style" && c.id === id))
        return cs.filter((c) => !(c.kind === "style" && c.id === id));
      const { style, made } = resolve(id);
      const name = made?.name ?? style?.name ?? id;
      return [...cs, { kind: "style", key: newKey(), id, name, thumb }];
    });
  }, []);
  const addPick = useCallback(
    (id: string) => {
      if (pickedSet.has(id)) return;
      const canvas = document.querySelector<HTMLCanvasElement>(
        `[data-item="${CSS.escape(id)}"] canvas`,
      );
      const video = document.querySelector<HTMLVideoElement>(
        `[data-item="${CSS.escape(id)}"] video`,
      );
      let thumb: string | null = video?.poster ?? null;
      if (canvas && canvas.width > 1) {
        const c = document.createElement("canvas");
        c.width = 96;
        c.height = 54;
        c.getContext("2d")?.drawImage(canvas, 0, 0, 96, 54);
        thumb = c.toDataURL("image/jpeg", 0.72);
      }
      togglePick(id, thumb);
      notify(`${resolve(id).made?.name ?? resolve(id).style?.name ?? "Style"} is in your prompt.`);
    },
    [pickedSet, togglePick, notify],
  );

  const patch = useCallback((key: string, next: Partial<Chip>) => {
    setChips((cs) => cs.map((c) => (c.key === key ? ({ ...c, ...next } as Chip) : c)));
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files.slice(0, 6)) {
        const key = newKey();
        if (file.type.startsWith("video/")) {
          setChips((cs) => [
            ...cs,
            { kind: "video", key, name: file.name, status: "uploading", progress: 0 },
          ]);
          void videoPoster(file).then((poster) => patch(key, { poster }));
          try {
            const up = await api.upload(file, (k) => patch(key, { progress: k }));
            patch(key, {
              status: "ready",
              path: up.path,
              display: up.display,
              name: up.name,
              frames: up.frames,
            });
            notify(
              `${file.name} is in your prompt${up.frames.length ? `, with ${up.frames.length} key frames` : ""}.`,
            );
          } catch (e) {
            patch(key, {
              status: "error",
              error: e instanceof Error ? e.message : "Couldn't add it.",
            });
          }
          continue;
        }
        if (!file.type.startsWith("image/")) {
          notify("Drop an image, a logo or a video.");
          continue;
        }
        let dataUrl = "";
        try {
          dataUrl = await readDataUrl(file);
        } catch {
          notify("Couldn't read that file.");
          continue;
        }
        const logo = await looksLikeLogo(file, dataUrl);
        const theme = logo
          ? themeFromPalette(await paletteOf(dataUrl), nameFromFile(file.name))
          : null;
        if (logo) await preloadLogo(dataUrl);
        setChips((cs) => [
          // One logo at a time: a new logo replaces the old one.
          ...(logo ? cs.filter((c) => c.kind !== "logo") : cs),
          {
            kind: logo ? "logo" : "image",
            key,
            name: file.name,
            dataUrl,
            theme,
            status: "uploading",
            progress: 0,
          },
        ]);
        try {
          const up = await api.upload(file, (k) => patch(key, { progress: k }));
          patch(key, { status: "ready", path: up.path, display: up.display, name: up.name });
          notify(
            logo
              ? `Your logo is in: ${theme ? "every style now wears its colours" : "it appears in the styles"}, and every prompt uses it.`
              : `${file.name} is in your prompt as a reference.`,
          );
        } catch (e) {
          patch(key, {
            status: "error",
            error: e instanceof Error ? e.message : "Couldn't add it.",
          });
        }
      }
    },
    [patch, notify],
  );

  const toggleLogo = useCallback(
    async (key: string) => {
      const chip = chips.find((c) => c.key === key);
      if (!chip || (chip.kind !== "logo" && chip.kind !== "image")) return;
      if (chip.kind === "image") {
        const theme = themeFromPalette(await paletteOf(chip.dataUrl), nameFromFile(chip.name));
        await preloadLogo(chip.dataUrl);
        setChips((cs) =>
          cs
            .filter((c) => c.kind !== "logo")
            .map((c) => (c.key === key ? ({ ...c, kind: "logo", theme } as Chip) : c)),
        );
        notify("Using it as your logo.");
      } else {
        patch(key, { kind: "image" } as Partial<Chip>);
        notify("Using it as a reference image.");
      }
    },
    [chips, patch, notify],
  );

  const addUrl = useCallback(
    async (raw: string) => {
      const url = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        notify("That doesn't look like a link.");
        return;
      }
      const key = newKey();
      const video =
        /(youtube\.com|youtu\.be|x\.com|twitter\.com|vimeo\.com|instagram\.com|tiktok\.com)/i.test(
          host,
        );
      if (video) {
        setChips((cs) => [
          ...cs,
          { kind: "url", key, url, host, status: "reference", note: "Reference link" },
        ]);
        notify(`${host} link is in your prompt as a reference.`);
        return;
      }
      setChips((cs) => [
        ...cs.filter((c) => !(c.kind === "url" && c.status === "brand")),
        { kind: "url", key, url, host, status: "pulling" },
      ]);
      try {
        const r = await api.brand(url);
        const font = await loadBrandFont(r.theme.font, "Inter");
        let logo: string | null = null;
        if (r.logoUrl) logo = await drawableLogo(r.logoUrl);
        if (logo) await preloadLogo(logo);
        patch(key, {
          status: "brand",
          brand: { ...r.theme, font, logo },
          logoUrl: r.logoUrl,
          host: r.site,
        });
        notify(`Every style now wears ${r.site}.`);
      } catch (e) {
        const setup = e instanceof ApiError && Boolean(e.body.setup);
        patch(key, {
          status: "reference",
          setup,
          note: setup
            ? "Add a Firecrawl key to pull its brand"
            : e instanceof Error
              ? e.message
              : "Couldn't read it",
        });
        notify(
          setup
            ? `${host} is in your prompt. To re-skin the wall from a site, add a Firecrawl key (firecrawl.dev).`
            : `${host} is in your prompt as a reference.`,
        );
      }
    },
    [patch, notify],
  );

  const remove = useCallback(
    (key: string) => setChips((cs) => cs.filter((c) => c.key !== key)),
    [],
  );

  // ── write ──
  const fingerprint = JSON.stringify([
    text.trim(),
    pickedIds,
    assets.map((a) => a.path),
    urls,
    seconds,
    enhance,
    brand?.name ?? "",
  ]);
  const write = useCallback(async () => {
    if (writing) return;
    const picked = pickedIds
      .map((id) => resolve(id).style)
      .filter((s): s is MotionStyle => Boolean(s));
    const theme = brand ?? picked[0]?.theme ?? STYLES[0].theme;
    const started = performance.now();
    const scrollToResult = () =>
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    if (!enhance) {
      setWritten({
        prompt: composePlain({
          idea: text,
          theme,
          styles: STYLES,
          picked,
          seconds,
          urls,
          assets,
          branded: Boolean(brand),
        }),
        engine: "plain",
        ms: performance.now() - started,
        from: fingerprint,
      });
      scrollToResult();
      return;
    }
    setWriting(true);
    try {
      const r = await api.improve({
        idea: text,
        theme,
        styleIds: pickedIds,
        urls,
        assets,
        seconds,
        branded: Boolean(brand),
      });
      setWritten({ ...r, from: fingerprint });
      scrollToResult();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't write the prompt.");
    } finally {
      setWriting(false);
    }
  }, [writing, pickedIds, brand, enhance, text, seconds, urls, assets, fingerprint, notify]);

  // ── the wall ──
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of STYLES) if (s.family) counts.set(s.family, (counts.get(s.family) ?? 0) + 1);
    return [...counts.entries()];
  }, []);
  const q = query.trim().toLowerCase();
  const visibleStyles = useMemo(() => {
    if (stress && stress > STYLES.length)
      return Array.from({ length: stress }, (_, i) => STYLES[i % STYLES.length]);
    const inFamily = family ? STYLES.filter((s) => s.family === family) : STYLES;
    if (!q) return inFamily;
    return inFamily.filter((s) =>
      [s.name, s.tagline ?? "", s.look, s.move, s.family ?? "", ...(s.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [q, stress, family]);
  const visibleMade = useMemo(
    () =>
      q
        ? MADE.filter((m) =>
            [m.name, m.tagline, m.group, m.prompt].join(" ").toLowerCase().includes(q),
          )
        : MADE,
    [q],
  );
  const visibleInsp = useMemo(
    () =>
      q
        ? INSPIRATION.filter((i) =>
            [i.title, i.blurb, i.author, i.handle, i.platform].join(" ").toLowerCase().includes(q),
          )
        : INSPIRATION,
    [q],
  );

  // ── detail ──
  const detail = useMemo<DetailItem | null>(() => {
    if (!openId) return null;
    const { style, made } = resolve(openId);
    if (made)
      return {
        id: openId,
        kicker: `Made in this video · ${made.group}`,
        name: made.name,
        look: made.tagline,
        rules: [],
        prompt: made.prompt,
        style: made.style,
        video:
          made.source.kind === "video"
            ? { src: made.source.src, poster: made.source.poster }
            : undefined,
        exportable: false,
        aspects: made.source.kind === "scene",
      };
    if (!style) return null;
    const i = STYLES.indexOf(style);
    return {
      id: openId,
      kicker: `No. ${String(i + 1).padStart(2, "0")} · ${brand ? "Your brand" : (style.family ?? "Motion style")}`,
      name: style.name,
      look: style.look,
      move: style.move,
      rules: style.rules,
      prompt: fillPrompt(style, themes.get(style.id) ?? style.theme, assets),
      ref: style.ref,
      style,
      exportable: true,
      aspects: true,
    };
  }, [openId, brand, themes, assets]);

  const described = text.trim().length >= 3;
  const added = chips.some((c) => c.kind !== "style");
  const counts = { styles: STYLES.length, made: MADE.length, inspiration: INSPIRATION.length };

  return (
    <div
      ref={page}
      className="ml-page"
      data-ready={hydrated ? "1" : undefined}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        const files = [...(e.dataTransfer.files ?? [])];
        if (!files.length) return;
        e.preventDefault();
        void addFiles(files);
      }}
    >
      <HeroBeam anchor={slot} />
      <header className="ml-hero">
        <h1>
          Unlimited motion <span className="ml-grad">styles</span>
        </h1>
        <div className="ml-slot" ref={slot}>
          <div className={`ml-dock ${docked ? "docked" : ""}`} ref={dock}>
            <Composer
              text={text}
              setText={setText}
              chips={chips}
              onRemove={remove}
              onToggleLogo={(k) => void toggleLogo(k)}
              onFiles={(f) => void addFiles(f)}
              onUrl={(u) => void addUrl(u)}
              onItem={addPick}
              onOpenChip={(id) => onSelect(id)}
              seconds={seconds}
              setSeconds={setSeconds}
              enhance={enhance}
              setEnhance={setEnhance}
              target={target}
              setTarget={setTarget}
              status={status}
              writing={writing}
              onWrite={() => {
                void write();
              }}
              docked={docked}
            />
          </div>
        </div>
        <Steps picked={pickedIds.length > 0} described={described} added={added} />
      </header>

      {written && (
        <section className="ml-result" ref={resultRef} aria-live="polite">
          <div className="ml-result-head">
            <div>
              <h3>Your prompt</h3>
              <small>
                {seconds} s ·{" "}
                {written.engine === "claude"
                  ? `Enhanced by Claude Code in ${(written.ms / 1000).toFixed(1)} s`
                  : written.engine === "template"
                    ? "Enhanced by the built-in writer"
                    : "Your words, as written"}
                {written.from !== fingerprint
                  ? " · The box has changed: write it again to update"
                  : ""}
                {written.note ? ` · ${written.note}` : ""}
              </small>
            </div>
            <OpenActions
              name={
                pickedIds.length
                  ? (resolve(pickedIds[0]).style?.name ?? "motion")
                  : text.split(/\s+/).slice(0, 6).join(" ") || "motion"
              }
              prompt={written.prompt}
              assets={assets}
              target={target}
              status={status}
              notify={notify}
            />
          </div>
          <RiseView text={written.prompt} />
        </section>
      )}

      <div className="ml-wall-head">
        <div className="ml-tabs" role="tablist" aria-label="Collections">
          {(
            [
              ["styles", "Styles"],
              ["made", "Made in this video"],
              ["inspiration", "Inspiration"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className="ml-tab"
              onClick={() => setTab(id)}
            >
              {label}
              <span>{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="ml-tools">
          <div className="ml-search">
            <Search size={14} aria-hidden="true" />
            <label className="sr-only" htmlFor="ml-search">
              Search
            </label>
            <input
              id="ml-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
            />
          </div>
          {tab === "styles" && families.length > 1 && (
            <>
              <label className="sr-only" htmlFor="ml-family">
                Family
              </label>
              <select
                id="ml-family"
                className="ml-select"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
              >
                <option value="">All families</option>
                {families.map(([name, n]) => (
                  <option key={name} value={name}>
                    {name} · {n}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {tab === "styles" && (
        <>
          <div className="ml-wall">
            {visibleStyles.map((s, i) => (
              <LiveTile
                key={stress ? `${s.id}:${i}` : s.id}
                style={s}
                itemId={s.id}
                index={STYLES.indexOf(s)}
                theme={themes.get(s.id) ?? s.theme}
                badge={FEATURED.has(s.id) ? "Featured" : undefined}
                selected={pickedSet.has(s.id)}
                promptOf={promptOf}
                ensureRunner={ensureRunner}
                onToggle={togglePick}
                onOpen={onSelect}
                onCopy={copyPrompt}
              />
            ))}
          </div>
          {!visibleStyles.length && <p className="ml-empty">No style matches “{query}”.</p>}
        </>
      )}

      {tab === "made" && (
        <>
          <p className="ml-lede">
            Every piece made for the video, with the prompt that made it. The story loops and the
            coffee B-roll run live, in code.
          </p>
          <div className="ml-wall">
            {visibleMade.map((m, i) =>
              m.style ? (
                <LiveTile
                  key={m.id}
                  style={m.style}
                  itemId={`made-${m.id}`}
                  index={i}
                  theme={m.style.theme}
                  badge={m.group}
                  selected={pickedSet.has(`made-${m.id}`)}
                  promptOf={promptOf}
                  ensureRunner={ensureRunner}
                  onToggle={togglePick}
                  onOpen={onSelect}
                  onCopy={copyPrompt}
                />
              ) : (
                <MadeVideoTile
                  key={m.id}
                  item={m}
                  index={i}
                  selected={pickedSet.has(`made-${m.id}`)}
                  onToggle={togglePick}
                  onOpen={onSelect}
                  onCopy={copyPrompt}
                />
              ),
            )}
          </div>
          {!madeReady && <p className="ml-empty">Loading the live pieces…</p>}
        </>
      )}

      {tab === "inspiration" && (
        <>
          <p className="ml-lede">
            Great motion drawn in code, by other people. Links and official embeds only, with
            credit.
          </p>
          <div className="ml-insp-grid">
            {visibleInsp.map((item) => (
              <InspirationCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {detail && (
        <ItemDetail
          item={detail}
          theme={
            detail.style && !detail.id.startsWith("made-")
              ? (themes.get(detail.style.id) ?? detail.style.theme)
              : (detail.style?.theme ?? STYLES[0].theme)
          }
          branded={Boolean(brand)}
          selected={pickedSet.has(detail.id)}
          onToggle={() => {
            if (pickedSet.has(detail.id))
              setChips((cs) => cs.filter((c) => !(c.kind === "style" && c.id === detail.id)));
            else addPick(detail.id);
          }}
          assets={assets}
          target={target}
          status={status}
          ensureRunner={ensureRunner}
          notify={notify}
          onClose={() => onSelect(undefined)}
        />
      )}

      {dragging && (
        <div className="ml-dropzone" aria-hidden="true">
          <div>
            <ImageUp size={28} />
            Drop it into your prompt
            <small>A logo re-skins every style · images and videos become references</small>
          </div>
        </div>
      )}
      {toast && (
        <div className="ml-toast" role="status" aria-live="polite">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
