import { createHash } from "node:crypto";
import { classifyMessage } from "./account-connections";
import { addressList } from "./gmail-mailbox";
import type { InboxItem, OperatorState } from "../src/lib/operator";

/** Add a bounded mail snapshot without replacing local work or calendar data. */
export function importInboxSnapshot(state: OperatorState, body: any) {
  if (!["gmail", "outlook", "slack"].includes(body.provider))
    throw new Error("Choose Gmail, Outlook or Slack.");
  const account = typeof body.account === "string" ? body.account.trim().slice(0, 300) : "";
  if (!account) throw new Error("Include the source account or workspace.");
  if (
    !Array.isArray(body.messages) ||
    (!body.messages.length && !Array.isArray(body.labels)) ||
    body.messages.length > 100
  )
    throw new Error("Import between 1 and 100 messages at a time.");
  const provider = body.provider as "gmail" | "outlook" | "slack";
  const prefix = `${provider === "gmail" ? "google" : provider}:${createHash("sha256").update(account).digest("hex").slice(0, 12)}:`;
  const string = (v: unknown, limit: number) => (typeof v === "string" ? v.slice(0, limit) : "");
  const safeUrl = (value: unknown) => {
    try {
      const url = new URL(string(value, 2000));
      return url.protocol === "https:" && !url.username && !url.password &&
        ([
          "mail.google.com",
          "outlook.live.com",
          "outlook.office.com",
          "app.slack.com",
        ].includes(url.hostname) || provider === "slack" && url.hostname.endsWith(".slack.com"))
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  // Validate the entire batch before mutating the workspace.
  const messages: InboxItem[] = body.messages.map((m: any) => {
    if (
      !m ||
      typeof m !== "object" ||
      !string(m.id, 500) ||
      (!string(m.body, 100000).trim() &&
        !(provider === "gmail" && (m.gmailDraftId || m.labelIds?.includes("DRAFT")))) ||
      !Number.isFinite(Date.parse(m.receivedAt))
    )
      throw new Error("Each message needs its original ID, text and a valid date.");
    const subject = string(m.subject, 500) || "(No subject)",
      content = string(m.body, 100000);
    const rule = classifyMessage(subject, content);
    return {
      id: prefix + string(m.id, 500),
      from: string(m.from, 500) || account,
      subject,
      body: content,
      receivedAt: new Date(m.receivedAt).toISOString(),
      category: rule.category,
      triageReason: rule.reason,
      status: "open",
      source: provider,
      ...(m.direction === "inbound" || m.direction === "outbound" ? { direction: m.direction } : {}),
      remoteId: string(m.remoteId || m.id, 500),
      threadId: string(m.threadId, 500) || undefined,
      account,
      to: m.to !== undefined ? addressList(m.to).map((value) => string(value, 500)) : undefined,
      ...(m.cc !== undefined ? { cc: addressList(m.cc).map((value) => string(value, 500)) } : {}),
      ...(m.bcc !== undefined
        ? { bcc: addressList(m.bcc).map((value) => string(value, 500)) }
        : {}),
      replyTo: string(m.replyTo, 1000) || undefined,
      rfcMessageId: string(m.rfcMessageId, 1000) || undefined,
      references: string(m.references, 10000) || undefined,
      labelIds: Array.isArray(m.labelIds)
        ? ([
            ...new Set(
              m.labelIds
                .slice(0, 1000)
                .filter((x: unknown) => typeof x === "string" && x.length <= 200),
            ),
          ] as string[])
        : undefined,
      gmailDraftId: string(m.gmailDraftId, 500) || undefined,
      url: safeUrl(m.url),
      ...(typeof m.read === "boolean" ? { read: m.read } : {}),
    };
  });
  let added = 0,
    updated = 0;
  for (const item of messages) {
    const old = state.inbox.find((m) => m.id === item.id);
    if (old) {
      Object.assign(old, item, {
        status: old.status,
        category: old.category,
        draft: old.draft,
        ...(old.readOverride ? { read: old.read, readOverride: true } : {}),
      });
      updated++;
    } else {
      state.inbox.push(item);
      added++;
    }
  }
  if (provider === "gmail" && Array.isArray(body.labels)) {
    const labels = body.labels
      .slice(0, 2000)
      .filter(
        (label: any) =>
          label && typeof label.id === "string" && label.id && typeof label.name === "string",
      )
      .map((label: any) => ({
        id: string(label.id, 200),
        name: string(label.name, 500),
        type: label.type === "system" ? "system" : "user",
        account,
        ...(Number.isSafeInteger(label.messagesTotal) && label.messagesTotal >= 0
          ? { messagesTotal: label.messagesTotal }
          : {}),
        ...(Number.isSafeInteger(label.messagesUnread) && label.messagesUnread >= 0
          ? { messagesUnread: label.messagesUnread }
          : {}),
        ...(label.color &&
        /^#[0-9a-fA-F]{6}$/.test(label.color.backgroundColor) &&
        /^#[0-9a-fA-F]{6}$/.test(label.color.textColor)
          ? {
              color: {
                backgroundColor: label.color.backgroundColor,
                textColor: label.color.textColor,
              },
            }
          : {}),
      }));
    state.gmailLabels = [
      ...(state.gmailLabels || []).filter((label) => label.account !== account),
      ...labels,
    ];
    state.gmailLabelsUpdatedAt = new Date().toISOString();
  }
  const record = {
    provider,
    account,
    importedAt: new Date().toISOString(),
    count: state.inbox.filter((m) => m.source === provider && m.account === account).length,
    via: body.via === "codex" ? ("codex" as const) : ("file" as const),
  };
  state.inboxImports = [
    ...(state.inboxImports || []).filter((i) => i.provider !== provider || i.account !== account),
    record,
  ];
  return { added, updated, snapshot: record };
}
