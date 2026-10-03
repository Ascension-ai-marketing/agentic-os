import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { businessWorkspace } from "./business-workspace";

function workspace(run: (service: ReturnType<typeof businessWorkspace>, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "business-workspace-"));
  try { run(businessWorkspace(root), root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const observation = { platform: "youtube", recordedAt: "2026-09-10T12:00:00Z", metrics: { followers: 10 }, origin: "manual", sourceLabel: "QA" };
test("business profile and widget patches preserve other choices and persist privately", () => workspace((store, root) => {
  store.update({ profile: { businessName: "QA business", personalPriorities: "Time with family" }, widgets: { dream: false } });
  store.update({ profile: { whoYouHelp: "Creators" }, widgets: { audience: false, nonsense: true } });
  const saved = businessWorkspace(root).read();
  expect(saved.profile.businessName).toBe("QA business"); expect(saved.profile.whoYouHelp).toBe("Creators");
  expect(saved.widgets.dream).toBe(false); expect(saved.widgets.aiSpend).toBe(true); expect(saved.widgets.nonsense).toBeUndefined();
  expect(statSync(join(root, ".operator-data/business.json")).mode & 0o777).toBe(0o600);
}));
test("dated snapshots merge by observation and retain explicit zero while missing stays absent", () => workspace((store) => {
  store.importSnapshots({ snapshots: [observation] });
  store.importSnapshots({ snapshots: [{ ...observation, metrics: { views: 0 } }] });
  const saved = store.read().snapshots;
  expect(saved).toHaveLength(1); expect(saved[0].metrics).toEqual({ followers: 10, views: 0 });
  expect(saved[0].metrics.members).toBeUndefined();
  store.importSnapshots({ snapshots: [{ ...observation, recordedAt: "2026-09-11", metrics: { followers: 12 } }] });
  expect(store.read().snapshots).toHaveLength(2);
}));
test("invalid batches and unsafe source URLs fail without erasing saved history", () => workspace((store) => {
  store.importSnapshots({ snapshots: [observation] });
  expect(() => store.importSnapshots({ snapshots: [observation, { ...observation, metrics: { followers: -1 } }] })).toThrow();
  expect(() => store.importSnapshots({ snapshots: [{ ...observation, sourceUrl: "javascript:alert(1)" }] })).toThrow();
  expect(() => store.importSnapshots({ snapshots: [{ ...observation, sourceUrl: "https://key:secret@example.com" }] })).toThrow();
  expect(() => store.importSnapshots({ snapshots: [{ ...observation, recordedAt: "2126-01-01" }] })).toThrow();
  expect(store.read().snapshots).toHaveLength(1);
}));
test("bank snapshots whitelist non-sensitive fields and do not invent currency", () => workspace((store) => {
  const result = store.importFinances({ accounts: [{ name: "Checking", balance: 32, accountNumber: "secret-account", routingNumber: "secret-routing" }], recordedAt: observation.recordedAt, sourceLabel: "Mercury" });
  expect(result.finances.accounts[0]).toEqual({ name: "Checking", balance: 32, currency: null, sourceId: "" });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(() => store.importFinances({ accounts: [{ name: "Checking", balance: "32" }], recordedAt: observation.recordedAt })).toThrow();
  expect(store.read().finances.accounts[0].balance).toBe(32);
}));
test("corrupt business storage never resets existing records", () => workspace((store, root) => {
  store.update({ profile: { businessName: "QA" } });
  writeFileSync(join(root, ".operator-data/business.json"), "corrupted");
  expect(() => store.read()).toThrow("left untouched"); expect(() => store.update({ widgets: {} })).toThrow();
}));
test("progress goals, completion and check-ins persist as an ordered update trail", () => workspace((store) => {
 let data=store.progress({action:'goal',horizon:'week',title:'Ship the new creator dashboard'});
 const goal=data.progress.goals[0];expect(goal.status).toBe('planned');expect(data.progress.updates).toHaveLength(1);
 data=store.progress({action:'goal',id:goal.id,status:'done',notes:'Reviewed the live build'});
 expect(data.progress.goals[0].status).toBe('done');expect(data.progress.updates[0].text).toContain('Completed');
 data=store.progress({action:'check-in',text:'The dashboard shipped with real audience history.',goalId:goal.id});
 expect(data.progress.updates).toHaveLength(3);expect(data.progress.updates[0].goalId).toBe(goal.id);
 expect(()=>store.progress({action:'goal',id:'missing',status:'done'})).toThrow();
 expect(()=>store.progress({action:'goal',horizon:'decade',title:'Invalid'})).toThrow();
 expect(store.read().progress.goals).toHaveLength(1);
 store.progress({action:'remove-goal',id:goal.id});expect(store.read().progress.goals).toHaveLength(0);
 expect(store.read().progress.updates).toHaveLength(4);
}));

test("setup saves three canonical period goals atomically, with no duplicate profile goal", () => {
 const root=mkdtempSync(join(tmpdir(),'business-goal-period-'));
 try {
  const store=businessWorkspace(root,{now:()=>new Date('2026-09-16T12:00:00Z'),timeZone:'Europe/Vienna'});
  const result=store.progress({action:'setup-goals',goals:[{horizon:'quarter',title:'Launch the offer'},{horizon:'month',title:'Validate the offer'},{horizon:'week',title:'Book five calls'}]});
  expect(result.progress.goals).toHaveLength(3);expect(result.progress.updates).toHaveLength(3);
  expect(result.profile.quarterGoal).toBeUndefined();
  expect(result.progress.goals[2].period).toEqual({startDate:'2026-09-14',endDate:'2026-09-20',timeZone:'Europe/Vienna'});
  const before=JSON.stringify(store.read());
  expect(()=>store.progress({action:'setup-goals',goals:[{id:result.progress.goals[0].id,horizon:'quarter',title:'Changed title'},{horizon:'month',title:''}]})).toThrow();
  expect(JSON.stringify(store.read())).toBe(before);
  expect(()=>store.progress({action:'setup-goals',goals:[{horizon:'week',title:'One'},{horizon:'week',title:'Two'}]})).toThrow();
  const updated=store.progress({action:'setup-goals',goals:[{id:result.progress.goals[0].id,horizon:'quarter',title:'Launch with 30 customers'}]});
  expect(updated.progress.goals).toHaveLength(3);expect(updated.progress.goals[0].title).toBe('Launch with 30 customers');
 } finally{rmSync(root,{recursive:true,force:true})}
});

test("Monday review preserves completed history and explicit carry-forward creates a new goal", () => {
 const root=mkdtempSync(join(tmpdir(),'business-goal-renew-'));
 try {
  let now=new Date('2026-09-20T21:59:59Z');const store=businessWorkspace(root,{now:()=>now,timeZone:'Europe/Vienna'});
  let data=store.progress({action:'goal',horizon:'week',title:'Publish the lesson'});const oldId=data.progress.goals[0].id;
  data=store.progress({action:'goal',id:oldId,status:'done'});const oldGoal=structuredClone(data.progress.goals[0]);
  now=new Date('2026-09-20T22:00:00Z');
  expect(store.read().progress.goals[0]).toEqual(oldGoal);
  expect(()=>store.progress({action:'setup-goals',goals:[{id:oldId,horizon:'week',title:'Silently change last week'}]})).toThrow('earlier period');
  data=store.progress({action:'setup-goals',goals:[{horizon:'week',title:'Publish the next lesson',renewedFromId:oldId}]});
  expect(data.progress.goals).toHaveLength(2);expect(data.progress.goals[0]).toEqual(oldGoal);
  expect(data.progress.goals[1].id).not.toBe(oldId);expect(data.progress.goals[1].status).toBe('planned');
  expect(data.progress.goals[1].period).toMatchObject({startDate:'2026-09-21',endDate:'2026-09-27'});
  expect(data.progress.goals[1].renewedFromId).toBe(oldId);expect(data.progress.updates[0].text).toContain('Carried forward');
  expect(()=>store.progress({action:'setup-goals',goals:[{horizon:'week',title:'Duplicate renewal',renewedFromId:oldId}]})).toThrow('already been carried');
  expect(()=>store.progress({action:'goal',horizon:'week',title:'Wrong zone',timeZone:'invalid'})).toThrow();
  expect(store.read().progress.goals).toHaveLength(2);
 } finally{rmSync(root,{recursive:true,force:true})}
});


test("verified scope survives imports without merging unknown-scope or other-channel metrics", () => workspace(store => {
  const sourceUrl="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", measurementScope="youtube-channel-totals-v1";
  store.importSnapshots({snapshots:[{...observation,sourceUrl,origin:"connector",metrics:{views:67096}}]});
  const legacy=structuredClone(store.read().snapshots[0]);
  store.importSnapshots({snapshots:[{...observation,sourceUrl,origin:"connector",measurementScope,metrics:{followers:250000}}]});
  let saved=store.read().snapshots;expect(saved).toHaveLength(2);expect(saved.find((row:any)=>row.id===legacy.id)).toEqual(legacy);
  const scoped=saved.find((row:any)=>row.measurementScope===measurementScope);expect(scoped.metrics).toEqual({followers:250000});
  store.importSnapshots({snapshots:[{...observation,sourceUrl,origin:"connector",measurementScope,metrics:{views:12000000}}]});
  saved=store.read().snapshots;expect(saved).toHaveLength(2);expect(saved.find((row:any)=>row.id===scoped.id).metrics).toEqual({followers:250000,views:12000000});
  store.importSnapshots({snapshots:[{...observation,sourceUrl:"https://www.youtube.com/channel/UC1234567890123456789012",origin:"connector",measurementScope,metrics:{followers:10}}]});
  expect(store.read().snapshots).toHaveLength(3);expect(store.read().snapshots.find((row:any)=>row.id===legacy.id)).toEqual(legacy);
}));

test("unknown scopes and mismatched measurement identities reject atomically", () => workspace(store => {
  store.importSnapshots({snapshots:[observation]});const before=JSON.stringify(store.read());
  for(const changed of [{measurementScope:"whatever",sourceUrl:"https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"},{measurementScope:"youtube-channel-totals-v1",sourceUrl:"https://example.com/channel/UCabcdefghijklmnopqrstuv"},{measurementScope:"youtube-channel-totals-v1"},{measurementScope:"community-totals-v1",sourceUrl:"https://community.example.com/group"}]) {
    expect(()=>store.importSnapshots({snapshots:[{...observation,...changed}]})).toThrow("measurement scope");expect(JSON.stringify(store.read())).toBe(before);
  }
}));

test("monthly income persists with its window, survives a failed re-read and is validated", () => workspace((store) => {
  const income = { amount: 1500.756, currency: "USD", days: 30, recordedAt: "2026-09-17T10:00:00Z", transactions: 2, windowStart: "2026-08-18T10:00:00Z", windowEnd: "2026-09-17T10:00:00Z" };
  let data = store.importFinances({ accounts: [{ name: "Checking", balance: 32, currency: "USD" }], recordedAt: "2026-09-17", sourceLabel: "Mercury via Codex · current balances", monthlyIncome: income });
  expect(data.finances.monthlyIncome).toEqual({ ...income, amount: 1500.76, recordedAt: "2026-09-17T10:00:00.000Z", windowStart: "2026-08-18T10:00:00.000Z", windowEnd: "2026-09-17T10:00:00.000Z" });
  data = store.importFinances({ accounts: [{ name: "Checking", balance: 40, currency: "USD" }], recordedAt: "2026-09-18", sourceLabel: "Mercury via Codex · current balances", monthlyIncomeError: "Mercury has more transactions this month than this reader totals." });
  expect(data.finances.accounts[0].balance).toBe(40); expect(data.finances.monthlyIncome.amount).toBe(1500.76);
  expect(data.finances.monthlyIncomeError).toEqual({ message: "Mercury has more transactions this month than this reader totals.", at: "2026-09-18T00:00:00.000Z" });
  data = store.importFinances({ accounts: [{ name: "Checking", balance: 41, currency: "USD" }], recordedAt: "2026-09-18", sourceLabel: "Mercury via Codex · current balances", monthlyIncome: { ...income, amount: 10 } });
  expect(data.finances.monthlyIncome.amount).toBe(10); expect(data.finances.monthlyIncomeError).toBeUndefined();
  data = store.importFinances({ accounts: [{ name: "Other bank", balance: 5, currency: "EUR" }], recordedAt: "2026-09-18", sourceLabel: "Manual" });
  expect(data.finances.monthlyIncome).toBeUndefined();
  for (const bad of [{ ...income, amount: -1 }, { ...income, currency: "usd" }, { ...income, days: 7 }, { ...income, transactions: 1.5 }, { ...income, recordedAt: "yesterday" }, "1000"])
    expect(() => store.importFinances({ accounts: [{ name: "Checking", balance: 1 }], recordedAt: "2026-09-18", monthlyIncome: bad })).toThrow();
  expect(store.read().finances.accounts[0].name).toBe("Other bank");
}));
test("the monthly revenue target is validated, rounded and clearable", () => workspace((store) => {
  expect(store.update({ profile: { revenueTargetMonthly: 50000.129 } }).profile.revenueTargetMonthly).toBe(50000.13);
  for (const bad of [0, -5, "50000", Number.NaN, Number.POSITIVE_INFINITY, 1e13]) expect(() => store.update({ profile: { revenueTargetMonthly: bad } })).toThrow();
  expect(store.read().profile.revenueTargetMonthly).toBe(50000.13);
  expect(store.update({ profile: { revenueTargetMonthly: null } }).profile.revenueTargetMonthly).toBeUndefined();
}));
test("Mercury balances saved without a currency read back as USD without rewriting the file", () => workspace((store, root) => {
  store.importFinances({ accounts: [{ name: "Checking", balance: 12 }, { name: "Other", balance: 3, currency: "EUR" }], recordedAt: "2026-09-17", sourceLabel: "Mercury via Codex · current balances" });
  expect(store.read().finances.accounts.map((a: any) => a.currency)).toEqual(["USD", "EUR"]);
  expect(JSON.parse(readFileSync(join(root, ".operator-data/business.json"), "utf8")).finances.accounts[0].currency).toBeNull();
  store.importFinances({ accounts: [{ name: "Checking", balance: 12 }], recordedAt: "2026-09-17", sourceLabel: "Some other bank" });
  expect(store.read().finances.accounts[0].currency).toBeNull();
}));

test("observations for a platform this edition does not track are hidden, and kept when saving", () => workspace((store, root) => {
  store.update({ profile: { businessName: "QA" } });
  const file = join(root, ".operator-data/business.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...data, snapshots: [...data.snapshots, { platform: "old-forum", metric: "members", value: 10, observedAt: "2026-01-01" }] }));
  expect(businessWorkspace(root).read().snapshots.some((s: any) => s.platform === "old-forum")).toBe(false);
  businessWorkspace(root).update({ profile: { businessName: "QA 2" } });
  expect(JSON.parse(readFileSync(file, "utf8")).snapshots.some((s: any) => s.platform === "old-forum")).toBe(true);
}));
