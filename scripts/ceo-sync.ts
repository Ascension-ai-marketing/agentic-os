/**
 * ceo-sync.ts
 *
 * Brings the CEO's record of handed-out work up to date with the agents' own
 * records: Hermes cards and the OS's agent jobs. The voice brain and the
 * dashboard both use it. An agent that cannot be reached leaves its tasks as
 * they were, and is asked again sooner than one that answered.
 */
import type { HermesBoard, HermesCard } from "./ceo-hermes";
import type { CeoStore, CeoTask, CeoTaskStatus } from "./ceo-store";

/** The parts of an OS agent job (agent-jobs-types.ts) that are read here. */
export type OsJob = { id: string; runs: { agent: string; status: string; text?: string; error?: string }[] };
export type CeoSync = ReturnType<typeof ceoSync>;
type State = { status: CeoTaskStatus; note?: string };

const OPEN: CeoTaskStatus[] = ["queued", "running", "blocked"];
const RETRY_MS = 5_000;
const tail = (text: unknown, max: number) => (typeof text === "string" ? text.trim().slice(-max) : "");
/** Hermes' own words for a card it does not have, as opposed to Hermes not answering. */
const gone = (error: unknown) => /no such task/i.test(error instanceof Error ? error.message : "");

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
  let next = -Infinity, running: Promise<void> | undefined;

  function apply(task: CeoTask, state: State) {
    const note = state.note ?? "";
    if (state.status !== task.status || note !== (task.note ?? "")) store.updateTask(task.id, { status: state.status, note });
  }
  /** Each side answers whether everything it asked for came back. */
  async function hermes(tasks: CeoTask[]) {
    const cards = new Map((await board.cards()).map((card) => [card.id, card]));
    let reached = true;
    for (const task of tasks) {
      let card: HermesCard | undefined = cards.get(task.ref!);
      if (card?.status === task.status) continue;
      // A card that stopped or finished carries what the worker said; one off the list was archived or removed.
      if (!card || (card.status !== "queued" && card.status !== "running")) {
        try { card = await board.show(task.ref!); }
        // Only Hermes saying the card does not exist ends the task; details that did not come are left for the next refresh.
        catch (error) {
          if (card || !gone(error)) { reached = false; continue; }
        }
      }
      apply(task, card?.id ? card : { status: "failed", note: "Its card is no longer on the Hermes board." });
    }
    return reached;
  }
  async function os(tasks: CeoTask[]) {
    const jobs = new Map((await options.jobs()).map((job) => [job.id, job]));
    for (const task of tasks) apply(task, jobState(jobs.get(task.ref!), task.agent === "codex" ? "codex" : "claude"));
    return true;
  }
  async function run() {
    const open = store.tasks().filter((task) => OPEN.includes(task.status) && task.ref);
    const cards = open.filter((task) => task.agent === "hermes"), jobs = open.filter((task) => task.agent !== "hermes");
    const reached = await Promise.all([
      cards.length ? hermes(cards).catch(() => false) : true,
      jobs.length ? os(jobs).catch(() => false) : true,
    ]);
    if (reached.includes(false)) next = Math.min(next, now() + Math.min(gap, RETRY_MS));
  }
  /** A caller that gives up stops its own wait; the refresh carries on for the others. */
  function until(work: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return work;
    return new Promise((done, fail) => {
      const stop = () => done();
      signal.addEventListener("abort", stop, { once: true });
      // A refresh that failed is told to the caller, like one asked for without a way to give up.
      void work.then(done, fail).finally(() => signal.removeEventListener("abort", stop));
    });
  }

  return {
    /** Brings unfinished work up to date. Calls close together share one refresh; "force" skips the pause between refreshes. */
    refresh(signal?: AbortSignal, force = false): Promise<void> {
      // A caller that has already given up starts nothing.
      if (signal?.aborted) return Promise.resolve();
      if (!running) {
        if (!force && now() < next) return Promise.resolve();
        next = now() + gap;
        running = run().finally(() => { running = undefined; });
      }
      return until(running, signal);
    },
  };
}
