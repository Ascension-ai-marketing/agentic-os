import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mailArchive, normalizeArchiveMessage } from "./mail-archive";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mail-archive-test-"));
  roots.push(root);
  return { root, archive: mailArchive(root) };
}
function gmail(id: string, text: string) {
  return {
    id,
    internal_date: "1483228800000",
    label_ids: ["INBOX", "UNREAD"],
    payload: {
      mime_type: "text/plain",
      headers: [
        { name: "Subject", value: "Historical invoice" },
        { name: "From", value: "Supplier <supplier@example.com>" },
      ],
      body: { data: Buffer.from(text).toString("base64url") },
    },
  };
}
test("mail body details preserve separate reply recipients", () => {
  const raw = gmail("recipients", "Full text");
  raw.payload.headers.push({ name: "To", value: "Owner <owner@example.com>, Team <team@example.com>" }, { name: "Cc", value: "Colleague <colleague@example.com>" }, { name: "Reply-To", value: "replies@example.com" });
  const item = normalizeArchiveMessage("gmail", "owner@example.com", raw);
  expect(item.to).toEqual(["Owner <owner@example.com>", "Team <team@example.com>"]);
  expect(item.cc).toEqual(["Colleague <colleague@example.com>"]);
  expect(item.replyTo).toBe("replies@example.com");
});
test("full message bodies survive restart, are searchable beyond preview length and are deduplicated", () => {
  const { root, archive } = fixture();
  const body = "A long original message. ".repeat(6000) + " buriedarchivekeyword";
  archive.import("gmail", "owner@example.com", [gmail("one", body), gmail("two", "Second email")]);
  archive.import("gmail", "owner@example.com", [gmail("one", body)]);
  expect(archive.stats().total).toBe(2);
  expect(() => archive.progress("gmail", "owner@example.com", 3, true)).toThrow("expected 3");
  archive.progress("gmail", "owner@example.com", 2, true);
  archive.close();
  const reopened = mailArchive(root);
  expect(reopened.search("buriedarchivekeyword").items[0].body).toBe(body);
  expect(reopened.stats().accounts[0].status).toBe("complete");
  expect(() => reopened.search("' OR 1=1; DROP TABLE messages;")).not.toThrow();
  expect(reopened.stats().total).toBe(2);
  expect(statSync(join(root, ".operator-data/mail-archive.sqlite")).mode & 0o777).toBe(0o600);
  reopened.close();
});
test("provider and account IDs remain separate; updates keep the search index current", () => {
  const { archive } = fixture();
  archive.import("gmail", "one@example.com", [gmail("same", "old uniqueword")]);
  archive.import("gmail", "two@example.com", [gmail("same", "Another account")]);
  archive.import("outlook", "one@example.com", [
    {
      id: "same",
      subject: "Third message",
      receivedDateTime: "2010-01-01T00:00:00Z",
      body: {
        contentType: "HTML",
        content: "<p>Searchable <b>Outlook</b></p><script>evil()</script>",
      },
      sender: { emailAddress: { address: "sender@example.com" } },
    },
  ]);
  archive.import("gmail", "one@example.com", [gmail("same", "replacementword")]);
  expect(archive.stats().total).toBe(3);
  expect(archive.search("uniqueword").total).toBe(0);
  expect(archive.search("replacementword").total).toBe(1);
  expect(archive.search("", 1, 0, "gmail").hasMore).toBe(true);
  expect(archive.search("", 30, 0, "outlook").items[0].body).toBe("Searchable Outlook");
  archive.close();
});
test("invalid batches roll back and multipart text is preferred without attachment bytes", () => {
  const { archive } = fixture();
  expect(() =>
    archive.import("gmail", "owner@example.com", [gmail("valid", "Hello"), { id: "invalid" }]),
  ).toThrow();
  expect(archive.stats().total).toBe(0);
  const item = normalizeArchiveMessage("gmail", "owner@example.com", {
    ...gmail("mime", ""),
    payload: {
      mime_type: "multipart/mixed",
      parts: [
        {
          mime_type: "text/html",
          body: { data: Buffer.from("<p>HTML fallback</p>").toString("base64url") },
        },
        {
          mime_type: "text/plain",
          body: { data: Buffer.from("Readable original").toString("base64url") },
        },
        {
          filename: "secret.txt",
          mime_type: "text/plain",
          body: { data: Buffer.from("Attachment data").toString("base64url") },
        },
      ],
    },
  });
  expect(item.body).toBe("Readable original");
  archive.close();
});

test("older exact matches survive the candidate limit ahead of newer broad matches", () => {
  const { archive } = fixture();
  try {
    archive.import("gmail", "owner@example.com", [gmail("exact-old", "zebra budget")]);
    for (let batch = 0; batch < 3; batch++) {
      archive.import(
        "gmail",
        "owner@example.com",
        Array.from({ length: 80 }, (_, index) => ({
          ...gmail(`broad-${batch}-${index}`, "ordinary budget"),
          internal_date: String(1700000000000 + batch * 80 + index),
        })),
      );
    }
    const result = archive.search("zebra budget", 200);
    expect(result.total).toBe(241);
    expect(result.items).toHaveLength(200);
    expect(result.hasMore).toBe(true);
    expect(result.items[0].remoteId).toBe("exact-old");
    expect(archive.search("zebra budget", 1).items[0].remoteId).toBe("exact-old");
    expect(archive.search("zebra budget", 1, 0, "outlook").total).toBe(0);
    expect(archive.search("", 1).items[0].remoteId).not.toBe("exact-old");
  } finally {
    archive.close();
  }
});

test("whitespace-only plain MIME falls back to the searchable HTML body", () => {
  const { archive } = fixture();
  try {
    archive.import("gmail", "owner@example.com", [
      {
        ...gmail("blank-plain", ""),
        snippet: "Short preview without the search term",
        payload: {
          mime_type: "multipart/alternative",
          parts: [
            {
              mime_type: "text/plain",
              body: { data: Buffer.from(" \n\t ").toString("base64url") },
            },
            {
              mime_type: "text/html",
              body: {
                data: Buffer.from("<p>Full HTML with preservedkeyword.</p>").toString("base64url"),
              },
            },
          ],
        },
      },
    ]);
    const result = archive.search("preservedkeyword");
    expect(result.total).toBe(1);
    expect(result.items[0].body).toBe("Full HTML with preservedkeyword.");
  } finally {
    archive.close();
  }
});

test("conversational searches ignore filler and never expand literal terms into prefixes", () => {
  const { archive } = fixture();
  try {
    archive.import("gmail", "owner@example.com", [gmail("wanted", "Granola meeting"), gmail("broad", "Hey this is my weekend granolas")]);
    expect(archive.search("hey who was in my last meeting (granola)?").items.map(item => item.remoteId)).toEqual(["wanted"]);
    expect(archive.search("who was in my").total).toBe(0);
    expect(archive.search("").total).toBe(2);
  } finally { archive.close(); }
});

test("unresolved external text bodies block the whole batch until hydrated without changing stored mail", () => {
  const { archive } = fixture();
  try {
    archive.import("gmail", "owner@example.com", [gmail("existing", "Previously stored body")]);
    const before = archive.stats();
    for (const field of ["attachmentId", "attachment_id"] as const) {
      const unresolved = {
        ...gmail(`external-${field}`, ""),
        snippet: "A misleading short preview",
        payload: { mime_type: "text/plain", body: { [field]: "external-body", size: 12345 } },
      };
      expect(() =>
        archive.import("gmail", "owner@example.com", [
          gmail("existing", "Would overwrite old body"),
          gmail("new-valid", "Should not commit before the missing body"),
          unresolved,
        ]),
      ).toThrow("external text body that still needs downloading");
      expect(archive.stats()).toEqual(before);
      expect(archive.search("Previously stored body").items[0].body).toBe("Previously stored body");
      expect(archive.search("Should not commit").total).toBe(0);
      expect(() => archive.progress("gmail", "owner@example.com", 3, true)).toThrow("expected 3");
    }
    const hydrated = {
      ...gmail("external-hydrated", "Full downloaded message body"),
      payload: {
        ...gmail("external-hydrated", "Full downloaded message body").payload,
        body: {
          attachment_id: "external-body",
          data: Buffer.from("Full downloaded message body").toString("base64url"),
        },
      },
    };
    archive.import("gmail", "owner@example.com", [gmail("new-valid", "A valid message"), hydrated]);
    expect(archive.search("downloaded").items[0].body).toBe("Full downloaded message body");
    expect(archive.progress("gmail", "owner@example.com", 3, true).accounts[0].status).toBe(
      "complete",
    );
    const attachmentOnly = normalizeArchiveMessage("gmail", "owner@example.com", {
      ...gmail("attached-file", ""),
      payload: {
        parts: [
          gmail("body", "Readable message body").payload,
          {
            mime_type: "text/plain",
            filename: "notes.txt",
            body: { attachmentId: "file-attachment" },
          },
        ],
      },
    });
    expect(attachmentOnly.body).toBe("Readable message body");
  } finally {
    archive.close();
  }
});
