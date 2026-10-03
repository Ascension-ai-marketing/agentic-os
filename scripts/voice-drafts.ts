/**
 * Shared voice helpers for the reply queues: pick a spread of real replies as
 * examples, the fallback voice guide, and the prompt that turns past replies
 * into a written voice guide.
 */

const MAX_EXAMPLES = 36;

/** Spread examples across short, medium and long replies so the model sees the range. */
export function pickExamples(replies: { content: string }[], count = MAX_EXAMPLES) {
  const short = replies.filter(r => r.content.length < 60), medium = replies.filter(r => r.content.length >= 60 && r.content.length < 220), long = replies.filter(r => r.content.length >= 220);
  const take = (list: { content: string }[], n: number) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
  return [...take(short, Math.round(count * 0.3)), ...take(medium, Math.round(count * 0.45)), ...take(long, count - Math.round(count * 0.3) - Math.round(count * 0.45))].map(r => r.content);
}
export const FALLBACK_GUIDE = `Warm, quick and casual. Opens with "Heyy {first name}" or "Howdy" and often calls people "man", "brother" or "chief". Short sentences, one thought each, usually one to four lines. Says what he will do and when, with no fluff. Genuinely hyped for people ("stoked", "let's CRUSH this 💪") but never salesy. One emoji at most, usually 💪 🙌 or 😂. Answers the actual question first, then offers the next step. Honest when he does not know something yet ("let me check and come back to you"). Never writes formal sign-offs, never uses em dashes, never pads with corporate phrases.`;
export function voicePrompt(replies: string[], posts: string[]) {
  const system = "You are a writing analyst. You describe exactly how one specific person writes so another writer can imitate them in short direct messages.";
  const user = [
    "Below are direct-message replies this person has actually sent, followed by community posts they wrote.",
    "Write a voice guide of at most 320 words, as plain prose plus short bullets, covering: greetings and how they address people, sentence length and rhythm, favourite words and slang, emoji habits (which ones, how often), how they handle questions, links, requests and sales pitches, how warm or blunt they are, and things they never do. Quote real phrases. The guide is for writing DMs, so weight the DM replies above the posts. Output the guide only, no preamble.",
    "",
    "DM REPLIES:",
    ...replies.map(r => `- ${r.replace(/\s+/g, " ")}`),
    "",
    "COMMUNITY POSTS:",
    ...posts.map(p => `- ${p.replace(/\s+/g, " ")}`),
  ].join("\n");
  return { system, user };
}
