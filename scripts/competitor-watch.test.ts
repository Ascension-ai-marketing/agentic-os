import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { competitorWatch } from "./competitor-watch";
const channelId = "UCabcdefghijklmnopqrstuv";
function fixture() {
  const root = mkdtempSync(join(tmpdir(),"watch-test-")), home=join(root,"home");
  mkdirSync(join(home,".config"),{recursive:true});writeFileSync(join(home,".config/agentic-os.env"),'YOUTUBE_API_KEY="fixture-secret"\n');
  return {root,home,close:()=>rmSync(root,{recursive:true,force:true})};
}
const requests: string[] = [];
const request = (async (input:URL|RequestInfo,init?:RequestInit) => {
  const url=new URL(String(input));const endpoint=url.pathname.split('/').at(-1)!;
  requests.push(endpoint);expect(init?.method).toBe("GET");expect(url.hostname).toBe("www.googleapis.com");expect(init?.redirect).toBe("error");
  if(endpoint==="channels")return Response.json({items:[{id:channelId,snippet:{title:"Fixture channel",thumbnails:{medium:{url:"https://yt3.ggpht.com/fixture"}}},statistics:{subscriberCount:"1000"},contentDetails:{relatedPlaylists:{uploads:"UUabcdefghijklmnopqrstuv"}}}]});
  if(endpoint==="playlistItems")return Response.json({items:Array.from({length:30},(_,i)=>({contentDetails:{videoId:`video${String(i).padStart(6,"0")}`}}))});
  if(endpoint==="videos")return Response.json({items:url.searchParams.get("id")!.split(",").map((id,i)=>({id,snippet:{channelId,title:`Upload ${i}`,publishedAt:new Date(Date.UTC(2026,7,1)-i*86400000).toISOString(),thumbnails:{high:{url:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}}},statistics:i===4?{}:{viewCount:"1234"},status:{privacyStatus:i===0?"private":"public"},contentDetails:{duration:i===1?"PT1M":"PT10M"}}))});
  throw new Error("Unexpected request");
}) as typeof fetch;
test("watch list reads bounded public metadata with no comments or private-service requests",async()=>{
  const f=fixture();requests.length=0;
  try{const service=competitorWatch(f.root,{homeDir:f.home,request});const result=await service.sync(["@Fixture"]);
    expect(result.channels).toHaveLength(1);expect(result.channels[0].videos).toHaveLength(24);
    expect(result.channels[0].videos.every(v=>v.durationSeconds>180)).toBe(true);
    expect(result.channels[0].videos.find(v=>v.id==="video000004")?.views).toBeUndefined();
    expect(requests).toEqual(["channels","playlistItems","videos"]);expect(JSON.stringify(result)).not.toContain("fixture-secret");expect(service.read()).toEqual(result);
  }finally{f.close();}
});
test("invalid destinations and oversized lists never start requests",async()=>{
  const f=fixture();requests.length=0;
  try{const service=competitorWatch(f.root,{homeDir:f.home,request});await expect(service.sync(["http://127.0.0.1/private"])).rejects.toThrow();await expect(service.sync(Array(7).fill("@Fixture"))).rejects.toThrow("six");expect(requests).toHaveLength(0);}finally{f.close();}
});
test("provider failure preserves snapshots and never leaks API credentials",async()=>{
  const f=fixture();
  try{await competitorWatch(f.root,{homeDir:f.home,request}).sync(["@Fixture"]);const before=readFileSync(join(f.root,".operator-data/competitor-watch.json"),"utf8");
    const failed=competitorWatch(f.root,{homeDir:f.home,request:(async()=>{throw new Error("key=fixture-secret")}) as typeof fetch});
    const result=await failed.sync();expect(result.channels[0].videos).toHaveLength(24);expect(result.warnings[0]).toContain("earlier snapshot");expect(JSON.stringify(result)).not.toContain("fixture-secret");
    const after=readFileSync(join(f.root,".operator-data/competitor-watch.json"),"utf8");
    await expect(failed.sync(["@Different"])).rejects.toThrow("unchanged");expect(readFileSync(join(f.root,".operator-data/competitor-watch.json"),"utf8")).toBe(after);expect(JSON.parse(before).channels).toEqual(result.channels);
  }finally{f.close();}
});
test("an explicitly empty selection clears only the public watch list",async()=>{
  const f=fixture();try{const service=competitorWatch(f.root,{homeDir:f.home,request});await service.sync(["@Fixture"]);requests.length=0;const result=await service.sync([]);expect(result.channels).toEqual([]);expect(result.inputs).toEqual([]);expect(requests).toEqual([]);}finally{f.close();}
});
