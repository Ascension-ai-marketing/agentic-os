import { HarnessTextStream } from "./harness-stream";
import {
  assistantPython,
  hermesInstalled,
  assistantBinary,
  claudeSignInStatus,
} from "./assistant-runtime";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { chatRuntimeArgs } from "./chat-runtime";
const locals = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
} as const;
let remoteCatalog: { at: number; models: any[] } | undefined;
export type CodexModelDiscovery = { models: any[]; ready: boolean; detail: string };

export function remoteHarnessModels(models: any[], hermes: boolean, sdk: boolean) {
  return [
    ...(hermes ? models : []),
    ...(sdk
      ? models
          .map((m) => ({
            ...m,
            key: `deepseek|openrouter|${m.name}`,
            backend: "deepseek",
            label: `DeepSeek Harness · ${m.name}`,
          }))
      : []),
  ];
}
export async function discoverCodexModels(
  binary = assistantBinary("codex"),
  launch: typeof spawn = spawn,
): Promise<CodexModelDiscovery> {
  if (!binary)
    return { models: [], ready: false, detail: "Install Codex, then sign in with codex login." };
  return new Promise((resolve) => {
    const child = launch(binary, ["app-server", "-c", 'model_provider="openai"'], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      total = 0,
      finished = false,
      phase = 1;
    const done = (
      models: any[] = [],
      detail = "Codex sign-in or model discovery could not be verified. Open Codex and check your account.",
    ) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      resolve({ models, ready: !!models.length, detail });
    };
    const timer = setTimeout(() => done(), 8000);
    child.on("error", () => done());
    child.on("close", () => done());
    child.stderr?.resume();
    child.stdin?.on("error", () => done());
    const send = (message: unknown) => child.stdin?.write(JSON.stringify(message) + "\n");
    child.stdout?.on("data", (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (total > 1_000_000) return done([], "Codex discovery exceeded its local response limit.");
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (finished) break;
        try {
          const message = JSON.parse(line);
          if (message.id !== phase) continue;
          if (message.error) {
            done();
            break;
          }
          if (phase === 1) {
            phase = 2;
            send({ method: "initialized" });
            send({ id: 2, method: "account/read", params: { refreshToken: false } });
          } else if (phase === 2) {
            // This text lane deliberately uses native OpenAI auth, without custom provider config.
            if (!["chatgpt", "apiKey"].includes(message.result?.account?.type)) {
              done(
                [],
                "Codex is installed but its OpenAI sign-in was not confirmed. Run codex login.",
              );
              break;
            }
            phase = 3;
            send({ id: 3, method: "model/list", params: { includeHidden: false } });
          } else {
            const data = Array.isArray(message.result?.data) ? message.result.data : [];
            const models = data
              .slice(0, 500)
              .filter((item: any) => typeof item.model === "string" && item.model.length <= 200)
              .map((item: any) => ({
                key: `claude|openai · via codex|${item.model}`,
                backend: "claude",
                provider: "openai · via codex",
                name: item.model,
                label: `Codex · ${typeof item.displayName === "string" ? item.displayName : item.model}`,
              }));
            done(
              models,
              models.length
                ? "Codex reports signed in; model access is discovered, not generation-tested."
                : "Signed in to Codex, but no models were returned.",
            );
          }
        } catch {
          done();
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "agentic-os-chat", version: "1.0.0" } },
    });
  });
}
/** The official Agent SDK initialize response exposes the CLI's current model
 * choices. Send only that control request: no prompt, tools or saved session. */
export async function discoverClaudeModels(
  binary = assistantBinary("claude"),
  launch: typeof spawn = spawn,
): Promise<CodexModelDiscovery> {
  if (!binary) return { models: [], ready: false, detail: "Install Claude Code to discover its models." };
  return new Promise((resolve) => {
    const child = launch(binary, [
      "--print", "--input-format", "stream-json", "--output-format", "stream-json",
      "--verbose", "--no-session-persistence", ...chatRuntimeArgs("claude"),
    ], { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });
    let buffer = "", total = 0, finished = false;
    const done = (models: any[] = [], detail = "Claude model discovery failed. Check the installed Claude Code version and refresh.") => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      resolve({ models, ready: models.length > 0, detail });
    };
    const timer = setTimeout(() => done(), 8000);
    child.on("error", () => done());
    child.on("close", () => done());
    child.stderr?.resume();
    child.stdin?.on("error", () => done());
    child.stdout?.on("data", (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (total > 1_000_000) return done([], "Claude discovery exceeded its local response limit.");
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (finished) break;
        let message: any;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.type !== "control_response" || message.response?.request_id !== "agentic-models") continue;
        if (message.response.subtype !== "success") return done();
        const items = message.response.response?.models;
        const seen = new Set<string>();
        const models = (Array.isArray(items) ? items : []).slice(0, 500).flatMap((item: any) => {
          // Preserve a concrete CLI value (including context modifiers). Resolve
          // moving aliases such as 'default' or 'sonnet' to the reported exact ID.
          const name = typeof item?.value === "string" && item.value.startsWith("claude-") ? item.value : item?.resolvedModel;
          if (typeof name !== "string" || !name.startsWith("claude-") || name.length > 200 || seen.has(name)) return [];
          seen.add(name);
          return [{ key: `claude|claude-code|${name}`, backend: "claude", provider: "claude-code", name,
            label: `Claude Code · ${name}` }];
        });
        done(models, models.length ? "Models reported by the installed Claude Code runtime. Sign-in is checked separately." : "Claude Code returned no supported model choices. Update Claude Code and refresh.");
      }
    });
    child.stdin?.write(JSON.stringify({ type: "control_request", request_id: "agentic-models", request: { subtype: "initialize", hooks: null, skills: [] } }) + "\n");
  });
}

export async function assistantCatalog(root: string, key: string, options: { refresh?: boolean } = {}) {
  const statuses: any[] = [],
    models: any[] = [];
  await Promise.all(
    Object.entries(locals).map(async ([provider, base]) => {
      try {
        const r = await fetch(base + "/models", { signal: AbortSignal.timeout(1800) });
        if (!r.ok) throw new Error();
        const d = await r.json();
        const ids = (d.data || [])
          .map((m: any) => m.id)
          .filter((x: any) => typeof x === "string" && !x.includes(":cloud"));
        for (const name of ids)
          models.push({
            key: `local|${provider}|${name}`,
            backend: "local",
            provider,
            name,
            label: `${provider === "ollama" ? "Ollama" : "LM Studio"} · ${name}`,
            private: true,
          });
        statuses.push({
          id: provider,
          ready: !!ids.length,
          detail: ids.length
            ? `${ids.length} local models available`
            : "Running · load a model to use it",
        });
      } catch {
        statuses.push({
          id: provider,
          ready: false,
          detail: "Start the local server to discover models",
        });
      }
    }),
  );
  const [codex, claude, claudeModels] = await Promise.all([discoverCodexModels(), claudeSignInStatus(), discoverClaudeModels()]);
  models.push(...codex.models, ...claudeModels.models);
  statuses.push({ id: "codex", ready: codex.ready, detail: codex.detail }, {
    ...claude, catalogReady: claudeModels.ready,
    detail: claude.ready ? `${claude.detail} ${claudeModels.detail}` : claude.detail,
  });
  const installed = existsSync(assistantPython(root));
  const hermes = hermesInstalled();
  statuses.push({
    id: "hermes",
    installed: hermes,
    ready: hermes,
    detail: hermes
      ? "Hermes is installed; provider access is checked when you send."
      : "Install Hermes before using its model routes.",
  });
  if (key) {
    try {
      if (options.refresh || !remoteCatalog || Date.now() - remoteCatalog.at > 3600000) {
        const r = await fetch("https://openrouter.ai/api/v1/models", {
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) throw new Error();
        const d = await r.json();
        remoteCatalog = {
          at: Date.now(),
          models: (d.data || [])
            .filter(
              (m: any) =>
                !m.id.includes(":batch") &&
                (m.architecture?.output_modalities || ["text"]).includes("text"),
            )
            .map((m: any) => ({
              key: `hermes|openrouter|${m.id}`,
              backend: "hermes",
              provider: "openrouter",
              name: m.id,
              label: `Hermes · ${m.id}`,
            })),
        };
      }
      models.push(...remoteHarnessModels(remoteCatalog.models, hermes, installed));
      statuses.push({ id: "openrouter", ready: true, detail: "Current OpenRouter text-model catalog. Credential access is checked when you send." });
    } catch {
      statuses.push({ id: "openrouter", ready: false, detail: "OpenRouter catalog could not be refreshed. Check the connection and retry." });
    }
  } else statuses.push({ id: "openrouter", ready: false, detail: "Connect OpenRouter to discover its current model catalog." });
  statuses.push({
    id: "deepseek",
    ready: installed && !!key,
    detail: installed
      ? key
        ? "SDK installed · OpenRouter credential available"
        : "SDK installed · connect an API provider"
      : "Install the scoped SDK to enable this harness",
  });
  return { models, statuses };
}
export async function runAssistant(
  root: string,
  body: any,
  key: string,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const prompt = String(body.prompt || "").slice(0, 200000),
    model = String(body.model || "").slice(0, 200);
  if (!prompt || !model) throw new Error("Choose a model and enter a message.");
  if (body.backend === "local") {
    const base = locals[body.provider as keyof typeof locals];
    if (!base) throw new Error("Unknown local provider.");
    if (model.includes(":cloud"))
      throw new Error("Cloud-hosted models are excluded from the local route.");
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: true }),
      signal,
    });
    if (!r.ok || !r.body)
      throw new Error(
        `Local model returned HTTP ${r.status}. Load the selected model and try again.`,
      );
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      answerLength = 0,
      complete = false;
    const consume = (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === "[DONE]") {
        complete = true;
        return;
      }
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        throw new Error("The local model returned an invalid stream event. Please retry.");
      }
      if (event.error) throw new Error(event.error.message || "Local model error");
      const choice = event.choices?.[0],
        part = choice?.delta?.content;
      if (typeof part === "string" && part) {
        answerLength += part.length;
        if (answerLength > 2000000)
          throw new Error("The local model exceeded the response size limit.");
        onText(part);
      }
      if (choice?.finish_reason != null) complete = true;
    };
    try {
      while (!complete) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) consume(line);
        if (buffer.length > 2000000)
          throw new Error("The local model exceeded the stream event size limit.");
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      signal.throwIfAborted();
      if (!complete)
        throw new Error(
          "The local model response was incomplete. The connection ended before completion; please retry.",
        );
      if (!answerLength) throw new Error("The local model returned no text.");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return;
  }
  if (body.backend !== "deepseek" || !/^[~a-zA-Z0-9][a-zA-Z0-9._:/+@~-]{1,199}$/.test(model))
    throw new Error("Unknown harness or model.");
  if (!key) throw new Error("Connect your OpenRouter provider before using DeepSeek Harness.");
  const python = assistantPython(root);
  if (!existsSync(python))
    throw new Error("DeepSeek Harness SDK is not installed for this workspace.");
  await new Promise<void>((ok, fail) => {
    const child = spawn(python, [resolve(root, "scripts/dsh-companion.py")], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const stream = new HarnessTextStream(onText);
    let streamError: Error | undefined;
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {}
    };
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 180000);
    child.stdout.on("data", (chunk) => {
      try { if (!streamError) stream.push(chunk); }
      catch (error) { streamError = error as Error; stop(); }
    });
    child.stderr.resume(); // Runtime diagnostics may contain private data; never return them.
    child.stdin.on("error", () => stop());
    child.on("error", (e) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      fail(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (streamError) return fail(streamError);
      if (code !== 0 || signal.aborted)
        return fail(
          new Error(
            signal.aborted
              ? "Stopped."
              : "DeepSeek Harness could not complete the request. Check the provider and model connection.",
          ),
        );
      try {
        stream.finish();
        ok();
      } catch (e) {
        fail(e);
      }
    });
    if (signal.aborted) { stop(); return; }
    child.stdin.end(
      JSON.stringify({
        prompt,
        model,
        maxTokens:
          typeof body.maxOutputTokens === "number"
            ? Math.max(1024, Math.min(8192, Math.floor(body.maxOutputTokens)))
            : 4096,
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
      }),
    );
  });
}
