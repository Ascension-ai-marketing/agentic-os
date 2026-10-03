/**
 * ceo-sync.ts
 *
 * Brings the CEO's record of handed-out work up to date with the agents' own
 * records: Hermes cards and the OS's agent jobs. The voice brain and the
 * dashboard both use it. An agent that cannot be reached leaves its tasks as
 * they were.
 */
import type { HermesBoard, HermesCard } from "./ceo-hermes";
import type { CeoStore, CeoTask, CeoTaskStatus } from "./ceo-store";

/** The parts of an OS agent job (agent-jobs-types.ts) that are read here. */
export type OsJob = { id: string; runs: { agent: string; status: string; text?: string; error?: string }[] };
export type CeoSync = ReturnType<typeof ceoSync>;
type State = { status: CeoTaskStatus; note?: string };

const OPEN: CeoTaskStatus[] = ["queued", "running", "blocked"];
const tail = (text: unknown, max: number) => (typeof text === "string" ? text.trim().slice(-max) : "");

/** One agent's run of an OS job, as the states the voice talks about. */
export function jobState(job: OsJob | undefined, agent: "claude" | "codex"): State {
  const run = job?.runs.find((item) => item.agent === agent);
  if (!run) return { status: "failed", note: "The OS no longer has this task." };
  if (run.status === "queued" || run.status === "running") return { status: run.status };
  // Permission prompts are answered by the person, on screen. Nothing here answers them.
  if (run.status === "needs_input") return { status: "blocked", note: "It is waiting for the person's permission, on screen in the OS." };
  if (run.status === "completed") return { status: "done", note: tail(run.text, 1500) };
  if (run.status === "cancelled") return { status: "failed", note: "It was stopped before it finished." };
  return { status: "failed", note: tail(run.error, 600) || "It failed without saying why." };
}

export function ceoSync(options: {
  store: CeoStore; board: Pick<HermesBoard, "cards" | "show">;
  /** The OS's agent jobs. */
  jobs: (signal?: AbortSignal) => Promise<OsJob[]> | OsJob[];
  minGapMs?: number; now?: () => number;
}) {
  const { store, board } = options, now = options.now ?? Date.now, gap = options.minGapMs ?? 20_000;
  let last = -Infinity, running: Promise<void> | undefined;

  function apply(task: CeoTask, state: State) {
    const note = state.note ?? "";
    if (state.status !== task.status || note !== (task.note ?? "")) store.updateTask(task.id, { status: state.status, note });
  }
  async function hermes(tasks: CeoTask[], signal?: AbortSignal) {
    const cards = new Map((await board.cards(signal)).map((card) => [card.id, card]));
    for (const task of tasks) {
      let card: HermesCard | undefined = cards.get(task.ref!);
      if (card?.status === task.status) continue;
      // A card that stopped or finished carries what the worker said; one off the list was archived or removed.
      if (!card || (card.status !== "queued" && card.status !== "running")) {
        try { card = await board.show(task.ref!, signal); }
        catch { if (card) continue; }
      }
      apply(task, card?.id ? card : { status: "failed", note: "Its card is no longer on the Hermes board." });
    }
  }
  async function os(tasks: CeoTask[], signal?: AbortSignal) {
    const jobs = new Map((await options.jobs(signal)).map((job) => [job.id, job]));
    for (const task of tasks) apply(task, jobState(jobs.get(task.ref!), task.agent === "codex" ? "codex" : "claude"));
  }
  async function run(signal?: AbortSignal) {
    const open = store.tasks().filter((task) => OPEN.includes(task.status) && task.ref);
    const cards = open.filter((task) => task.agent === "hermes"), jobs = open.filter((task) => task.agent !== "hermes");
    await Promise.all([
      cards.length ? hermes(cards, signal).catch(() => undefined) : undefined,
      jobs.length ? os(jobs, signal).catch(() => undefined) : undefined,
    ]);
  }

  return {
    /** Brings unfinished work up to date. Calls close together share one refresh; "force" skips the pause between refreshes. */
    refresh(signal?: AbortSignal, force = false): Promise<void> {
      if (running) return running;
      if (!force && now() - last < gap) return Promise.resolve();
      last = now();
      running = run(signal).finally(() => { running = undefined; });
      return running;
    },
  };
}
