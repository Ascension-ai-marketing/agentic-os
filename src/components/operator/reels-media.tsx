import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { jevFetch } from "@/lib/jev-client";

export function useReelMedia(id?: string, file?: string, enabled = true) {
  const [asset, setAsset] = useState({ url: "", error: false });
  useEffect(() => {
    setAsset({ url: "", error: false });
    if (!id || !file || !enabled) return;
    const controller = new AbortController(); let objectUrl = "";
    void jevFetch(`/__reels/media?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`, { signal: controller.signal })
      .then(response => response.blob()).then(blob => {
        if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setAsset({ url: objectUrl, error: false }); }
      }).catch(() => { if (!controller.signal.aborted) setAsset({ url: "", error: true }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, file, enabled]);
  return asset;
}

/** Fetch only nearby media; play only while the preview and document are visible. */
export function ReelVideo({ id, file, label, playing = true, muted = true, register, onTime, onReady, onBlocked }: {
  id: string; file?: string; label: string; playing?: boolean; muted?: boolean;
  register?: (video: HTMLVideoElement | null) => void;
  onTime?: (seconds: number) => void; onReady?: (video: HTMLVideoElement) => void; onBlocked?: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement | null>(null);
  const [nearby, setNearby] = useState(false), [visible, setVisible] = useState(false), [pageVisible, setPageVisible] = useState(true);
  const { url, error } = useReelMedia(id, file, nearby);
  useEffect(() => {
    const element = holder.current; if (!element) return;
    const loadObserver = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNearby(true); }, { rootMargin: "180px" });
    const playObserver = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.25), { threshold: [0, 0.25] });
    loadObserver.observe(element); playObserver.observe(element);
    const visibility = () => setPageVisible(!document.hidden); visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { loadObserver.disconnect(); playObserver.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const shouldPlay = playing && visible && pageVisible;
  useEffect(() => {
    const element = video.current; if (!element || !url) return;
    if (shouldPlay) void element.play().catch(error => { if (error?.name === "NotAllowedError") onBlocked?.(); });
    else element.pause();
  }, [shouldPlay, url, onBlocked]);
  return <div ref={holder} className="rs-media">
    {url ? <video ref={element => { video.current = element; register?.(element); }} src={url} muted={muted} autoPlay={shouldPlay} loop playsInline preload="metadata" aria-label={label} onLoadedMetadata={event => onReady?.(event.currentTarget)} onTimeUpdate={event => onTime?.(event.currentTarget.currentTime)} />
      : <span className="rs-media-loading">{file && !error ? <Loader2 size={22} className="rs-spin" /> : <Film size={28} />}<span>{error ? "Preview unavailable" : file ? "Loading video" : "Ready after build"}</span></span>}
  </div>;
}
