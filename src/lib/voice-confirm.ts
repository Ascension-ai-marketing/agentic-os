// Real work from voice starts only after the user says yes. The yes must come
// from the user's own microphone transcript (text inside an email, a web page
// or a memory cannot produce one), it must be the whole answer ("yes, but
// cancel" is not a yes), and it must be spoken after the Start card appeared.
const YES_WORD = "(?:yes|yeah|yep|yup|sure|ok|okay|go|go ahead|do it|start|start it|confirm|confirmed|please do|let's go|lets go|go for it|absolutely|definitely|sounds good|yes please)";
const FILLER = "(?:please|then|now|thanks|thank you|go ahead|do it|start it|jarvis)";
const YES = new RegExp(`^\\W*${YES_WORD}(?:[\\s,.!]+${FILLER})*[\\s.!]*$`, "i");
const NO = /\b(?:no|nope|nah|cancel|stop|don't|dont|do not|wait|hold on|not now|never mind|nevermind|instead|but)\b/i;

/** "yes" when the words are a plain yes, "no" when they refuse or change course, else null. */
export function confirmWord(text: string): "yes" | "no" | null {
  const t = text.trim();
  if (!t) return null;
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return null;
}

/** A proposed task waits at most this long for a yes. */
export const CONFIRM_WINDOW_MS = 60_000;

/** The answer counts only if it was spoken after the proposal, inside the window. */
export function confirmsTask(answer: { text: string; spokenAt: number }, proposedAt: number, now = Date.now()): "yes" | "no" | null {
  if (answer.spokenAt <= proposedAt || now - proposedAt > CONFIRM_WINDOW_MS) return null;
  return confirmWord(answer.text);
}

const STYLE_TARGET = /\b(funn(?:y|ier)|humou?r|jok(?:e|es|ey|ier)|sarcas\w*|witty|wittier|dry|drier|serious|faster|slower|speed|pace|quicker)\b/i;
const CHANGE_WORD = /\b(be|get|go|make|turn|talk|speak|sound|more|less|bit|increase|decrease|raise|lower|set|switch|change|up|down|crank|dial|tone)\b/i;
// Any negation ("don’t", "did not", "rather you didn't") means no change.
const REFUSAL = /\b(no|not|never|stop|enough|keep|leave)\b|n['’]t\b/i;
// "Make this email funnier" is about the email, not about Jarvis.
const OTHER_OBJECT = /\b(email|e-?mail|post|text|message|caption|script|copy|reply|draft|tweet|thread|video|title|doc|document|slide|story|line|joke about)\b/i;
const ABOUT_JARVIS = /\b(you|your|yourself|jarvis)\b|^\W*(?:please\s+)?(?:be|talk|speak|sound|go)\b/i;

/** True when the user's own words ask to change how Jarvis sounds ("be funnier", "talk faster"). */
export function asksForStyleChange(text: string): boolean {
  const t = text.trim();
  if (!t || REFUSAL.test(t) || !STYLE_TARGET.test(t) || !CHANGE_WORD.test(t)) return false;
  if (OTHER_OBJECT.test(t)) return false;
  return ABOUT_JARVIS.test(t) || /\b(humou?r|speed|pace|sarcasm)\b/i.test(t);
}
