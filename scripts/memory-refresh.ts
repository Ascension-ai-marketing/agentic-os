import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
const DAY = 24 * 60 * 60 * 1000;
export function memoryRefresh(root: string, run: () => Promise<unknown>, now = Date.now) {
  const dir = join(root, ".operator-data"),
    file = join(dir, "memory-refresh.json");
  let pending = false;
  function read(): { daily: boolean; lastQueuedAt?: string } {
    // On by default: a new install keeps its sources fresh without a setting to find.
    if (!existsSync(file)) return { daily: true };
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value.daily !== "boolean" ||
      (value.lastQueuedAt && !Number.isFinite(Date.parse(value.lastQueuedAt)))
    )
      throw new Error("Daily refresh settings need attention. Existing settings were preserved.");
    return value;
  }
  function save(value: ReturnType<typeof read>) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  return {
    status() {
      const value = read();
      return {
        ...value,
        nextAt:
          value.daily && value.lastQueuedAt
            ? new Date(Date.parse(value.lastQueuedAt) + DAY).toISOString()
            : undefined,
        note: "Refreshes enabled sources daily while the OS is running. A missed refresh runs next time you open it. Large imports continue in bounded batches.",
      };
    },
    configure(body: { daily?: boolean }) {
      if (typeof body.daily !== "boolean") throw new Error("Choose whether to refresh daily.");
      const prior = read();
      save({
        ...prior,
        daily: body.daily,
        ...(body.daily && !prior.daily ? { lastQueuedAt: new Date(now()).toISOString() } : {}),
      });
      return this.status();
    },
    async due() {
      const state = read();
      if (
        pending ||
        !state.daily ||
        (state.lastQueuedAt && now() - Date.parse(state.lastQueuedAt) < DAY)
      )
        return false;
      pending = true;
      try {
        await run();
        save({ ...read(), lastQueuedAt: new Date(now()).toISOString() });
        return true;
      } finally {
        pending = false;
      }
    },
  };
}
