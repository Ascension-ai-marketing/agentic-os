import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InboxItem, OperatorState } from "../src/lib/operator";

export type GmailCapabilities = {
  modify: boolean;
  send: boolean;
  drafts: boolean;
  labels: boolean;
};
export function gmailCapabilities(scopes: string[] = [], connected = true): GmailCapabilities {
  const has = (name: string) =>
    connected &&
    (scopes.includes("https://mail.google.com/") ||
      scopes.includes("https://www.googleapis.com/auth/gmail." + name));
  const modify = has("modify");
  return {
    modify,
    send: modify || has("send") || has("compose"),
    drafts: modify || has("compose"),
    labels: modify,
  };
}
export function grantedScopes(value: unknown): string[] {
  return typeof value === "string" ? [...new Set(value.split(/\s+/).filter(Boolean))] : [];
}
export class GmailProviderError extends Error {
  constructor(public status: number) {
    super(
      `Gmail returned HTTP ${status}. ${status === 403 ? "Allow mail access or reconnect this account." : "Check Gmail and try again."}`,
    );
  }
}
const header = (value: unknown, name: string) => {
  if (typeof value !== "string" || /[\r\n\0]/.test(value) || value.length > 4000)
    throw new Error(`Invalid ${name}.`);
  return value.trim();
};
/** Split display-name addresses without breaking a quoted comma. Metadata parsing stays lossless. */
export function addressList(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .filter((x): x is string => typeof x === "string")
      .flatMap(addressList)
      .slice(0, 100);
  if (typeof value !== "string") return [];
  return value
    .split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);
}
export function recipientHeader(value: unknown, optional = false): string {
  if (
    optional &&
    (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
  )
    return "";
  if (Array.isArray(value) && value.some((x) => typeof x !== "string"))
    throw new Error("Invalid recipient.");
  const input = Array.isArray(value) ? value.join(", ") : value;
  const text = header(input, "recipient");
  if (optional && !text) return "";
  const parts = addressList(text),
    addresses = new Set<string>(),
    normalized: string[] = [];
  if (!parts.length || parts.length > 20 || /[\x00-\x1f\x7f]/.test(text))
    throw new Error("Enter up to 20 valid email addresses in each recipient field.");
  for (const part of parts) {
    const display = part.match(/^(.*?)\s*<([^<>]+)>$/);
    if (display?.[1].includes('"') && !/^"(?:[^"\\]|\\.)*"$/.test(display[1].trim()))
      throw new Error("Invalid recipient display name.");
    const address = display ? display[2].trim() : part;
    if (
      address.length > 254 ||
      part.length > 800 ||
      !/^[^\s<>@,;:"()]+@[^\s<>@,;:"()]+\.[^\s<>@,;:"()]+$/.test(address) ||
      (display && /[<>]/.test(display[1]))
    ) {
      throw new Error("Enter the recipient email address before saving or sending.");
    }
    const key = address.toLowerCase();
    if (addresses.has(key)) continue;
    addresses.add(key);
    const at = address.lastIndexOf("@"),
      normalizedAddress = address.slice(0, at) + "@" + address.slice(at + 1).toLowerCase();
    normalized.push(
      display && display[1].trim()
        ? `${display[1].trim()} <${normalizedAddress}>`
        : normalizedAddress,
    );
  }
  return normalized.join(", ");
}
export function replyMime(
  item: InboxItem,
  from: string,
  to: unknown,
  body: unknown,
  messageId: string = randomUUID(),
  cc: unknown = "",
  bcc: unknown = "",
): string {
  if (typeof body !== "string" || !body.trim() || body.length > 100000)
    throw new Error("Write a reply of up to 100,000 characters first.");
  const subject = header(item.subject, "subject");
  const encodeSubject = (value: string) =>
    /[^\x20-\x7e]/.test(value) || value.length > 70
      ? Array.from(value)
          .reduce<string[]>((a, c) => {
            if (!a.length || Buffer.byteLength(a[a.length - 1] + c) > 42) a.push(c);
            else a[a.length - 1] += c;
            return a;
          }, [])
          .map((x) => `=?UTF-8?B?${Buffer.from(x).toString("base64")}?=`)
          .join("\r\n ")
      : value;
  const lines = [
    `From: ${recipientHeader(from)}`,
    `To: ${addressList(recipientHeader(to)).join(",\r\n ")}`,
    ...(recipientHeader(cc, true)
      ? [`Cc: ${addressList(recipientHeader(cc, true)).join(",\r\n ")}`]
      : []),
    ...(recipientHeader(bcc, true)
      ? [`Bcc: ${addressList(recipientHeader(bcc, true)).join(",\r\n ")}`]
      : []),
    `Subject: ${encodeSubject(item.labelIds?.includes("DRAFT") || /^re:/i.test(subject) ? subject : "Re: " + subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${header(messageId, "message ID")}@argentic.local>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (item.rfcMessageId) {
    const id = header(item.rfcMessageId, "reply message ID");
    if (!/^<[^<>\s]+>$/.test(id))
      throw new Error("This message has an invalid reply header. Open it in Gmail to reply.");
    const references = item.references ? header(item.references, "references") : "";
    if (references && !/^(?:<[^<>\s]+>\s*)+$/.test(references))
      throw new Error("This message has invalid thread references. Open it in Gmail to reply.");
    lines.push(`In-Reply-To: ${id}`, `References: ${references ? references + " " : ""}${id}`);
  }
  const normalized = body.replace(/\r?\n/g, "\r\n");
  return Buffer.from(
    lines.join("\r\n") +
      "\r\n\r\n" +
      Buffer.from(normalized)
        .toString("base64")
        .match(/.{1,76}/g)!
        .join("\r\n") +
      "\r\n",
  ).toString("base64url");
}

type SendAttempt = {
  requestId: string;
  fingerprint: string;
  account: string;
  itemId: string;
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  body: string;
  status: "pending" | "sent" | "uncertain" | "failed";
  startedAt: string;
  sentMessageId?: string;
};
export function gmailMailbox(options: {
  root: string;
  load: () => OperatorState;
  save: (state: OperatorState) => void;
  identity: () => { email?: string; connected: boolean; grantedScopes?: string[] };
  request: (path: string, method: string, body: unknown) => Promise<any>;
}) {
  const directory = join(options.root, ".operator-data"),
    ledgerFile = join(directory, "gmail-send-attempts.json");
  const ledger = (): Record<string, SendAttempt> =>
    existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {};
  const persist = (value: Record<string, SendAttempt>) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(ledgerFile + ".tmp", JSON.stringify(value), { mode: 0o600 });
    renameSync(ledgerFile + ".tmp", ledgerFile);
  };
  const patch = (
    id: string,
    account: string,
    value: Partial<InboxItem>,
    draftSnapshot?: {
      before?: string;
      submitted: string;
      beforeTo?: string;
      submittedTo: string;
      beforeCc?: string;
      submittedCc: string;
      beforeBcc?: string;
      submittedBcc: string;
    },
  ) => {
    const state = options.load(),
      item = state.inbox.find(
        (x) =>
          x.id === id && x.source === "gmail" && x.account?.toLowerCase() === account.toLowerCase(),
      );
    if (!item)
      throw new Error(
        "This Gmail message was removed while the action completed. Refresh Gmail to reconcile.",
      );
    // An editor in another tab may have saved a newer reply while Gmail was responding.
    if (
      draftSnapshot &&
      ((item.draft !== draftSnapshot.before && item.draft !== draftSnapshot.submitted) ||
        (item.draftTo !== draftSnapshot.beforeTo && item.draftTo !== draftSnapshot.submittedTo) ||
        (item.draftCc !== draftSnapshot.beforeCc && item.draftCc !== draftSnapshot.submittedCc) ||
        (item.draftBcc !== draftSnapshot.beforeBcc && item.draftBcc !== draftSnapshot.submittedBcc))
    ) {
      delete value.draft;
      delete value.draftTo;
      delete value.draftCc;
      delete value.draftBcc;
    }
    Object.assign(item, value);
    options.save(state);
    return item;
  };
  async function inspectDraft(item: InboxItem, fields: { cc: boolean; bcc: boolean }) {
    if (!item.gmailDraftId) return;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(item.gmailDraftId))
      throw new Error("Invalid Gmail draft. Sync again.");
    const draft = await options.request(
      `/drafts/${encodeURIComponent(item.gmailDraftId)}?format=full`,
      "GET",
      undefined,
    );
    if (
      draft.id !== item.gmailDraftId ||
      !item.threadId ||
      draft.message?.threadId !== item.threadId ||
      !draft.message?.payload
    ) {
      throw new Error(
        "This Gmail draft no longer matches this conversation. Sync it again or open it in Gmail.",
      );
    }
    const hasAttachment = (part: any): boolean => {
      if (!part) return false;
      if (
        part.filename ||
        part.body?.attachmentId ||
        (part.mimeType &&
          !part.mimeType.startsWith("multipart/") &&
          !["text/plain", "text/html"].includes(part.mimeType))
      )
        return true;
      if (
        part.headers?.some(
          (h: any) =>
            String(h.name).toLowerCase() === "content-disposition" &&
            /^(attachment|inline)/i.test(String(h.value)),
        )
      )
        return true;
      return (part.parts || []).some(hasAttachment);
    };
    if (hasAttachment(draft.message.payload)) {
      throw new Error("This draft includes attachments. Open it in Gmail to preserve them.");
    }
    for (const field of ["cc", "bcc"] as const) {
      const included = draft.message.payload.headers?.some(
        (h: any) => String(h.name).toLowerCase() === field && String(h.value || "").trim(),
      );
      if (included && !fields[field])
        throw new Error(
          `This draft includes ${field === "cc" ? "Cc" : "Bcc"} recipients. Review that field and submit it explicitly to preserve or change them.`,
        );
    }
  }
  return async (input: any) => {
    const account = options.identity();
    if (!account.connected || !account.email)
      throw new Error("Connect Gmail directly and allow mail access first.");
    const state = options.load(),
      item = state.inbox.find((x) => x.id === input.id);
    if (
      !item ||
      item.source !== "gmail" ||
      !item.remoteId ||
      !item.account ||
      item.account.toLowerCase() !== account.email.toLowerCase()
    )
      throw new Error(
        "This message does not belong to the connected Gmail account. Sync that account first.",
      );
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(item.remoteId) ||
      (item.threadId && !/^[A-Za-z0-9_-]{1,200}$/.test(item.threadId))
    )
      throw new Error("This Gmail message has invalid provider metadata. Sync it again.");
    const capabilities = gmailCapabilities(account.grantedScopes, true);
    const action = String(input.action || "");
    if (
      ![
        "read",
        "unread",
        "archive",
        "restore",
        "star",
        "unstar",
        "labels",
        "draft",
        "send",
      ].includes(action)
    )
      throw new Error("Choose a supported Gmail action.");
    const required = action === "send" ? "send" : action === "draft" ? "drafts" : "modify";
    if (!capabilities[required])
      throw new Error("Allow Gmail mail access before using this action.");
    if (action === "draft" || action === "send") {
      const to = recipientHeader(input.to),
        cc = recipientHeader(input.cc, true),
        bcc = recipientHeader(input.bcc, true),
        body = input.body;
      const recipientFields = {
        cc: typeof input.cc === "string" || Array.isArray(input.cc),
        bcc: typeof input.bcc === "string" || Array.isArray(input.bcc),
      };
      const draftRecipients = {
        draftTo: to,
        ...(recipientFields.cc ? { draftCc: cc } : {}),
        ...(recipientFields.bcc ? { draftBcc: bcc } : {}),
      };
      const draftSnapshot = {
        before: item.draft,
        submitted: body,
        beforeTo: item.draftTo,
        submittedTo: to,
        beforeCc: item.draftCc,
        submittedCc: cc,
        beforeBcc: item.draftBcc,
        submittedBcc: bcc,
      };
      const requestId =
        action === "send" ? header(input.requestId, "send request ID") : randomUUID();
      if (action === "send" && !/^[A-Za-z0-9_-]{16,120}$/.test(requestId))
        throw new Error("A unique send request ID is required.");
      const raw = replyMime(item, account.email, to, body, requestId, cc, bcc);
      const message = {
        raw,
        ...(item.threadId && item.rfcMessageId ? { threadId: item.threadId } : {}),
      };
      if (action === "draft") {
        if (item.gmailDraftId && !/^[A-Za-z0-9_-]{1,200}$/.test(item.gmailDraftId))
          throw new Error("Invalid Gmail draft. Sync again.");
        let saved: any;
        try {
          await inspectDraft(item, recipientFields);
          saved = await options.request(
            item.gmailDraftId ? `/drafts/${encodeURIComponent(item.gmailDraftId)}` : "/drafts",
            item.gmailDraftId ? "PUT" : "POST",
            { message },
          );
          if (!saved.id)
            throw new Error("Gmail did not return a draft ID. Check Drafts before retrying.");
        } catch (error) {
          patch(item.id, account.email, { draft: body, ...draftRecipients }, draftSnapshot);
          throw error;
        }
        const updated = patch(
          item.id,
          account.email,
          {
            draft: body,
            ...draftRecipients,
            gmailDraftId: saved.id,
            ...(item.labelIds?.includes("DRAFT") && saved.message?.id
              ? {
                  remoteId: saved.message.id,
                  body,
                  to: addressList(to),
                  cc: addressList(cc),
                  bcc: addressList(bcc),
                }
              : {}),
          },
          draftSnapshot,
        );
        return { ok: true, action, item: updated };
      }
      const attempts = ledger(),
        fingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              account.email.toLowerCase(),
              item.threadId || item.remoteId,
              item.rfcMessageId || "",
              to,
              cc,
              bcc,
              body,
            ]),
          )
          .digest("hex");
      const sameReply = (x: SendAttempt) => {
        const legacyFingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              account.email!.toLowerCase(),
              item.threadId || item.remoteId,
              item.rfcMessageId || "",
              to,
              body,
            ]),
          )
          .digest("hex");
        let sameRecipients = false;
        try {
          sameRecipients =
            recipientHeader(x.to) === to &&
            recipientHeader(x.cc, true) === cc &&
            recipientHeader(x.bcc, true) === bcc;
        } catch {
          return false;
        }
        return (
          x.account.toLowerCase() === account.email!.toLowerCase() &&
          x.body === body &&
          sameRecipients &&
          (x.fingerprint === fingerprint ||
            (!cc && !bcc && x.fingerprint === legacyFingerprint) ||
            x.itemId === item.id ||
            (item.gmailDraftId && x.draftId === item.gmailDraftId))
        );
      };
      const previous = attempts[requestId];
      if (previous && !sameReply(previous))
        throw new Error("This send request ID was already used for a different reply.");
      const matching = Object.values(attempts).filter(sameReply);
      const completed =
        previous?.status === "sent" ? previous : matching.find((x) => x.status === "sent");
      if (completed) {
        const updated = patch(
          item.id,
          account.email,
          {
            draft: "",
            draftTo: undefined,
            draftCc: undefined,
            draftBcc: undefined,
            gmailDraftId: undefined,
            gmailSendState: "sent",
            gmailSendRequestId: completed.requestId,
            gmailSentMessageId: completed.sentMessageId,
            ...(item.labelIds?.includes("DRAFT")
              ? { remoteId: completed.sentMessageId, labelIds: ["SENT"], read: true }
              : {}),
          },
          draftSnapshot,
        );
        return {
          ok: true,
          action,
          alreadyCompleted: true,
          sentMessageId: completed.sentMessageId,
          requestId: completed.requestId,
          item: updated,
        };
      }
      if (
        (previous && previous.status !== "failed") ||
        matching.some((x) => ["pending", "uncertain"].includes(x.status))
      )
        return {
          ok: false,
          action,
          uncertain: true,
          requestId,
          message:
            "This reply may already have been sent. Check Gmail Sent before sending another copy.",
          item,
        };
      try {
        await inspectDraft(item, recipientFields);
      } catch (error) {
        patch(item.id, account.email, { draft: body, ...draftRecipients }, draftSnapshot);
        throw error;
      }
      const attempt: SendAttempt = {
        requestId,
        fingerprint,
        account: account.email,
        itemId: item.id,
        draftId: item.gmailDraftId,
        to,
        cc,
        bcc,
        body,
        status: "pending",
        startedAt: new Date().toISOString(),
      };
      attempts[requestId] = attempt;
      persist(attempts);
      // Never retry this provider request. The durable pending entry also guards process crashes.
      let sent: any;
      try {
        if (item.gmailDraftId && !/^[A-Za-z0-9_-]{1,200}$/.test(item.gmailDraftId))
          throw new GmailProviderError(400);
        sent = await options.request(
          item.gmailDraftId ? "/drafts/send" : "/messages/send",
          "POST",
          item.gmailDraftId ? { id: item.gmailDraftId, message } : message,
        );
        if (!sent.id) throw new Error("Gmail did not confirm the sent message ID.");
      } catch (error) {
        const uncertain = !(
          error instanceof GmailProviderError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        );
        attempt.status = uncertain ? "uncertain" : "failed";
        persist(attempts);
        const updated = patch(
          item.id,
          account.email,
          {
            draft: body,
            ...draftRecipients,
            ...(uncertain ? { gmailSendState: "uncertain", gmailSendRequestId: requestId } : {}),
          },
          draftSnapshot,
        );
        if (!uncertain) throw error;
        return {
          ok: false,
          action,
          uncertain: true,
          requestId,
          item: updated,
          message:
            "Gmail did not confirm delivery. Your reply is saved here. Check Gmail Sent before trying again.",
        };
      }
      attempt.status = "sent";
      attempt.sentMessageId = sent.id;
      persist(attempts);
      const updated = patch(
        item.id,
        account.email,
        {
          draft: "",
          draftTo: undefined,
          draftCc: undefined,
          draftBcc: undefined,
          gmailDraftId: undefined,
          ...(item.labelIds?.includes("DRAFT")
            ? { remoteId: sent.id, labelIds: sent.labelIds || ["SENT"], read: true }
            : {}),
          gmailSendState: "sent",
          gmailSendRequestId: requestId,
          gmailSentAt: new Date().toISOString(),
          gmailSentMessageId: sent.id,
        },
        draftSnapshot,
      );
      return { ok: true, action, requestId, sentMessageId: sent.id, item: updated };
    }
    const operations: Record<string, [string[], string[]]> = {
      read: [[], ["UNREAD"]],
      unread: [["UNREAD"], []],
      archive: [[], ["INBOX"]],
      restore: [["INBOX"], []],
      star: [["STARRED"], []],
      unstar: [[], ["STARRED"]],
    };
    let [addLabelIds, removeLabelIds] = operations[action] || [[], []];
    if (action === "labels") {
      const labels = new Set(
        (state.gmailLabels || [])
          .filter(
            (x) => x.type === "user" && x.account?.toLowerCase() === account.email!.toLowerCase(),
          )
          .map((x) => x.id),
      );
      const validate = (values: unknown) => {
        if (
          !Array.isArray(values) ||
          values.length > 100 ||
          values.some((x) => typeof x !== "string" || !labels.has(x))
        )
          throw new Error("Choose labels from this Gmail account.");
        return [...new Set(values)] as string[];
      };
      addLabelIds = validate(input.addLabelIds || []);
      removeLabelIds = validate(input.removeLabelIds || []);
      if (addLabelIds.some((x) => removeLabelIds.includes(x)))
        throw new Error("A label cannot be added and removed together.");
      if (!addLabelIds.length && !removeLabelIds.length)
        throw new Error("Choose a label to add or remove.");
    }
    const result = await options.request(
      `/messages/${encodeURIComponent(item.remoteId)}/modify`,
      "POST",
      { addLabelIds, removeLabelIds },
    );
    if (result.id !== item.remoteId || !Array.isArray(result.labelIds))
      throw new Error("Gmail did not confirm the updated labels. Sync before trying again.");
    const labelIds: string[] = result.labelIds.filter((x: unknown) => typeof x === "string");
    const updated = patch(item.id, account.email, {
      labelIds,
      starred: labelIds.includes("STARRED"),
      read: !labelIds.includes("UNREAD"),
      readOverride: false,
      status: labelIds.includes("INBOX") ? "open" : "done",
    });
    return { ok: true, action, item: updated };
  };
}
