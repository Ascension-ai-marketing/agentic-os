import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operatorPlugin } from "./operator-plugin";
let root:string, base:string, server:Server;
const token='business-qa-token';
beforeAll(async()=>{
 root=mkdtempSync(join(tmpdir(),'business-api-'));
 let middleware:any;
 const plugin=operatorPlugin({root,token,memoryHome:join(root,"fake-home")} as any);
 (plugin.configureServer as any)({middlewares:{use(_path:string,fn:any){middleware=fn}}});
 server=createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end()}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true})});
async function request(path:string,body?:any){const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json','X-Claude-OS-Token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
test('business and personal profile enter memory separately and obey source gates',async()=>{
 let result=await request('/business',{profile:{businessName:'QA Studio',whatYouDo:'Teach creators useful business systems',quarterGoal:'Deliver the autumn program',personalPriorities:'Keep evenings free for family'}});
 expect(result.status).toBe(200);
 let state=(await request('/state')).data;
 expect(state.sources.filter((s:any)=>s.connector?.provider==='business-setup')).toHaveLength(2);
 expect(state.goals.quarter).toBe('Deliver the autumn program');
 await request('/business',{profile:{whatYouDo:'Teach creators practical video systems'}});
 state=(await request('/state')).data;
 expect(state.sources.filter((s:any)=>s.connector?.provider==='business-setup'&&!s.deletedAt)).toHaveLength(2);
 await request('/brain/sources',{id:'business',enabled:false});
 let context=(await request('/brain/context')).data;
 expect(context.business).toBeNull();expect(context.personalProfile.personalPriorities).toBe('Keep evenings free for family');
 expect(context.sources.some((s:any)=>s.origin==='business')).toBe(false);
 await request('/brain/sources',{id:'personal',enabled:false});
 expect((await request('/brain/context')).data.personalProfile).toBeNull();
 await request('/business',{profile:{personalPriorities:'',preferredName:''}});
 state=(await request('/state')).data;
 expect(state.sources.some((s:any)=>s.connector?.itemId==='personal'&&!s.deletedAt)).toBe(false);
});
test('business snapshot APIs validate dates and preserve existing state on rejected import',async()=>{
 const snapshot={platform:'instagram',recordedAt:'2026-09-10',metrics:{followers:100,posts:2},origin:'manual'};
 expect((await request('/business/snapshots',{snapshots:[snapshot]})).status).toBe(200);
 const before=(await request('/business')).data;
 const failed=await request('/business/snapshots',{snapshots:[snapshot,{...snapshot,metrics:{followers:-1}}]});
 expect(failed.status).toBeGreaterThanOrEqual(400);expect((await request('/business')).data).toEqual(before);
 expect((await request('/business/finances',{accounts:[{name:'QA balance',balance:120}],recordedAt:'2026-09-10'})).data.finances.accounts[0].currency).toBeNull();
});
test('progress updates reach shared context only while the business source is enabled',async()=>{
 const created=await request('/business/progress',{action:'goal',horizon:'week',title:'Publish the walkthrough'});
 expect(created.status).toBe(200);
 const goal=created.data.progress.goals[0];
 await request('/business/progress',{action:'check-in',goalId:goal.id,text:'The live interface has been reviewed.'});
 await request('/brain/sources',{id:'business',enabled:true});
 let context=(await request('/brain/context')).data;
 expect(context.business.progress.goals[0].title).toBe('Publish the walkthrough');
 expect(context.business.progress.updates[0].text).toBe('The live interface has been reviewed.');
 await request('/brain/sources',{id:'business',enabled:false});
 context=(await request('/brain/context')).data;
 expect(context.business).toBeNull();
 expect((await request('/business')).data.progress.goals).toHaveLength(1);
});
test('setup goals use canonical periods and business notes/files use the existing memory importer',async()=>{
 const before=(await request('/state')).data.goals;
 const result=await request('/business/progress',{action:'setup-goals',timeZone:'Europe/Vienna',goals:[{horizon:'quarter',title:'Canonical quarter outcome'},{horizon:'month',title:'Canonical month milestone'},{horizon:'week',title:'Canonical Sunday commitment'}]});
 expect(result.status).toBe(200);
 expect(result.data.progress.goals.filter((goal:any)=>goal.title.startsWith('Canonical'))).toHaveLength(3);
 expect(result.data.progress.goals.at(-1).period.timeZone).toBe('Europe/Vienna');
 expect((await request('/state')).data.goals).toEqual(before);
 const note=await request('/memory',{title:'Business DNA fixture',text:'We help independent creators build useful workflows.',collection:'business',origin:'business',kind:'note'});
 expect(note.status).toBe(201);expect(note.data.source.collection).toBe('business');expect(note.data.source.origin).toBe('business');
 const file=await request('/memory',{filename:'business-overview.txt',title:'Business overview',base64:Buffer.from('Our business serves creators who want a clearer view of their work.').toString('base64'),collection:'business',origin:'business',kind:'document'});
 expect(file.status).toBe(201);
 for(let i=0;i<20;i++){const item=(await request('/memory/'+file.data.source.id)).data.source;if(item.status!=='indexing'){expect(item.status).toBe('ready');expect(item.text).toContain('serves creators');break;}await new Promise(resolve=>setTimeout(resolve,20));}
 const ready=(await request('/memory/'+file.data.source.id)).data.source;expect(ready.status).toBe('ready');
});
