import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermesBoard, WORKER, type Run } from "./ceo-hermes";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

const TOOLS = "web_search|web_extract|todo_list|kanban_show|kanban_complete|kanban_block|kanban_comment|kanban_heartbeat";
const DENY = "approvals:\n  single_query_mode: deny\n  cron_mode: deny\n  unattended_mode: deny\n";
/** The block on every tool but the worker's own, as Hermes reads it from the profile. */
const hook = (tools = TOOLS) => `hooks:\n  pre_tool_call:\n    - matcher: '(?!(?:${tools})$).+'\n      command: '/bin/sh -c "exit 2"'\n      timeout: 5\n      fail_closed: true\n`;
const NARROW = `platform_toolsets:\n  cli:\n    - web\n    - todo\n    - no_mcp\n${DENY}${hook()}`;

/** A Hermes that is never started: a made-up home folder and a stand-in for the command. */
function fixture(profile?: string, answer: (args: string[]) => { code?: number; stdout?: string; stderr?: string } = () => ({}), env?: string) {
  const root = mkdtempSync(join(tmpdir(), "ceo-hermes-root-")), home = mkdtempSync(join(tmpdir(), "ceo-hermes-home-"));
  folders.push(root, home);
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(join(home, ".hermes", ".env"), "SAMPLE_API_TOKEN=fixtureonlysecretvalue\n");
  if (profile !== undefined) {
    mkdirSync(join(home, ".hermes", "profiles", WORKER), { recursive: true });
    writeFileSync(join(home, ".hermes", "profiles", WORKER, "config.yaml"), profile);
    if (env !== undefined) writeFileSync(join(home, ".hermes", "profiles", WORKER, ".env"), env);
  }
  const calls: { args: string[]; input?: string }[] = [];
  const run: Run = async (args, options) => {
    calls.push({ args, input: options?.input });
    return { code: 0, stdout: "{}", stderr: "", ...answer(args) };
  };
  return { board: hermesBoard({ root, home, run }), calls };
}
const dispatch = { title: "Competitor pricing", task: "List three competitors and their prices.", key: "0123456789abcdef0123456789abcdef" };

test("nothing is handed out until the worker profile exists", async () => {
  const { board, calls } = fixture();
  expect(board.workerProblem()).toContain(`no "${WORKER}" profile yet`);
  await expect(board.dispatch(dispatch)).rejects.toThrow("nothing can be handed to it until that is set up");
  expect(calls).toHaveLength(0);
});

test("a worker profile that is missing its tool list, is wider than a worker may be, or has no block on other tools turns dispatch off", async () => {
  for (const [profile, why] of [
    ["model: sample-model\n", "no tool list of its own"],
    ["platform_toolsets:\n  cli: []\n", "no tool list of its own"],
    ["platform_toolsets: [not: valid: yaml\n", "no tool list of its own"],
    [`platform_toolsets:\n  cli:\n    - file\n    - terminal\n    - browser\n${hook()}`, "allows terminal, browser"],
    // A page it reads could have it send a file out.
    [`platform_toolsets:\n  cli:\n    - file\n    - web\n${DENY}${hook()}`, "both files and the web"],
    [`${NARROW}mcp_servers:\n  mail:\n    command: sample\n`, "connected services"],
    [NARROW.replace("cron_mode: deny", "cron_mode: approve"), "approves risky steps on its own"],
    [`platform_toolsets:\n  cli:\n    - web\napprovals:\n  mode: "off"\n${hook()}`, "approves risky steps on its own"],
    [`${NARROW}security:\n  allow_private_urls: true\n`, "this computer's own addresses"],
    [`${NARROW}browser:\n  allow_private_urls: true\n`, "this computer's own addresses"],
    // The block: missing, failing open, another command, another shape, or with an opening to hand work on or run commands.
    [NARROW.replace(hook(), ""), "no block on the tools"],
    [NARROW.replace("fail_closed: true", "fail_closed: false"), "no block on the tools"],
    [NARROW.replace("      fail_closed: true\n", ""), "no block on the tools"],
    [NARROW.replace('/bin/sh -c "exit 2"', "~/bin/check-tool.sh"), "no block on the tools"],
    [NARROW.replace(`'(?!(?:${TOOLS})$).+'`, "'kanban_create|terminal'"), "no block on the tools"],
    [NARROW.replace(`'(?!(?:${TOOLS})$).+'`, `'(?!(?:${TOOLS})).+'`), "no block on the tools"],
    [NARROW.replace("pre_tool_call", "post_tool_call"), "no block on the tools"],
    [NARROW.replace(hook(), hook(`${TOOLS}|kanban_create`)), "no block on the tools"],
    [NARROW.replace(hook(), hook(`${TOOLS}|kanban_request_review`)), "no block on the tools"],
    [NARROW.replace(hook(), hook(`${TOOLS}|kanban_attach_url`)), "no block on the tools"],
    [NARROW.replace(hook(), hook(`${TOOLS}|terminal`)), "no block on the tools"],
    [NARROW.replace(hook(), hook("web_search|web_extract|kanban_show|kanban_block")), "could not end its own card"],
  ] as const) {
    const { board, calls } = fixture(profile);
    expect(board.workerProblem()).toContain(why);
    await expect(board.dispatch(dispatch)).rejects.toThrow(why);
    expect(calls).toHaveLength(0);
  }
  // Settings in the profile's own environment file that would undo the block.
  for (const [env, why] of [
    ["SAMPLE_API_TOKEN=fixtureonlysecretvalue\nHERMES_SAFE_MODE=1\n", "HERMES_SAFE_MODE"],
    ["export HERMES_ALLOW_PRIVATE_URLS = \"true\"\n", "this computer's own addresses"],
  ] as const) {
    const { board, calls } = fixture(NARROW, undefined, env);
    expect(board.workerProblem()).toContain(why);
    expect(board.workerProblem()).not.toContain("fixtureonlysecretvalue");
    await expect(board.dispatch(dispatch)).rejects.toThrow(why);
    expect(calls).toHaveLength(0);
  }
  expect(fixture(NARROW).board.workerProblem()).toBe("");
  expect(fixture(NARROW, undefined, "# Keys for this profile\nSAMPLE_API_TOKEN=fixtureonlysecretvalue\n# HERMES_SAFE_MODE=1\nHERMES_SAFE_MODE=\n").board.workerProblem()).toBe("");
  // A worker with files and no web passes the same checks.
  const files = `platform_toolsets:\n  cli:\n    - file\n    - todo\n    - no_mcp\n${DENY}${hook("read_file|write_file|patch|search_files|todo_list|kanban_show|kanban_complete|kanban_block|kanban_comment|kanban_heartbeat")}`;
  expect(fixture(files).board.workerProblem()).toBe("");
});

test("a card goes to the worker only, with its rules first, the task on standard input and no approvals switched off", async () => {
  const { board, calls } = fixture(NARROW, () => ({ stdout: JSON.stringify({ id: "t_sample1", title: "Competitor pricing", status: "ready" }) }));
  expect(await board.dispatch({ ...dispatch, title: "  --yolo   Competitor\n pricing " })).toEqual({ id: "t_sample1", title: "Competitor pricing", status: "queued" });
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual([
    "kanban", "create", "yolo Competitor pricing", "--body-file", "-", "--assignee", "ceo-worker", "--workspace", "scratch",
    "--idempotency-key", dispatch.key, "--max-runtime", "30m", "--max-retries", "1", "--created-by", "jarvis", "--json",
  ]);
  expect(calls[0].args.filter((arg) => arg.startsWith("--"))).not.toContain("--yolo");
  expect(calls[0].input).toStartWith("You are a background worker for the person");
  expect(calls[0].input).toContain("Never send, post, publish, book, buy or message anyone");
  expect(calls[0].input).toEndWith("The task:\nList three competitors and their prices.");
});

test("a card Hermes did not name, a failed command and an unreadable answer are all errors", async () => {
  await expect(fixture(NARROW, () => ({ stdout: JSON.stringify({ title: "No id" }) })).board.dispatch(dispatch)).rejects.toThrow("did not say which card");
  await expect(fixture(NARROW, () => ({ code: 2, stderr: "board locked, token fixtureonlysecretvalue" })).board.dispatch(dispatch)).rejects.toThrow("Hermes could not do that: board locked, token ••••");
  await expect(fixture(NARROW, () => ({ stdout: "not json" })).board.cards()).rejects.toThrow("unreadable");
});

test("Hermes' card states become the four the voice talks about", async () => {
  const list = [
    { id: "a", title: "Triage", status: "triage" }, { id: "b", title: "Todo", status: "todo" }, { id: "c", title: "Ready", status: "ready" },
    { id: "d", title: "Running", status: "running" }, { id: "e", title: "Review", status: "review" },
    { id: "f", title: "Needs the person", status: "blocked" }, { id: "g", title: "Crashed", status: "blocked", last_failure_error: "timed out after 30m" },
    { id: "h", title: "Done", status: "done" }, { id: "i", title: "Archived", status: "archived" }, { title: "No id" },
  ];
  const { board, calls } = fixture(NARROW, () => ({ stdout: JSON.stringify(list) }));
  const cards = await board.cards();
  expect(calls[0].args).toEqual(["kanban", "list", "--assignee", "ceo-worker", "--json"]);
  expect(cards.map((card) => `${card.id}:${card.status}`)).toEqual(["a:queued", "b:queued", "c:queued", "d:running", "e:running", "f:blocked", "g:failed", "h:done", "i:done"]);
  expect(cards.find((card) => card.id === "g")?.note).toBe("timed out after 30m");
  expect(await fixture(NARROW, () => ({ stdout: JSON.stringify({ error: "no board" }) })).board.cards()).toEqual([]);
});

test("one card is shown with what the worker last said, and saved keys never come through", async () => {
  const shown = (extra: object) => JSON.stringify({ task: { id: "t_sample1", title: "Competitor pricing", status: "done" }, comments: [{ body: "First note." }, { body: "Last comment." }], ...extra });
  const summary = fixture(NARROW, () => ({ stdout: shown({ latest_summary: "Three competitors found. Key used: fixtureonlysecretvalue" }) }));
  expect(await summary.board.show("t_sample1")).toEqual({ id: "t_sample1", title: "Competitor pricing", status: "done", note: "Three competitors found. Key used: ••••" });
  expect(summary.calls[0].args).toEqual(["kanban", "show", "t_sample1", "--json"]);
  expect((await fixture(NARROW, () => ({ stdout: shown({}) })).board.show("t_sample1")).note).toBe("Last comment.");
  const failed = JSON.stringify({ task: { id: "t_sample2", title: "Crashed", status: "blocked", last_failure_error: "timed out after 30m" }, comments: [] });
  expect(await fixture(NARROW, () => ({ stdout: failed })).board.show("t_sample2")).toEqual({ id: "t_sample2", title: "Crashed", status: "failed", note: "timed out after 30m" });

  // An error from an earlier attempt stays on the card: what stopped it last decides between blocked and failed.
  const retried = (events: object[], extra: object = {}) => JSON.stringify({
    task: { id: "t_sample3", title: "Retried", status: "blocked", last_failure_error: "timed out after 30m" }, comments: [{ body: "Needs a decision." }], events, ...extra,
  });
  const failedOnce = { kind: "failed", payload: { error: "timed out after 30m" } };
  const blockedLater = fixture(NARROW, () => ({ stdout: retried([failedOnce, { kind: "blocked", payload: { reason: "Needs approval: email Dana Lee the invoice." } }, { kind: "commented" }]) }));
  expect(await blockedLater.board.show("t_sample3")).toEqual({ id: "t_sample3", title: "Retried", status: "blocked", note: "Needs approval: email Dana Lee the invoice." });
  const asText = fixture(NARROW, () => ({ stdout: retried([failedOnce, { kind: "blocked", payload: JSON.stringify({ reason: "Needs the login. Key: fixtureonlysecretvalue" }) }]) }));
  expect((await asText.board.show("t_sample3")).note).toBe("Needs the login. Key: ••••");
  // No reason given: what the worker last said, never the old error.
  const noReason = fixture(NARROW, () => ({ stdout: retried([failedOnce, { kind: "blocked", payload: "not json" }]) }));
  expect(await noReason.board.show("t_sample3")).toEqual({ id: "t_sample3", title: "Retried", status: "blocked", note: "Needs a decision." });
  const gaveUp = fixture(NARROW, () => ({ stdout: retried([{ kind: "blocked", payload: { reason: "Needs a decision." } }, { kind: "gave_up", payload: { error: "timed out after 30m" } }]) }));
  expect(await gaveUp.board.show("t_sample3")).toEqual({ id: "t_sample3", title: "Retried", status: "failed", note: "timed out after 30m" });

  const { board, calls } = fixture(NARROW);
  await expect(board.show("--assignee")).rejects.toThrow("not a Hermes card");
  await expect(board.show("t_1; rm -rf")).rejects.toThrow("not a Hermes card");
  expect(calls).toHaveLength(0);
});
