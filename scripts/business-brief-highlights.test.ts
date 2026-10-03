import {expect,test} from "bun:test";
import {briefHighlights} from "./business-brief-highlights";
test("brief facts never aggregate unknown or mixed currencies and never reconstruct disabled business",()=>{
 const b:any={finances:{accounts:[{balance:10,currency:null},{balance:20,currency:"USD"}]},audience:[{platform:"youtube",ref:"business:yt",metrics:{followers:{value:250000},views:{value:12000000}}},{platform:"instagram",ref:"business:ig",metrics:{followers:{value:3000}}}]};
 expect(briefHighlights({sources:{business:b}}).map(x=>x.id)).toEqual(["youtube","views"]);
 expect(briefHighlights({sources:{}})).toEqual([]);
 b.finances.accounts[0].currency="USD";
 expect(briefHighlights({sources:{business:b}})[0].value).toBe("$30");
 b.finances.accounts[0].currency="EUR";
 expect(briefHighlights({sources:{business:b}}).some(x=>x.id==="cash")).toBe(false);
});
