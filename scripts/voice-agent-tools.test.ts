import { expect, test } from "bun:test";
import { buildOpenAIVoiceSession } from "./openai-voice";

test("delegation protocol accepts only a prompt and one of the supported runtime targets", () => {
  const tool = buildOpenAIVoiceSession().tools.find((item) => item.name === "delegate_task")!;
  expect(tool.parameters.required).toEqual(["prompt", "target"]);
  expect(tool.parameters.additionalProperties).toBe(false);
  const fields = tool.parameters.properties as Record<string, { type: string; enum?: string[] }>;
  expect(Object.keys(fields).sort()).toEqual(["prompt", "target"]);
  expect(fields.target.enum).toEqual(["codex", "claude", "both"]);
  expect(fields.prompt.type).toBe("string");
});

test("a connection check cannot smuggle a task, command, credential or target override", () => {
  const tool = buildOpenAIVoiceSession().tools.find((item) => item.name === "check_agents")!;
  expect(tool.parameters.properties).toEqual({});
  expect(tool.parameters.required).toEqual([]);
  expect(tool.parameters.additionalProperties).toBe(false);
});

test("voice can inspect task progress but has no native approval, answer or cancellation tool", () => {
  const session = buildOpenAIVoiceSession();
  const names = session.tools.map((tool) => tool.name);
  expect(names).toContain("agent_task_status");
  expect(names.some((name) => /approve|respond|cancel|answer_agent|shell|command/.test(name))).toBe(
    false,
  );
  const status = session.tools.find((tool) => tool.name === "agent_task_status")!;
  expect(status.parameters.required).toEqual(["job_id"]);
  expect(status.parameters.additionalProperties).toBe(false);
  expect(session.instructions).toContain("only for an explicit user request");
  expect(session.instructions).toContain(
    "Codex acts and Claude independently reviews in read-only mode",
  );
  expect(session.instructions).toContain("never approve on their behalf");
  expect(session.instructions).toContain("do not automatically append inbox messages");
  expect(session.instructions).toContain("without a separate OS OAuth connection");
  expect(session.instructions).toContain(
    "obtain any required message or recipient context through its own tools",
  );
});

test("named workflows expose only a user task, known workflow and supported agent", () => {
  const tool = buildOpenAIVoiceSession().tools.find((item) => item.name === "run_workflow")!;
  expect(tool.parameters.required).toEqual(["workflow", "prompt", "target"]);
  expect(tool.parameters.additionalProperties).toBe(false);
  const fields = tool.parameters.properties as Record<string, { enum?: string[] }>;
  expect(Object.keys(fields).sort()).toEqual(["prompt", "target", "workflow"]);
  expect(fields.workflow.enum).toEqual(["build", "improve-os"]);
  expect(tool.description).toContain("only when the user explicitly asks");
});
