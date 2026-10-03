#!/usr/bin/env bun
/**
 * sync-elevenlabs-kb.ts
 *
 * One-way copy of the memory vault into an ElevenLabs knowledge base folder, so an
 * ElevenLabs agent with RAG enabled can answer from what the OS knows. The vault
 * stays authoritative: new and changed memories are uploaded, trashed ones are
 * removed. Secrets found in a memory are redacted before it leaves this computer.
 *
 *   bun run sync:kb                    # dry run: show what would be sent
 *   bun run sync:kb --apply            # upload
 *   bun run sync:kb --folder <id>      # ElevenLabs folder (remembered after first use)
 *   bun run sync:kb --collection personal --provider claude --limit 20
 *
 * API contracts verified against ElevenLabs' knowledge base create-from-text and delete docs.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { providerKey } from "./provider-config";

const API = "https://api.elevenlabs.io";
const KEY_NAMES = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"] as const;
/** RAG index allowance per ElevenLabs plan, in bytes. */
export const RAG_LIMITS: [string, number][] = [["Free", 1e6], ["Starter", 2e6], ["Creator", 20e6], ["Pro", 100e6]];

export type VaultDoc = { id: string; title: string; collection: string; provider: string; text: string };
export type SyncState = { version: 1; folderId: string; docs: Record<string, { docId: string; hash: string; name: string }> };
export type Plan = { create: Upload[]; update: Upload[]; remove: { id: string; docId: string; name: string }[]; unchanged: number };
type Upload = { id: string; name: string; text: string; hash: string; hits: number; oldDocId?: string };

const digest = (s: string) => createHash("sha256").update(s).digest("hex");

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bsk_[A-Za-z0-9]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];
/** `API_KEY=…`, `"password": "…"`: the label stays, the value goes. */
const LABELLED = /\b((?:api[_-]?key|secret|token|passwd|password|authorization)\w*["']?\s*[:=]\s*["']?)([^\s"',;]{12,})/gi;

export function redactSecrets(text: string) {
  let hits = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, () => (hits++, "[redacted]"));
  out = out.replace(LABELLED, (_, label: string, value: string) => (value === "[redacted]" ? label + value : (hits++, label + "[redacted]")));
  return { text: out, hits };
}

/** Live vault documents, read through the manifest so trashed and unknown files are skipped. */
export function readVault(root: string): VaultDoc[] {
  const dataDir = join(resolve(root), ".operator-data");
  const manifestPath = join(dataDir, "memory-vault.json");
  if (!existsSync(manifestPath)) return [];
  const entries = JSON.parse(readFileSync(manifestPath, "utf8")).entries as Record<string, { path: string; trashed: boolean }>;
  const docs: VaultDoc[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.trashed || entry.path.startsWith("/") || entry.path.split(/[\\/]/).includes("..")) continue;
    const file = join(dataDir, "vault", entry.path);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const field = (name: string) => {
      const value = front?.[1].match(new RegExp(`^${name}: (.*)$`, "m"))?.[1];
      try { return value ? String(JSON.parse(value) ?? "") : ""; } catch { return value ?? ""; }
    };
    const text = (front ? raw.slice(front[0].length) : raw).trim();
    if (text) docs.push({ id, title: field("title") || id, collection: field("collection"), provider: field("source_provider"), text });
  }
  return docs;
}

export function planSync(docs: VaultDoc[], state: SyncState): Plan {
  const plan: Plan = { create: [], update: [], remove: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const doc of docs) {
    seen.add(doc.id);
    const name = doc.title.replace(/\s+/g, " ").trim().slice(0, 120) || doc.id;
    const clean = redactSecrets(`# ${name}\n\n${doc.text}`);
    const hash = digest(clean.text);
    const known = state.docs[doc.id];
    if (known?.hash === hash) plan.unchanged++;
    else (known ? plan.update : plan.create).push({ id: doc.id, name, text: clean.text, hash, hits: clean.hits, oldDocId: known?.docId });
  }
  for (const [id, known] of Object.entries(state.docs)) if (!seen.has(id)) plan.remove.push({ id, docId: known.docId, name: known.name });
  return plan;
}

const statePath = (root: string) => join(resolve(root), ".operator-data", "elevenlabs-kb-sync.json");
export function loadState(root: string): SyncState {
  try {
    const value = JSON.parse(readFileSync(statePath(root), "utf8"));
    if (value.version === 1 && value.docs) return value;
  } catch { /* A first run has no state. */ }
  return { version: 1, folderId: "", docs: {} };
}
function saveState(root: string, state: SyncState) {
  const file = statePath(root);
  mkdirSync(join(resolve(root), ".operator-data"), { recursive: true, mode: 0o700 });
  writeFileSync(file + ".tmp", JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
async function call(fetcher: Fetch, apiKey: string, method: string, path: string, body?: object) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(API + path, {
      method,
      headers: { "xi-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (response.ok) return response.status === 204 ? {} : await response.json().catch(() => ({}));
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      response.status === 401 ? "ElevenLabs did not accept this key. Allow knowledge base access for it."
        : response.status === 404 && method === "DELETE" ? "gone"
          : `ElevenLabs returned ${response.status}. ${detail}`,
    );
  }
}

/** Applies a plan. State is saved after every document, so an interrupted run resumes cleanly. */
export async function applySync(root: string, plan: Plan, state: SyncState, apiKey: string, fetcher: Fetch = fetch, log: (line: string) => void = () => {}) {
  const drop = async (docId: string) => {
    try { await call(fetcher, apiKey, "DELETE", `/v1/convai/knowledge-base/${encodeURIComponent(docId)}?force=true`); }
    catch (e) { if ((e as Error).message !== "gone") throw e; }
  };
  let sent = 0;
  for (const item of [...plan.create, ...plan.update]) {
    const created = await call(fetcher, apiKey, "POST", "/v1/convai/knowledge-base/text", {
      text: item.text, name: item.name, ...(state.folderId ? { parent_folder_id: state.folderId } : {}),
    });
    if (typeof created.id !== "string") throw new Error("ElevenLabs did not return a document ID.");
    state.docs[item.id] = { docId: created.id, hash: item.hash, name: item.name };
    saveState(root, state);
    if (item.oldDocId) await drop(item.oldDocId);
    log(`${++sent}/${plan.create.length + plan.update.length} ${item.name}`);
  }
  for (const item of plan.remove) {
    await drop(item.docId);
    delete state.docs[item.id];
    saveState(root, state);
    log(`removed ${item.name}`);
  }
  return { uploaded: sent, removed: plan.remove.length };
}

if (import.meta.main) {
  const ROOT = resolve(import.meta.dir, "..");
  const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const APPLY = process.argv.includes("--apply");
  const state = loadState(ROOT);
  state.folderId = flag("--folder") || state.folderId || providerKey(ROOT, "ELEVENLABS_KB_FOLDER_ID");
  let docs = readVault(ROOT);
  const collection = flag("--collection"), provider = flag("--provider"), limit = Number(flag("--limit") || 0);
  if (collection) docs = docs.filter((d) => d.collection === collection);
  if (provider) docs = docs.filter((d) => d.provider === provider);
  if (limit > 0) docs = docs.slice(0, limit);
  const plan = planSync(docs, state);
  // A filtered run must not remove documents it simply did not look at.
  if (collection || provider || limit > 0) plan.remove = [];

  const pending = [...plan.create, ...plan.update];
  const bytes = pending.reduce((n, d) => n + Buffer.byteLength(d.text), 0);
  const total = docs.reduce((n, d) => n + Buffer.byteLength(d.text), 0);
  const withSecrets = pending.filter((d) => d.hits > 0);
  const by = new Map<string, number>();
  for (const d of docs) by.set(d.provider || "unknown", (by.get(d.provider || "unknown") ?? 0) + 1);
  console.log(`\nElevenLabs knowledge base sync  ${APPLY ? "(uploading)" : "(dry run, nothing is sent)"}`);
  console.log(`  Folder      ${state.folderId || "none: documents go to the knowledge base root"}`);
  console.log(`  Memories    ${docs.length}  (${[...by].map(([k, n]) => `${k} ${n}`).join(", ")})`);
  console.log(`  To upload   ${plan.create.length} new, ${plan.update.length} changed, ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`  To remove   ${plan.remove.length}`);
  console.log(`  Unchanged   ${plan.unchanged}`);
  console.log(`  Redactions  ${withSecrets.reduce((n, d) => n + d.hits, 0)} secret-like values in ${withSecrets.length} memories, replaced with [redacted]`);
  const fits = RAG_LIMITS.find(([, max]) => total <= max);
  console.log(`  Plan needed ${fits ? `${fits[0]} or higher` : "Scale or higher"} for ${(total / 1e6).toFixed(2)} MB in total (RAG index allowance)`);
  for (const d of [...pending].sort((a, b) => b.text.length - a.text.length).slice(0, 5)) console.log(`    ${(d.text.length / 1000).toFixed(0).padStart(4)}k  ${d.name}`);

  if (!APPLY) { console.log("\nRun with --apply to upload.\n"); process.exit(0); }
  const apiKey = KEY_NAMES.map((name) => providerKey(ROOT, name)).find(Boolean);
  if (!apiKey) { console.error("\nAdd ELEVENLABS_API_KEY to ~/.config/agentic-os.env, then try again.\n"); process.exit(1); }
  try {
    const done = await applySync(ROOT, plan, state, apiKey, fetch, (line) => console.log("  " + line));
    console.log(`\nUploaded ${done.uploaded}, removed ${done.removed}. Enable RAG on the agent and attach the folder to use them.\n`);
  } catch (e) {
    console.error(`\nStopped: ${(e as Error).message}\nFinished documents are saved; run again to continue.\n`);
    process.exit(1);
  }
}
