import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateAdvisorStatus, runPrivateAdvisor } from "./private-advisor";
const signal = () => new AbortController().signal;
function fixture(enabled = true) {
 const root=mkdtempSync(join(tmpdir(),"os-private-advisor-"));
 mkdirSync(join(root,".operator-data"));
 if(enabled)writeFileSync(join(root,".operator-data/private-advisor.json"),JSON.stringify({enabled:true,service:"aiwithjack-advisor",endpoint:"https://www.aiwithjack.com/api/advisor-chat",token:"DO_NOT_EXPOSE"}));
 return {root,clean:()=>rmSync(root,{recursive:true,force:true})};
}
function stream(events: unknown[], finalNewline = true) {
 const content=events.map(e=>`data: ${JSON.stringify(e)}`).join("\n")+(finalNewline?"\n":"");
 const bytes=new TextEncoder().encode(content);
 return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}}),{headers:{"Content-Type":"text/event-stream"}});
}
test("community checkout has no private bot and cannot invoke its endpoint",async()=>{
 const f=fixture(false);let called=false;
 try {expect(privateAdvisorStatus(f.root)).toEqual({enabled:false});
 await expect(runPrivateAdvisor(f.root,{message:"hi",prompt:"context"},signal(),()=>{},(async()=>{called=true;return stream([])}) as typeof fetch)).rejects.toThrow("not enabled");expect(called).toBe(false);
 }finally{f.clean()}
});
test("private adapter streams Unicode tokens, uses fixed destination, and does not expose or forward local config secrets",async()=>{
 const f=fixture();const deltas:string[]=[];let requested:any;
 try{expect(JSON.stringify(privateAdvisorStatus(f.root))).not.toContain("DO_NOT_EXPOSE");
 await runPrivateAdvisor(f.root,{message:"question",prompt:"only enabled context",endpoint:"https://evil.test"} as any,signal(),d=>deltas.push(d),(async(url,init)=>{requested={url,init};return stream([{token:"Hello café "},{token:"世界"},{done:true}],false)}) as typeof fetch);
 expect(deltas.join("")).toBe("Hello café 世界");expect(deltas).toHaveLength(2);
 expect(requested.url).toBe("https://www.aiwithjack.com/api/advisor-chat");expect(requested.init.redirect).toBe("error");expect(JSON.stringify(requested)).not.toContain("DO_NOT_EXPOSE");
 expect(JSON.parse(requested.init.body)).toEqual({message:"question",businessContext:"only enabled context",history:[]});
 }finally{f.clean()}
});
test("partial, errored and truncated advisor answers are never marked complete",async()=>{
 const f=fixture();try{for(const events of [[{token:"partial"}],[{token:"partial"},{error:"PRIVATE_ERROR"}],[{token:"partial"},{done:true,truncated:true}]]) {
 let error="";try{await runPrivateAdvisor(f.root,{message:"hi",prompt:"context"},signal(),()=>{},(async()=>stream(events)) as typeof fetch)}catch(e){error=(e as Error).message}
 expect(error).not.toBe("");expect(error).not.toContain("PRIVATE_ERROR");
 }}finally{f.clean()}
});
test("oversized context is rejected before leaving the device",async()=>{
 const f=fixture();let called=false;try{await expect(runPrivateAdvisor(f.root,{message:"hi",prompt:"a".repeat(100001)},signal(),()=>{},(async()=>{called=true;return stream([])}) as typeof fetch)).rejects.toThrow("too large");expect(called).toBe(false)}finally{f.clean()}
});
test("an endpoint off the advisor host, or without https, leaves the advisor disabled",async()=>{
 for(const endpoint of ["https://evil.test/api/advisor-chat","http://www.aiwithjack.com/api/advisor-chat","https://www.aiwithjack.com/api/advisor-chat?x=1","not a url"]){
 const root=mkdtempSync(join(tmpdir(),"os-private-advisor-"));mkdirSync(join(root,".operator-data"));
 writeFileSync(join(root,".operator-data/private-advisor.json"),JSON.stringify({enabled:true,service:"aiwithjack-advisor",endpoint}));
 let called=false;
 try{expect(privateAdvisorStatus(root)).toEqual({enabled:false});
 await expect(runPrivateAdvisor(root,{message:"hi",prompt:"context"},signal(),()=>{},(async()=>{called=true;return stream([])}) as typeof fetch)).rejects.toThrow("not enabled");expect(called).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true})}}
});
