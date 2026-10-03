import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localMemoryFiles,
  readLocalMemories,
  notionPageId,
  fetchNotionPage,
  emailText,
} from "./memory-imports";
test("agent memory listing stays within curated text stores and refuses forged or symlinked files", () => {
  const home = mkdtempSync(join(tmpdir(), "memory-adapter-"));
  try {
    const root = join(home, ".codex/memories");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "MEMORY.md"),
      "Remember the release planning context for this project.",
    );
    writeFileSync(join(root, "private-key.md"), "Do not import this credential-shaped file.");
    writeFileSync(join(root, "session.jsonl"), "Raw conversations must not be pulled.");
    const external = join(home, "outside.md");
    writeFileSync(external, "Unrelated data must remain outside the memory scan.");
    symlinkSync(external, join(root, "shortcut.md"));
    const listed = localMemoryFiles("codex", home);
    expect(listed.files).toHaveLength(1);
    expect(readLocalMemories("codex", [listed.files[0].id], home)[0].text).toContain(
      "release planning",
    );
    expect(() =>
      readLocalMemories("codex", [Buffer.from(external).toString("base64url")], home),
    ).toThrow();
    const claude = join(home, ".claude/projects/example/memory");
    mkdirSync(claude, { recursive: true });
    writeFileSync(
      join(claude, "preferences.md"),
      "Please show dates in the user's current timezone.",
    );
    expect(localMemoryFiles("claude", home).files).toHaveLength(1);
    expect(() => localMemoryFiles("other", home)).toThrow();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Notion import uses fixed API host, obtains page title/content, rejects partial content and bad access", async () => {
  const id = "00112233445566778899aabbccddeeff",
    url = `https://workspace.notion.site/Project-${id}?pvs=4`,
    calls: any[] = [];
  expect(notionPageId(url)).toBe("00112233-4455-6677-8899-aabbccddeeff");
  expect(() => notionPageId(`https://evil.test/${id}`)).toThrow();
  const fixture = (async (url: any, options: any) => {
    calls.push({ url, options });
    return Response.json(
      String(url).endsWith("/markdown")
        ? {
            markdown: "# Launch\nThe team will launch the updated product next month.",
            truncated: false,
            unknown_block_ids: [],
          }
        : { properties: { Name: { type: "title", title: [{ plain_text: "Launch plan" }] } } },
    );
  }) as typeof fetch;
  const result = await fetchNotionPage("fixture-token", url, fixture);
  expect(result.title).toBe("Launch plan");
  expect(result.text).toContain("next month");
  expect(calls.every((c) => c.url.startsWith("https://api.notion.com/v1/pages/"))).toBe(true);
  expect(calls[0].options.headers["Notion-Version"]).toBe("2026-03-11");
  await expect(
    fetchNotionPage("fixture", url, (async () =>
      Response.json({ truncated: true })) as typeof fetch),
  ).rejects.toThrow("incomplete");
  await expect(
    fetchNotionPage(
      "fixture",
      url,
      (async () => new Response("{}", { status: 404 })) as typeof fetch,
    ),
  ).rejects.toThrow("Share this Notion page");
});
test("email exports decode body text without importing attachments", () => {
  const eml =
    'From: Alex <alex@example.test>\r\nSubject: Launch\r\nContent-Type: multipart/mixed; boundary="part"\r\n\r\n--part\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from("The launch review is scheduled for Friday.").toString("base64") +
    "\r\n--part\r\nContent-Disposition: attachment\r\nContent-Type: text/plain\r\n\r\nDo not index the attachment.\r\n--part--";
  const text = emailText(eml, (s) => s);
  expect(text).toContain("Subject: Launch");
  expect(text).toContain("review is scheduled");
  expect(text).not.toContain("Do not index");
  expect(
    emailText(
      "Subject: Test\nContent-Type: text/plain\nContent-Transfer-Encoding: quoted-printable\n\nReview the caf=C3=A9 offer.",
      (s) => s,
    ),
  ).toContain("café");
});
