import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./ambient-video.css";

/** Two muted copies overlap at the loop boundary so a cut in the source never flashes. */
export function AmbientVideo({
  src,
  poster,
  className = "",
  label = "Background animation",
  controls = true,
}: {
  src: string;
  poster: string;
  className?: string;
  label?: string;
  controls?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const videos = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const pausedRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const [enabled, setEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setFailed(false);
    setReady(false);
  }, [src]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current();
  }, [paused]);
  useEffect(() => {
    const container = root.current;
    const elements = videos.current;
    if (!container || !enabled || failed || elements.some((element) => !element)) return;
    const pair = [...elements] as [HTMLVideoElement, HTMLVideoElement];
    let visible = false,
      disposed = false,
      active = 0,
      frame = 0;
    let transitioning = false,
      starting = false,
      progress = 0,
      previousFrame = 0;
    let fadeSeconds = 0.8;
    const canPlay = () => visible && !document.hidden && !pausedRef.current && !disposed;
    const show = () => {
      pair.forEach((element, index) => {
        element.style.zIndex = index === active ? "1" : "2";
        element.style.opacity = index === active ? "1" : "0";
      });
    };
    pair.forEach((element) => {
      element.muted = true;
      element.style.opacity = "0";
    });
    const startTransition = () => {
      if (starting || transitioning || !canPlay()) return;
      const incoming = pair[1 - active];
      if (incoming.readyState < 2) return;
      starting = true;
      fadeSeconds = Math.min(0.8, (pair[active].duration || 2.4) / 3);
      incoming
        .play()
        .then(() => {
          starting = false;
          if (disposed) return;
          transitioning = true;
          progress = 0;
          previousFrame = performance.now();
          if (!canPlay()) incoming.pause();
        })
        .catch(() => {
          starting = false;
        });
    };
    const tick = (now: number) => {
      frame = 0;
      if (!canPlay()) return;
      const outgoing = pair[active],
        incoming = pair[1 - active];
      if (transitioning) {
        progress = Math.min(
          1,
          progress + Math.min((now - previousFrame) / 1000, 0.1) / fadeSeconds,
        );
        // Smoothstep keeps the start/end of the blend gentle without a second CSS transition.
        incoming.style.opacity = String(progress * progress * (3 - 2 * progress));
        if (progress >= 1) {
          outgoing.pause();
          outgoing.style.opacity = "0";
          try {
            outgoing.currentTime = 0;
          } catch {
            /* Metadata may not be available yet. */
          }
          active = 1 - active;
          transitioning = false;
          show();
        }
      } else if (
        Number.isFinite(outgoing.duration) &&
        outgoing.duration > 0 &&
        outgoing.duration - outgoing.currentTime <= Math.min(0.8, outgoing.duration / 3)
      ) {
        startTransition();
      }
      previousFrame = now;
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!canPlay()) {
        pair.forEach((element) => element.pause());
        cancelAnimationFrame(frame);
        frame = 0;
        previousFrame = 0;
        return;
      }
      const playing = pair[active];
      if (!playing.ended)
        playing
          .play()
          .then(() => {
            if (disposed) return;
            if (!canPlay()) {
              playing.pause();
              return;
            }
            if (!transitioning) show();
            setReady(true);
          })
          .catch(() => {});
      else startTransition();
      if (transitioning) pair[1 - active].play().catch(() => {});
      previousFrame = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    syncRef.current = sync;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { rootMargin: "80px" },
    );
    observer.observe(container);
    pair.forEach((element) => element.addEventListener("canplay", sync));
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      syncRef.current = () => {};
      observer.disconnect();
      cancelAnimationFrame(frame);
      pair.forEach((element) => {
        element.removeEventListener("canplay", sync);
        element.pause();
      });
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, failed, src]);
  return (
    <div ref={root} className={`biz-ambient-video ${className}`} data-loop="crossfade">
      <img src={poster} alt="" loading="lazy" aria-hidden="true" />
      {enabled &&
        !failed &&
        [0, 1].map((index) => (
          <video
            key={`${src}:${index}`}
            ref={(element) => {
              videos.current[index] = element;
            }}
            src={src}
            poster={poster}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            className={ready ? "is-ready" : ""}
            onError={() => setFailed(true)}
          />
        ))}
      {controls && enabled && !failed && (ready || paused) && (
        <button
          type="button"
          className="biz-ambient-control"
          aria-label={`${paused ? "Play" : "Pause"} ${label.toLowerCase()}`}
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      )}
    </div>
  );
}
