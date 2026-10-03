import { useEffect, useRef, useState } from "react";

type Film = { src: string; poster: string };

/** One looping take. Plays forward only; never reverses frames or animates the still image. */
function FilmLayer({ film, active, motion }: { film: Film; active: boolean; motion: boolean }) {
  const root = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [film.src]);
  useEffect(() => {
    const player = video.current, container = root.current;
    if (!motion || !player || !container || failed) return;
    let visible = true, disposed = false;
    const sync = () => {
      if (disposed || !visible || !active || document.hidden) player.pause();
      else void player.play().then(() => { if (disposed || !visible || !active || document.hidden) player.pause(); }).catch(() => {});
    };
    player.muted = true; player.playbackRate = 1;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(container); player.addEventListener("canplay", sync); document.addEventListener("visibilitychange", sync); sync();
    return () => { disposed = true; observer.disconnect(); player.pause(); player.removeEventListener("canplay", sync); document.removeEventListener("visibilitychange", sync); };
  }, [film.src, motion, failed, active]);
  return <div ref={root} className="ws-film-layer" data-active={active}>
    <img src={film.poster} alt="" />
    {motion && !failed && <video ref={video} src={film.src} poster={film.poster} autoPlay muted playsInline loop preload="auto" onError={() => setFailed(true)} />}
  </div>;
}

/** Crossfades between takes when the section changes, so the film never hard-cuts. */
export function SetupLandscape({ src, poster }: { src: string; poster: string }) {
  const [motion, setMotion] = useState(false);
  const [layers, setLayers] = useState<Film[]>([{ src, poster }]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setLayers(current => current[current.length - 1]?.src === src ? current : [...current.slice(-1), { src, poster }]);
    const timer = window.setTimeout(() => setLayers(current => current.length > 1 ? current.slice(-1) : current), 1500);
    return () => window.clearTimeout(timer);
  }, [src, poster]);
  return <div className="ws-calm-film ws-forward-landscape" aria-hidden="true">
    {layers.map((film, index) => <FilmLayer key={film.src} film={film} active={index === layers.length - 1} motion={motion} />)}
  </div>;
}
