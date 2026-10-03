import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { loadKnownSecrets, redactSecrets, setKnownSecrets } from "./hermes-progress";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateChatAttachments } from "./chat-attachments";
import type { ChatAttachment } from "../src/lib/chat-attachments";
export type SavedMessage = {
  attachments?: ChatAttachment[];
  role: "user" | "oracle";
  text: string;
  brainRevision?: number;
  contextKey?: string;
  contextReusable?: boolean;
  sourceIds?: string[];
  via?: string;
  apps?: string[];
  /** Jev actions in the chat: a line ("Opened Dashboard") or an agent task card. */
  kind?: "action" | "task";
  jobId?: string;
  agent?: "claude" | "codex";
  taskPrompt?: string;
  exec?: Record<string, unknown>;
  jev?: Record<string, unknown>;
  os?: boolean;
  tools?: string[];
  /** What Hermes did while answering (Hermes chats). */
  hermesActions?: string[];
};
/** A Jev decision card: a plain object with a run id, at most 24 KB. */
function jevCard(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof (v as { run?: unknown }).run !== "string") return undefined;
  try {
    const json = JSON.stringify(v);
    return json.length <= 24_000 ? (JSON.parse(json) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
export type SavedConversation = {
  id: string;
  revision: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: SavedMessage[];
  modelKey?: string;
  pinned?: boolean;
  persona?: "advisor" | "assistant" | "private-advisor" | "hermes";
};
export class ConversationConflict extends Error {
  readonly status = 409;
  constructor() {
    super(
      "This conversation changed in another tab. Your unsaved copy is kept in this browser. Save it as a new chat.",
    );
  }
}
export function conversationStore(root: string) {
  const dir = join(root, ".operator-data"),
    file = join(dir, "conversations.json");
  const load = (): SavedConversation[] => {
    if (!existsSync(file)) return [];
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(s)) throw Error();
      return s;
    } catch {
      throw new Error("Saved conversations could not be read. Your history was left untouched.");
    }
  };
  const write = (items: SavedConversation[]) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = file + "." + randomUUID();
    writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const safeId = (id: unknown) => {
    if (typeof id !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new Error("Choose a valid conversation.");
    return id;
  };
  const strings = (items: unknown) =>
    Array.isArray(items)
      ? items
          .filter((v) => typeof v === "string")
          .slice(0, 100)
          .map((v) => v.slice(0, 300))
      : undefined;
  return {
    list: () => load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    save: (body: any) => {
      const id = body.id ? safeId(body.id) : randomUUID(),
        items = load(),
        old = items.find((x) => x.id === id);
      if (!Array.isArray(body.messages) || body.messages.length > 500)
        throw new Error(
          "A conversation can contain up to 500 messages. Start a new conversation to continue.",
        );
      if (body.messages.some((m: any) => typeof m?.via === "string" && m.via.startsWith("Hermes"))) setKnownSecrets(loadKnownSecrets(root));
      const messages: SavedMessage[] = body.messages.map((m: any) => {
        if (
          !m ||
          !["user", "oracle"].includes(m.role) ||
          typeof m.text !== "string" ||
          m.text.length > 600000
        )
          throw new Error("A chat message has invalid or oversized content.");
        return {
          role: m.role,
          // Hermes replies can quote a key it saw: never store one.
          text: typeof m.via === "string" && m.via.startsWith("Hermes") ? redactSecrets(m.text) : m.text,
          brainRevision:
            Number.isInteger(m.brainRevision) && m.brainRevision >= 0 ? m.brainRevision : undefined,
          contextKey: typeof m.contextKey === "string" && /^chat1:[01]:[01]{6,7}$/.test(m.contextKey) ? m.contextKey : undefined,
          contextReusable: typeof m.contextReusable === "boolean" ? m.contextReusable : undefined,
          sourceIds: strings(m.sourceIds),
          apps: strings(m.apps),
          attachments: validateChatAttachments(m.attachments),
          via: typeof m.via === "string" ? m.via.slice(0, 300) : undefined,
          kind: m.kind === "action" || m.kind === "task" ? m.kind : undefined,
          jobId: typeof m.jobId === "string" && /^[A-Za-z0-9-]{1,80}$/.test(m.jobId) ? m.jobId : undefined,
          agent: m.agent === "claude" || m.agent === "codex" ? m.agent : undefined,
          taskPrompt: typeof m.taskPrompt === "string" ? m.taskPrompt.slice(0, 2000) : undefined,
          // Jev's cards and the OS assistant's tool chips, so a reopened chat still shows them.
          exec: jevCard(m.exec),
          jev: jevCard(m.jev),
          os: m.os === true ? true : undefined,
          tools: strings(m.tools),
          // Filter first, then shorten: a cut-off key must not survive as a prefix.
          hermesActions: strings(Array.isArray(m.hermesActions) ? m.hermesActions.map((a: unknown) => (typeof a === "string" ? redactSecrets(a) : a)) : undefined),
        };
      });
      const now = new Date().toISOString();
      const conversation: SavedConversation = {
        id,
        revision: (old?.revision || 0) + 1,
        title: String(
          body.title ||
            old?.title ||
            messages.find((m) => m.role === "user")?.text ||
            "New conversation",
        )
          .trim()
          .slice(0, 120),
        createdAt: old?.createdAt || now,
        updatedAt: now,
        messages,
        pinned: typeof body.pinned === "boolean" ? body.pinned : (old?.pinned || false),
        modelKey: typeof body.modelKey === "string" ? body.modelKey.slice(0, 300) : old?.modelKey,
        persona: ["advisor", "assistant", "private-advisor", "hermes"].includes(body.persona) ? body.persona : old?.persona,
      };
      if (body.revision !== undefined && (!Number.isInteger(body.revision) || body.revision < 0))
        throw new Error("Invalid conversation revision.");
      const expected = body.revision || 0;
      if (expected !== (old?.revision || 0)) {
        // Retrying an acknowledged-by-server snapshot after a dropped response is safe.
        const same =
          old &&
          old.title === conversation.title &&
          !!old.pinned === !!conversation.pinned &&
          old.modelKey === conversation.modelKey &&
          old.persona === conversation.persona &&
          JSON.stringify(old.messages) === JSON.stringify(messages);
        if (same) return old;
        throw new ConversationConflict();
      }
      write([conversation, ...items.filter((x) => x.id !== id)]);
      return conversation;
    },
    remove: (id: unknown) => {
      safeId(id);
      write(load().filter((x) => x.id !== id));
      return { ok: true };
    },
  };
}
