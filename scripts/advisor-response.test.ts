import {test,expect} from 'bun:test';
import {parseAdvisorResponse} from '../src/lib/advisor-response';
test('bot references render separately and navigation text never executes',()=>{
 const result=parseAdvisorResponse('Answer <<nav:/memory>>\n---SOURCES---\n[youtube] Test video | 2:10 | https://www.youtube.com/watch?v=abcdefghijk&t=130\n[book] Book | Chapter two | https://example.test/book');
 expect(result.text).toBe('Answer');expect(result.references).toHaveLength(2);expect(result.references[0].kind).toBe('youtube');
});
test('unsafe, credential-bearing and partial reference URLs are not clickable',()=>{
 expect(parseAdvisorResponse('Answer\n---SOURCES---\n[book] Unsafe | One | javascript:alert(1)\n[book] Credentials | Two | https://user:secret@example.test\n[book] Partial | Three | htt').references).toEqual([]);
});
