export const CHAT_DRAFT_KEY = "argentic.chat-drafts.v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Drafts = Record<string, { text: string; updatedAt: number }>;
const validId = (id: string) => /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
function read(storage: Storage): Drafts {
  const parsed = JSON.parse(storage.getItem(CHAT_DRAFT_KEY) || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const drafts: Drafts = {};
  for (const [id, item] of Object.entries(parsed)) {
    if (!validId(id) || !item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Partial<Drafts[string]>;
    if (
      typeof value.text !== "string" ||
      value.text.length > 100000 ||
      typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.updatedAt)
    )
      continue;
    drafts[id] = { text: value.text, updatedAt: value.updatedAt };
  }
  return drafts;
}
export function readChatDraft(storage: Storage, id: string): string {
  try {
    return read(storage)[id]?.text || "";
  } catch {
    return "";
  }
}
export function saveChatDraft(storage: Storage, id: string, text: string): boolean {
  if (!validId(id)) return false;
  try {
    const drafts = read(storage);
    if (text) {
      if (text.length > 100000) return false;
      drafts[id] = {
        text,
        updatedAt: Math.max(
          Date.now(),
          ...Object.values(drafts).map((draft) => draft.updatedAt + 1),
        ),
      };
    } else delete drafts[id];
    // Keep only recent unsent text; sent conversation data belongs to the server.
    const recent = Object.entries(drafts)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 20);
    storage.setItem(CHAT_DRAFT_KEY, JSON.stringify(Object.fromEntries(recent)));
    return true;
  } catch {
    return false;
  }
}
export function newestChatDraftId(storage: Storage): string | undefined {
  try {
    return Object.entries(read(storage)).sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0]?.[0];
  } catch {
    return undefined;
  }
}
export function listChatDrafts(
  storage: Storage,
): Array<{ id: string; text: string; updatedAt: number }> {
  try {
    return Object.entries(read(storage))
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
