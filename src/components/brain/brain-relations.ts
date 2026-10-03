// Brain relations: which records from different sources belong together.
// Signals, strongest first: the same person, the same project, rare words the
// two records share, and the same day. Only pairs across sources are kept, and
// each record keeps a few of its best links, so the map stays readable.

/** When a record last changed. Accepts ISO dates and "169d ago" style text. */
export function memoryTime(n: { updated?: string }, now = Date.now()): number | null {
  if (!n.updated) return null;
  const iso = Date.parse(n.updated);
  if (Number.isFinite(iso)) return iso;
  const m = /^(\d+)\s*(s|m|min|h|d|w|mo|y)\w*\s+ago$/i.exec(n.updated.trim());
  if (!m) return /just now|today/i.test(n.updated) ? now : null;
  const unit: Record<string, number> = {
    s: 1e3,
    m: 6e4,
    min: 6e4,
    h: 36e5,
    d: 864e5,
    w: 6048e5,
    mo: 2592e6,
    y: 31536e6,
  };
  return now - Number(m[1]) * (unit[m[2].toLowerCase()] ?? 864e5);
}

export type RelationFacet = {
  id: string;
  origin: string;
  name: string;
  text?: string;
  time?: number | null;
  project?: string;
  people?: string[];
};
export type Relation = { id: string; score: number; reasons: string[] };
export type RelationLink = { source: string; target: string; score: number; reasons: string[] };

const STOP = new Set(
  `about above after again against also always another anything around because been before being below between both
  could does doing done down during each either else enough even every from further have having here into just keep
  like make made many more most much must need never next only other over same should since some still such than that
  their them then there these they thing things this those through today under until very want well were what when
  where which while will with within without would your yours yourself first last good best great really thats
  memory memories feedback reference project projects user note notes file files session sessions chat chats
  conversation conversations message messages reply thread claude codex chatgpt email meeting meetings skill skills
  agent agents operator users update updated rewrite write create created build built using used uses read readme
  index work working works hard rules only output below above each string strings screen text line lines run runs
  task tasks prompt prompts help want need make please thanks okay yeah jack hey bro different three four five
  seven step steps page pages drop self contained desktop real sale format question structure deliver title titles
  generate comparison broken rebuild final check public level levels source sources start started simple plain
  give gives stop move moved seen inside weight status request reminder edit json true false null undefined
  full part parts version today yesterday week weeks month months year years time times people person thing`.split(
    /\s+/,
  ),
);

/** Topic words for one record: lower case, plural folded, noise removed. */
const surface = new Map<string, string>();
export function topicWords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ]+/)) {
    if (raw.length < 4 || /^\d+$/.test(raw) || STOP.has(raw)) continue;
    const w = raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (STOP.has(w)) continue;
    if (!surface.has(w)) surface.set(w, raw);
    out.add(w);
  }
  return [...out];
}

const DAY = 864e5;
const dayKey = (t: number) => Math.floor(t / DAY);

export function relateRecords(
  facets: RelationFacet[],
  {
    perNode = 3,
    maxLinks = 420,
    minScore = 6.5,
  }: { perNode?: number; maxLinks?: number; minScore?: number } = {},
) {
  const n = facets.length;
  const byIndex = facets;
  // Words in a title count fully; words only in the summary count for less.
  const titles = facets.map((f) => new Set(topicWords(f.name)));
  const words = facets.map((f, i) => [...new Set([...titles[i], ...topicWords(f.text || "")])]);
  const df = new Map<string, number>();
  for (const list of words) for (const w of list) df.set(w, (df.get(w) || 0) + 1);
  // A word shared by too many records says nothing about any pair.
  const cap = Math.max(6, Math.round(n * 0.025));
  const postings = new Map<string, number[]>();
  words.forEach((list, i) => {
    for (const w of list) {
      const d = df.get(w)!;
      if (d < 2 || d > cap) continue;
      if (!postings.has(w)) postings.set(w, []);
      postings.get(w)!.push(i);
    }
  });
  type Acc = { score: number; words: string[]; person?: string; project?: string };
  const pairs = new Map<string, Acc>();
  const touch = (a: number, b: number) => {
    if (byIndex[a].origin === byIndex[b].origin) return null;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let acc = pairs.get(key);
    if (!acc) pairs.set(key, (acc = { score: 0, words: [] }));
    return acc;
  };
  for (const [w, list] of postings) {
    const idf = Math.log(n / list.length);
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const acc = touch(list[x], list[y]);
        if (acc) {
          const inTitles = Number(titles[list[x]].has(w)) + Number(titles[list[y]].has(w));
          acc.score += idf * (inTitles === 2 ? 1.25 : inTitles === 1 ? 0.8 : 0.45);
          acc.words.push(w);
        }
      }
  }
  // People and projects are exact matches and weigh more than any single word.
  const exact = (key: (f: RelationFacet) => string[], apply: (acc: Acc, value: string) => void) => {
    const groups = new Map<string, { label: string; list: number[] }>();
    facets.forEach((f, i) => {
      for (const v of key(f)) {
        const k = v.toLowerCase().trim();
        if (k.length < 3) continue;
        if (!groups.has(k)) groups.set(k, { label: v.trim(), list: [] });
        groups.get(k)!.list.push(i);
      }
    });
    for (const { label, list } of groups.values()) {
      if (list.length > 60) continue;
      for (let x = 0; x < list.length; x++)
        for (let y = x + 1; y < list.length; y++) {
          const acc = touch(list[x], list[y]);
          if (acc) apply(acc, label);
        }
    }
  };
  exact(
    (f) => f.people || [],
    (acc, v) => {
      acc.score += 7;
      acc.person = acc.person || v;
    },
  );
  exact(
    (f) => (f.project ? [f.project] : []),
    (acc, v) => {
      acc.score += 6.5;
      acc.project = acc.project || v;
    },
  );
  const scored: Array<RelationLink & { a: number; b: number }> = [];
  for (const [key, acc] of pairs) {
    const [a, b] = key.split(":").map(Number);
    const ta = facets[a].time,
      tb = facets[b].time;
    let score = acc.score;
    const sameDay = ta != null && tb != null && dayKey(ta) === dayKey(tb);
    const nearDay = !sameDay && ta != null && tb != null && Math.abs(ta - tb) < 3 * DAY;
    if (sameDay) score += 1.5;
    else if (nearDay) score += 0.6;
    const strong =
      acc.person || acc.project || acc.words.length >= 2 || (acc.words.length === 1 && sameDay);
    if (!strong || score < minScore) continue;
    const reasons: string[] = [];
    if (acc.person) reasons.push(`Same person: ${acc.person}`);
    if (acc.project) reasons.push(`Same project: ${acc.project}`);
    if (acc.words.length)
      reasons.push(
        `Shared words: ${acc.words
          .sort((x, y) => (df.get(x) || 0) - (df.get(y) || 0))
          .slice(0, 3)
          .map((w) => surface.get(w) || w)
          .join(", ")}`,
      );
    if (sameDay) reasons.push("Same day");
    else if (nearDay) reasons.push("Same week");
    scored.push({
      a,
      b,
      source: facets[a].id,
      target: facets[b].id,
      score: Math.round(score * 10) / 10,
      reasons,
    });
  }
  scored.sort((x, y) => y.score - x.score);
  // Each record keeps its best few links; strong hubs cannot swallow the map.
  const degree = new Map<number, number>();
  const links: RelationLink[] = [];
  for (const l of scored) {
    if (links.length >= maxLinks) break;
    if ((degree.get(l.a) || 0) >= perNode || (degree.get(l.b) || 0) >= perNode) continue;
    degree.set(l.a, (degree.get(l.a) || 0) + 1);
    degree.set(l.b, (degree.get(l.b) || 0) + 1);
    links.push({ source: l.source, target: l.target, score: l.score, reasons: l.reasons });
  }
  const byId = new Map<string, Relation[]>();
  for (const l of links) {
    for (const [from, to] of [
      [l.source, l.target],
      [l.target, l.source],
    ]) {
      if (!byId.has(from)) byId.set(from, []);
      byId.get(from)!.push({ id: to, score: l.score, reasons: l.reasons });
    }
  }
  for (const list of byId.values()) list.sort((a, b) => b.score - a.score);
  return { links, byId };
}
