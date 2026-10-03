import { expect, test } from 'bun:test';
import { DEFAULT_CHAT_CONTEXT, contextSelectionKey, scopeChatContext, selectedChatHistory, selectedMemorySource } from '../src/lib/chat-context-selection';
import { buildChatTurnPrompt } from '../src/lib/chat-turn-prompt';
import { chatContextEligible } from '../src/lib/chat-context';
import { conversationStore } from './conversations';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const workspace = {
  sources: [{ id: 'claude', origin: 'claude', text: 'CLAUDE_SECRET' }, { id: 'gmail', origin: 'email', connector: { provider: 'gmail' }, text: 'GMAIL_SECRET' }, { id: 'outlook', origin: 'email', connector: { provider: 'outlook' }, text: 'OUTLOOK_CONTEXT' }],
  brainSources: { codex: false }, business: { name: 'BUSINESS_SECRET' }, personalProfile: { name: 'PERSONAL_SECRET' },
  goals: { text: 'GOAL_SECRET' }, events: [{ end: '2099-01-01', title: 'MEETING_SECRET' }],
  inbox: [{ source: 'gmail', status: 'open', body: 'GMAIL_SECRET' }, { source: 'outlook', status: 'open', body: 'OUTLOOK_CONTEXT' }],
  inboxImports: [{ provider: 'gmail', account: 'GMAIL_SECRET' }, { provider: 'outlook', account: 'OUTLOOK_CONTEXT' }], mailArchive: { secret: 'GMAIL_SECRET' },
};
test('context off excludes automatic context but preserves explicit attachment permissions', () => {
  const selection = { enabled: false, sources: {} };
  const scoped = scopeChatContext(workspace, selection);
  const prompt = buildChatTurnPrompt({ instructions: '', workspace: scoped, history: '', pageContext: '', evidence: '', mailEvidence: '', files: 'EXPLICIT_FILE', request: 'Hello' });
  expect(prompt).not.toContain('SECRET'); expect(prompt).not.toContain('OUTLOOK_CONTEXT'); expect(prompt).toContain('EXPLICIT_FILE');
  expect(scoped.sources).toEqual([]); expect(scoped.brainSources.codex).toBe(false);
  expect(selectedMemorySource({ origin: 'manual' }, selection)).toBe(false);
});
test('independent account and agent switches narrow context without enabling global exclusions', () => {
  const selection = { enabled: true, sources: { gmail: false, claude: false, personal: false } };
  const scoped = scopeChatContext(workspace, selection);
  expect(JSON.stringify(scoped)).not.toContain('GMAIL_SECRET'); expect(JSON.stringify(scoped)).not.toContain('PERSONAL_SECRET'); expect(JSON.stringify(scoped)).not.toContain('CLAUDE_SECRET');
  expect(scoped.sources.map(s => s.id)).toEqual(['outlook']); expect(scoped.inbox).toHaveLength(1); expect(scoped.brainSources.codex).toBe(false);
  expect(selectedMemorySource({ origin: 'email' }, selection)).toBe(false);
  expect(selectedMemorySource({ origin: 'email', connector: { provider: 'outlook' } }, selection)).toBe(true);
});
test('earlier answers cannot reintroduce excluded context, including after save/reload', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-policy-'));
  try {
    const selection = { enabled: true, sources: { gmail: false } };
    expect(selectedChatHistory({}, selection)).toBe(false);
    expect(selectedChatHistory({}, DEFAULT_CHAT_CONTEXT)).toBe(true);
    const store = conversationStore(root);
    store.save({ title: 'Synthetic policy', messages: [{ role: 'oracle', text: 'Selected context only', contextKey: contextSelectionKey(selection) }] });
    const message = store.list()[0].messages[0];
    expect(selectedChatHistory(message, selection)).toBe(true);
    expect(selectedChatHistory(message, DEFAULT_CHAT_CONTEXT)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('voice turns without verified source provenance stay in history but cannot be reused', () => {
  const root = mkdtempSync(join(tmpdir(), 'voice-policy-'));
  try {
    const store = conversationStore(root);
    store.save({ title: 'Jarvis fixture', messages: [{ role: 'oracle', text: 'Private realtime discussion', contextReusable: false, brainRevision: 1 }] });
    const turn = store.list()[0].messages[0];
    expect(turn.text).toBe('Private realtime discussion');
    expect(turn.contextReusable).toBe(false);
    expect(chatContextEligible(turn, { brainRevision: 1, sources: [] })).toBe(false);
    expect(chatContextEligible({ ...turn, contextReusable: true }, { brainRevision: 1, sources: [] })).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
