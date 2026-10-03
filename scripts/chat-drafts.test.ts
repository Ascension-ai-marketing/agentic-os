import { expect, test } from "bun:test";
import {
  CHAT_DRAFT_KEY,
  saveChatDraft,
  readChatDraft,
  newestChatDraftId,
  listChatDrafts,
} from "../src/lib/chat-drafts";
const id = (index: number) => `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
function storage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) || null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}
test("independent unsent drafts survive reload and acceptance clears only the current draft", () => {
  const store = storage();
  expect(saveChatDraft(store, id(1), "Unsent thought")).toBe(true);
  saveChatDraft(store, id(2), "Another idea");
  expect(readChatDraft(store, id(1))).toBe("Unsent thought");
  expect(newestChatDraftId(store)).toBe(id(2));
  expect(listChatDrafts(store).map((draft) => draft.id)).toEqual([id(2), id(1)]);
  saveChatDraft(store, id(2), "");
  expect(readChatDraft(store, id(2))).toBe("");
  expect(readChatDraft(store, id(1))).toBe("Unsent thought");
});
test("draft failure is explicit, corruption is preserved and storage is bounded", () => {
  const store = storage();
  store.setItem(CHAT_DRAFT_KEY, "corrupt");
  expect(saveChatDraft(store, id(1), "new")).toBe(false);
  expect(store.getItem(CHAT_DRAFT_KEY)).toBe("corrupt");
  expect(readChatDraft(store, id(1))).toBe("");
  store.setItem(CHAT_DRAFT_KEY, "{}");
  for (let index = 1; index <= 25; index++) saveChatDraft(store, id(index), `Draft ${index}`);
  expect(listChatDrafts(store)).toHaveLength(20);
  expect(newestChatDraftId(store)).toBe(id(25));
  expect(saveChatDraft(store, "__proto__", "bad")).toBe(false);
  expect(saveChatDraft(store, id(25), "x".repeat(100001))).toBe(false);
  expect(
    saveChatDraft(
      {
        getItem: () => "{}",
        setItem: () => {
          throw Error("quota");
        },
      },
      id(1),
      "Draft",
    ),
  ).toBe(false);
});
