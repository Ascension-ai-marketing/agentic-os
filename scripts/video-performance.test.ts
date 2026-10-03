import { expect, test } from "bun:test";
import { videoPerformance } from "../src/lib/video-performance";
const at = Date.UTC(2026, 8, 17);
const make = (views?: number, index = 0) => ({ id: `v${index}`, views, publishedAt: new Date(at - (index + 1) * 86400000).toISOString() });
test("ranks the latest ten measured uploads and benchmarks only earlier videos", () => {
  const rows = Array.from({ length:20 }, (_,i) => make(i === 0 ? 600 : 100,i));
  const result = videoPerformance(rows,at);
  expect(result.get("v0")).toEqual({rank:1,rankCount:10,multiple:6,baselineCount:10});
  expect(result.get("v1")?.multiple).toBe(1);
  expect(result.get("v10")?.rank).toBeUndefined();
  expect(result.get("v19")?.multiple).toBeUndefined();
});
test("unknown counts, duplicate ids, future dates and zero baselines do not create scores", () => {
  const rows = [make(50), ...Array.from({length:7},(_,i)=>make(i===1?undefined:0,i+1)),make(50), {id:"future",views:9e9,publishedAt:new Date(at+86400000).toISOString()}];
  const result=videoPerformance(rows,at);
  expect(result.size).toBe(8); expect(result.has("future")).toBe(false);
  expect(result.get("v0")?.rankCount).toBe(7); expect(result.get("v0")?.multiple).toBeUndefined();
  expect(result.get("v2")?.rank).toBeUndefined();
});
test("ties share a rank and fewer than five earlier measurements produce no multiple",()=>{
  const result=videoPerformance([make(10),make(10,1),make(5,2)],at);
  expect(result.get("v0")?.rank).toBe(1);expect(result.get("v1")?.rank).toBe(1);expect(result.get("v2")?.rank).toBe(3);expect(result.get("v0")?.multiple).toBeUndefined();
});
