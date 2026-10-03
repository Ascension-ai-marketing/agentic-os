import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  personName,
  projectFromCwd,
  promptTitle,
  readChatgptStream,
  readCodexStream,
  readEmailStream,
  readHermesStream,
  readMeetingsStream,
} from "./memory-streams";

const tempHome = () => mkdtempSync(join(tmpdir(), "memory-streams-"));

describe("memory streams", () => {
  test("prompt titles drop file dumps and long paths", () => {
    expect(
      promptTitle(
        "# Files mentioned by the user:\n\n## a.pdf: /x\n## My request for Codex:\nCheck this contract",
      ),
    ).toBe("Check this contract");
    expect(promptTitle("Read /Users/me/Desktop/app/notes.md and fix it")).toBe(
      "Read notes.md and fix it",
    );
  });

  test("projects come from real folders, not scratch or home", () => {
    expect(projectFromCwd("/Users/me/Desktop/stacked-daily", "/Users/me")).toBe("stacked-daily");
    expect(projectFromCwd("/Users/me", "/Users/me")).toBeUndefined();
    expect(
      projectFromCwd("/Users/me/Documents/Codex/2026-09-25/hey-bro", "/Users/me"),
    ).toBeUndefined();
    expect(projectFromCwd("/Users/me/Desktop", "/Users/me")).toBeUndefined();
  });

  test("people are plain names", () => {
    expect(personName("Ana Ruiz <ana@example.com>")).toBe("Ana Ruiz");
    expect(personName("You → Dana Brooks")).toBe("Dana Brooks");
  });

  test("codex reads threads, names, summaries and folds repeated runs", async () => {
    const home = tempHome();
    const dir = join(home, ".codex");
    mkdirSync(join(dir, "memories", "rollout_summaries"), { recursive: true });
    const db = new Database(join(dir, "state_5.sqlite"));
    db.run(`CREATE TABLE threads (id TEXT, title TEXT, name TEXT, first_user_message TEXT, cwd TEXT,
      updated_at INTEGER, source TEXT, git_branch TEXT, model TEXT, archived INTEGER)`);
    const add = db.prepare("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?)");
    add.run(
      "a",
      "Fix header",
      null,
      "Fix header",
      `${home}/Desktop/site`,
      1790000000,
      "vscode",
      "main",
      "gpt",
      0,
    );
    add.run(
      "b",
      "Daily run",
      null,
      "Daily run",
      `${home}/Desktop/site`,
      1790000100,
      "exec",
      null,
      null,
      0,
    );
    add.run(
      "c",
      "Daily run",
      null,
      "Daily run",
      `${home}/Desktop/site`,
      1790000200,
      "exec",
      null,
      null,
      0,
    );
    add.run("d", "Old", null, "Old", home, 1780000000, "vscode", null, null, 1);
    add.run("e", "Sub", null, "Sub", home, 1790000300, '{"subagent":{}}', null, null, 0);
    db.close();
    writeFileSync(
      join(dir, "session_index.jsonl"),
      JSON.stringify({ id: "a", thread_name: "Header polish" }) + "\n",
    );
    writeFileSync(
      join(dir, "memories", "rollout_summaries", "x.md"),
      "thread_id: a\nupdated_at: now\n\n# The header now fits on phones\n",
    );
    const s = await readCodexStream(home);
    expect(s.status).toBe("ok");
    expect(s.records.map((r) => r.title)).toEqual(["Daily run", "Header polish"]);
    const header = s.records.find((r) => r.id === "a")!;
    expect(header.project).toBe("site");
    expect(header.meta).toBe("The header now fits on phones");
    expect(s.records[0].meta).toContain("2 runs");
  });

  test("codex is missing when the folder is absent", async () => {
    expect((await readCodexStream(tempHome())).status).toBe("missing");
  });

  test("chatgpt export is optional and parsed when present", () => {
    const home = tempHome();
    expect(readChatgptStream(home).status).toBe("missing");
    mkdirSync(join(home, "Downloads"), { recursive: true });
    writeFileSync(
      join(home, "Downloads", "conversations.json"),
      JSON.stringify([
        {
          id: "c1",
          title: "Launch plan",
          update_time: 1790000000,
          mapping: {
            m: {
              message: {
                author: { role: "user" },
                create_time: 1,
                content: { parts: ["Plan the launch"] },
              },
            },
          },
        },
      ]),
    );
    const s = readChatgptStream(home);
    expect(s.status).toBe("ok");
    expect(s.records[0]).toMatchObject({
      id: "c1",
      title: "Launch plan",
      preview: "Plan the launch",
    });
  });

  test("email and meetings read the operator store, headers only from the archive", async () => {
    const home = tempHome();
    const data = join(home, ".operator-data");
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "workspace.json"),
      JSON.stringify({
        inbox: [
          {
            id: "i1",
            from: "Ana <ana@x.io>",
            subject: "Invoice",
            body: "Hi",
            receivedAt: "2026-09-01T10:00:00Z",
            source: "gmail",
          },
        ],
        events: [
          {
            id: "e1",
            title: "Sync",
            start: "2026-09-02T09:00:00Z",
            attendees: "Ana, Bo",
            notes: "Plan",
            actions: [],
          },
        ],
      }),
    );
    const db = new Database(join(data, "mail-archive.sqlite"));
    db.run(
      `CREATE TABLE messages (id TEXT, provider TEXT, received_at TEXT, subject TEXT, sender TEXT, body TEXT)`,
    );
    db.run(
      `INSERT INTO messages VALUES ('m1','outlook','2026-09-03T00:00:00Z','Contract','Bo <bo@x.io>','secret body')`,
    );
    db.close();
    const email = await readEmailStream(data, home);
    expect(email.records.map((r) => r.title)).toEqual(["Contract", "Invoice"]);
    expect(JSON.stringify(email.records[0])).not.toContain("secret body");
    expect(email.records[1].people).toEqual(["Ana"]);
    const meetings = readMeetingsStream(data, home);
    expect(meetings.records[0]).toMatchObject({ title: "Sync", people: ["Ana", "Bo"] });
    expect(readMeetingsStream(join(home, "none"), home).status).toBe("missing");
  });

  test("hermes reads sessions and notes, never auth or env files", async () => {
    const home = tempHome();
    const dir = join(home, ".hermes");
    mkdirSync(join(dir, "memories"), { recursive: true });
    writeFileSync(join(dir, "memories", "MEMORY.md"), "Prefers short answers");
    writeFileSync(join(dir, "auth.json"), '{"token":"secret-token"}');
    const db = new Database(join(dir, "state.db"));
    db.run(`CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT, message_count INTEGER,
      started_at REAL, ended_at REAL, last_activity_at REAL, archived INTEGER)`);
    db.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT)`);
    db.run(`INSERT INTO sessions VALUES ('s1','telegram','m',NULL,4,1790000000,NULL,NULL,0)`);
    db.run(`INSERT INTO sessions VALUES ('s2','cron','m','Daily brief · Sep 02 08:08',2,1790000100,NULL,NULL,0)`);
    db.run(`INSERT INTO sessions VALUES ('s3','subagent','m','Helper',1,1790000200,NULL,NULL,0)`);
    db.run(`INSERT INTO messages (session_id, role, content) VALUES ('s1','user','CONTEXT: x\n\nQUESTION: How much runway do I have?')`);
    db.close();
    const s = await readHermesStream(home);
    const titles = s.records.map((r) => r.title);
    expect(titles).toContain("How much runway do I have?");
    expect(titles).toContain("Daily brief");
    expect(titles).toContain("Hermes memory");
    expect(titles).not.toContain("Helper");
    expect(JSON.stringify(s)).not.toContain("secret-token");
  });
});

test("a repeating meeting is one Memory entry, not one per day", async () => {
  const { collapseSeries } = await import("../src/lib/operator");
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 7)).toISOString();
  const now = Date.parse(day(10));
  const events = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, title: "Morning routine", start: day(i + 1), series: "abc" })),
    { id: "one", title: "Dentist", start: day(12) },
  ];
  const out = collapseSeries(events, now);
  expect(out.map((e) => e.title).sort()).toEqual(["Dentist", "Morning routine"]);
  expect(out.find((e) => e.series)?.start).toBe(day(10));
});

test("the same series id in two calendars stays two Memory entries", async () => {
  const { collapseSeries } = await import("../src/lib/operator");
  const e = (id: string, cal: string) => ({ id, title: id, start: "2026-10-03T07:00:00.000Z", series: "same", calendarId: cal, source: "google" });
  expect(collapseSeries([e("a", "work"), e("b", "home")], Date.parse("2026-10-01T00:00:00Z"))).toHaveLength(2);
});
