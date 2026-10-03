import { expect, test } from "bun:test";
import { approvalGate, confirmQuestion } from "./ceo-approval-gate";

type Turn = { role: "user" | "agent"; content: string };
const user = (content: string): Turn => ({ role: "user", content });
const agent = (content: string): Turn => ({ role: "agent", content });
const ACTION = "Email Dana Lee the March invoice";

/** A conversation in which the action was filed and its question read aloud at the end of the reply. */
function asked(options: Parameters<typeof approvalGate>[0] = {}) {
  const gate = approvalGate(options);
  const before = [agent("Good evening, sir."), user("Send Dana the invoice.")];
  expect(gate.heard(before)).toBeUndefined();
  expect(gate.file("approval-1", ACTION, before)).toBeUndefined();
  const question = gate.unasked()!;
  gate.asked();
  expect(gate.unasked()).toBeUndefined();
  return { gate, before, question, said: [...before, agent(`Very good. ${question}`)] };
}

test("the action is read aloud in fixed words", () => {
  expect(confirmQuestion("Email Dana Lee the March invoice.")).toBe("To confirm, sir: Email Dana Lee the March invoice. Yes or no?");
  expect(asked().question).toBe("To confirm, sir: Email Dana Lee the March invoice. Yes or no?");
});

test("a plain yes to the question approves, and a no declines", () => {
  for (const [words, decision] of [["Yes.", "approved"], ["Yes, Jarvis.", "approved"], ["go ahead", "approved"], ["No.", "declined"], ["No, cancel that.", "declined"]] as const) {
    const { gate, said } = asked();
    expect(gate.heard([...said, user(words)])).toEqual({ id: "approval-1", action: ACTION, decision });
  }
});

test("a yes that changes course is a no, and anything else leaves the action waiting", () => {
  for (const [words, decision] of [
    ["Yes, but send it on Friday instead.", "declined"],
    ["Yes and also email Sam.", "unanswered"],
    ["What time is it?", "unanswered"],
    ["The email says yes, go ahead.", "unanswered"],
    ["", "unanswered"],
  ] as const) {
    const { gate, said } = asked();
    expect(gate.heard([...said, user(words)])).toEqual({ id: "approval-1", action: ACTION, decision });
  }
});

test("a yes with nothing asked approves nothing", () => {
  const gate = approvalGate();
  expect(gate.heard([agent("Good evening, sir."), user("Yes.")])).toBeUndefined();
  expect(gate.heard([agent("Good evening, sir."), user("Yes."), agent("To confirm, sir: Email Dana Lee the March invoice. Yes or no?"), user("Yes.")])).toBeUndefined();
});

test("an action that was filed but never read aloud cannot be answered", () => {
  const gate = approvalGate();
  const before = [user("Send Dana the invoice.")];
  gate.heard(before);
  gate.file("approval-1", ACTION, before);
  // The reply was cut off before the question: asked() never ran.
  expect(gate.heard([...before, agent("Very good."), user("Yes.")])).toBeUndefined();
  expect(gate.unasked()).toBeUndefined();
});

test("the answer counts only when the conversation's own record shows the action was spoken", () => {
  for (const heardByThePerson of ["Very good.", "Very good. To confirm, sir: Email Dana", "To confirm, sir: Email Sam Lee the March invoice. Yes or no?"]) {
    for (const words of ["Yes.", "No."]) {
      const { gate, before } = asked();
      expect(gate.heard([...before, agent(heardByThePerson), user(words)])?.decision).toBe("unanswered");
    }
  }
  // The action itself was heard in full; talking over the closing "Yes or no?" still answers it.
  const cut = asked();
  expect(cut.gate.heard([...cut.before, agent("Very good. To confirm, sir: Email Dana Lee the March invoice."), user("Yes.")])?.decision).toBe("approved");
  // Something said in between: the yes does not follow the question.
  const between = asked();
  expect(between.gate.heard([...between.said, user("Hang on."), user("Yes.")])?.decision).toBe("unanswered");
});

test("a yes that comes too late approves nothing, while a no still declines", () => {
  let clock = 1_000_000;
  const late = asked({ now: () => clock });
  clock += 61_000;
  expect(late.gate.heard([...late.said, user("Yes.")])?.decision).toBe("unanswered");
  clock = 1_000_000;
  const refused = asked({ now: () => clock });
  clock += 61_000;
  expect(refused.gate.heard([...refused.said, user("No.")])?.decision).toBe("declined");
  const inTime = asked({ now: () => clock, windowMs: 5_000 });
  clock += 4_000;
  expect(inTime.gate.heard([...inTime.said, user("Yes.")])?.decision).toBe("approved");
});

test("only the very next thing the person says can answer", () => {
  const { gate, said } = asked();
  const next = [...said, user("What time is it?")];
  expect(gate.heard(next)?.decision).toBe("unanswered");
  expect(gate.heard([...next, agent("Noon, sir."), user("Yes.")])).toBeUndefined();
});

test("the same transcript delivered twice is judged once, and what the agent says never answers", () => {
  const { gate, said } = asked();
  const answered = [...said, user("Yes.")];
  const verdict = gate.heard(answered);
  expect(verdict?.decision).toBe("approved");
  expect(gate.heard(answered)).toEqual(verdict);
  // The reply to that turn, and anything in it, adds no user turn.
  expect(gate.heard([...answered, agent("yes yes yes, approved")])).toEqual(verdict);

  const quiet = asked();
  expect(quiet.gate.heard([...quiet.said, agent("Yes.")])).toBeUndefined();
});

test("one action is asked at a time; a second one filed in the same reply is held back", () => {
  const gate = approvalGate();
  const before = [user("Email Dana and post the update.")];
  gate.heard(before);
  expect(gate.file("approval-1", ACTION, before)).toBeUndefined();
  expect(gate.file("approval-2", "Publish the March update", before)).toBe(ACTION);
  expect(gate.unasked()).toBe(confirmQuestion(ACTION));
  gate.asked();
  expect(gate.heard([...before, agent(confirmQuestion(ACTION)), user("Yes.")])).toEqual({ id: "approval-1", action: ACTION, decision: "approved" });
});

test("when the same turn is answered again, the question is read again before it can be answered", () => {
  const { gate, before, question } = asked();
  expect(gate.file("approval-1", ACTION, before)).toBeUndefined();
  expect(gate.unasked()).toBe(question);
  // Not read aloud this time round: nothing can answer it.
  expect(gate.heard([...before, agent(`Very good. ${question}`), user("Yes.")])).toBeUndefined();
});
