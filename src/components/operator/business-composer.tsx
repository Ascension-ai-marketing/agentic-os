import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PromptInput } from "@/components/ui/ai-chat-input";
import { loadAskModels, loadAskCatalog, modelPickerGroup, rememberAskModel } from "@/lib/business-ask";
import { askOperator } from "@/lib/operator";
import { ChatModelLogo, ContextLogo } from "./chat-brand";

export function BusinessComposer({ context }: { context: string }) {
  const catalog = useQuery({
    queryKey: ["business-ask-models"],
    queryFn: loadAskModels,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const models = catalog.data ?? [];
  const [chosenModel, setChosenModel] = useState("");
  const selected = models.find((model) => model.key === chosenModel) || models[0];

  return (
    <section className="biz-composer-panel" aria-labelledby="business-advisor-heading">
      <div className="biz-composer-sky" aria-hidden="true" />
      <div className="biz-composer-stack">
        <div className="biz-advisor-heading">
          <h2 id="business-advisor-heading">Your business advisor.</h2>
        </div>
        <PromptInput
          placeholder="What would you like to work through?"
          models={models.map((model) => model.key)}
          unavailableModels={models.filter(model => model.available === false).map(model => model.key)}
          modelLabels={Object.fromEntries(models.map((model) => [model.key, model.label]))}
          modelGroups={Object.fromEntries(models.map(model => [model.key, modelPickerGroup(model)]))}
          renderGroupIcon={group => group === "All" ? null : <ContextLogo origin={group.toLowerCase().replace(" code", "")} />}
          onModelPickerOpen={() => void catalog.refetch()}
          modelPickerFooter={<button type="button" className="ar-prompt-provider" disabled={catalog.isFetching} onClick={async () => { await loadAskCatalog({refresh:true}); await catalog.refetch(); }}>Refresh models</button>}
          selectedModel={selected?.key || ""}
          onModelChange={(key) => {
            setChosenModel(key);
            const model = models.find((model) => model.key === key);
            if (model) rememberAskModel(model);
          }}
          renderModelIcon={(key) => (
            <ChatModelLogo model={models.find((model) => model.key === key)} />
          )}
          sendDisabled={!selected || selected.available === false}
          efforts={["Auto"]}
          maxAttachments={0}
          onVoice={() => window.dispatchEvent(new CustomEvent("operator:voice"))}
          onSubmit={(value, meta) => {
            const model = models.find((model) => model.key === meta.model);
            if (!model || model.available === false) return false;
            rememberAskModel(model);
            askOperator(value, context, true, model.key, "business", "advisor");
          }}
        />
      </div>
    </section>
  );
}
