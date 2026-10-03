import { expect, test } from "bun:test";
import { memorySourceStatus } from "../src/lib/memory-source-status";
const base = { id:"claude", available:true, counts:{conversations:1210}, status:"error", progress:{processed:1210,failed:1},error:"~/.claude/projects/test/session.jsonl: exceeds the 64 MiB file limit." };
test("one large history file does not hide already imported history",()=>{
 const state=memorySourceStatus(base);
 expect(state.label).toBe("Large conversation ready to retry");
 expect(state.detail).toContain("1,209 files already processed");
 expect(state.detail).not.toContain("~/.claude");
});
test("bounded continuation is not described as an import failure",()=>{
 expect(memorySourceStatus({...base,status:"idle",progress:{processed:40,hasMore:true,remaining:50}}).label).toBe("More to import");
});
test("missing ChatGPT export and encrypted Granola history give distinct next steps",()=>{
 const empty={...base,available:false,counts:{conversations:0},status:"idle",error:undefined,progress:{processed:0}};
 expect(memorySourceStatus({...empty,id:"chatgpt"}).label).toBe("Export needed");
 expect(memorySourceStatus({...empty,id:"granola",availabilityNote:"Local notes are encrypted."}).label).toBe("Notes stored encrypted");
 expect(memorySourceStatus({...empty,id:"codex"}).label).toBe("No saved files found");
});
