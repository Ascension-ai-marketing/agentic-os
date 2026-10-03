import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assistantCatalog, runAssistant } from "./assistant-adapters";
import type { InboxQuestionModel } from "./inbox-questions";
import { runInboxHarness } from "./inbox-dsh-harness";

export function inboxQuestionModelAvailable(root: string, key: string, model?: InboxQuestionModel) {
  if (model?.backend === "local") return ["ollama", "lmstudio"].includes(model.provider) && !!model.name && !model.name.includes(":cloud");
  return !!key && existsSync(resolve(root, ".operator-data/dsh-venv/bin/python"));
}

export async function generateInboxQuestionAnswer(root: string, key: string, prompt: string, selected: InboxQuestionModel | undefined, signal: AbortSignal) {
  if (!selected || (selected.backend === "deepseek" && selected.name === "deepseek/deepseek-v4.1-flash"))
    return runInboxHarness(root, key, prompt, signal);
  const catalog = await assistantCatalog(root, key);
  if (signal.aborted) throw new Error("Stopped.");
  const models = catalog.models.filter((model: any) => ["local", "deepseek"].includes(model.backend));
  const model = selected
    ? models.find((model: any) => model.backend === selected.backend && model.provider === selected.provider && model.name === selected.name)
    : models.find((model: any) => model.backend === "deepseek" && model.name === "deepseek/deepseek-v4.1-flash") || models.find((model: any) => model.backend === "deepseek" && /flash/i.test(model.name)) || models.find((model: any) => model.backend === "deepseek");
  if (!model) throw new Error("Choose an available assistant model in Chat.");
  let answer = "";
  await runAssistant(root, { backend: model.backend, provider: model.provider, model: model.name, maxOutputTokens: 4096, prompt }, key, signal, part => {
    answer += part;
    if (answer.length > 18000) throw new Error("The answer was too long.");
  });
  return answer;
}
