import { afterEach, expect, test } from "bun:test";
import { chatSseEvent } from "./chat-request";
import { askModel, loadAskModels, loadAskCatalog } from "../src/lib/business-ask";
const originalFetch = globalThis.fetch,
  originalWindow = (globalThis as any).window;
afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).window = originalWindow;
});
function endpoint(events: string) {
  globalThis.fetch = (async (url: any, opts: any) =>
    String(url) === "/__token"
      ? Response.json({ token: "test" })
      : new Response(
          new ReadableStream({
            start(c) {
              const bytes = new TextEncoder().encode(events);
              for (let n = 0; n < bytes.length; n += 7) c.enqueue(bytes.slice(n, n + 7));
              c.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )) as any;
}
test("Hermes line boundaries keep a startup warning separate from its answer", async () => {
  endpoint(
    chatSseEvent("chunk", "Warning: Unknown toolsets: messaging\n") +
      chatSseEvent("chunk", "JUNIPER-SUNRISE-421") +
      chatSseEvent("done", "ok"),
  );
  const result = await askModel({ key: "h", backend: "hermes", name: "test" }, "Recall", () => {});
  expect(result).toBe("Warning: Unknown toolsets: messaging\nJUNIPER-SUNRISE-421");
  expect(result.replace(/^Warning: Unknown toolsets:.*$/m, "").trim()).toBe("JUNIPER-SUNRISE-421");
});
test("local token chunks preserve spaces and Unicode across stream boundaries", async () => {
  endpoint("event: chunk\ndata: Hello\n\nevent: chunk\ndata:  café\n\nevent: done\ndata: ok\n\n");
  expect(
    await askModel(
      { key: "l", backend: "local", provider: "ollama", name: "test" },
      "Hi",
      () => {},
    ),
  ).toBe("Hello café");
});
test("provider failures surface instead of returning successful empty text", async () => {
  endpoint("event: error\ndata: Provider is offline\n\n");
  await expect(
    askModel({ key: "l", backend: "local", provider: "ollama", name: "test" }, "Hi", () => {}),
  ).rejects.toThrow("Provider is offline");
});
test("an unavailable remembered local model does not silently switch to cloud", async () => {
  (globalThis as any).window = { localStorage: { getItem: () => "local|ollama|private-model" } };
  globalThis.fetch = (async () =>
    Response.json({
      catalog: [{ provider: "openrouter", models: [{ name: "cloud-model" }] }],
      models: [],
    })) as any;
  const models = await loadAskModels();
  expect(models[0].backend).toBe("local");
  expect(models[0].name).toBe("private-model");
  expect(models[0].label).toContain("unavailable");
});

for (const backend of ["claude", "hermes", "local", "deepseek"] as const) {
  test(`${backend} preserves exact paragraphs, code and split Unicode`, async () => {
    const content = "Here is café.\n\n```ts\nconst value = 1;\n```";
    endpoint(
      chatSseEvent("chunk", content.slice(0, 8)) +
        chatSseEvent("chunk", content.slice(8)) +
        chatSseEvent("done", "ok"),
    );
    expect(await askModel({ key: backend, backend, name: "test" }, "Hi", () => {})).toBe(content);
  });
}
test("CRLF, comments and multiple data lines survive arbitrary network chunks", async () => {
  endpoint(
    ":keepalive\r\n\r\nevent:chunk\r\ndata:Hello\r\ndata: café\r\n\r\nevent:done\r\ndata:ok\r\n\r\n",
  );
  expect(await askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {})).toBe(
    "Hello\ncafé",
  );
});
test("an interrupted partial answer and an empty completed reply fail", async () => {
  endpoint(chatSseEvent("chunk", "An unfinished sentence"));
  await expect(
    askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {}),
  ).rejects.toThrow("incomplete");
  endpoint(":keepalive\n\n" + chatSseEvent("done", "ok"));
  await expect(
    askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {}),
  ).rejects.toThrow("no answer");
});
test("terminal events finish without waiting for the server to close", async () => {
  let cancelled = false;
  globalThis.fetch = (async (url: any) =>
    String(url) === "/__token"
      ? Response.json({ token: "test" })
      : new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(
                  chatSseEvent("chunk", "Complete") + chatSseEvent("done", "ok"),
                ),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
        )) as any;
  expect(await askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {})).toBe(
    "Complete",
  );
  expect(cancelled).toBe(true);
});
test("cancelling an idle stream releases it promptly", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (url: any) =>
    String(url) === "/__token"
      ? Response.json({ token: "test" })
      : new Response(
          new ReadableStream({
            start() {
              queueMicrotask(() => controller.abort());
            },
          }),
        )) as any;
  await expect(
    askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {}, controller.signal),
  ).rejects.toThrow();
});
test("token and unavailable model failures never start a provider request", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ error: "Reload to reconnect locally." }, { status: 403 });
  }) as any;
  await expect(
    askModel({ key: "l", backend: "local", name: "test" }, "Hi", () => {}),
  ).rejects.toThrow("Reload to reconnect");
  expect(calls).toBe(1);
  calls = 0;
  await expect(
    askModel({ key: "l", backend: "local", name: "test", available: false }, "Hi", () => {}),
  ).rejects.toThrow("unavailable");
  expect(calls).toBe(0);
});
test("catalog HTTP failures and malformed optional catalogs preserve known models", async () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  globalThis.fetch = (async (url: any) =>
    String(url) === "/__operator/models"
      ? Response.json({ models: "bad" })
      : String(url) === "/__hermes_models"
        ? Response.json({
            configured: ["connected"],
            catalog: [
              { provider: "connected", models: [{ name: "real" }] },
              { provider: "unconfigured", models: [{ name: "hidden" }] },
            ],
          })
        : Response.json({}, { status: 503 })) as any;
  expect((await loadAskModels()).map((model) => model.name)).toEqual(["real"]);
});

test("known disconnected lanes stay unavailable even when installed-model discovery lists them", async () => {
  (globalThis as any).window = {
    localStorage: { getItem: () => "claude|openai · via codex|gpt-example" },
  };
  globalThis.fetch = (async (url: any) =>
    String(url) === "/__operator/models"
      ? Response.json({
          models: [
            {
              key: "claude|openai · via codex|gpt-example",
              backend: "claude",
              provider: "openai · via codex",
              name: "gpt-example",
              label: "Codex",
            },
          ],
        })
      : String(url) === "/__claude_models"
        ? Response.json({
            laneHealth: { "openai · via codex": { ok: false }, "claude-code": { ok: false } },
            catalog: [{ provider: "claude-code", models: [{ name: "claude-example" }] }],
          })
        : Response.json({ catalog: [] })) as any;
  const models = await loadAskModels();
  expect(models).toHaveLength(1);
  expect(models[0].available).toBe(false);
  expect(models[0].name).toBe("gpt-example");
});

test("fresh-user catalog distinguishes a failed lookup from no configured models", async () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  globalThis.fetch = (async () => Response.json({}, { status: 503 })) as any;
  expect((await loadAskCatalog()).discoveryFailed).toBe(true);
  globalThis.fetch = (async () => Response.json({ models: [], catalog: [], statuses: [] })) as any;
  const empty = await loadAskCatalog();
  expect(empty.discoveryFailed).toBe(false);
  expect(empty.models).toEqual([]);
});
test("local sign-in discovery overrides installed CLI catalogs without inventing cloud access", async () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  globalThis.fetch = (async (url: any) =>
    String(url) === "/__operator/models"
      ? Response.json({
          models: [],
          statuses: [
            { id: "codex", ready: false, detail: "Sign in" },
            { id: "claude", installed: true, ready: false, detail: "Sign in" },
            { id: "hermes", installed: false, ready: false, detail: "Install" },
          ],
        })
      : String(url) === "/__claude_models"
        ? Response.json({
            laneHealth: { "claude-code": { ok: true }, "openai · via codex": { ok: true } },
            catalog: [
              { provider: "claude-code", models: [{ name: "claude-test" }] },
              { provider: "openai · via codex", models: [{ name: "gpt-test" }] },
            ],
          })
        : Response.json({
            configured: ["openrouter"],
            catalog: [{ provider: "openrouter", models: [{ name: "remote-test" }] }],
          })) as any;
  expect((await loadAskCatalog()).models).toEqual([]);
});

test("native runtime catalogs replace old hardcoded menus and Codex leads a fresh selection", async()=>{
 (globalThis as any).window={localStorage:{getItem:()=>null}};
 const model=(backend:string,provider:string,name:string)=>({backend,provider,name,key:`${backend}|${provider}|${name}`,label:name});
 globalThis.fetch=(async (url:any)=>Response.json(String(url).startsWith("/__operator/models")?{
  models:[model("hermes","openrouter","vendor/current"),model("claude","claude-code","claude-current"),model("claude","openai · via codex","gpt-current"),model("local","ollama","private")],
  statuses:[{id:"claude",installed:true,ready:true,detail:"Signed in"},{id:"codex",ready:true,detail:"Signed in"},{id:"openrouter",ready:true,detail:"Current"}],
 }:String(url)==="/__claude_models"?{catalog:[{provider:"claude-code",models:[{name:"claude-stale"}]},{provider:"openai · via codex",models:[{name:"gpt-stale"}]}]}:{configured:["openrouter"],catalog:[{provider:"openrouter",models:[{name:"vendor/stale"}]}]})) as any;
 const models=await loadAskModels();
 expect(models.map(m=>m.name)).toEqual(["gpt-current","claude-current","vendor/current","private","auto-jev"]);
});

test("refresh requests a new catalog and preserves the exact unavailable remembered choice",async()=>{
 const remembered="claude|claude-code|claude-previous[1m]";
 (globalThis as any).window={localStorage:{getItem:()=>remembered}};
 const urls:string[]=[];
 globalThis.fetch=(async(url:any)=>{urls.push(String(url));return Response.json({models:[],catalog:[],statuses:[{id:"claude",ready:false,installed:true,detail:"Sign in"}]});}) as any;
 const catalog=await loadAskCatalog({refresh:true});
 expect(urls).toContain("/__operator/models?refresh=1");
 expect(catalog.models[0].key).toBe(remembered);expect(catalog.models[0].available).toBe(false);
});

test("discovered signed-out Claude choices remain visible but unavailable without displacing a usable default",async()=>{
 (globalThis as any).window={localStorage:{getItem:()=>null}};
 globalThis.fetch=(async(url:any)=>Response.json(String(url)==="/__operator/models"?{
 models:[{key:"claude|claude-code|claude-current",name:"claude-current",label:"Claude Code",backend:"claude",provider:"claude-code"},{key:"hermes|openrouter|vendor/current",name:"vendor/current",label:"Hermes",backend:"hermes",provider:"openrouter"}],statuses:[{id:"claude",installed:true,ready:false,detail:"Signed out"}]
 }:{catalog:[]})) as any;
 const models=await loadAskModels();expect(models[0].backend).toBe("hermes");
 expect(models.find(model=>model.name==="claude-current")?.available).toBe(false);
});

test("configured router models must still exist in the current OpenRouter catalog",async()=>{
 (globalThis as any).window={localStorage:{getItem:()=>null}};
 globalThis.fetch=(async(url:any)=>Response.json(String(url)==="/__operator/models"?{models:[{key:"hermes|openrouter|vendor/current",name:"vendor/current",label:"Hermes",backend:"hermes",provider:"openrouter"}],statuses:[{id:"openrouter",ready:true,detail:"Current"},{id:"claude",installed:true,ready:false,detail:"Signed out"}]}:String(url)==="/__claude_models"?{catalog:[{provider:"openrouter · via claude code",models:[{name:"vendor/current"},{name:"vendor/retired"}]}]}:{catalog:[]})) as any;
 const models=await loadAskModels();
 expect(models.some(model=>model.name==="vendor/retired")).toBe(false);
 expect(models.filter(model=>model.name==="vendor/current")).toHaveLength(1);
  expect(models.some(model=>model.backend==="claude" && model.provider?.includes("openrouter"))).toBe(false);
});
