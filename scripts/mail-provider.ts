import { normalizeArchiveMessage, type mailArchive } from "./mail-archive";

type Provider = "gmail" | "outlook";
type Options = {
  archive: ReturnType<typeof mailArchive>;
  identity: (provider: Provider) => Promise<string>;
  request: (provider: Provider, path: string, account?: string) => Promise<any>;
};
export const outlookMetadataFields = "id,subject,from,sender,toRecipients,receivedDateTime,bodyPreview,isRead,conversationId,webLink,internetMessageId,categories";
export function mailMetadataPath(provider: Provider, id: string) {
  const query = provider === "gmail"
    ? new URLSearchParams([["format", "metadata"], ...["From", "To", "Subject", "Message-ID"].map(header => ["metadataHeaders", header])])
    : new URLSearchParams({ $select: outlookMetadataFields });
  return `/messages/${encodeURIComponent(id)}?${query}`;
}
const validProvider = (value: string): value is Provider => value === "gmail" || value === "outlook";

/** Native provider search is bounded. Only metadata enters the index; bodies are fetched on open. */
export function mailProvider(options: Options) {
  const opening = new Map<string, Promise<ReturnType<Options["archive"]["get"]>>>();
  return {
    /** Recent received metadata only; no archive mutation or full body requests. */
    async recent(provider: Provider, expectedAccount: string, guard: () => void = () => {}) {
      if (!validProvider(provider) || !expectedAccount) throw new Error("Choose a connected mailbox.");
      guard();
      const account = await options.identity(provider);
      guard();
      if (account !== expectedAccount) throw Object.assign(new Error("The direct mailbox changed during the lookup."), { code: "ACCOUNT_CHANGED" });
      const params = new URLSearchParams(provider === "gmail"
        ? { q: "in:inbox -in:drafts -in:sent -in:spam -in:trash", maxResults: "10", includeSpamTrash: "false" }
        : { $top: "10", $orderby: "receivedDateTime desc", $filter: "receivedDateTime ge 1970-01-01T00:00:00Z and isDraft eq false", $select: outlookMetadataFields + ",isDraft" });
      const page = await options.request(provider, "/messages?" + params, account);
      guard();
      const rows = provider === "gmail" ? page?.messages : page?.value;
      const emptyGmail = provider === "gmail" && rows === undefined && page?.resultSizeEstimate === 0 && !page?.nextPageToken;
      if ((!Array.isArray(rows) && !emptyGmail) || (rows?.length || 0) > 10 || (rows || []).some((row: any) => typeof row?.id !== "string" || !row.id))
        throw new Error("The direct mailbox returned an invalid recent message list.");
      const metadata: any[] = [];
      for (const row of rows || []) {
        guard();
        const record = provider === "gmail" ? await options.request(provider, mailMetadataPath(provider, row.id), account) : { ...row, body: undefined };
        guard();
        if (record?.id !== row.id) throw new Error("The direct mailbox returned a different message.");
        metadata.push(provider === "gmail" ? { ...record, payload: { headers: record.payload?.headers } } : record);
      }
      const verified = await options.identity(provider);
      guard();
      if (verified !== account) throw Object.assign(new Error("The direct mailbox changed during the lookup."), { code: "ACCOUNT_CHANGED" });
      const items = metadata.map(row => ({ ...normalizeArchiveMessage(provider, account, row), bodyStatus: "metadata" as const, bodyTruncated: true }))
        .filter((item, index) => item.direction !== "outbound" && !item.labelIds?.includes("DRAFT") && metadata[index].isDraft !== true)
        .map(item => ({ ...item, body: item.body.slice(0, 400) }))
        .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
      return { account, items, checkedAt: new Date().toISOString() };
    },
    async search(provider: string, query: string, limit = 30) {
      if (!validProvider(provider)) throw new Error("Choose Gmail or Outlook for live search.");
      if (typeof query !== "string" || !query.trim() || query.length > 600)
        throw new Error("Enter a provider search of up to 600 characters.");
      limit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 30;
      const account = await options.identity(provider);
      const params = new URLSearchParams(provider === "gmail"
        ? { q: query.trim(), maxResults: String(limit), includeSpamTrash: "true" }
        : { $search: JSON.stringify(query.trim()), $top: String(limit), $select: outlookMetadataFields });
      const page = await options.request(provider, "/messages?" + params, account);
      const listing = provider === "gmail" ? page?.messages : page?.value;
      const emptyGmail = provider === "gmail" && listing === undefined && page?.resultSizeEstimate === 0 && !page?.nextPageToken;
      if (!Array.isArray(listing) && !emptyGmail) throw new Error("Provider did not return a complete search result. Retry the search.");
      const records = listing || [];
      if (records.length > limit || records.some((record: any) => typeof record?.id !== "string" || !record.id))
        throw new Error("Provider returned an invalid search result.");
      const unique = [...new Map<string, any>(records.map((record: any) => [record.id, record])).values()];
      const metadata: any[] = [];
      if (provider === "gmail") {
        for (let offset = 0; offset < unique.length; offset += 4) {
          const results = await Promise.allSettled(unique.slice(offset, offset + 4).map(async record => {
            const message = await options.request(provider, mailMetadataPath(provider, record.id), account);
            if (message?.id !== record.id) throw new Error("Provider returned a different message. Retry the search.");
            return message;
          }));
          const failure = results.find(result => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          metadata.push(...results.map(result => (result as PromiseFulfilledResult<any>).value));
        }
      } else metadata.push(...unique);
      const items = options.archive.importMetadata(provider, account, metadata);
      return { items, total: items.length, limit, bounded: true, hasMore: !!(provider === "gmail" ? page.nextPageToken : page["@odata.nextLink"]) };
    },
    async message(id: string) {
      const saved = options.archive.get(id);
      if (!saved || saved.bodyStatus !== "metadata") return saved;
      const existing = opening.get(id);
      if (existing) return existing;
      const read = async () => {
        const provider = saved.source;
        if (!validProvider(provider) || !saved.account || !saved.remoteId) throw new Error("This email has no verified provider identifier.");
        const account = await options.identity(provider);
        if (account !== saved.account) throw new Error("Connect the account that owns this email before opening its body.");
        const record = await options.request(provider, `/messages/${encodeURIComponent(saved.remoteId)}${provider === "gmail" ? "?format=full" : ""}`, account);
        if (record?.id !== saved.remoteId) throw new Error("Provider returned a different email.");
        if (provider === "gmail" ? !record.payload || typeof record.payload !== "object" : typeof record.body?.content !== "string")
          throw new Error("Provider omitted the email body. Open the original email or retry.");
        // External MIME parts and attachments are deliberately not downloaded.
        return options.archive.cacheBody(provider, account, record);
      };
      const task = read().finally(() => opening.delete(id)); opening.set(id, task);
      return task;
    },
  };
}
