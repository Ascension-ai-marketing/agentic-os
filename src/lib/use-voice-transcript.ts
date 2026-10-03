import { useEffect, useRef, useState } from "react";
import { operatorRequest } from "./operator";
import {
  createVoiceTranscriptStore,
  type VoiceSaveState,
  type VoiceTranscript,
  type VoiceTurnContext,
} from "./voice-transcript-store";

export function useVoiceTranscript() {
  const [saveState, setSaveState] = useState<VoiceSaveState>({
    status: "idle",
    pending: 0,
    backupAvailable: true,
    message: "",
  });
  const store = useRef<ReturnType<typeof createVoiceTranscriptStore> | null>(null);
  useEffect(() => {
    let mounted = true;
    const current = createVoiceTranscriptStore({
      // Access storage lazily so disabled browser storage still permits server saves.
      storage: {
        get length() {
          return localStorage.length;
        },
        key: (i) => localStorage.key(i),
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: (key) => localStorage.removeItem(key),
      },
      save: (snapshot) =>
        operatorRequest<{ conversation: VoiceTranscript }>("/conversations", snapshot),
      onChange: (state) => {
        if (mounted) setSaveState(state);
      },
      onSaved: () => window.dispatchEvent(new Event("operator:conversations-changed")),
    });
    store.current = current;
    current.restore();
    const flush = () => {
      void current.flush();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted = false;
      current.dispose();
      if (store.current === current) store.current = null;
      window.removeEventListener("online", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return {
    saveState,
    append: (
      role: "user" | "assistant",
      text: string,
      context: VoiceTurnContext,
      engine: "openai" | "elevenlabs" | "browser",
    ) => store.current?.append(role, text, context, engine),
    flush: () => store.current?.flush(),
    retry: () => store.current?.flush(),
    saveCopy: () => store.current?.saveConflictCopy(),
    newConversation: () => store.current?.newConversation(),
  };
}
