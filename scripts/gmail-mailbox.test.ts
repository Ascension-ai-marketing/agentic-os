import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  gmailCapabilities,
  gmailMailbox,
  GmailProviderError,
  recipientHeader,
  replyMime,
} from "./gmail-mailbox";
import { EMPTY_STATE, type OperatorState } from "../src/lib/operator";
let root: string, state: OperatorState;
const modify = "https://www.googleapis.com/auth/gmail.modify";
const recipient = "Client <client@example.com>";
const sendId = "test-send-00000001";
const mail = () => ({
  id: "local-1",
  remoteId: "gmail_1",
  threadId: "thread_1",
  account: "qa@example.com",
  source: "gmail" as const,
  from: recipient,
  to: ["qa@example.com"],
  subject: "Proposal ✨",
  body: "Original",
  receivedAt: new Date().toISOString(),
  category: "needs-you" as const,
  status: "open" as const,
  labelIds: ["INBOX", "UNREAD"],
  read: false,
  rfcMessageId: "<original@example.com>",
  references: "<ancestor@example.com>",
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gmail-mailbox-"));
  state = structuredClone(EMPTY_STATE);
  state.inbox = [mail()];
  state.gmailLabels = [
    { id: "Label_1", name: "Clients", type: "user", account: "qa@example.com" },
    { id: "Label_other", name: "Other", type: "user", account: "other@example.com" },
  ];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const service = (
  request: (path: string, method: string, body: any) => Promise<any>,
  scopes = [modify],
  email = "qa@example.com",
  readDraft: (path: string) => Promise<any> = async (path) => ({
    id: path.split("/").pop()!.split("?")[0],
    message: {
      id: "draft_message_1",
      threadId: "thread_1",
      payload: { mimeType: "text/plain", headers: [] },
    },
  }),
) =>
  gmailMailbox({
    root,
    load: () => structuredClone(state),
    save: (value) => {
      state = value;
    },
    identity: () => ({ connected: true, email, grantedScopes: scopes }),
    request: (path, method, body) =>
      method === "GET" ? readDraft(path) : request(path, method, body),
  });

test("mail capabilities require verified granted scopes, not requested permissions", () => {
  expect(gmailCapabilities()).toEqual({ modify: false, send: false, drafts: false, labels: false });
  expect(gmailCapabilities(["https://www.googleapis.com/auth/gmail.readonly"])).toEqual(
    gmailCapabilities(),
  );
  expect(gmailCapabilities([modify])).toEqual({
    modify: true,
    send: true,
    drafts: true,
    labels: true,
  });
  expect(gmailCapabilities([modify], false)).toEqual(gmailCapabilities());
  expect(gmailCapabilities(["https://www.googleapis.com/auth/gmail.send"])).toEqual({
    modify: false,
    send: true,
    drafts: false,
    labels: false,
  });
});

test("reply MIME preserves threading, encodes Unicode and rejects header injection", () => {
  const decoded = Buffer.from(
    replyMime(mail(), "qa@example.com", recipient, "Thanks.\nLet's talk."),
    "base64url",
  ).toString();
  expect(decoded).toContain("In-Reply-To: <original@example.com>");
  expect(decoded).toContain("References: <ancestor@example.com> <original@example.com>");
  expect(decoded).toContain("Subject: =?UTF-8?B?");
  expect(decoded).toContain("To: Client <client@example.com>");
  expect(Buffer.from(decoded.split("\r\n\r\n")[1], "base64").toString()).toBe(
    "Thanks.\r\nLet's talk.",
  );
  expect(() => recipientHeader("client@example.com\r\nBcc: thief@example.com")).toThrow(
    "Invalid recipient",
  );
  expect(() =>
    replyMime(
      { ...mail(), subject: "Hi\r\nBcc: other@example.com" },
      "qa@example.com",
      recipient,
      "Hi",
    ),
  ).toThrow("Invalid subject");
  expect(() =>
    replyMime({ ...mail(), rfcMessageId: "bad" }, "qa@example.com", recipient, "Hi"),
  ).toThrow("invalid reply header");
  expect(() => replyMime(mail(), "qa@example.com", "", "Hi")).toThrow("recipient");
});

test("wrong account, missing metadata and readonly actions cannot reach Gmail", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { id: "gmail_1", labelIds: [] };
  };
  await expect(
    service(request, [], "qa@example.com")({ id: "local-1", action: "read" }),
  ).rejects.toThrow("mail access");
  await expect(
    service(request, [modify], "other@example.com")({ id: "local-1", action: "read" }),
  ).rejects.toThrow("belong");
  state.inbox[0].remoteId = undefined;
  await expect(
    service(request)({ id: "local-1", remoteId: "attacker-id", action: "read" }),
  ).rejects.toThrow("belong");
  expect(calls).toBe(0);
});

test("read/archive/labels update only after provider success and retain concurrent local edits", async () => {
  const calls: any[] = [];
  const action = service(async (path, method, body) => {
    calls.push({ path, method, body });
    state.inbox[0].draft = "Written while API was pending";
    return { id: "gmail_1", labelIds: ["Label_1"] };
  });
  await action({ id: "local-1", remoteId: "cannot-use-this", action: "archive" });
  expect(calls[0]).toEqual({
    path: "/messages/gmail_1/modify",
    method: "POST",
    body: { addLabelIds: [], removeLabelIds: ["INBOX"] },
  });
  expect(state.inbox[0]).toMatchObject({
    status: "done",
    read: true,
    readOverride: false,
    draft: "Written while API was pending",
    labelIds: ["Label_1"],
  });
  await action({ id: "local-1", action: "labels", addLabelIds: ["Label_1"], removeLabelIds: [] });
  await expect(
    action({ id: "local-1", action: "labels", addLabelIds: ["Label_other"] }),
  ).rejects.toThrow("this Gmail account");
  await expect(action({ id: "local-1", action: "labels", addLabelIds: ["TRASH"] })).rejects.toThrow(
    "this Gmail account",
  );
  const before = structuredClone(state);
  await expect(
    service(async () => {
      throw new GmailProviderError(403);
    })({ id: "local-1", action: "unread" }),
  ).rejects.toThrow("403");
  expect(state).toEqual(before);
});

test("drafts create then update the same provider draft with explicit recipient", async () => {
  const calls: any[] = [];
  const action = service(async (path, method, body) => {
    calls.push({ path, method, body });
    return { id: "draft_1", message: { id: "draft_message_1" } };
  });
  await action({ id: "local-1", action: "draft", to: recipient, body: "First" });
  await action({ id: "local-1", action: "draft", to: recipient, body: "Updated" });
  expect(calls.map((x) => [x.path, x.method])).toEqual([
    ["/drafts", "POST"],
    ["/drafts/draft_1", "PUT"],
  ]);
  expect(calls[0].body.message.threadId).toBe("thread_1");
  expect(state.inbox[0]).toMatchObject({ gmailDraftId: "draft_1", draft: "Updated" });
  await expect(
    action({ id: "local-1", action: "draft", body: "Missing recipient" }),
  ).rejects.toThrow("recipient");
});

test("send is durable and idempotent, with changed payload and duplicate uncertainty blocked", async () => {
  let calls = 0;
  const action = service(async (path, method, payload) => {
    calls++;
    expect(path).toBe("/messages/send");
    expect(method).toBe("POST");
    expect(payload.threadId).toBe("thread_1");
    return { id: "sent_1" };
  });
  const input = {
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Send this reply",
    requestId: sendId,
  };
  expect((await action(input)).ok).toBe(true);
  expect((await action(input)).alreadyCompleted).toBe(true);
  expect(calls).toBe(1);
  expect(state.inbox[0]).toMatchObject({
    draft: "",
    gmailSendState: "sent",
    gmailSentMessageId: "sent_1",
  });
  await expect(action({ ...input, body: "Different" })).rejects.toThrow("different reply");
  expect(statSync(join(root, ".operator-data/gmail-send-attempts.json")).mode & 0o777).toBe(0o600);
});

test("uncertain send retains reply, survives service restart and never sends again automatically", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    throw new TypeError("connection dropped");
  };
  const input = {
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Keep my reply",
    requestId: sendId,
  };
  const first = await service(request)(input);
  expect(first).toMatchObject({ ok: false, uncertain: true });
  expect(state.inbox[0]).toMatchObject({ draft: "Keep my reply", gmailSendState: "uncertain" });
  expect((await service(request)(input)).uncertain).toBe(true);
  expect((await service(request)({ ...input, requestId: "test-send-00000002" })).uncertain).toBe(
    true,
  );
  expect(calls).toBe(1);
  const record = JSON.parse(
    readFileSync(join(root, ".operator-data/gmail-send-attempts.json"), "utf8"),
  )[sendId];
  expect(record).toMatchObject({ status: "uncertain", body: "Keep my reply", to: recipient });
});

test("explicit provider rejection retains the reply without claiming delivery", async () => {
  await expect(
    service(async () => {
      throw new GmailProviderError(403);
    })({ id: "local-1", action: "send", to: recipient, body: "Do not lose", requestId: sendId }),
  ).rejects.toThrow("403");
  expect(state.inbox[0].draft).toBe("Do not lose");
  expect(state.inbox[0].gmailSendState).not.toBe("sent");
});

test("sending a stored provider draft consumes that draft and clears its local reference", async () => {
  state.inbox[0].gmailDraftId = "draft_1";
  const action = service(async (path, method, body) => {
    expect(path).toBe("/drafts/send");
    expect(body.id).toBe("draft_1");
    expect(body.message.raw).toBeTruthy();
    return { id: "sent_draft_1" };
  });
  await action({
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Final draft",
    requestId: sendId,
  });
  expect(state.inbox[0].gmailDraftId).toBeUndefined();
});

test("same provider draft represented by two local records cannot be sent twice", async () => {
  const original = state.inbox[0];
  original.gmailDraftId = "draft_shared";
  state.inbox.push({
    ...original,
    id: "second-local-draft",
    remoteId: "draft_message",
    labelIds: ["DRAFT"],
    subject: "Re: Proposal ✨",
  });
  let calls = 0;
  const action = service(async () => {
    calls++;
    return { id: "sent_shared" };
  });
  await action({
    id: original.id,
    action: "send",
    to: recipient,
    body: "One reply only",
    requestId: sendId,
  });
  const duplicate = await action({
    id: "second-local-draft",
    action: "send",
    to: recipient,
    body: "One reply only",
    requestId: "test-send-00000002",
  });
  expect(duplicate.alreadyCompleted).toBe(true);
  expect(calls).toBe(1);
  expect(state.inbox[1].gmailDraftId).toBeUndefined();
  expect(state.inbox[1].labelIds).toEqual(["SENT"]);
});

test("uncertain provider draft send is blocked through a second local record", async () => {
  state.inbox[0].gmailDraftId = "draft_shared";
  state.inbox.push({
    ...state.inbox[0],
    id: "second-local-draft",
    remoteId: "draft_message",
    labelIds: ["DRAFT"],
  });
  let calls = 0;
  const action = service(async () => {
    calls++;
    throw new TypeError("network uncertainty");
  });
  await action({
    id: "local-1",
    action: "send",
    to: recipient,
    body: "One reply only",
    requestId: sendId,
  });
  expect(
    (
      await action({
        id: "second-local-draft",
        action: "send",
        to: recipient,
        body: "One reply only",
        requestId: "test-send-00000002",
      })
    ).uncertain,
  ).toBe(true);
  expect(calls).toBe(1);
});

test("a newer local draft survives successful send or draft-save of an earlier reply", async () => {
  state.inbox[0].draft = "Earlier draft";
  const action = service(async () => {
    state.inbox[0].draft = "Newer reply from another tab";
    return { id: "sent_1" };
  });
  await action({
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Earlier draft",
    requestId: sendId,
  });
  expect(state.inbox[0].draft).toBe("Newer reply from another tab");
  const draft = service(async () => {
    state.inbox[0].draft = "A third local edit";
    return { id: "draft_1" };
  });
  await draft({ id: "local-1", action: "draft", to: recipient, body: "Second server draft" });
  expect(state.inbox[0].draft).toBe("A third local edit");
  expect(state.inbox[0].gmailDraftId).toBe("draft_1");
});

test("edited reply recipient persists on draft save, provider rejection and uncertain delivery", async () => {
  const edited = "Different client <different@example.com>";
  const saved = service(async () => ({ id: "draft_edited" }));
  await saved({ id: "local-1", action: "draft", to: edited, body: "Draft for edited recipient" });
  expect(state.inbox[0]).toMatchObject({ draftTo: edited, draft: "Draft for edited recipient" });
  await expect(
    service(async () => {
      throw new GmailProviderError(403);
    })({ id: "local-1", action: "draft", to: edited, body: "Keep failed draft" }),
  ).rejects.toThrow("403");
  expect(state.inbox[0]).toMatchObject({ draftTo: edited, draft: "Keep failed draft" });
  await expect(
    service(async () => {
      throw new GmailProviderError(403);
    })({
      id: "local-1",
      action: "send",
      to: edited,
      body: "Keep rejected reply",
      requestId: sendId,
    }),
  ).rejects.toThrow("403");
  expect(state.inbox[0]).toMatchObject({ draftTo: edited, draft: "Keep rejected reply" });
  await service(async () => {
    throw new TypeError("disconnected");
  })({
    id: "local-1",
    action: "send",
    to: edited,
    body: "Keep uncertain reply",
    requestId: "test-send-00000002",
  });
  expect(state.inbox[0]).toMatchObject({
    draftTo: edited,
    draft: "Keep uncertain reply",
    gmailSendState: "uncertain",
  });
});

test("a concurrent recipient edit preserves the newer recipient and body together", async () => {
  state.inbox[0].draft = "Earlier local body";
  state.inbox[0].draftTo = recipient;
  const action = service(async () => {
    state.inbox[0].draftTo = "newer@example.com";
    state.inbox[0].draft = "Newer local body";
    return { id: "sent_edited" };
  });
  await action({
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Submitted body",
    requestId: sendId,
  });
  expect(state.inbox[0]).toMatchObject({ draftTo: "newer@example.com", draft: "Newer local body" });
});

for (const action of ["draft", "send"])
  for (const extra of ["attachment", "cc", "bcc", "inline-image"])
    test(`${action} preserves provider draft ${extra} by rejecting before any mutation`, async () => {
      state.inbox[0].gmailDraftId = "draft_protected";
      let reads = 0,
        writes = 0;
      const payload: any = {
        mimeType: "multipart/mixed",
        headers: [],
        parts: [{ mimeType: "text/plain", body: { data: "SGVsbG8=" } }],
      };
      if (extra === "attachment")
        payload.parts.push({
          mimeType: "application/pdf",
          filename: "proposal.pdf",
          body: { attachmentId: "attachment_1" },
        });
      if (extra === "inline-image")
        payload.parts.push({ mimeType: "image/png", body: { data: "aW1hZ2U=" } });
      if (extra === "cc" || extra === "bcc")
        payload.headers.push({ name: extra === "cc" ? "Cc" : "Bcc", value: "other@example.com" });
      const run = service(
        async () => {
          writes++;
          return { id: "must-not-write" };
        },
        [modify],
        "qa@example.com",
        async (path) => {
          reads++;
          expect(path).toBe("/drafts/draft_protected?format=full");
          return {
            id: "draft_protected",
            message: { id: "draft_message", threadId: "thread_1", payload },
          };
        },
      );
      await expect(
        run({ id: "local-1", action, to: recipient, body: "Edited body", requestId: sendId }),
      ).rejects.toThrow(
        extra === "cc" || extra === "bcc"
          ? "submit it explicitly"
          : "Open it in Gmail to preserve them",
      );
      expect(reads).toBe(1);
      expect(writes).toBe(0);
      expect(state.inbox[0]).toMatchObject({
        gmailDraftId: "draft_protected",
        draft: "Edited body",
        draftTo: recipient,
      });
    });

test("stale provider draft thread cannot be overwritten or sent", async () => {
  state.inbox[0].gmailDraftId = "draft_stale";
  let writes = 0;
  const run = service(
    async () => {
      writes++;
      return { id: "must-not-write" };
    },
    [modify],
    "qa@example.com",
    async () => ({
      id: "draft_stale",
      message: {
        id: "draft_message",
        threadId: "different_thread",
        payload: { mimeType: "text/plain", headers: [] },
      },
    }),
  );
  for (const action of ["draft", "send"])
    await expect(
      run({ id: "local-1", action, to: recipient, body: "Edited body", requestId: sendId }),
    ).rejects.toThrow("no longer matches this conversation");
  expect(writes).toBe(0);
});

test("plain existing draft is inspected before an update and send", async () => {
  state.inbox[0].gmailDraftId = "draft_plain";
  const calls: string[] = [];
  const run = service(
    async (path) => {
      calls.push(path);
      return { id: path === "/drafts/send" ? "sent_plain" : "draft_plain" };
    },
    [modify],
    "qa@example.com",
    async (path) => {
      calls.push(path);
      return {
        id: "draft_plain",
        message: {
          id: "draft_message",
          threadId: "thread_1",
          payload: { mimeType: "text/plain", headers: [] },
        },
      };
    },
  );
  await run({ id: "local-1", action: "draft", to: recipient, body: "Edited body" });
  await run({
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Edited body",
    requestId: sendId,
  });
  expect(calls).toEqual([
    "/drafts/draft_plain?format=full",
    "/drafts/draft_plain",
    "/drafts/draft_plain?format=full",
    "/drafts/send",
  ]);
});

test("recipient lists normalize spacing and domains, preserve quoted names and reject injection in CC/BCC", async () => {
  expect(
    recipientHeader('"Smith, Jane" <jane@EXAMPLE.COM>; jane@example.com; Bob <bob@example.com>'),
  ).toBe('"Smith, Jane" <jane@example.com>, Bob <bob@example.com>');
  expect(recipientHeader("", true)).toBe("");
  let writes = 0;
  const run = service(async () => {
    writes++;
    return { id: "no" };
  });
  for (const field of ["cc", "bcc"])
    await expect(
      run({
        id: "local-1",
        action: "send",
        to: recipient,
        [field]: "good@example.com\r\nBcc: hidden@example.com",
        body: "Hi",
        requestId: sendId,
      }),
    ).rejects.toThrow("Invalid recipient");
  expect(writes).toBe(0);
  const raw = Buffer.from(
    replyMime(
      mail(),
      "qa@example.com",
      recipient,
      "Hi",
      sendId,
      "Copy <copy@example.com>",
      "private@example.com",
    ),
    "base64url",
  ).toString();
  expect(raw).toContain("Cc: Copy <copy@example.com>\r\n");
  expect(raw).toContain("Bcc: private@example.com\r\n");
});

test("an existing provider draft supports reviewed CC/BCC recipients and explicit removals", async () => {
  state.inbox[0].gmailDraftId = "draft_cc";
  state.inbox[0].cc = ["oldcopy@example.com"];
  state.inbox[0].bcc = ["oldprivate@example.com"];
  const rawMessages: string[] = [];
  const run = service(
    async (path, method, payload) => {
      rawMessages.push(Buffer.from(payload.message.raw, "base64url").toString());
      return { id: path === "/drafts/send" ? "sent_cc" : "draft_cc" };
    },
    [modify],
    "qa@example.com",
    async () => ({
      id: "draft_cc",
      message: {
        id: "draft_message",
        threadId: "thread_1",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Cc", value: "oldcopy@example.com" },
            { name: "Bcc", value: "oldprivate@example.com" },
          ],
        },
      },
    }),
  );
  await run({
    id: "local-1",
    action: "draft",
    to: recipient,
    cc: "newcopy@example.com",
    bcc: "newprivate@example.com",
    body: "Draft with recipients",
  });
  expect(state.inbox[0]).toMatchObject({
    draftCc: "newcopy@example.com",
    draftBcc: "newprivate@example.com",
  });
  expect(rawMessages[0]).toContain("Cc: newcopy@example.com");
  expect(rawMessages[0]).toContain("Bcc: newprivate@example.com");
  await run({
    id: "local-1",
    action: "send",
    to: recipient,
    cc: "",
    bcc: "",
    body: "Explicitly remove copies",
    requestId: sendId,
  });
  expect(rawMessages[1]).not.toContain("\r\nCc:");
  expect(rawMessages[1]).not.toContain("\r\nBcc:");
  expect(state.inbox[0].draftCc).toBeUndefined();
  expect(state.inbox[0].draftBcc).toBeUndefined();
});

test("CC/BCC are part of send identity and uncertain retries preserve all recipients", async () => {
  let writes = 0;
  const run = service(async () => {
    writes++;
    throw new TypeError("uncertain");
  });
  const input = {
    id: "local-1",
    action: "send",
    to: recipient,
    cc: "copy@example.com",
    bcc: "private@example.com",
    body: "All recipients",
    requestId: sendId,
  };
  expect((await run(input)).uncertain).toBe(true);
  expect(state.inbox[0]).toMatchObject({
    draftTo: recipient,
    draftCc: "copy@example.com",
    draftBcc: "private@example.com",
    draft: "All recipients",
  });
  expect((await run({ ...input, requestId: "test-send-00000002" })).uncertain).toBe(true);
  expect(writes).toBe(1);
  await expect(run({ ...input, cc: "different@example.com" })).rejects.toThrow("different reply");
  await expect(run({ ...input, bcc: "different@example.com" })).rejects.toThrow("different reply");
  expect(writes).toBe(1);
});

test("a concurrent CC/BCC edit preserves the entire newer draft together", async () => {
  Object.assign(state.inbox[0], {
    draft: "Earlier",
    draftTo: recipient,
    draftCc: "oldcopy@example.com",
    draftBcc: "oldprivate@example.com",
  });
  const run = service(async () => {
    state.inbox[0].draftCc = "newcopy@example.com";
    state.inbox[0].draftBcc = "newprivate@example.com";
    return { id: "sent_concurrent_cc" };
  });
  await run({
    id: "local-1",
    action: "send",
    to: recipient,
    cc: "oldcopy@example.com",
    bcc: "oldprivate@example.com",
    body: "Earlier",
    requestId: sendId,
  });
  expect(state.inbox[0]).toMatchObject({
    draft: "Earlier",
    draftTo: recipient,
    draftCc: "newcopy@example.com",
    draftBcc: "newprivate@example.com",
  });
});

test("legacy uncertain sends without CC/BCC fields stay blocked after the recipient upgrade", async () => {
  let writes = 0;
  const run = service(async () => {
    writes++;
    throw new TypeError("uncertain");
  });
  const input = {
    id: "local-1",
    action: "send",
    to: recipient,
    body: "Legacy reply",
    requestId: sendId,
  };
  await run(input);
  const file = join(root, ".operator-data/gmail-send-attempts.json"),
    attempts = JSON.parse(readFileSync(file, "utf8"));
  delete attempts[sendId].cc;
  delete attempts[sendId].bcc;
  attempts[sendId].fingerprint = "legacy-pre-cc-fingerprint";
  writeFileSync(file, JSON.stringify(attempts));
  expect((await run({ ...input, cc: "", bcc: "" })).uncertain).toBe(true);
  expect(
    (await run({ ...input, cc: "", bcc: "", requestId: "test-send-00000002" })).uncertain,
  ).toBe(true);
  expect(writes).toBe(1);
});
