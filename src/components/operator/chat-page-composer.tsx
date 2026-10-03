import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PromptInput } from "@/components/ui/ai-chat-input";
import {
  loadAskModels,
  loadAskCatalog,
  modelPickerGroup,
  rememberAskModel,
} from "@/lib/business-ask";
import { askOperator } from "@/lib/operator";
import { ChatModelLogo, harnessName, ContextLogo } from "./chat-brand";
import "./chat-refinements.css";
import "./chat-page-composer.css";

/** Page entry into the same saved Chat engine, model choice and source gates. */
export function ChatPageComposer({
  placeholder,
  context = "",
  contextSource,
  title = "Chat",
  description,
  suggestions = [],
}: {
  placeholder: string;
  context?: string;
  contextSource?: string;
  title?: string;
  description?: string;
  suggestions?: string[];
}) {
  const catalog = useQuery({
    queryKey: ["page-chat-models"],
    queryFn: loadAskModels,
    staleTime: 30_000,
  });
  const models = catalog.data ?? [];
  const [chosen, setChosen] = useState("");
  const [draft, setDraft] = useState("");
  const selected = models.find((model) => model.key === chosen) || models[0];
  return (
    <section className="ar-page-chat" aria-label={title}>
      <div className="ar-page-chat-label">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <small>
          {selected ? `Via ${harnessName(selected)}` : "Connect a model in Connections"}
        </small>
      </div>
      <div className="ar-chat-composer">
        <PromptInput
          className="ar-agentic-prompt"
          alwaysExpanded
          value={draft}
          onChange={setDraft}
          controlsAlign="right"
          modelLoading={catalog.isPending || catalog.isFetching}
          runtimeChoices={["Codex", "Claude", "Hermes", "OpenRouter", "Local"]}
          localModels={models
            .filter((model) => model.backend === "local")
            .map((model) => model.key)}
          placeholder={placeholder}
          models={models.map((model) => model.key)}
          unavailableModels={models
            .filter((model) => model.available === false)
            .map((model) => model.key)}
          selectedModel={selected?.key || ""}
          modelLabels={Object.fromEntries(models.map((model) => [model.key, model.name]))}
          modelGroups={Object.fromEntries(
            models.map((model) => [model.key, modelPickerGroup(model)]),
          )}
          renderModelIcon={(key) => (
            <ChatModelLogo model={models.find((model) => model.key === key)} />
          )}
          renderGroupIcon={(group) =>
            group === "All" ? null : (
              <ContextLogo origin={group.toLowerCase().replace(" code", "")} />
            )
          }
          onModelChange={(key) => {
            setChosen(key);
            const model = models.find((item) => item.key === key);
            if (model) rememberAskModel(model);
          }}
          onModelPickerOpen={() => {
            void catalog.refetch();
          }}
          modelPickerFooter={
            <button
              type="button"
              className="ar-prompt-provider"
              disabled={catalog.isFetching}
              onClick={async () => {
                await loadAskCatalog({ refresh: true });
                await catalog.refetch();
              }}
            >
              Refresh models
            </button>
          }
          sendDisabled={!selected || selected.available === false}
          maxAttachments={0}
          efforts={["Default"]}
          onSubmit={(question, meta) => {
            const model = models.find((item) => item.key === meta.model);
            if (!model || model.available === false) return false;
            rememberAskModel(model);
            askOperator(question, context, true, model.key, contextSource);
            setDraft("");
            return true;
          }}
        />
      </div>
      {!!suggestions.length && (
        <div className="ar-page-chat-suggestions">
          {suggestions.map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
