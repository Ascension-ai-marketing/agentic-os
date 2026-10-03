/** Per-turn restrictions for the read-only text composer. Native agent panes are unchanged. */
export function chatRuntimeArgs(runtime: "codex" | "claude"): string[] {
  if (runtime === "claude")
    return [
      "--safe-mode",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ];
  // --ignore-user-config retains the native auth store (documented by local CLI help).
  // Do not copy credentials, user MCP configuration, plugins, or native app access.
  return [
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "apps",
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
    "--disable",
    "multi_agent",
    "--disable",
    "skill_mcp_dependency_install",
    "-c",
    'web_search="disabled"',
    "-c",
    "memories.use_memories=false",
    "-c",
    "project_doc_max_bytes=0",
  ];
}
