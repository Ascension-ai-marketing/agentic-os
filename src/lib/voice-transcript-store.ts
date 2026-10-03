export const VOICE_TRANSCRIPT_PREFIX = "agentic.voice.pending.v1.";
const MAX_MESSAGES = 450;
const MAX_TEXT = 600000;
const MAX_CONVERSATION_TEXT = 1000000;
export type VoiceTranscriptMessage = {
  role: "user" | "oracle";
  text: string;
  brainRevision: number;
  contextKey?: string;
  contextReusable: boolean;
  sourceIds?: string[];
  via: string;
};
export type VoiceTranscript = {
  id: string;
  revision: number;
  title: string;
  messages: VoiceTranscriptMessage[];
  persona: "assistant";
};
export type VoiceTurnContext = {
  brainRevision?: number;
  contextKey?: string;
  sourceIds?: string[];
  contextReusable?: boolean;
};
type Pending = {
  latest: VoiceTranscript;
  attempt?: VoiceTranscript;
  conflict?: boolean;
  replaces?: string[];
};
export type VoiceSaveState = {
  status: "idle" | "saving" | "saved" | "error" | "conflict";
  pending: number;
  backupAvailable: boolean;
  message: string;
  savedId?: string;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Options = {
  storage: Storage;
  save: (snapshot: VoiceTranscript) => Promise<{ conversation: VoiceTranscript }>;
  onChange?: (state: VoiceSaveState) => void;
  onSaved?: (id: string) => void;
  uuid?: () => string;
  debounceMs?: number;
};
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);

function validSnapshot(value: unknown): value is VoiceTranscript {
  const v = value as VoiceTranscript;
  return (
    !!v &&
    validId(v.id) &&
    Number.isInteger(v.revision) &&
    v.revision >= 0 &&
    typeof v.title === "string" &&
    v.title.length <= 120 &&
    v.persona === "assistant" &&
    Array.isArray(v.messages) &&
    v.messages.length > 0 &&
    v.messages.length <= MAX_MESSAGES &&
    v.messages.every(
      (m) =>
        !!m &&
        ["user", "oracle"].includes(m.role) &&
        typeof m.text === "string" &&
        m.text.length <= MAX_TEXT &&
        Number.isInteger(m.brainRevision) &&
        m.brainRevision >= 0 &&
        (m.contextKey === undefined || /^chat1:[01]:[01]{6}$/.test(m.contextKey)) &&
        typeof m.contextReusable === "boolean" &&
        (!m.contextReusable || !!m.contextKey) &&
        (!m.sourceIds ||
          (Array.isArray(m.sourceIds) &&
            m.sourceIds.length <= 100 &&
            m.sourceIds.every((id) => typeof id === "string" && id.length <= 300))) &&
        typeof m.via === "string" &&
        m.via.startsWith("Jarvis · "),
    ) &&
    v.messages.reduce((sum, m) => sum + m.text.length, 0) <= MAX_CONVERSATION_TEXT
  );
}
function snapshotOnly(value: VoiceTranscript): VoiceTranscript {
  return {
    id: value.id,
    revision: value.revision,
    title: value.title,
    persona: "assistant",
    messages: value.messages.map(
      ({ role, text, brainRevision, contextKey, contextReusable, sourceIds, via }) => ({
        role,
        text,
        brainRevision,
        contextKey,
        contextReusable,
        sourceIds,
        via,
      }),
    ),
  };
}

/** Local transcript persistence only. Nothing here is sent to a model or indexed as Memory. */
export function createVoiceTranscriptStore(options: Options) {
  const pending = new Map<string, Pending>();
  const uuid = options.uuid || (() => crypto.randomUUID());
  let active: VoiceTranscript | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let backupAvailable = true;
  let state: VoiceSaveState = { status: "idle", pending: 0, backupAvailable: true, message: "" };
  const emit = (patch: Partial<VoiceSaveState>) => {
    state = { ...state, ...patch, pending: pending.size, backupAvailable };
    options.onChange?.(state);
  };
  function backup(entry: Pending) {
    try {
      options.storage.setItem(VOICE_TRANSCRIPT_PREFIX + entry.latest.id, JSON.stringify(entry));
    } catch {
      backupAvailable = false;
    }
  }
  function removeBackup(id: string) {
    try {
      options.storage.removeItem(VOICE_TRANSCRIPT_PREFIX + id);
    } catch {
      backupAvailable = false;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, options.debounceMs ?? 350);
  }
  function restore() {
    try {
      const keys = Array.from({ length: options.storage.length }, (_, i) =>
        options.storage.key(i),
      ).filter((key): key is string => !!key?.startsWith(VOICE_TRANSCRIPT_PREFIX));
      for (const key of keys) {
        try {
          const record = JSON.parse(options.storage.getItem(key) || "null") as Pending;
          if (
            !validSnapshot(record?.latest) ||
            key !== VOICE_TRANSCRIPT_PREFIX + record.latest.id ||
            (record.attempt &&
              (!validSnapshot(record.attempt) || record.attempt.id !== record.latest.id))
          )
            continue;
          pending.set(record.latest.id, {
            latest: snapshotOnly(record.latest),
            ...(record.attempt ? { attempt: snapshotOnly(record.attempt) } : {}),
            conflict: record.conflict === true,
            replaces: record.replaces?.filter(validId).slice(0, 10),
          });
        } catch {
          /* Preserve an unreadable backup without replacing it. */
        }
      }
    } catch {
      backupAvailable = false;
    }
    if (pending.size) {
      emit({
        status: [...pending.values()].some((e) => e.conflict) ? "conflict" : "saving",
        message: "Recovering unsaved voice text.",
      });
      schedule();
    }
  }
  function append(
    role: "user" | "assistant",
    text: string,
    context: VoiceTurnContext,
    engine: "openai" | "elevenlabs" | "browser",
  ) {
    if (!text.trim()) return;
    if (text.length > MAX_TEXT) {
      emit({
        status: "error",
        message: "This response is too large to save. Keep this tab open and copy the transcript.",
      });
      return;
    }
    if (
      !active ||
      active.messages.length >= MAX_MESSAGES ||
      active.messages.reduce((sum, m) => sum + m.text.length, 0) + text.length >
        MAX_CONVERSATION_TEXT
    ) {
      active = {
        id: uuid(),
        revision: 0,
        title: "Jarvis · Voice conversation",
        messages: [],
        persona: "assistant",
      };
    }
    const revisionKnown = Number.isInteger(context.brainRevision) && context.brainRevision! >= 0;
    const contextKnown =
      typeof context.contextKey === "string" && /^chat1:[01]:[01]{6}$/.test(context.contextKey);
    const sourcesKnown =
      context.sourceIds === undefined ||
      (Array.isArray(context.sourceIds) &&
        context.sourceIds.length <= 100 &&
        context.sourceIds.every((id) => typeof id === "string" && id.length <= 300));
    const message: VoiceTranscriptMessage = {
      role: role === "assistant" ? "oracle" : "user",
      text,
      brainRevision: revisionKnown ? context.brainRevision! : 0,
      ...(contextKnown ? { contextKey: context.contextKey } : {}),
      ...(sourcesKnown && context.sourceIds ? { sourceIds: [...context.sourceIds] } : {}),
      contextReusable:
        context.contextReusable !== false && revisionKnown && contextKnown && sourcesKnown,
      via: `Jarvis · ${engine === "openai" ? "OpenAI voice" : engine === "elevenlabs" ? "ElevenLabs voice" : "Browser voice"}`,
    };
    active = { ...active, messages: [...active.messages, message] };
    const firstUser = active.messages.find((m) => m.role === "user");
    if (firstUser)
      active.title = `Jarvis · ${firstUser.text.replace(/\s+/g, " ").trim()}`.slice(0, 120);
    const old = pending.get(active.id);
    const entry: Pending = { ...old, latest: snapshotOnly(active) };
    pending.set(active.id, entry);
    backup(entry);
    emit({
      status: entry.conflict ? "conflict" : "saving",
      message: entry.conflict
        ? "This chat changed elsewhere. Save your voice text as a separate chat."
        : "",
    });
    schedule();
  }
  async function drain() {
    let failed = false;
    for (const [id, entry] of pending) {
      if (entry.conflict) continue;
      // Retry exactly the uncertain snapshot first, before any subsequently queued text.
      entry.attempt ||= snapshotOnly(entry.latest);
      backup(entry);
      const attempt = entry.attempt;
      emit({ status: "saving", message: "" });
      try {
        const result = await options.save(attempt);
        const saved = result.conversation;
        if (
          !saved ||
          saved.id !== id ||
          !Number.isInteger(saved.revision) ||
          saved.revision < attempt.revision
        )
          throw new Error("The local server did not confirm this save.");
        options.onSaved?.(id);
        const current = pending.get(id)!;
        if (active?.id === id) active = { ...active, revision: saved.revision };
        if (JSON.stringify(current.latest) === JSON.stringify(attempt)) {
          pending.delete(id);
          removeBackup(id);
          for (const replaced of current.replaces || []) {
            pending.delete(replaced);
            removeBackup(replaced);
          }
        } else {
          const continuation = {
            ...current,
            latest: { ...current.latest, revision: saved.revision },
            attempt: undefined,
          };
          pending.set(id, continuation);
          backup(continuation);
          // Map.set on an existing key does not revisit it; continue the serial drain explicitly.
          await drain();
          return;
        }
        emit({ savedId: id });
      } catch (error) {
        const current = pending.get(id) || entry;
        const conflict = /changed in another tab|conversation conflict/i.test(
          (error as Error).message,
        );
        current.attempt = attempt;
        current.conflict = conflict;
        pending.set(id, current);
        backup(current);
        failed = true;
        emit({
          status: conflict ? "conflict" : "error",
          message: conflict
            ? "This chat changed elsewhere. Your unsaved voice text is preserved; save it as a separate chat."
            : "Voice text has not reached saved Chat history. Retry when the local server is available.",
        });
        // Stop automatic retries after a failure; an explicit retry or later turn may try again.
        break;
      }
    }
    if (!failed)
      emit({
        status: pending.size ? "conflict" : "saved",
        message: pending.size
          ? "This chat changed elsewhere. Save your voice text as a separate chat."
          : "",
      });
  }
  function flush(): Promise<void> {
    clearTimeout(timer);
    if (running) return running;
    if (!pending.size) return Promise.resolve();
    running = drain().finally(() => {
      running = undefined;
    });
    return running;
  }
  async function saveConflictCopy() {
    for (const [id, entry] of [...pending]) {
      if (!entry.conflict) continue;
      const copy = { ...entry.latest, id: uuid(), revision: 0 };
      const next: Pending = { latest: copy, replaces: [...(entry.replaces || []), id] };
      backup(next);
      pending.delete(id);
      pending.set(copy.id, next);
      if (active?.id === id) active = copy;
    }
    await flush();
  }
  return {
    restore,
    append,
    flush,
    saveConflictCopy,
    newConversation: () => {
      active = undefined;
      void flush();
    },
    getState: () => state,
    dispose: () => {
      clearTimeout(timer);
      void flush();
    },
  };
}
