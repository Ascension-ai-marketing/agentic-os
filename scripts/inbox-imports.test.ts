import { expect, test } from "bun:test";
import { importInboxSnapshot } from "./inbox-imports";
import { EMPTY_STATE } from "../src/lib/operator";
import { brainContext } from "../src/lib/brain-sources";
const batch = () => ({
  provider: "gmail",
  account: "test@example.com",
  via: "codex",
  messages: [
    {
      id: "a",
      from: "Sender",
      subject: "Review proposal",
      body: "Please review this proposal.",
      receivedAt: "2026-09-16T10:00:00Z",
      read: false,
    },
  ],
});
test("snapshot import preserves drafts, categories, local read and existing calendar on repeat", () => {
  const state = structuredClone(EMPTY_STATE);
  state.events.push({
    id: "e",
    title: "Meeting",
    start: "2026-09-16T10:00:00Z",
    end: "2026-09-16T11:00:00Z",
    notes: "Keep",
    allDay: false,
    source: "google",
    actions: [],
  });
  expect(importInboxSnapshot(state, batch()).added).toBe(1);
  Object.assign(state.inbox[0], {
    read: true,
    readOverride: true,
    draft: "My draft",
    category: "waiting",
    status: "done",
  });
  expect(importInboxSnapshot(state, batch()).updated).toBe(1);
  expect(state.inbox).toHaveLength(1);
  expect(state.inbox[0]).toMatchObject({
    read: true,
    draft: "My draft",
    category: "waiting",
    status: "done",
  });
  expect(state.events[0].notes).toBe("Keep");
  expect(state.inboxImports).toHaveLength(1);
  expect(state.inboxImports![0]).toMatchObject({ via: "codex", provider: "gmail", count: 1 });
});
test("invalid batches fail before any mutation and accounts have distinct message IDs", () => {
  const state = structuredClone(EMPTY_STATE),
    b = batch();
  expect(() =>
    importInboxSnapshot(state, {
      ...b,
      messages: [...b.messages, { ...b.messages[0], receivedAt: "invalid" }],
    }),
  ).toThrow();
  expect(state.inbox).toHaveLength(0);
  importInboxSnapshot(state, b);
  importInboxSnapshot(state, { ...b, account: "another@example.com" });
  expect(state.inbox).toHaveLength(2);
  expect(state.inbox[0].id).not.toBe(state.inbox[1].id);
  expect(() => importInboxSnapshot(state, { ...b, provider: "unknown" })).toThrow();
  expect(() =>
    importInboxSnapshot(state, { ...b, messages: Array(101).fill(b.messages[0]) }),
  ).toThrow();
});

test("Gmail imports retain provider metadata and full account-scoped labels across batches", () => {
  const state = structuredClone(EMPTY_STATE);
  const first = batch();
  importInboxSnapshot(state, {
    ...first,
    labels: [
      {
        id: "Label_1",
        name: "Clients",
        type: "user",
        messagesTotal: 245,
        messagesUnread: 8,
        color: { backgroundColor: "#aabbcc", textColor: "#000000" },
      },
    ],
    messages: [
      {
        ...first.messages[0],
        remoteId: "remote_a",
        threadId: "thread_a",
        to: ["test@example.com"],
        replyTo: "reply@example.com",
        rfcMessageId: "<original@example.com>",
        labelIds: ["INBOX", "Label_1"],
        url: "https://mail.google.com/mail/u/0/#all/thread_a",
      },
    ],
  });
  expect(state.inbox[0]).toMatchObject({
    account: "test@example.com",
    remoteId: "remote_a",
    threadId: "thread_a",
    to: ["test@example.com"],
    replyTo: "reply@example.com",
    rfcMessageId: "<original@example.com>",
    labelIds: ["INBOX", "Label_1"],
  });
  expect(
    importInboxSnapshot(state, { ...first, messages: [{ ...first.messages[0], id: "b" }] }).snapshot
      .count,
  ).toBe(2);
  importInboxSnapshot(state, {
    provider: "gmail",
    account: "other@example.com",
    messages: [],
    labels: [{ id: "Label_1", name: "Different label", messagesTotal: 3 }],
  });
  expect(state.gmailLabels).toHaveLength(2);
  expect(state.gmailLabels?.find((l) => l.account === "test@example.com")).toMatchObject({
    name: "Clients",
    messagesTotal: 245,
    messagesUnread: 8,
    color: { backgroundColor: "#aabbcc", textColor: "#000000" },
  });
  importInboxSnapshot(state, {
    provider: "gmail",
    account: "other@example.com",
    messages: [],
    labels: [],
  });
  expect(state.gmailLabels).toHaveLength(1);
});

test("blank Gmail drafts load without fabricated text and unsafe original URLs are dropped", () => {
  const state = structuredClone(EMPTY_STATE),
    first = batch();
  importInboxSnapshot(state, {
    ...first,
    messages: [
      {
        ...first.messages[0],
        body: "",
        gmailDraftId: "draft_a",
        labelIds: ["DRAFT"],
        url: "https://untrusted.example/read",
      },
    ],
  });
  expect(state.inbox[0]).toMatchObject({ body: "", gmailDraftId: "draft_a", labelIds: ["DRAFT"] });
  expect(state.inbox[0].url).toBeUndefined();
  expect(() =>
    importInboxSnapshot(state, { ...first, messages: [{ ...first.messages[0], body: "" }] }),
  ).toThrow();
  expect(state.inbox[0].gmailDraftId).toBe("draft_a");
});

test("disabling email memory excludes Gmail label metadata as well as message contents", () => {
  const state = structuredClone(EMPTY_STATE);
  importInboxSnapshot(state, { ...batch(), labels: [{ id: "Label_1", name: "Private client" }] });
  state.brainSources = { email: false };
  const context = brainContext(state);
  expect(context.inbox).toEqual([]);
  expect(context.inboxImports).toEqual([]);
  expect(context.gmailLabels).toEqual([]);
  expect(context.gmailLabelsUpdatedAt).toBeUndefined();
  expect(state.gmailLabels?.[0].name).toBe("Private client");
});

test("snapshot CC/BCC metadata supports reply-all and preserves locally edited recipients", () => {
  const state = structuredClone(EMPTY_STATE),
    first = batch();
  importInboxSnapshot(state, {
    ...first,
    messages: [
      {
        ...first.messages[0],
        to: '"Smith, Jane" <jane@example.com>, test@example.com',
        cc: ["copy@example.com"],
        bcc: ["private@example.com"],
      },
    ],
  });
  expect(state.inbox[0]).toMatchObject({
    to: ['"Smith, Jane" <jane@example.com>', "test@example.com"],
    cc: ["copy@example.com"],
    bcc: ["private@example.com"],
  });
  Object.assign(state.inbox[0], {
    draft: "My reply",
    draftTo: "edited@example.com",
    draftCc: "edited-copy@example.com",
    draftBcc: "edited-private@example.com",
  });
  importInboxSnapshot(state, { ...first, messages: [{ ...first.messages[0], cc: [], bcc: [] }] });
  expect(state.inbox[0]).toMatchObject({
    cc: [],
    bcc: [],
    draft: "My reply",
    draftTo: "edited@example.com",
    draftCc: "edited-copy@example.com",
    draftBcc: "edited-private@example.com",
  });
});

test("a metadata-light snapshot does not erase previously fetched CC/BCC headers", () => {
  const state = structuredClone(EMPTY_STATE),
    first = batch();
  importInboxSnapshot(state, {
    ...first,
    messages: [{ ...first.messages[0], cc: ["copy@example.com"], bcc: ["private@example.com"] }],
  });
  importInboxSnapshot(state, first);
  expect(state.inbox[0]).toMatchObject({ cc: ["copy@example.com"], bcc: ["private@example.com"] });
});
