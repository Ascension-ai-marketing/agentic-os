/**
 * Inspiration: great motion drawn in code, by other people. Links and official
 * embeds only; nothing here is downloaded or re-hosted. Each entry was checked
 * (X posts via the fxtwitter API; YouTube via oEmbed) on 24 Sep 2026.
 */
export interface InspirationItem {
  id: string;
  url: string;
  platform: "X" | "YouTube";
  author: string;
  handle: string;
  /** YYYY-MM-DD (UTC). */
  date: string;
  title: string;
  blurb: string;
  /** Official embed URL (loaded only when the card is on screen). */
  embed: string | null;
  tag: "Made with AI" | "Classic";
}

const x = (handle: string, id: string) => ({
  url: `https://x.com/${handle}/status/${id}`,
  embed: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true&hideThread=true`,
});

export const INSPIRATION: InspirationItem[] = [
  {
    id: "devteamdrew",
    ...x("devteamdrew", "2102436464323661880"),
    platform: "X",
    author: "DreW",
    handle: "@devteamdrew",
    date: "2026-09-22",
    title: "A short film, all in code",
    blurb: "A 32-second animated short with its soundtrack, made in code by Claude Opus 5.5.",
    tag: "Made with AI",
  },
  {
    id: "kevin_t_ngo",
    ...x("kevin_t_ngo", "2102437977435893771"),
    platform: "X",
    author: "Kevin Ngo",
    handle: "@kevin_t_ngo",
    date: "2026-09-22",
    title: "A girl asks Claude a question",
    blurb: "Every frame JavaScript on a canvas, the sound made with Web Audio.",
    tag: "Made with AI",
  },
  {
    id: "remotion",
    ...x("Remotion", "2013626968386765291"),
    platform: "X",
    author: "Remotion",
    handle: "@Remotion",
    date: "2026-01-20",
    title: "Remotion Agent Skills launch",
    blurb: "A launch clip made by prompting Claude Code with Remotion's React video skills.",
    tag: "Made with AI",
  },
  {
    id: "majidmanzarpour",
    ...x("majidmanzarpour", "2102476258948927543"),
    platform: "X",
    author: "Majid Manzarpour",
    handle: "@majidmanzarpour",
    date: "2026-09-22",
    title: "A pixel wizard casts a spell",
    blurb: "Opus 5.5 animates pixel art in vanilla JavaScript and Canvas 2D.",
    tag: "Made with AI",
  },
  {
    id: "addyosmani",
    ...x("addyosmani", "2102436416437580159"),
    platform: "X",
    author: "Addy Osmani",
    handle: "@addyosmani",
    date: "2026-09-22",
    title: "A pelican riding a bike",
    blurb: "Built in Three.js with Opus 5.5 on launch day.",
    tag: "Made with AI",
  },
  {
    id: "heygen",
    ...x("HeyGen", "2048155061751288197"),
    platform: "X",
    author: "HeyGen",
    handle: "@HeyGen",
    date: "2026-04-25",
    title: "Motion graphics in Claude Design",
    blurb: "Claude Design makes motion graphics with the HyperFrames skill, rendered to MP4.",
    tag: "Made with AI",
  },
  {
    id: "lcslates",
    ...x("LCSlates", "2102503027340988559"),
    platform: "X",
    author: "Chris Riley",
    handle: "@LCSlates",
    date: "2026-09-22",
    title: "Gold-leaf tiles take flight",
    blurb: "Opus 5.5 writes an 80-second WebGL2 film of flying mosaic tiles.",
    tag: "Made with AI",
  },
  {
    id: "emollick",
    ...x("emollick", "2102441628661080384"),
    platform: "X",
    author: "Ethan Mollick",
    handle: "@emollick",
    date: "2026-09-22",
    title: "A drowned gothic tower",
    blurb: "Opus 5.5 codes a twigl shader of a drowned neo-gothic tower.",
    tag: "Made with AI",
  },
  {
    id: "3b1b-fourier",
    url: "https://www.youtube.com/watch?v=spUNpyF58BY",
    embed: "https://www.youtube-nocookie.com/embed/spUNpyF58BY",
    platform: "YouTube",
    author: "3Blue1Brown",
    handle: "@3blue1brown",
    date: "2018-01-26",
    title: "The Fourier transform, animated",
    blurb: "The classic visual explainer, animated in code with the Python library Manim.",
    tag: "Classic",
  },
  {
    id: "etiennejcb",
    ...x("etiennejcb", "2094490124964761943"),
    platform: "X",
    author: "Etienne Jacob",
    handle: "@etiennejcb",
    date: "2026-08-31",
    title: "Brick Territories",
    blurb: "Balls fight over brick territories in a JavaScript canvas simulation.",
    tag: "Classic",
  },
  {
    id: "beesandbombs",
    ...x("beesandbombs", "1829996792454529423"),
    platform: "X",
    author: "Dave Whyte",
    handle: "@beesandbombs",
    date: "2024-08-31",
    title: "A Bees & Bombs loop",
    blurb: "A looping geometric animation by Dave Whyte, who codes his loops in Processing.",
    tag: "Classic",
  },
  {
    id: "iquilezles",
    ...x("iquilezles", "2068059864065335548"),
    platform: "X",
    author: "Inigo Quilez",
    handle: "@iquilezles",
    date: "2026-06-19",
    title: "Coding a procedural tower",
    blurb: "From his tutorial coding a procedural brick tower as a Shadertoy shader.",
    tag: "Classic",
  },
];
