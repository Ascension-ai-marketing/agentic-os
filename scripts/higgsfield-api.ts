/** Server-only Higgsfield API adapter. No CLI auth or website-credit billing.
 * Sources: docs.higgsfield.ai/docs/{authentication,concepts/file-uploads,concepts/requests}
 * Model schemas come from each official console API-reference page, not the older OpenAPI list.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PriceLine } from "../src/lib/design-pricing";

const API = "https://api.higgsfield.ai";
// The official V2 SDK uses platform.higgsfield.ai. Accepted requests can
// point there even when submitted through api.higgsfield.ai.
const REQUEST_ORIGINS = new Set([API, "https://platform.higgsfield.ai"]);
// Higgsfield moved its console to open.higgsfield.ai (Oct 2026); the old address only redirects.
const CONSOLE = "https://open.higgsfield.ai";
/** "bytedance/seedance-2.5/text-to-video" keeps its slashes: the console redirects %2F links. */
const modelPath = (model: string) => model.split("/").map(encodeURIComponent).join("/");
type Json = Record<string, any>;
type Fetcher = typeof fetch;
export type HiggsfieldParam = {
  name: string;
  type: "string" | "integer" | "boolean";
  default: unknown;
  required: boolean;
  enum?: string[];
};
export type HiggsfieldModel = {
  id: string;
  label: string;
  kind: "image" | "video";
  perUnit: null;
  pricing?: PriceLine[];
  pricingSource: "live" | "unavailable";
};
export type HiggsfieldRequestRecord = {
  requestId: string;
  model: string;
  status: "accepted" | "completed" | "needs_attention" | "stopped";
  updatedAt: number;
};

export function readHiggsfieldRequests(path: string): HiggsfieldRequestRecord[] {
  try {
    const records = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(records) ? records.slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function normalizeHiggsfieldKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().replace(/^Key\s+/i, "");
  return /^[\x21-\x39\x3b-\x7e]{4,512}:[\x21-\x39\x3b-\x7e]{4,1024}$/.test(key) ? key : null;
}

export function higgsfieldEnvironmentKey(env: Record<string, string | undefined>): string | null {
  for (const name of ["HF_CREDENTIALS", "HF_KEY", "HIGGSFIELD_API_KEY"]) {
    const key = normalizeHiggsfieldKey(env[name]);
    if (key) return key;
  }
  return normalizeHiggsfieldKey(`${env.HF_API_KEY_ID ?? env.HF_API_KEY ?? ""}:${env.HF_API_KEY_SECRET ?? env.HF_API_SECRET ?? ""}`);
}

async function boundedBody(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new Error("Higgsfield response exceeds the size limit");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error("Higgsfield response exceeds the size limit");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/** Decode the public server-rendered console data without executing page scripts. */
export function consoleRecords(html: string): Json[] {
  let payload = "";
  for (const match of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)) {
    try {
      const row = JSON.parse(match[1]);
      if (row[0] === 1 && typeof row[1] === "string") payload += row[1];
    } catch {
      /* Not a data chunk. */
    }
  }
  const records: Json[] = [];
  let visited = 0;
  const walk = (value: unknown, depth = 0) => {
    if (++visited > 50_000 || depth > 18) return;
    if (typeof value === "string" && /^[\[{]/.test(value)) {
      try {
        walk(JSON.parse(value), depth + 1);
      } catch {
        /* Ordinary text. */
      }
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
    else if (value && typeof value === "object") {
      records.push(value as Json);
      Object.values(value).forEach((item) => walk(item, depth + 1));
    }
  };
  for (const line of payload.split("\n")) {
    const json = line.slice(line.indexOf(":") + 1);
    if (/^[\[{\"]/.test(json)) {
      try {
        walk(JSON.parse(json));
      } catch {
        /* RSC instruction or streamed text. */
      }
    }
  }
  return records;
}

/** Public console prices. Catalog minima are never treated as a selected-settings quote. */
export function higgsfieldPriceLines(
  row: Json,
  model: string,
  kind: "image" | "video",
  now = Date.now(),
): PriceLine[] {
  const lines: PriceLine[] = [];
  const sourceUrl = `${CONSOLE}/models/${modelPath(model)}/api-reference`;
  const add = (value: Json | undefined, exact: boolean) => {
    if (!value || value.currency !== "USD") return;
    let amount = value.amount;
    const expiry = value.discount_expires_at ? Date.parse(value.discount_expires_at) : null;
    if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now))
      amount = value.original_amount;
    if (
      !(
        typeof amount === "number" ||
        (typeof amount === "string" && /^\d+(?:\.\d+)?$/.test(amount))
      )
    )
      return;
    const costUsd = Number(amount);
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    const unit = value.unit;
    if (!["image", "video", "second", "megapixel", "token", "request"].includes(unit)) return;
    const conditions: Record<string, string> = {};
    if (exact) {
      if (
        !value.configuration ||
        typeof value.configuration !== "object" ||
        Array.isArray(value.configuration)
      )
        return;
      for (const [name, selected] of Object.entries(value.configuration)) {
        if (selected === null || selected === undefined) continue;
        if (name === "batch_size" && Number(selected) === 1) continue; // The adapter always requests one output.
        if (!["string", "number", "boolean"].includes(typeof selected)) return;
        conditions[name === "duration_seconds" ? "duration" : name] = String(selected);
      }
    }
    lines.push({
      billable: kind === "image" ? "output_image" : "output_video",
      unit,
      costUsd,
      provider: "Higgsfield",
      qualifier: exact ? "exact" : "from",
      ...(exact ? { conditions } : {}),
      sourceUrl,
      fetchedAt: new Date(now).toISOString(),
    });
  };
  add(row.pricing?.primary, false);
  for (const option of (Array.isArray(row.pricing?.options) ? row.pricing.options : []).slice(
    0,
    50,
  ))
    add(option, true);
  return lines;
}

export function parseHiggsfieldModels(html: string): HiggsfieldModel[] {
  const found = new Map<string, HiggsfieldModel>();
  for (const row of consoleRecords(html)) {
    if (
      typeof row.slug !== "string" ||
      !/^[a-z0-9][a-z0-9._/-]{1,180}$/.test(row.slug) ||
      row.slug.includes("..")
    )
      continue;
    const kind = row.output_type ?? row.output_types?.[0];
    const id = row.default_mode_id ?? row.slug;
    if (
      !["image", "video"].includes(kind) ||
      !row.title ||
      row.availability_state === "unavailable" ||
      !/^[a-z0-9][a-z0-9._/-]{1,180}$/.test(id) ||
      id.includes("..")
    )
      continue;
    // Workflows are not general-purpose model choices.
    if (id.startsWith("marketing-studio/")) continue;
    const pricing = higgsfieldPriceLines(row, id, kind);
    found.set(id, {
      id,
      label: String(row.title).slice(0, 120),
      kind,
      perUnit: null,
      ...(pricing.length
        ? { pricing }
        : found.get(id)?.pricing
          ? { pricing: found.get(id)!.pricing }
          : {}),
      pricingSource: pricing.length || found.get(id)?.pricing?.length ? "live" : "unavailable",
    });
  }
  return [...found.values()]
    .sort((a, b) => {
      const priority = (m: HiggsfieldModel) => (m.id === "higgsfield-ai/soul/v2/standard" ? 0 : 1);
      return priority(a) - priority(b) || a.label.localeCompare(b.label);
    })
    .slice(0, 150);
}

export function parseHiggsfieldSchema(html: string, model: string): Json {
  const rows = consoleRecords(html);
  const row = rows.find((item) => item.slug === model && item.input_schema?.properties);
  if (!row)
    throw new Error("Higgsfield model controls could not be loaded. Refresh the model list.");
  return row.input_schema;
}

export function higgsfieldParams(schema: Json): HiggsfieldParam[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, raw]) => {
    const p = raw as Json;
    if (
      name === "prompt" ||
      /url|reference|image|video|audio_url|batch_size|num_images|style_id/.test(name) ||
      !["string", "integer", "boolean"].includes(p.type)
    )
      return [];
    return [
      {
        name,
        type: p.type,
        default: p.default ?? null,
        required: (schema.required ?? []).includes(name),
        ...(Array.isArray(p.enum) ? { enum: p.enum.map(String) } : {}),
      },
    ];
  });
}

function externalUrl(raw: unknown): URL {
  const url = new URL(String(raw));
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  )
    throw new Error("Higgsfield returned an unsafe media URL");
  return url;
}

export function publicAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (!isIP(value)) return false;
  if (value.startsWith("::ffff:")) return value.includes(".") && publicAddress(value.slice(7));
  if (value.includes(":")) return !/^(::|fc|fd|fe[89ab])/.test(value);
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19].includes(b))
  );
}

export function requestUrl(raw: unknown, id: string, action: "status" | "cancel"): string {
  const url = new URL(String(raw), API);
  if (
    url.username ||
    url.password ||
    !REQUEST_ORIGINS.has(url.origin) ||
    url.pathname !== `/requests/${id}/${action}` ||
    url.search ||
    url.hash
  )
    throw new Error("Higgsfield returned an invalid request URL");
  return url.href;
}

export function buildHiggsfieldInput(
  schema: Json,
  prompt: string,
  params: Json,
  references: string[],
): Json {
  const props = schema.properties ?? {};
  const input: Json = { prompt };
  for (const [name, p] of Object.entries(props) as Array<[string, Json]>) {
    if (name === "prompt" || /url|reference/.test(name)) continue;
    let value = params[name] ?? p.default;
    if (["batch_size", "num_images"].includes(name)) value = 1;
    if (value === null || value === undefined || value === "") continue;
    if (p.type === "integer" && typeof value === "string") value = Number(value);
    if (p.enum && !p.enum.includes(value))
      throw new Error(`Higgsfield: choose a supported ${name.replaceAll("_", " ")}`);
    if (
      p.type === "integer" &&
      (!Number.isInteger(value) ||
        (p.minimum !== undefined && value < p.minimum) ||
        (p.maximum !== undefined && value > p.maximum))
    )
      throw new Error(`Higgsfield: invalid ${name.replaceAll("_", " ")}`);
    if (p.type === "boolean" && typeof value !== "boolean")
      throw new Error(`Higgsfield: invalid ${name}`);
    if (p.type === "string" && typeof value !== "string")
      throw new Error(`Higgsfield: invalid ${name}`);
    input[name] = value;
  }
  if (references.length) {
    if (props.image_urls) input.image_urls = references;
    else if (props.image_reference_url && references.length === 1)
      input.image_reference_url = references[0];
    else if (props.image_url && references.length === 1) input.image_url = references[0];
    else if (
      props.first_frame_url &&
      (references.length === 1 || (references.length === 2 && props.last_frame_url))
    ) {
      input.first_frame_url = references[0];
      if (references[1] && props.last_frame_url) input.last_frame_url = references[1];
    } else
      throw new Error(
        "This Higgsfield model does not accept those reference images. Choose an image-edit or image-to-video model.",
      );
  }
  for (const required of schema.required ?? [])
    if (input[required] === undefined)
      throw new Error(`Higgsfield needs ${String(required).replaceAll("_", " ")} for this model`);
  return input;
}

export function createHiggsfieldApi(
  options: {
    requestStore?: string;
    fetcher?: Fetcher;
    resolveHost?: (hostname: string) => Promise<Array<{ address: string }>>;
    pause?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  function record(requestId: string, model: string, status: HiggsfieldRequestRecord["status"]) {
    if (!options.requestStore) return;
    const rows = readHiggsfieldRequests(options.requestStore).filter(
      (r) => r.requestId !== requestId,
    );
    rows.unshift({ requestId, model, status, updatedAt: Date.now() });
    mkdirSync(dirname(options.requestStore), { recursive: true, mode: 0o700 });
    const temporary = `${options.requestStore}.tmp`;
    writeFileSync(temporary, JSON.stringify(rows.slice(0, 100)), { mode: 0o600 });
    renameSync(temporary, options.requestStore);
  }
  const fetcher = options.fetcher ?? fetch;
  const resolveHost =
    options.resolveHost ?? ((hostname: string) => lookup(hostname, { all: true }));
  async function checkedExternalUrl(raw: unknown): Promise<URL> {
    const url = externalUrl(raw);
    const addresses = await resolveHost(url.hostname);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      throw new Error("Higgsfield returned a non-public media host");
    return url;
  }
  const pause =
    options.pause ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Generation cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, ms);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }));
  let catalogCache: { at: number; models: HiggsfieldModel[] } | null = null;
  const schemas = new Map<string, { at: number; schema: Json }>();
  async function publicPage(path: string) {
    const response = await fetcher(`${CONSOLE}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(`Higgsfield model catalog unavailable (HTTP ${response.status})`);
    return (await boundedBody(response, 3_000_000)).toString("utf8");
  }
  async function api(
    path: string,
    key: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<Json> {
    const credential = normalizeHiggsfieldKey(key);
    if (!credential) throw new Error("Enter the Higgsfield API key as KEY_ID:KEY_SECRET");
    const target = new URL(path, API);
    if (!REQUEST_ORIGINS.has(target.origin) || target.username || target.password)
      throw new Error("Higgsfield returned an invalid API origin");
    const response = await fetcher(target.href, {
      ...init,
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Key ${credential}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Never reflect provider response bodies: they can contain input or credentials.
      if (response.status === 401 || response.status === 403)
        throw new Error("Higgsfield rejected the API key. Check its ID and secret.");
      throw new Error(`Higgsfield API request failed (HTTP ${response.status})`);
    }
    const body = await boundedBody(response, 2_000_000);
    try {
      return body.length ? JSON.parse(body.toString("utf8")) : {};
    } catch {
      throw new Error("Higgsfield returned an unreadable API response");
    }
  }
  async function publicPricing(): Promise<Map<string, Json>> {
    const rows = new Map<string, Json>();
    // The public console currently returns 75 rows. At most three pages are read;
    // never follow a provider-supplied next URL or fetch account billing data.
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetcher(
        `https://dash.higgsfield.ai/api/v2/pricing/models/?page=${page}&page_size=50`,
        {
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) break;
      const payload = JSON.parse((await boundedBody(response, 2_000_000)).toString("utf8"));
      if (!Array.isArray(payload.results)) break;
      for (const row of payload.results.slice(0, 50)) {
        if (typeof row?.slug === "string") rows.set(row.slug, row);
        // Since Oct 2026 each version sits under modes[] with its own exact price
        // (the family row only carries a "from" price).
        for (const mode of Array.isArray(row?.modes) ? row.modes.slice(0, 40) : [])
          if (typeof mode?.slug === "string") rows.set(mode.slug, mode);
      }
      if (!payload.next || payload.results.length < 50) break;
    }
    return rows;
  }
  async function models() {
    if (catalogCache && Date.now() - catalogCache.at < 3_600_000) return catalogCache.models;
    const [catalogPage, currentPrices] = await Promise.all([
      publicPage("/explore"),
      publicPricing().catch(() => new Map<string, Json>()),
    ]);
    const models = parseHiggsfieldModels(catalogPage);
    for (const model of models) {
      const row = currentPrices.get(model.id);
      if (!row) continue;
      // "Kling 3.0 4K · Text to Video" says which version this is.
      if (typeof row.display_title === "string" && row.display_title.trim()) model.label = row.display_title.trim().slice(0, 120);
      const pricing = higgsfieldPriceLines(row, model.id, model.kind);
      if (pricing.length) {
        model.pricing = pricing;
        model.pricingSource = "live";
      }
    }
    if (!models.length)
      throw new Error(
        "Higgsfield's API model catalog could not be read. Open Connections and refresh.",
      );
    catalogCache = { at: Date.now(), models };
    return models;
  }
  async function schema(model: string) {
    if (!(await models()).some((item) => item.id === model))
      throw new Error("Unknown Higgsfield API model. Select a model again.");
    const hit = schemas.get(model);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.schema;
    const value = parseHiggsfieldSchema(
      await publicPage(`/models/${modelPath(model)}/api-reference`),
      model,
    );
    schemas.set(model, { at: Date.now(), schema: value });
    return value;
  }
  async function verifyKey(key: string) {
    // The documented upload-grant endpoint verifies auth without generating paid media.
    const grant = await api("/files/generate-upload-url", key, {
      method: "POST",
      body: JSON.stringify({ content_type: "image/png" }),
    });
    externalUrl(grant.upload_url);
    externalUrl(grant.public_url);
  }
  async function upload(key: string, path: string, signal?: AbortSignal) {
    if (statSync(path).size > 20_000_000)
      throw new Error("Higgsfield reference images must be 20 MB or smaller");
    const contentType = (
      {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
      } as Record<string, string>
    )[extname(path).toLowerCase()];
    if (!contentType) throw new Error("Choose a PNG, JPEG, WebP or GIF reference image");
    const grant = await api(
      "/files/generate-upload-url",
      key,
      { method: "POST", body: JSON.stringify({ content_type: contentType }) },
      signal,
    );
    const target = await checkedExternalUrl(grant.upload_url);
    const publicUrl = (await checkedExternalUrl(grant.public_url)).href;
    const headers: Record<string, string> = { "Content-Type": contentType };
    for (const [name, value] of Object.entries(grant.upload_headers ?? {})) {
      if (/^(authorization|cookie|host|proxy-authorization)$/i.test(name))
        throw new Error("Higgsfield returned invalid upload headers");
      if (typeof value === "string") headers[name] = value;
    }
    const response = await fetcher(target, {
      method: "PUT",
      redirect: "error",
      headers,
      body: readFileSync(path),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Higgsfield reference upload failed (HTTP ${response.status})`);
    return publicUrl;
  }
  async function generate(
    key: string,
    model: string,
    kind: "image" | "video",
    prompt: string,
    params: Json,
    references: string[],
    signal?: AbortSignal,
  ): Promise<{ buf: Buffer; ext: string }> {
    signal?.throwIfAborted();
    if (references.length > 8) throw new Error("Use no more than eight reference images");
    const spec = await schema(model);
    if (!(await models()).some((item) => item.id === model && item.kind === kind))
      throw new Error("Choose a Higgsfield model for this output type");
    // Validate references and controls before uploading files or submitting a paid job.
    buildHiggsfieldInput(
      spec,
      prompt,
      params,
      references.map((_, i) => `https://reference.example/${i}.png`),
    );
    const urls: string[] = [];
    for (const path of references.slice(0, 8)) urls.push(await upload(key, path, signal));
    const created = await api(
      `/${model}`,
      key,
      { method: "POST", body: JSON.stringify(buildHiggsfieldInput(spec, prompt, params, urls)) },
      signal,
    );
    const id = String(created.request_id ?? "");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
      throw new Error(
        "Higgsfield accepted the request but returned no valid request ID. Check API requests before retrying.",
      );
    let cancelUrl: string | null = null;
    let result = created;
    const deadline = Date.now() + (kind === "video" ? 15 : 8) * 60_000;
    try {
      // Persist the ID before validating returned URLs or polling. Never lose
      // an accepted request just because a later response cannot be handled.
      record(id, model, "accepted");
      const statusUrl = requestUrl(created.status_url, id, "status");
      cancelUrl = requestUrl(created.cancel_url, id, "cancel");
      while (result.status !== "completed") {
        signal?.throwIfAborted();
        if (["failed", "nsfw", "canceled", "cancelled"].includes(result.status))
          throw new Error(`Higgsfield request ${result.status}. Check its API request details.`);
        if (Date.now() > deadline)
          throw new Error(
            `Higgsfield is still processing request ${id}. Check API requests before retrying.`,
          );
        await pause(2500, signal);
        result = await api(statusUrl, key, {}, signal);
      }
      const url = await checkedExternalUrl(
        kind === "image" ? result.images?.[0]?.url : result.video?.url,
      );
      const response = await fetcher(url, {
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(`Higgsfield output download failed (HTTP ${response.status})`);
      const buf = await boundedBody(response, kind === "video" ? 250_000_000 : 30_000_000);
      const suffix = extname(url.pathname).slice(1).toLowerCase();
      record(id, model, "completed");
      return {
        buf,
        ext: ["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"].includes(suffix)
          ? suffix
          : kind === "video"
            ? "mp4"
            : "png",
      };
    } catch (error) {
      if (signal?.aborted) {
        if (cancelUrl) await api(cancelUrl, key, { method: "POST" }).catch(() => {});
        record(id, model, "stopped");
        throw new DOMException(
          "Stopped waiting for Higgsfield. A job already processing may still finish; check API requests.",
          "AbortError",
        );
      }
      record(id, model, "needs_attention");
      const detail = error instanceof Error ? error.message : "The output could not be retrieved";
      throw new Error(`${detail}. Request ${id}. Check API requests before retrying.`);
    }
  }
  return { models, schema, verifyKey, upload, generate };
}
