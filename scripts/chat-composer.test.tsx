import { afterEach, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PromptInput } from "../src/components/ui/ai-chat-input";
import { askModel, loadAskCatalog } from "../src/lib/business-ask";
import { buildChatTurnPrompt } from "../src/lib/chat-turn-prompt";
import { validateChatPrompt, chatSseEvent } from "./chat-request";
import { laneFor } from "../src/lib/model-lane";
import { harnessName, modelRouteDescription } from "../src/components/operator/chat-brand";
import { Toggle as LiquidToggle } from "../src/components/ui/liquid-toggle";
import { ChatHistoryItem } from "../src/components/operator/chat-history-item";
import { ChatCalendarReview } from "../src/components/operator/chat-calendar-review";

let root: Root | undefined;
let restore: Array<() => void> = [];
let images: Array<{ onload?: () => void; naturalWidth: number; naturalHeight: number }> = [];
function setGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restore.push(() =>
    previous
      ? Object.defineProperty(globalThis, name, previous)
      : Reflect.deleteProperty(globalThis, name),
  );
}
async function mount(props: React.ComponentProps<typeof PromptInput>) {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  setGlobal("window", window);
  setGlobal("document", window.document);
  setGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const name of ["scrollHeight", "clientHeight", "offsetHeight", "offsetWidth"]) {
    const previous = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, name);
    Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get: () => 0 });
    restore.push(() =>
      previous
        ? Object.defineProperty(window.HTMLElement.prototype, name, previous)
        : Reflect.deleteProperty(window.HTMLElement.prototype, name),
    );
  }
  setGlobal(
    "Image",
    class {
      onload?: () => void;
      naturalWidth = 100;
      naturalHeight = 80;
      constructor() {
        images.push(this);
      }
    },
  );
  const container = window.document.querySelector("main")!;
  root = createRoot(container);
  await act(async () => root!.render(<PromptInput models={["test"]} {...props} />));
  const textarea = container.querySelector("textarea")!;
  Object.defineProperty(textarea, "setSelectionRange", { value: () => {} });
  const click = async (label: string) =>
    act(async () => {
      const button = container.querySelector(`[aria-label="${label}"]`);
      expect(button).not.toBeNull();
      button!.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
  const choose = async (files: File[]) =>
    act(async () => {
      const input = container.querySelector('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  return { container, textarea, click, choose };
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  restore.reverse().forEach((fn) => fn());
  restore = [];
  images = [];
});

test("the rendered composer sends a greeting with large synthetic history through the Codex request path", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  setGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/__token") return Response.json({ token: "synthetic-token" });
    if (url === "/__operator/models")
      return Response.json({
        models: [
          {
            key: "claude|openai · via codex|gpt-5.6-sol",
            backend: "claude",
            provider: "openai · via codex",
            name: "gpt-5.6-sol",
            label: "Codex · gpt-5.6-sol",
          },
        ],
        statuses: [{ id: "codex", ready: true, detail: "Synthetic sign-in" }],
      });
    if (url.endsWith("_models")) return Response.json({ catalog: [] });
    const body = JSON.parse(String(init?.body));
    requests.push({ url, body });
    // The same prompt validator used before spawning the Vite Chat process.
    validateChatPrompt(body.prompt);
    expect(laneFor(body.model, body.provider)).toBe("codex");
    return new Response(chatSseEvent("chunk", "Hello\nthere") + chatSseEvent("done", "ok"));
  });
  const catalog = await loadAskCatalog();
  const model = catalog.models[0];
  let answer = "";
  const ui = await mount({
    alwaysExpanded: true,
    defaultValue: "heyyy",
    models: [model.key],
    selectedModel: model.key,
    onSubmit: async (request, meta) => {
      const selected = catalog.models.find((item) => item.key === meta.model)!;
      const prompt = buildChatTurnPrompt({
        instructions: "Use only the supplied context. Do not execute actions.",
        workspace: {
          business: { synthetic: '\"\\\n東京😀'.repeat(20_000) },
          inbox: [],
          events: [],
        },
        history: "USER: old synthetic context\n".repeat(5_000),
        evidence: "Synthetic source. ".repeat(10_000),
        pageContext: "No selected page.",
        mailEvidence: "",
        files: "",
        request,
      });
      answer = await askModel(selected, prompt, () => {}, undefined, { effort: "medium" });
      return true;
    },
  });
  await ui.click("Send prompt");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("/__claude_chat");
  expect(requests[0].body.prompt.endsWith("USER REQUEST:\nheyyy")).toBe(true);
  expect(Buffer.byteLength(requests[0].body.prompt)).toBeLessThanOrEqual(96_000);
  expect(requests[0].body.contextMode).toBe("provided");
  expect(requests[0].body.sessionId).toBeUndefined();
  expect(requests[0].body.permissionMode).toBe("plan");
  expect(answer).toBe("Hello\nthere");
  expect(ui.textarea.value).toBe("");
});

test("model search and provider controls escape clipped composer containers", async () => {
  const selected: string[] = [];
  const ui = await mount({
    alwaysExpanded: true,
    models: ["codex", "claude"],
    modelLabels: { codex: "GPT", claude: "Opus" },
    modelGroups: { codex: "Codex", claude: "Claude Code" },
    onModelChange: (model) => selected.push(model),
  });
  await ui.click("Select model. Current: GPT");
  const menu = document.querySelector('[role="dialog"][aria-label="Choose a model"]')!;
  expect(menu).not.toBeNull();
  expect(ui.container.contains(menu)).toBe(false);
  expect(menu.querySelector('[aria-label="Search available models"]')).not.toBeNull();
  expect(menu.querySelector('[aria-label="Chat runtime"]')).not.toBeNull();
  await act(async () => {
    const option = [...menu.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Opus"),
    )!;
    option.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  expect(selected).toEqual(["claude"]);
  expect(document.querySelector('[aria-label="Choose a model"]')).toBeNull();
});

test("saved chat titles can be renamed from right-click and keyboard-accessible options", async () => {
  const ui = await mount({});
  const renamed: string[] = [];
  let opened = 0;
  await act(async () =>
    root!.render(
      <ChatHistoryItem
        title="Original chat"
        detail="2 messages"
        active={false}
        disabled={false}
        onSelect={() => {
          opened++;
        }}
        onRename={(title) => renamed.push(title)}
      />,
    ),
  );
  await act(async () =>
    ui.container
      .querySelector(".ar-history-row")!
      .dispatchEvent(new window.Event("contextmenu", { bubbles: true, cancelable: true })),
  );
  expect(opened).toBe(0);
  expect(ui.container.querySelector(".ar-history-select small")).toBeNull();
  expect(ui.container.querySelector(".ar-history-select")?.getAttribute("title")).toBe(
    "Original chat",
  );
  expect(ui.container.querySelector('[role="menuitem"]')?.textContent).toContain("Rename chat");
  await act(async () =>
    ui.container
      .querySelector('[role="menuitem"]')!
      .dispatchEvent(new window.Event("click", { bubbles: true })),
  );
  expect(ui.container.querySelector('[aria-label="Chat title"]')?.getAttribute("value")).toBe(
    "Original chat",
  );
  await act(async () =>
    ui.container
      .querySelector("form")!
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(renamed).toEqual(["Original chat"]);
  await ui.click("Options for Original chat");
  expect(ui.container.querySelector('[role="menu"]')).not.toBeNull();
});

test.each(["created", "uncertain", "network", "expired"] as const)(
  "calendar booking requires review and a single explicit confirmation (%s)",
  async (outcome) => {
    const ui = await mount({});
    const calls: Array<{ path: string; body: any }> = [];
    const saved: string[] = [];
    const review = {
      reviewId: "synthetic-review",
      expiresAt: new Date(Date.now() + (outcome === "expired" ? -1_000 : 60_000)).toISOString(),
      provider: "google",
      account: "synthetic@example.test",
      calendar: { id: "work", name: "Work" },
      event: {
        title: "Synthetic meeting",
        start: "2030-01-02T09:00:00Z",
        end: "2030-01-02T09:30:00Z",
        timeZone: "UTC",
        attendees: ["guest@example.test"],
        location: "Video call",
        notes: "",
      },
      invitations: true,
    };
    const request = (async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/connections")
        return {
          accounts: [
            { id: "google", connected: true, capabilities: { calendarCreate: true } },
            { id: "outlook", connected: true, capabilities: { calendarCreate: false } },
          ],
        };
      if (path.endsWith("/options")) return { calendars: [{ id: "work", name: "Work" }] };
      if (path.endsWith("/prepare")) return review;
      if (outcome === "network") throw new Error("Synthetic disconnected response");
      return outcome === "created"
        ? { status: "created", eventId: "synthetic-event" }
        : { status: "uncertain", message: "Check the provider calendar before another booking." };
    }) as any;
    await act(async () =>
      root!.render(
        <ChatCalendarReview
          draft={{ ...review.event }}
          request={request}
          onDismiss={() => {}}
          onSaved={(message) => saved.push(message)}
        />,
      ),
    );
    expect(ui.container.querySelector('option[value="outlook"]')).toBeNull();
    expect(calls).toHaveLength(1);
    await act(async () => {
      const select = ui.container.querySelector('[aria-label="Calendar account"]')!;
      Object.defineProperty(select, "value", { configurable: true, value: "google" });
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () =>
      ui.container
        .querySelector("form")!
        .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(calls.map((call) => call.path)).toEqual([
      "/connections",
      "/connections/calendar/options",
      "/connections/calendar/prepare",
    ]);
    expect(ui.container.textContent).toContain("Invitations will be sent to: guest@example.test");
    expect(ui.container.textContent).toContain("synthetic@example.test");
    const confirm = () =>
      [...ui.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Confirm booking",
      )!;
    if (outcome === "expired") {
      expect(confirm().disabled).toBe(true);
      expect(calls.some((call) => call.path.endsWith("/create"))).toBe(false);
      expect(saved).toEqual([]);
      return;
    }
    await act(async () => {
      confirm().dispatchEvent(new window.Event("click", { bubbles: true }));
      confirm().dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const creates = calls.filter((call) => call.path.endsWith("/create"));
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({
      provider: "google",
      reviewId: "synthetic-review",
      confirm: true,
    });
    if (outcome === "created") expect(saved[0]).toContain("Booked in Google Calendar on Work");
    else {
      expect(saved).toEqual([]);
      expect(confirm().disabled).toBe(true);
      expect(ui.container.querySelector('[role="alert"]')).not.toBeNull();
    }
  },
);

test("a rejected send preserves the draft and attachments; acceptance clears both", async () => {
  let accept = false;
  const sent: File[][] = [];
  const ui = await mount({
    defaultValue: "Review this",
    onSubmit: (_text, meta) => {
      sent.push(meta.attachments);
      return accept;
    },
  });
  await ui.choose([new File(["draft"], "plan.txt", { type: "text/plain" })]);
  await ui.click("Send prompt");
  expect(ui.textarea.value).toBe("Review this");
  expect(ui.container.querySelector('[aria-label="Remove plan.txt"]')).not.toBeNull();
  accept = true;
  await ui.click("Send prompt");
  expect(ui.textarea.value).toBe("");
  expect(ui.container.querySelector('[aria-label="Remove plan.txt"]')).toBeNull();
  expect(sent.map((files) => files.length)).toEqual([1, 1]);
});

test("images reserve slots immediately and delayed decoding cannot resurrect a sent attachment", async () => {
  const errors: string[] = [];
  let sent: File[] = [];
  const ui = await mount({
    maxAttachments: 1,
    onAttachmentError: (message) => errors.push(message),
    onSubmit: (_text, meta) => {
      sent = meta.attachments;
    },
  });
  const photo = new File(["test-image"], "photo.png", { type: "image/png" });
  await ui.choose([photo]);
  expect(ui.container.querySelector('[aria-label="Remove photo.png"]')).not.toBeNull();
  await ui.choose([new File(["second"], "second.png", { type: "image/png" })]);
  expect(errors).toContain("A message can contain up to 1 files.");
  await ui.click("Send prompt");
  expect(sent).toEqual([photo]);
  await act(async () => images.forEach((image) => image.onload?.()));
  expect(ui.container.querySelector('[aria-label="Remove photo.png"]')).toBeNull();
});

test("a fresh chat keeps drafting and model setup available while send is unavailable", async () => {
  let sent = false;
  const ui = await mount({
    models: [],
    defaultValue: "Keep this draft",
    sendDisabled: true,
    onSubmit: () => {
      sent = true;
    },
  });
  expect(ui.textarea.disabled).toBe(false);
  expect(
    ui.container.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')?.disabled,
  ).toBe(true);
  await ui.click("Select model. Current: Choose model");
  expect(document.body.textContent).toContain(
    "No models found. Open Connections, then check again.",
  );
  expect(ui.textarea.value).toBe("Keep this draft");
  expect(sent).toBe(false);
});

test("provider tabs and model options keep Codex first without changing a remembered local model", async () => {
  const ui = await mount({
    alwaysExpanded: true,
    models: ["private", "hermes", "claude", "codex"],
    selectedModel: "private",
    modelGroups: { private: "Local", hermes: "Hermes", claude: "Claude Code", codex: "Codex" },
  });
  await ui.click("Select model. Current: private");
  const groups = [...document.querySelectorAll('[aria-label="Chat runtime"] button')].map(
    (button) => button.textContent,
  );
  expect(groups).toEqual(["All", "Codex", "Claude Code", "Hermes", "Local"]);
  const options = [...document.querySelectorAll(".agentic-model-options button")];
  expect(options.map((button) => button.textContent)).toEqual([
    "codexCodex",
    "claudeClaude Code",
    "hermesHermes",
    "privateLocal",
  ]);
  expect(
    options.find((button) => button.getAttribute("aria-pressed") === "true")?.textContent,
  ).toBe("privateLocal");
  const local = [...document.querySelectorAll('[aria-label="Chat runtime"] button')].find(
    (button) => button.textContent === "Local",
  )!;
  await act(async () => local.dispatchEvent(new window.Event("click", { bubbles: true })));
  expect([...document.querySelectorAll(".agentic-model-options button")].map(b => b.textContent)).toEqual(["privateLocal"]);
});

test("the header hosts one model selector and preserves the chosen route and draft", async () => {
  const ui = await mount({ defaultValue: "Keep this thought" });
  const header = document.createElement("header");
  document.body.prepend(header);
  const selected: string[] = [];
  await act(async () =>
    root!.render(
      <PromptInput
        alwaysExpanded
        defaultValue="Keep this thought"
        modelPickerTarget={header}
        models={["deepseek|hermes", "deepseek|sdk"]}
        selectedModel="deepseek|hermes"
        modelLabels={{ "deepseek|hermes": "DeepSeek", "deepseek|sdk": "DeepSeek" }}
        modelGroups={{ "deepseek|hermes": "Hermes", "deepseek|sdk": "DeepSeek Harness" }}
        modelRuntimeLabel="via Hermes"
        modelDescriptions={{
          "deepseek|hermes": "Hermes · OpenRouter",
          "deepseek|sdk": "DeepSeek Harness · OpenRouter",
        }}
        onModelChange={(key) => selected.push(key)}
      />,
    ),
  );
  expect(document.querySelectorAll('[aria-label^="Select model."]').length).toBe(1);
  expect(header.textContent).toContain("via Hermes");
  expect(ui.container.querySelector('[aria-label^="Select model."]')).toBeNull();
  await act(async () =>
    header.querySelector("button")!.dispatchEvent(new window.Event("click", { bubbles: true })),
  );
  const menu = document.querySelector('[role="dialog"][aria-label="Choose a model"]')!;
  expect(menu.textContent).toContain("DeepSeek Harness · OpenRouter");
  await act(async () =>
    [...menu.querySelectorAll<HTMLButtonElement>(".agentic-model-options button")]
      .find((button) => button.textContent?.includes("DeepSeek Harness"))!
      .dispatchEvent(new window.Event("click", { bubbles: true })),
  );
  expect(selected).toEqual(["deepseek|sdk"]);
  expect(document.querySelector('[role="dialog"][aria-label="Choose a model"]')).toBeNull();
  expect(ui.container.querySelector("textarea")?.value).toBe("Keep this thought");
});

test("model identity and runtime stay distinct across the same provider", () => {
  const base = {
    key: "test",
    label: "Test",
    name: "deepseek/deepseek-v4.1-flash",
    provider: "openrouter",
  };
  expect(harnessName({ ...base, backend: "hermes" })).toBe("Hermes");
  expect(harnessName({ ...base, backend: "deepseek" })).toBe("DeepSeek Harness");
  expect(modelRouteDescription({ ...base, backend: "deepseek" })).toBe(
    "DeepSeek Harness · OpenRouter",
  );
  expect(modelRouteDescription({ ...base, backend: "claude" })).toBe("Claude Code · OpenRouter");
  expect(harnessName({ ...base, backend: "claude", provider: "openai · via codex" })).toBe("Codex");
  expect(modelRouteDescription({ ...base, backend: "local", provider: "ollama" })).toBe(
    "Ollama · on this device",
  );
});

test("five-runtime picker routes exact OpenRouter and local models without mixing their lists", async () => {
 const selected:string[]=[];
 const ui=await mount({models:["codex-test","claude-test","hermes-test","sdk-test","local-test"],selectedModel:"codex-test",
  modelGroups:{"codex-test":"Codex","claude-test":"Claude","hermes-test":"Hermes","sdk-test":"OpenRouter","local-test":"Ollama"},
  localModels:["local-test"],
  runtimeChoices:["Codex","Claude","Hermes","OpenRouter","Local"],modelLabels:{"sdk-test":"Vendor current"},
  runtimeDescriptions:{OpenRouter:"Powered by DeepSeek Harness"},onModelChange:m=>selected.push(m)});
 await ui.click("Select model. Current: codex-test");
 // Compact picker: one row of runtime tiles; the description is the tile's tooltip.
 expect([...document.querySelectorAll('.amp-tiles button')].map(b=>b.textContent)).toEqual(["Codex","Claude","Hermes","OpenRouter","Local"]);
 const router=[...document.querySelectorAll('.amp-tiles button')].find(b=>b.textContent==="OpenRouter")!;
 await act(async()=>router.dispatchEvent(new window.Event("click",{bubbles:true})));
 expect(router.getAttribute("title")).toBe("Powered by DeepSeek Harness");
 const options=document.querySelectorAll('.agentic-model-options button');expect(options.length).toBe(1);
 await act(async()=>options[0].dispatchEvent(new window.Event("click",{bubbles:true})));
 expect(selected).toEqual(["sdk-test"]);
 await ui.click("Select model. Current: codex-test");
 const local=[...document.querySelectorAll('.amp-tiles button')].find(b=>b.textContent==="Local")!;
 await act(async()=>local.dispatchEvent(new window.Event("click",{bubbles:true})));
 const localOptions=document.querySelectorAll('.agentic-model-options button');
 expect(localOptions.length).toBe(1);
 expect(localOptions[0].textContent).toBe("local-test");
 await act(async()=>localOptions[0].dispatchEvent(new window.Event("click",{bubbles:true})));
 expect(selected).toEqual(["sdk-test","local-test"]);
});


test("chat deletion can be cancelled and failed deletions keep a visible retry", async () => {
  const ui = await mount({});
  let calls = 0;
  let fail = true;
  await act(async () => root!.render(<ChatHistoryItem title="Delete fixture" active disabled={false}
    onSelect={() => {}} onDelete={async () => { calls++; if (fail) throw new Error("Storage offline"); }} />));
  await ui.click("Delete Delete fixture");
  expect(calls).toBe(0);
  await act(async () => ui.container.querySelector(".ar-history-delete-cancel")!.dispatchEvent(new window.Event("click", {bubbles: true})));
  expect(ui.container.querySelector(".ar-history-delete-confirm")).toBeNull();
  expect(calls).toBe(0);
  await ui.click("Options for Delete fixture");
  await act(async () => ui.container.querySelector('[role="menuitem"]')!.dispatchEvent(new window.Event("click", {bubbles: true})));
  const confirm = () => ui.container.querySelector(".ar-history-delete-confirm .ar-history-delete-option")!.dispatchEvent(new window.Event("click", {bubbles: true}));
  await act(async () => { confirm(); });
  expect(calls).toBe(1);
  expect(ui.container.querySelector('[role="alert"]')?.textContent).toBe("Storage offline");
  expect(ui.container.querySelector(".ar-history-row")).not.toBeNull();
  fail = false;
  await act(async () => { confirm(); });
  expect(calls).toBe(2);
  expect(ui.container.querySelector(".ar-history-delete-confirm")).toBeNull();
});

test("liquid toggles follow parent state, remain accessible and never share SVG filter IDs", async () => {
  const ui = await mount({});
  const render = (checked: boolean) => <><LiquidToggle checked={checked} aria-label="Context" /><LiquidToggle checked={!checked} aria-label="Second context" disabled /></>;
  await act(async () => root!.render(render(true)));
  const input = () => ui.container.querySelector('input[aria-label="Context"]') as HTMLInputElement;
  expect(input().getAttribute("role")).toBe("switch");
  expect(input().checked).toBe(true);
  const ids = [...ui.container.querySelectorAll("filter")].map(el => el.id);
  expect(new Set(ids).size).toBe(2);
  expect(ui.container.querySelector('input[aria-label="Second context"]')?.hasAttribute("disabled")).toBe(true);
  await act(async () => root!.render(render(false)));
  expect(input().checked).toBe(false);
  expect([...ui.container.querySelectorAll("filter")].map(el => el.id)).toEqual(ids);
});
