import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { granolaApi } from "./granola-api";
const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "granola-api-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive:true, force:true }); });
const note = { id:"not_123456789abcde", title:"Planning", summary_markdown:"A useful plan for the next launch.", created_at:"2026-09-17" };
test("key setup verifies access before saving and exposes only configuration status", async () => {
  const root = temp(); const key = "synthetic-secret-key";
  const api = granolaApi(root, { fetcher: (async (url, init) => { expect(String(url)).toEndWith("?page_size=1"); expect(init?.headers).toEqual({Authorization:`Bearer ${key}`}); expect(init?.redirect).toBe("error"); return Response.json({notes:[],hasMore:false}); }) as typeof fetch });
  expect(await api.configure(key)).toEqual({configured:true,method:"api"});
  const file = join(root,".operator-data/granola.json"); expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file,"utf8")).toContain(key); expect(JSON.stringify(api.status())).not.toContain(key);
  const rejected = granolaApi(root, {fetcher:(async()=>new Response("secret",{status:401})) as typeof fetch});
  await expect(rejected.configure("invalid-secret-key")).rejects.toThrow("authorize");
  expect(readFileSync(file,"utf8")).toContain(key);
});
test("notes resume a page without transcripts or fetching arbitrary provider URLs", async () => {
  const requests: string[] = []; const api = granolaApi(temp(),{ key:()=>"synthetic-secret", fetcher:(async url => { requests.push(String(url)); return Response.json(requests.length === 1 ? {notes:[{id:note.id,url:"https://untrusted.test"}],hasMore:true,cursor:"next-page"} : {...note,transcript:"Excluded transcript"}); }) as typeof fetch });
  const result = await api.notes("last-page"); expect(result).toMatchObject({hasMore:true,cursor:"next-page"});
  expect(result.documents[0].text).not.toContain("Excluded transcript"); expect(requests).toEqual(["https://public-api.granola.ai/v1/notes?page_size=20&cursor=last-page",`https://public-api.granola.ai/v1/notes/${note.id}`]);
});
test("incomplete pages, invalid references, authorization failure, and oversized responses fail without saving", async () => {
  for (const value of [{notes:[]}, {notes:[],hasMore:true}, {notes:[{id:"../private"}],hasMore:false}]) {
    const root=temp(); const api=granolaApi(root,{key:()=>"test-key",fetcher:(async()=>Response.json(value)) as typeof fetch});
    await expect(api.notes()).rejects.toThrow(); expect(existsSync(join(root,".operator-data/granola.json"))).toBe(false);
  }
  const api=granolaApi(temp(),{key:()=>"test-key",fetcher:(async()=>new Response("x".repeat(2*1024*1024+1))) as typeof fetch});
  await expect(api.notes()).rejects.toThrow("supported import size");
});
