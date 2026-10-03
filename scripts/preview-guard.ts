import type { Plugin } from "vite";

export function previewAllowsMutation(path: string) {
  if (path === "/__website-os/connect") return true; // Read-only local preview inspection.
  if (
    /^\/__operator\/memory\/apps\/(?:codex|claude|hermes|granola|gmail|outlook|notion|chatgpt)(?:\/(?:sync|import))?$/.test(
      path,
    )
  )
    return true;
  return /^\/__operator\/(?:conversations(?:\/[^/]+)?|memory(?:\/[^/]+)?|inbox|calendar(?:\/import)?|brain\/sources|settings|goals|connections\/(?:configure|start|sync|disconnect))$/.test(
    path,
  );
}

/** Preview worktrees can edit their own workspace, not installed agent/system settings. */
export function previewGuard(): Plugin {
  return {
    name: "argentic-preview-isolation",
    configureServer(server) {
      if (process.env.ARGENTIC_PREVIEW !== "1") return;
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url || "/", "http://localhost").pathname;
        if (
          !path.startsWith("/__") ||
          ["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") ||
          previewAllowsMutation(path)
        )
          return next();
        res.statusCode = 409;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error:
              "This preview saves its own workspace. Use the main app on localhost:8081 for agent runs or system settings.",
          }),
        );
      });
    },
  };
}
