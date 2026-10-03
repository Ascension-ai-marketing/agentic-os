import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { CONNECTED_READ_TOOLS, connectedLinkId, connectedLinks, selectConnectedTool, unwrapConnectedRead, withConnectedRead } from "./codex-connected-read";

function transport(options: { permission?:boolean; malformed?:boolean; oversized?:boolean; toolError?:boolean; annotations?:any; output?:any } = {}) {
 const requests:any[]=[]; const kills:string[]=[]; let args:string[]=[];
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
 child.kill=(signal:string)=>{kills.push(signal);child.exitCode=0;return true;};
 child.stdin=new Writable({write(bytes,_encoding,done){
  const request=JSON.parse(String(bytes));requests.push(request);
  if(request.id!==undefined)queueMicrotask(()=>{
    if(options.permission&&request.method==="mcpServerStatus/list") {child.stdout.write(JSON.stringify({id:999,method:"item/tool/requestUserInput",params:{}})+"\n");return;}
    if(options.malformed&&request.method==="mcpServerStatus/list"){child.stdout.write("not-json\n");return;}
    if(options.oversized&&request.method==="mcpServerStatus/list"){child.stdout.write(Buffer.alloc(12*1024*1024+1,120));return;}
    const result=request.method==="initialize"?{}:request.method==="thread/start"?{thread:{id:"synthetic-thread"}}:request.method==="mcpServerStatus/list"?{data:[{name:"codex_apps",tools:{"gmail.search_emails":{name:"gmail.search_emails",annotations:options.annotations??{readOnlyHint:true},inputSchema:{type:"object",properties:{link_id:{type:"string",description:'Choose from [{"link_id":"link_6a967e6b15648191b4908fd42d5a922a","profile_email":"owner@example.test"}].'}},required:["link_id"]},_meta:{link_owner_profile:{email:"owner@example.test"}}},"gmail.send_email":{name:"gmail.send_email",annotations:{readOnlyHint:true}}}}]}:options.output??{structuredContent:{emails:[{id:"one",snippet:"café 東京"}]}};
    const response=JSON.stringify(options.toolError&&request.method==="mcpServer/tool/call"?{id:request.id,error:{message:"PRIVATE_ERROR_TOKEN"}}:{id:request.id,result})+"\n";
    const encoded=Buffer.from(response);for(let i=0;i<encoded.length;i+=3)child.stdout.write(encoded.subarray(i,i+3));
  });done();
 }});
 const launch=((_binary:string,flags:string[])=>{args=flags;return child;}) as any;
 return {requests,kills,launch,get args(){return args;}};
}
const run=<T>(fixture:ReturnType<typeof transport>,work:(client:any)=>Promise<T>)=>withConnectedRead("/tmp",work,{binary:"/synthetic/codex",launch:fixture.launch} as any);

test("connected read unwraps only successful structured provider data",()=>{
 expect(unwrapConnectedRead({structuredContent:{value:[]}})).toEqual({value:[]});
 expect(unwrapConnectedRead({content:[{type:"text",text:"A provider heading"},{type:"text",text:'{"emails":[]}' }]})).toEqual({emails:[]});
 expect(()=>unwrapConnectedRead({isError:true,structuredContent:{token:"PRIVATE"}})).toThrow("could not complete");
 expect(()=>unwrapConnectedRead({content:[{type:"text",text:"PRIVATE_DATA"}]})).toThrow("no readable data");
 expect(unwrapConnectedRead({content:[{type:"text",text:"<meetings_data/>"}]}, true)).toEqual({text:"<meetings_data/>"});
 expect([...CONNECTED_READ_TOOLS].some(name=>/send|delete|modify|archive|reply|mark|draft/.test(name))).toBe(false);
});

test("connectedLinkId extracts an opaque account link without storing credentials",()=>{
 expect(connectedLinkId({name:"gmail.search_emails",inputSchema:{properties:{link_id:{description:"Choose link_6a967e6b15648191b4908fd42d5a922a."}},required:["link_id"]}})).toBe("link_6a967e6b15648191b4908fd42d5a922a");
 expect(connectedLinkId({name:"local.read",inputSchema:{properties:{query:{type:"string"}},required:["query"]}})).toBe("");
});

test("connected tool selection uses the requested profile without persisting the link id",()=>{
 const tool:any={name:"gmail.get_profile",inputSchema:{properties:{link_id:{description:'Select from [{"link_id":"link_6a967e6b15648191b4908fd42d5a922a","profile_email":"admin.ascension.marketing@gmail.com"},{"link_id":"link_6ac05846297c8191a1a2afe78b80ffdc","profile_email":"zack@ascension-marketing.ca"}]'}},required:["link_id"]},_meta:{}};
 expect(connectedLinks(tool).map(link=>link.profileEmail)).toEqual(["admin.ascension.marketing@gmail.com","zack@ascension-marketing.ca"]);
 const selected=selectConnectedTool(tool,"zack@ascension-marketing.ca")!;
 expect(selected._meta.link_id).toBe("link_6ac05846297c8191a1a2afe78b80ffdc");
 expect(selected._meta.link_owner_profile.email).toBe("zack@ascension-marketing.ca");
});

test("Codex native refresh invokes one read through an ephemeral session without a model turn",async()=>{
 const f=transport();const result=await run(f,client=>client.call("gmail.search_emails",{query:"newer_than:14d",max_results:30}));
 expect(result.emails[0].snippet).toBe("café 東京");
 expect(f.args).toEqual(["app-server","--stdio"]);
 expect(f.requests.map(r=>r.method)).toEqual(["initialize","initialized","app/installed","thread/start","mcpServerStatus/list","mcpServer/tool/call"]);
 expect(f.requests.find(r=>r.method==="thread/start").params).toMatchObject({ephemeral:true,sandbox:"read-only",approvalPolicy:"never"});
 expect(f.requests.find(r=>r.method==="mcpServer/tool/call").params).toEqual({threadId:"synthetic-thread",server:"codex_apps",tool:"gmail.search_emails",arguments:{query:"newer_than:14d",max_results:30,link_id:"link_6a967e6b15648191b4908fd42d5a922a"}});
 expect(f.requests.some(r=>/turn\/start|login|authorize/.test(r.method))).toBe(false);
 expect(f.kills).toContain("SIGTERM");
});

test("read-only annotation and fixed tool allowlist both gate invocation",async()=>{
 for(const annotations of [{},{readOnlyHint:false},{readOnlyHint:true,destructiveHint:true}]){
  const f=transport({annotations});await expect(run(f,client=>client.call("gmail.search_emails",{}))).rejects.toThrow("not available");
  expect(f.requests.some(r=>r.method==="mcpServer/tool/call")).toBe(false);
 }
 const f=transport();await expect(run(f,client=>client.call("gmail.send_email",{}))).rejects.toThrow("not available");
 expect(f.requests.some(r=>r.method==="mcpServer/tool/call")).toBe(false);
});

test("incoming approval requests close the session without accepting permission",async()=>{
 const f=transport({permission:true});await expect(run(f,async()=>({}))).rejects.toThrow("approval");
 expect(f.requests.some(r=>r.id===999||r.method==="mcpServer/tool/call")).toBe(false);expect(f.kills).toContain("SIGTERM");
});

test("unreadable and oversized runtime output fail closed",async()=>{
 for(const failure of [{malformed:true},{oversized:true}]){
  const f=transport(failure);await expect(run(f,async()=>({}))).rejects.toThrow();
  expect(f.kills).toContain("SIGTERM");expect(f.requests.some(r=>r.method==="mcpServer/tool/call")).toBe(false);
 }
});

test("provider RPC errors are sanitized and successful responses cannot bypass isError",async()=>{
 for(const options of [{toolError:true},{output:{isError:true,content:[{type:"text",text:"PRIVATE_ERROR_TOKEN"}]}}]){
  const f=transport(options);let message="";try{await run(f,client=>client.call("gmail.search_emails",{}));}catch(error){message=(error as Error).message;}
  expect(message).not.toBe("");expect(message).not.toContain("PRIVATE_ERROR_TOKEN");expect(f.kills).toContain("SIGTERM");
 }
});

test("an unresponsive runtime times out and releases the pending request",async()=>{
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;let killed=false;let invoked=false;
 child.stdin=new Writable({write(_bytes,_e,done){done();}});child.kill=()=>{killed=true;child.exitCode=0;return true;};
 await expect(withConnectedRead("/tmp",async()=>{invoked=true;return {};},{binary:"/synthetic/codex",launch:(()=>child) as any,timeoutMs:10})).rejects.toThrow("timed out");
 expect(killed).toBe(true);expect(invoked).toBe(false);
});

test("on Windows the connected read launches codex.cmd through cmd.exe, hidden, and stops it without POSIX signal names",async()=>{
 const f=transport();let file="";let options:any;
 const launch=((binary:string,flags:string[],spawnOptions:any)=>{file=binary;options=spawnOptions;return f.launch(binary,flags,spawnOptions);}) as any;
 const result=await withConnectedRead("C:\\Users\\example\\agentic-os",client=>client.call("gmail.search_emails",{query:"newer_than:14d"}),{binary:"C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd",launch,platform:"win32",env:{ComSpec:"C:\\Windows\\System32\\cmd.exe"}} as any);
 expect(result.emails[0].snippet).toBe("café 東京");
 expect(file).toBe("C:\\Windows\\System32\\cmd.exe");
 expect(f.args).toEqual(["/d","/s","/c",'"C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd app-server --stdio"']);
 expect(options).toMatchObject({cwd:"C:\\Users\\example\\agentic-os",windowsHide:true,windowsVerbatimArguments:true});
 expect(f.kills.length).toBeGreaterThan(0);expect(f.kills.every(signal=>signal===undefined)).toBe(true);
 // A native codex.exe starts directly.
 const g=transport();let direct="";
 await withConnectedRead("C:\\Users\\example\\agentic-os",async()=>({}),{binary:"C:\\Users\\example\\.local\\bin\\codex.exe",launch:((binary:string,flags:string[],spawnOptions:any)=>{direct=binary;return g.launch(binary,flags,spawnOptions);}) as any,platform:"win32",env:{}} as any);
 expect(direct).toBe("C:\\Users\\example\\.local\\bin\\codex.exe");expect(g.args).toEqual(["app-server","--stdio"]);
});
