import {expect,test} from 'bun:test';
import {HarnessTextStream} from './harness-stream';
const encode=(events:unknown[])=>new TextEncoder().encode(events.map(event=>JSON.stringify(event)).join('\n'));
test('harness deltas stream before completion with split Unicode preserved',()=>{
 const seen:string[]=[];const stream=new HarnessTextStream(t=>seen.push(t));
 const first=encode([{type:'delta',text:'café 世界'}]);
 for(const byte of first)stream.push(new Uint8Array([byte]));
 stream.push(new TextEncoder().encode('\n'));expect(seen).toEqual(['café 世界']);
 stream.push(encode([{type:'delta',text:'\nsecond'},{type:'done'}]));stream.finish();expect(seen.join('')).toBe('café 世界\nsecond');
});
test('harness partial, malformed, hidden diagnostics and post-completion events fail closed',()=>{
 for(const events of [[{type:'delta',text:'partial'}],[{type:'done'}],[{type:'reasoning',text:'private'}],[{type:'done'},{type:'delta',text:'late'}]]){
 const seen:string[]=[];let failed=false;
 try{const s=new HarnessTextStream(t=>seen.push(t));s.push(encode(events));s.finish()}catch{failed=true}
 expect(failed).toBe(true);expect(seen.join('')).not.toContain('private');
 }
 const s=new HarnessTextStream(()=>{});expect(()=>s.push(new TextEncoder().encode('not json\n'))).toThrow('invalid');
 const e=new HarnessTextStream(()=>{});expect(()=>e.push(encode([{type:'error',message:'SECRET'}]))||e.finish()).toThrow('could not complete');
});
