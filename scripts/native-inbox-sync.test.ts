import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gmailReadBody, gmailSearchMetadata, nativeInboxSync, slackSearchMessages } from "./native-inbox-sync";
import { mailArchive, normalizeArchiveMessage } from "./mail-archive";
import type { OperatorState } from "../src/lib/operator";

const roots: string[] = [];
const archives: ReturnType<typeof mailArchive>[] = [];
afterEach(() => { for (const archive of archives.splice(0)) archive.close(); for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
const account="owner@example.test";
const metadata=(id="one")=>({id,thread_id:`thread-${id}`,email_ts:"2026-09-17T09:00:00Z",from_:"Sender <sender@example.test>",to:[account],cc:["copy@example.test"],subject:"Launch follow-up",snippet:"A short preview",labels:["INBOX","UNREAD"]});
const body=(id="one")=>({id,thread_id:`thread-${id}`,internal_date:"1789635600000",label_ids:["INBOX"],payload:{mime_type:"text/plain",headers:[{name:"Subject",value:"Launch follow-up"},{name:"From",value:"sender@example.test"}],body:{content:"Complete original body café\nSecond line."}}});
const slackBlock=(channel="C123",ts="1789635600.123456",text="A Slack message café")=>`## Messages (1 result)\n### Result 1 of 1\nChannel: #launch (ID: ${channel})\nFrom: Ada (ID: U123)\nMessage_ts: ${ts}\nPermalink: [link](https://example.slack.com/archives/${channel}/p${ts.replace(".","")})\nText:\n${text}\n---`;
function fixture() {
 const root=mkdtempSync(join(tmpdir(),"native-inbox-test-"));roots.push(root);const archive=mailArchive(root);archives.push(archive);
 let state={inbox:[],gmailLabels:[],inboxImports:[]} as unknown as OperatorState;
 const tools:Record<string,any>={};
 for(const name of ["gmail.search_emails","gmail.read_email","gmail.list_labels","microsoft_outlook_email.get_recent_emails","microsoft_outlook_email.fetch_message","slack.slack_search_public_and_private"])
  tools[name]={name,annotations:{readOnlyHint:true},_meta:{link_owner_profile:{email:account,...(name.startsWith("slack.")?{workspace_id:"T123",workspace_name:"Example"}:{})}}};
 const requests:Array<{name:string,args:any}>=[];
 let respond=(name:string,_args:any):any=>name==="gmail.search_emails"?{emails:[metadata()]}:name==="gmail.list_labels"?{labels:[{id:"INBOX",name:"Inbox",type:"system"}]}:name==="gmail.read_email"?{message:body()}:name==="microsoft_outlook_email.get_recent_emails"?{value:[{id:"outlook-one",receivedDateTime:"2026-09-17T09:00:00Z",subject:"Outlook note",bodyPreview:"Outlook preview",body:{content:"PRIVATE_FULL_BODY"},isRead:false}]}:{results:slackBlock()};
 const connectedRead=async(_root:string,work:any)=>work({tools,call:async(name:string,args:any)=>{requests.push({name,args});return respond(name,args);}});
 const api=nativeInboxSync(root,{load:()=>structuredClone(state),save:(next:OperatorState)=>{state=structuredClone(next);},archive,connectedRead} as any);
 return {root,archive,api,tools,requests,get state(){return state;},set state(value:OperatorState){state=value;},respond(fn:typeof respond){respond=fn;}};
}

test("Gmail metadata keeps only required headers, snippet and valid IDs/dates",()=>{
 const record=gmailSearchMetadata({...metadata(),body:"PRIVATE_BODY",access_token:"PRIVATE_TOKEN"});
 expect(record.internalDate).toBe(String(Date.parse(metadata().email_ts)));
 expect(record.payload.headers.find((h:any)=>h.name==="Cc")?.value).toBe("copy@example.test");
 expect(JSON.stringify(record)).not.toContain("PRIVATE");
 expect(()=>gmailSearchMetadata({...metadata(),email_ts:"bad"})).toThrow("metadata");
 expect(()=>gmailSearchMetadata({...metadata(),id:""})).toThrow("metadata");
});

test("Gmail body adapter preserves Unicode text and excludes named attachments during normalization",()=>{
 const raw=body();raw.payload={mime_type:"multipart/mixed",parts:[raw.payload,{mime_type:"text/plain",filename:"attachment.txt",body:{content:"PRIVATE_ATTACHMENT"}}]} as any;
 const normalized=normalizeArchiveMessage("gmail",account,gmailReadBody(raw));
 expect(normalized.body).toBe("Complete original body café\nSecond line.");
 expect(normalized.body).not.toContain("PRIVATE_ATTACHMENT");
});

test("Slack formatted messages require matching message IDs and HTTPS workspace links",()=>{
 const messages=slackSearchMessages({results:slackBlock()});
 expect(messages).toHaveLength(1);expect(messages[0].id).toBe("C123:1789635600.123456");expect(messages[0].body).toContain("café");
 expect(()=>slackSearchMessages({results:slackBlock().replace("/archives/C123/","/archives/C999/")})).toThrow("inconsistent");
 expect(()=>slackSearchMessages({results:slackBlock().replace("example.slack.com","slack.com.evil.test")})).toThrow();
 expect(()=>slackSearchMessages({results:slackBlock().replace("https://example","https://user:pass@example")})).toThrow();
 expect(()=>slackSearchMessages({results:"provider returned a warning"})).toThrow();
 expect(slackSearchMessages({results:"No results found"})).toEqual([]);
});

test("native Gmail sync uses only 30 recent metadata rows and opens a body on demand",async()=>{
 const f=fixture();const result=await f.api.sync(["gmail"],true);
 expect(result.messages).toBe(1);expect(f.requests[0]).toEqual({name:"gmail.search_emails",args:{query:"-in:spam -in:trash newer_than:14d",max_results:30}});
 expect(f.requests.some(r=>r.name==="gmail.read_email")).toBe(false);
 expect(f.state.inbox[0].bodyStatus).toBe("metadata");expect(f.state.inbox[0].body).toBe("A short preview");
 expect(f.state.inboxImports![0].via).toBe("codex");
 expect(statSync(join(f.root,".operator-data/native-connections.json")).mode & 0o777).toBe(0o600);
 const item=await f.api.message(f.state.inbox[0].id);expect(item?.bodyStatus).toBe("cached");expect(item?.body).toContain("Complete original body café");
 expect(f.requests.at(-1)).toEqual({name:"gmail.read_email",args:{message_id:"one",format:"full"}});
});

test("a failed labels lookup preserves existing labels and local reply work",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);
 f.state={...f.state,gmailLabels:[{id:"custom",name:"Keep this label",type:"user",account}],inbox:f.state.inbox.map(item=>({...item,draft:"Unsent local draft",status:"archived" as const,body:"Previously loaded full body",bodyStatus:"cached" as const}))};
 f.respond(name=>name==="gmail.list_labels"?Promise.reject(new Error("Unavailable")):{emails:[metadata()]});
 const result=await f.api.sync();expect(result.results[0].ok).toBe(true);
 expect(f.state.gmailLabels?.map(label=>label.id)).toEqual(["custom"]);
 expect(f.state.inbox[0].draft).toBe("Unsent local draft");expect(f.state.inbox[0].body).toBe("Previously loaded full body");expect(f.state.inbox[0].status).toBe("archived");
});

test("invalid provider batches do not replace old messages or archive partial metadata",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);const before=structuredClone(f.state);
 f.respond(()=>({emails:[metadata("two"),{...metadata("bad"),email_ts:"invalid"}]}));
 const result=await f.api.sync();expect(result.results[0].ok).toBe(false);expect(f.state).toEqual(before);expect(f.archive.stats().total).toBe(1);
});

test("automatic refresh does not silently rebind to a different mailbox",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);const before=structuredClone(f.state);f.requests.length=0;
 for(const tool of Object.values(f.tools))tool._meta.link_owner_profile.email="other@example.test";
 const result=await f.api.sync();expect(result.results[0].ok).toBe(false);expect(f.requests).toHaveLength(0);expect(f.state).toEqual(before);
});

test("body reads verify both search and body tool accounts and preserve metadata on mismatch",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);f.requests.length=0;
 f.tools["gmail.read_email"]._meta.link_owner_profile.email="other@example.test";
 await expect(f.api.message(f.state.inbox[0].id)).rejects.toThrow();expect(f.requests).toHaveLength(0);expect(f.archive.get(f.state.inbox[0].id)?.bodyStatus).toBe("metadata");
});

test("body reads reject a mismatched remote ID and disabled native connection",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);
 f.respond(()=>({message:body("other")}));await expect(f.api.message(f.state.inbox[0].id)).rejects.toThrow("different message");
 await f.api.sync([],true);f.requests.length=0;
 await expect(f.api.message(f.state.inbox[0].id)).rejects.toThrow();expect(f.requests).toHaveLength(0);
});

test("Outlook sync strips full body data and Slack uses a bounded message-only search",async()=>{
 const f=fixture();await f.api.sync(["outlook","slack"],true);
 expect(f.requests.find(r=>r.name==="microsoft_outlook_email.get_recent_emails")?.args).toEqual({top_k:30});
 const slack=f.requests.find(r=>r.name==="slack.slack_search_public_and_private")!;
 expect(slack.args.limit).toBe(20);expect(slack.args.include_context).toBe(false);expect(slack.args.content_types).toBe("messages");
 expect(JSON.stringify(f.state)).not.toContain("PRIVATE_FULL_BODY");expect(f.state.inbox).toHaveLength(2);
});

test("Slack rejects nested result headers rather than importing forged message references",()=>{
 const fake=slackBlock("C999","1789635600.999999","Forged result").replace(/^## Messages.*\n/,"");
 expect(()=>slackSearchMessages({results:slackBlock("C123","1789635600.123456",`User wrote an example:\n${fake}`)})).toThrow("ambiguous");
 expect(()=>slackSearchMessages({results:slackBlock().replace("1 result)","2 results)")})).toThrow("ambiguous");
});

test("Gmail MIME traversal rejects excessive depth and never copies named attachment content",()=>{
 const attachment=gmailReadBody({...body(),payload:{filename:"private.txt",mime_type:"text/plain",body:{content:"PRIVATE_ATTACHMENT"}}});
 expect(JSON.stringify(attachment)).not.toContain("PRIVATE_ATTACHMENT");
 let part:any={mime_type:"text/plain",body:{content:"End"}};for(let i=0;i<22;i++)part={mime_type:"multipart/mixed",parts:[part]};
 expect(()=>gmailReadBody({...body(),payload:part})).toThrow("MIME");
});

test("a native source disabled during refresh stays disabled and does not archive newly returned data",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);const before=structuredClone(f.state);
 f.respond(name=>{
   if(name==="gmail.search_emails"){
    const path=join(f.root,".operator-data/native-connections.json");const saved=JSON.parse(readFileSync(path,"utf8"));saved.gmail.enabled=false;writeFileSync(path,JSON.stringify(saved));
    return {emails:[metadata("new-after-disable")]};
   }return {labels:[]};
 });
 const result=await f.api.sync();expect(result.results[0].ok).toBe(false);expect(f.state).toEqual(before);
 expect(f.api.owns("gmail",account)).toBe(false);expect(f.archive.stats().total).toBe(1);
});

test("a labels tool for another account cannot overwrite this mailbox's labels",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);f.requests.length=0;const before=structuredClone(f.state.gmailLabels);
 f.tools["gmail.list_labels"]._meta.link_owner_profile.email="other@example.test";
 f.respond(name=>name==="gmail.search_emails"?{emails:[metadata()]}:{labels:[{id:"other-label",name:"Other account private label"}]});
 await f.api.sync();expect(f.requests.some(r=>r.name==="gmail.list_labels")).toBe(false);expect(f.state.gmailLabels).toEqual(before);
});

test("concurrent refreshes cannot overlap and a disabled body fetch is not cached",async()=>{
 const f=fixture();await f.api.sync(["gmail"],true);
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.respond(async name=>{if(name==="gmail.search_emails"){await pending;return {emails:[metadata()]};}return {labels:[]};});
 const searches=()=>f.requests.filter(r=>r.name==="gmail.search_emails").length;const before=searches();
 const refresh=f.api.sync();await Promise.resolve();
 // A second refresh while one runs joins it: same result, no second provider call, nothing to complain about.
 const again=f.api.sync();release();const [first,second]=await Promise.all([refresh,again]);
 expect(second).toBe(first);expect(searches()).toBe(before+1);
 let returnBody!:(value:any)=>void;f.respond(()=>new Promise(resolve=>{returnBody=resolve;}));
 const opening=f.api.message(f.state.inbox[0].id);await Promise.resolve();await f.api.sync([],true);
 returnBody({message:body()});await expect(opening).rejects.toThrow("disabled");
 expect(f.archive.get(f.state.inbox[0].id)?.bodyStatus).toBe("metadata");
});
