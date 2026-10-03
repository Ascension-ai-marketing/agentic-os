import { assistantPython } from "./assistant-runtime";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = "deepseek/deepseek-v4.1-flash";
const MAX_PROMPT = 100_000;
const MAX_OUTPUT_BYTES = 65_536;
const FAILURE =
  "The inbox assistant could not complete this answer. Your matching conversations are still available.";

/** A bounded, tool-free JSON answer through the workspace's installed SDK. */
export async function runInboxHarness(
  root: string,
  key: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new Error("Stopped.");
  if (!key.trim()) throw new Error("Connect your OpenRouter provider before asking the inbox.");
  if (!prompt.trim() || prompt.length > MAX_PROMPT)
    throw new Error("The inbox question contains too much context or is empty.");
  const python = assistantPython(root);
  const companion = resolve(root, "scripts/inbox-dsh-companion.py");
  if (!existsSync(python) || !existsSync(companion))
    throw new Error("The inbox DeepSeek Harness runtime is unavailable in this workspace.");

  return new Promise<string>((resolveAnswer, reject) => {
    const child = spawn(python, [companion], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let bytes = 0;
    let settled = false;
    const kill = (kind: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {
        // A completed child may have already exited before cancellation reaches it.
      }
    };
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolveAnswer(text!);
    };
    const stop = (message: string) => {
      if (settled) return;
      kill("SIGTERM");
      // Kill the SDK process group even when its parent exits first.
      const escalation = setTimeout(() => kill("SIGKILL"), 750);
      escalation.unref();
      finish(new Error(message));
    };
    const abort = () => stop("Stopped.");
    const deadline = setTimeout(
      () => stop("The inbox answer took too long. Try a more specific question."),
      35_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_OUTPUT_BYTES) return stop("The inbox assistant returned too much output.");
      output += chunk;
    });
    // Drain diagnostics without retaining or exposing provider credentials or private prompts.
    child.stderr.resume();
    child.on("error", () => finish(new Error(FAILURE)));
    child.stdin.on("error", () => stop(FAILURE));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(FAILURE));
      try {
        const envelope = JSON.parse(output.trim());
        if (envelope.finishReason !== "completed" || typeof envelope.text !== "string")
          throw new Error("Incomplete answer");
        const text = envelope.text.trim();
        if (!text || text.length > 18_000) throw new Error("Invalid answer length");
        const answer = JSON.parse(text);
        if (!answer || typeof answer !== "object" || Array.isArray(answer))
          throw new Error("The answer must be a JSON object");
        finish(undefined, text);
      } catch {
        finish(new Error("The inbox assistant returned an incomplete or invalid JSON answer."));
      }
    });
    if (signal.aborted) return abort();
    child.stdin.end(JSON.stringify({ model: MODEL, apiKey: key, prompt }));
  });
}
