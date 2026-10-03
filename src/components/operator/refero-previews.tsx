import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const previews = [
  {
    name: "Apple",
    url: "https://styles.refero.design/style/aecac5da-f397-4ddf-b71f-de1efc434cb8",
    video:
      "https://images.refero.design/styles/refero.design/video/1f887521-04e4-41f5-ba4f-ef578bd2940b.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/db890fdc-1c11-4b3e-8775-038a56523506.jpg",
  },
  {
    name: "Origin Financial",
    url: "https://styles.refero.design/style/c60f05ff-2420-4a24-92db-80c4b6a74683",
    video:
      "https://images.refero.design/styles/refero.design/video/b2af7366-6d7f-41ac-8985-4356cd39a16e.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/02d9c19b-b2e4-4d9a-805d-22ff505c31e0.jpg",
  },
  {
    name: "Dala",
    url: "https://styles.refero.design/style/e5f5f8cf-e68d-4ed1-bbf5-6b67569af648",
    video:
      "https://images.refero.design/styles/refero.design/video/7a543157-32e3-4e97-a93d-eeb756b07446.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/ce90970d-badf-402a-ad3d-10b7ef36f46e.jpg",
  },
  {
    name: "ThoughtLab",
    url: "https://styles.refero.design/style/82d52a5f-b1bb-4a69-91a3-15a7eb8bbe99",
    video:
      "https://images.refero.design/styles/refero.design/video/aa4d859d-fd3b-4a72-a75f-ec4be35fcb99.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/86e7ce83-4caa-4348-90a0-20811a956baa.jpg",
  },
  {
    name: "Hyer Aviation",
    url: "https://styles.refero.design/style/f61cf515-ccd5-4494-bdd1-be9fe4d7258c",
    video:
      "https://images.refero.design/styles/refero.design/video/b2ceae78-314c-4107-b6aa-3409fb452ec9.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/2447f501-c210-4916-bd62-7a697394f205.jpg",
  },
  {
    name: "Superpower",
    url: "https://styles.refero.design/style/5d34568d-4bdc-445d-a527-c6f5249fa8fb",
    video:
      "https://images.refero.design/styles/refero.design/video/1ba8edaf-540d-40d1-8ced-4ba05263e616.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/9712ccd3-ad86-40ee-8d00-92571490fe81.jpg",
  },
  {
    name: "Ui",
    url: "https://styles.refero.design/style/0fd67ec5-7e9c-4ca9-b368-5d9c7388477a",
    video:
      "https://images.refero.design/styles/refero.design/video/ae9e46cc-557b-4278-ba07-dbf06729f722.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/bc96909d-3b1a-4a95-a2e5-93587a842c81.jpg",
  },
  {
    name: "Duolingo",
    url: "https://styles.refero.design/style/7088d695-362b-4e09-b325-fa8136d4f350",
    video:
      "https://images.refero.design/styles/refero.design/video/15d4f4fc-0d36-4f22-bb4c-790b0b2951eb.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/81d97a69-fb9f-4a0a-aeeb-89e3fcc503f6.jpg",
  },
  {
    name: "Vivid+Co",
    url: "https://styles.refero.design/style/8875b14e-c59a-492f-8780-8027a480f21c",
    video:
      "https://images.refero.design/styles/refero.design/video/4830086b-49f9-48a0-865e-aac393a9c3ab.mp4",
    poster:
      "https://images.refero.design/styles/refero.design/image/0baab439-ae90-42ec-97d6-a7b93e3b6c90.jpg",
  },
];

function PreviewVideo({
  preview,
  playing,
}: {
  preview: (typeof previews)[number];
  playing: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // The clipped carousel and page viewport both count: offscreen videos do not play.
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting) setLoaded(true);
      },
      { threshold: 0.05 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (loaded && visible && playing) {
      void element.play().catch(() => {
        /* Keep the poster when autoplay is unavailable. */
      });
    } else {
      element.pause();
    }
    return () => element.pause();
  }, [loaded, visible, playing]);
  return (
    <video
      ref={video}
      src={loaded ? preview.video : undefined}
      poster={preview.poster}
      muted
      loop
      playsInline
      preload="none"
      aria-label={`${preview.name} website preview`}
      tabIndex={-1}
    />
  );
}

export function ReferoPreviews() {
  const showcase = useRef<HTMLElement>(null);
  const viewports = useRef<Array<HTMLDivElement | null>>([]);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [inView, setInView] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setPaused(true);
    };
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateMotion();
    updateVisibility();
    setReady(true);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.01,
    });
    if (showcase.current) observer.observe(showcase.current);
    preference.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  const mediaPlaying = ready && inView && !paused && pageVisible;
  // Start the CSS tracks with the first paint. Video readiness and intersection
  // only control media downloads/playback, not the row movement.
  const playing = !paused && pageVisible && !focused;
  const manual = browsing || focused || reducedMotion;
  const rows = [previews.slice(0, 5), previews.slice(5)];
  function browse(direction: number) {
    setBrowsing(true);
    requestAnimationFrame(() => {
      for (const viewport of viewports.current) {
        viewport?.scrollBy({
          left:
            direction * ((viewport.querySelector("li")?.getBoundingClientRect().width || 400) + 14),
          behavior: reducedMotion ? "instant" : "smooth",
        });
      }
    });
  }
  function togglePlayback() {
    if (paused || browsing) {
      setPaused(false);
      setBrowsing(false);
      for (const viewport of viewports.current) if (viewport) viewport.scrollLeft = 0;
    } else {
      setPaused(true);
    }
  }
  return (
    <section ref={showcase} className="ar-site-showcase" aria-labelledby="site-showcase-title">
      <div className="ar-site-showcase-heading">
        <h2 id="site-showcase-title">Websites in motion</h2>
        <div className="ar-site-showcase-controls">
          <button type="button" onClick={() => browse(-1)} aria-label="Previous website previews">
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={paused || browsing ? "Play website previews" : "Pause website previews"}
            aria-pressed={paused || browsing}
          >
            {paused || browsing ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button type="button" onClick={() => browse(1)} aria-label="Next website previews">
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div className="ar-site-showcase-rows">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            ref={(element) => {
              viewports.current[rowIndex] = element;
            }}
            className="ar-site-showcase-window"
            data-manual={manual}
            onFocusCapture={(event) => {
              const target = event.target as HTMLElement;
              if (!target.matches(":focus-visible")) return;
              setFocused(true);
              // Keyboard users get stable, scrollable cards instead of moving targets.
              requestAnimationFrame(() =>
                target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" }),
              );
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setFocused(false);
            }}
            onTouchStart={() => setBrowsing(true)}
          >
            <div
              className="ar-site-showcase-track"
              data-direction={rowIndex === 0 ? "right" : "left"}
              data-playing={playing}
              data-manual={manual}
            >
              {[false, true].map((duplicate) => (
                <ul
                  className="ar-site-showcase-group"
                  key={String(duplicate)}
                  aria-label={duplicate ? undefined : `Website previews, row ${rowIndex + 1}`}
                  aria-hidden={duplicate || undefined}
                >
                  {row.map((preview) => (
                    <li key={preview.url}>
                      <a
                        href={preview.url}
                        target="_blank"
                        rel="noreferrer"
                        tabIndex={duplicate ? -1 : undefined}
                        aria-label={`View ${preview.name} on Refero`}
                      >
                        <div className="ar-site-showcase-screen">
                          <PreviewVideo preview={preview} playing={mediaPlaying} />
                          <span className="ar-site-showcase-visit" aria-hidden="true">
                            <ArrowUpRight size={18} />
                          </span>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="ar-site-showcase-credit">
        <a href="https://styles.refero.design/" target="_blank" rel="noreferrer">
          Via Refero <ArrowUpRight size={11} />
        </a>
      </div>
    </section>
  );
}
