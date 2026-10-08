// Mounted once for the whole OS: wires the word "Jarvis" to the Jarvis
// conversation, and keeps the detector off the microphone while any other
// voice in the OS is listening or speaking.
import { useEffect } from "react";
import { startCeoVoice, stopCeoVoice, useCeoVoice } from "./ceo-voice";
import { useLiveVoice } from "./live-voice";
import { useVoice } from "./voice-store";
import { holdWake, releaseWake, restoreWake, setWakeHandler } from "./wake-word";

export function JarvisWake() {
  const live = useLiveVoice();
  const voice = useVoice();
  const jarvis = useCeoVoice();
  useEffect(() => {
    setWakeHandler(() => void startCeoVoice());
    restoreWake();
    return () => setWakeHandler(null);
  }, []);
  // Live voice in Chat takes over: the two never share the microphone.
  const liveOn = live.phase !== "off";
  useEffect(() => {
    if (liveOn) stopCeoVoice();
  }, [liveOn]);
  // Push-to-talk listening and any spoken reply (which may itself say "Jarvis").
  const busy = liveOn || (jarvis.phase === "off" && (voice.mood === "listening" || voice.mood === "speaking"));
  useEffect(() => {
    if (busy) holdWake("os-voice");
    else releaseWake("os-voice");
  }, [busy]);
  return null;
}
