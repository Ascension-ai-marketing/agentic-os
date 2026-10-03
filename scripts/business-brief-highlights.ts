export type BriefHighlight = { id:string; label:string; value:string; caption:string; ref:string; recordedAt?:string };
/** Select snapshot facts before generation; the model cannot invent these numbers. */
export function briefHighlights(packet: {sources:Record<string,any>}): BriefHighlight[] {
  const business = packet.sources.business;
  if (!business) return [];
  const facts:BriefHighlight[] = [], accounts = business.finances?.accounts || [];
  const currency = accounts[0]?.currency;
  if (accounts.length && typeof currency === "string" && /^[A-Z]{3}$/.test(currency) && accounts.every((a:any) => a.currency === currency && Number.isFinite(a.balance))) {
    facts.push({id:"cash",label:"Cash on hand",value:new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:0}).format(accounts.reduce((sum:number,a:any)=>sum+a.balance,0)),caption:`${accounts.length} account${accounts.length===1?"":"s"} · ${currency}`,ref:"business:workspace",recordedAt:business.finances.recordedAt});
  }
  const add = (platform:string,metric:string,id:string,label:string,caption:string) => {
    const source=business.audience?.find((row:any)=>row.platform===platform), fact=source?.metrics?.[metric];
    if (typeof fact?.value!=="number" || !Number.isFinite(fact.value) || fact.value<0) return;
    facts.push({id,label,value:new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(fact.value),caption,ref:fact.ref || source.ref,recordedAt:fact.recordedAt || source.recordedAt});
  };
  add("youtube","followers","youtube","YouTube","Subscribers");
  if(facts.length<3) add("youtube","views","views","Channel views","Lifetime · YouTube");
  return facts.slice(0,3);
}
