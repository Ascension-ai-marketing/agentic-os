import { test, expect } from "bun:test";
import { allowedOpenUrl, openUrlCommand, terminalAppleScript, terminalCommand } from "./open-terminal-route";

test("resumes the agent's own session in the OS folder", () => {
  const sid = "0f8e7d6c-5b4a-4392-8176-5f4e3d2c1b0a";
  expect(terminalCommand({ agent: "claude", sessionId: sid, root: "/Users/me/agentic os" })).toBe(`cd '/Users/me/agentic os' && claude --resume ${sid}`);
  expect(terminalCommand({ agent: "codex", sessionId: sid, root: "/x" })).toBe(`cd '/x' && codex resume ${sid}`);
});
test("ignores a malformed session id and rejects unknown agents", () => {
  expect(terminalCommand({ agent: "claude", sessionId: "x; rm -rf ~", root: "/x" })).toBe("cd '/x' && claude");
  expect(() => terminalCommand({ agent: "bash", root: "/x" })).toThrow("Choose");
});
test("quotes the folder for the shell and the script for AppleScript", () => {
  expect(terminalCommand({ agent: "claude", root: "/it's/here" })).toBe(`cd '/it'\\''s/here' && claude`);
  expect(terminalAppleScript('say "hi"')[0]).toBe('tell application "Terminal" to do script "say \\"hi\\""');
});

test("links open with the system's own launcher, never through a shell", () => {
  const url = "https://www.notion.so/page?a=1&b=2";
  expect(openUrlCommand(url, "darwin")).toEqual(["open", [url]]);
  expect(openUrlCommand(url, "win32")).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
  expect(openUrlCommand(url, "linux")).toEqual(["xdg-open", [url]]);
});

test("files the OS saved for you can be opened, nothing else on localhost", () => {
  expect(allowedOpenUrl("http://localhost:8081/__memory_file/openai-fact-sheet.html", 8081)).toBe("http://localhost:8081/__memory_file/openai-fact-sheet.html");
  expect(allowedOpenUrl("http://localhost:8081/__token")).toBeNull();
  expect(allowedOpenUrl("http://localhost:8081/__memory_file/../../.env", 8081)).toBeNull();
  expect(allowedOpenUrl("http://localhost:8081/__memory_file/a.html")).toBeNull();
  expect(allowedOpenUrl("http://evil.example/__memory_file/a.html")).toBeNull();
});

test("saved files open only from this server's own port", () => {
  expect(allowedOpenUrl("http://localhost:8081/__memory_file/a.html", 8081)).toBe("http://localhost:8081/__memory_file/a.html");
  expect(allowedOpenUrl("http://localhost:9999/__memory_file/a.html", 8081)).toBeNull();
});
