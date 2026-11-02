import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AcpHandoffFacts } from '../../src/main/workbench/external/acp/AcpHandoffFacts';
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore';
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore';
import type { AcpHandoffReadInput, AcpStructuredHandoff } from '../../src/shared/workbench/acp';
import type { ConversationMessage } from '../../src/shared/workbench/conversations';
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function fixture(messages: ConversationMessage[] = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-acp-handoff-'));
  const conversationDirectory = path.join(directory, 'conversations'), eventDirectory = path.join(directory, 'events');
  const conversations = new ConversationStore({ directory: conversationDirectory });
  const events = new ExecutionEventStore({ directory: eventDirectory, inlineBytes: 32 });
  cleanup.push(async () => { await events.flushMaintenance(); await fs.rm(directory, { recursive: true, force: true }); });
  await conversations.registerWorkspace({ workspaceId: 'space', rootPath: directory, managed: false, authorization: 'user-selected' });
  const identity = { workspaceId: 'space', conversationId: 'chosen' };
  let current = await conversations.createConversation(identity);
  current = await conversations.updateConversation({ ...identity, expectedRevision: current.revision, patch: { messages,
    frozenContextRefs: [{ contextRefId: 'original-ref', documentId: 'document', epoch: 'epoch', revision: 1 }] } });
  let artifacts: AcpStructuredHandoff['artifacts'] = [];
  const fresh = () => {
    // Reopen both durable owners: no original Host, controller, MCP session or in-memory operation map.
    const restoredConversations = new ConversationStore({ directory: conversationDirectory });
    const restoredEvents = new ExecutionEventStore({ directory: eventDirectory, inlineBytes: 32 });
    cleanup.push(() => restoredEvents.flushMaintenance());
    return new AcpHandoffFacts({
      read: async () => { const record = await restoredConversations.readConversation(identity); assert.ok(record); return record; },
      artifacts: () => structuredClone(artifacts), execution: () => restoredEvents.snapshot(identity.conversationId),
      blob: ref => restoredEvents.readBlob(identity.conversationId, ref),
    });
  };
  const append = (itemId: string, data: ExecutionEventInput['data'], type: ExecutionEventInput['type'] = 'tool',
    conversationId = identity.conversationId) => events.append({ eventId: randomUUID(), conversationId, taskId: 'task', runId: 'old-native-run',
      itemId, source: 'external-mcp', type, time: Date.now(), update: 'snapshot', data });
  return { directory, conversations, events, identity, fresh, append,
    artifacts: (next: AcpStructuredHandoff['artifacts']) => { artifacts = next; } };
}
const message = (messageId: string, text: string, createdAt = 1): ConversationMessage =>
  ({ messageId, text, createdAt, role: 'user', attachmentIds: [] });

describe('ACP durable work handoff', () => {
it('reopens a completed operation with its independent undelivered fact and clears it only after delivery', async () => {
  const f = await fixture([message('goal', '保存老师的稿件')])
  await f.append('receipt', { toolName: 'file.write', status: 'running', transportDelivery: 'unknown' })
  await f.append('receipt', { toolName: 'file.write', status: 'completed', applicationStatus: 'applied',
    operationId: 'op-1', documentId: 'document', revision: 3, output: '{"saved":true}' })
  await f.append('receipt', { transportDelivery: 'undelivered' })
  const reader = f.fresh(), lost = await reader.project()
  assert.match(lost.unsettledOperations.join('\n'), /undelivered/)
  const item = await reader.read({ section: 'item', runId: 'old-native-run', itemId: 'receipt' }) as {
    status: string; applicationStatus: string; transportDelivery: string; text: string }
  assert.equal(item.status, 'completed'); assert.equal(item.applicationStatus, 'applied')
  assert.equal(item.transportDelivery, 'undelivered'); assert.equal(item.text, '{"saved":true}')
  await f.append('receipt', { transportDelivery: 'delivered' })
  const after = await f.fresh().project()
  assert.doesNotMatch(after.unsettledOperations.join('\n'), /receipt/)
  const confirmed = await f.fresh().read({ section: 'item', runId: 'old-native-run', itemId: 'receipt' }) as {
    status: string; applicationStatus: string; transportDelivery: string }
  assert.equal(confirmed.status, 'completed'); assert.equal(confirmed.applicationStatus, 'applied')
  assert.equal(confirmed.transportDelivery, 'delivered')
})
  it('keeps an early user constraint after more than four turns and reads truncated instructions by original identity', async () => {
    const original = '请保留老师手写标题。' + '背景说明。'.repeat(1300) + '结尾明确约束：不要修改实验参数。';
    const f = await fixture([message('original', original), ...Array.from({ length: 8 }, (_, i) => message(`later-${i}`, `继续第${i}步`, i + 2))]);
    const reader = f.fresh(), handoff = await reader.project();
    assert.match(handoff.userInstructions![0]!, /保留老师手写标题/);
    assert.equal(handoff.history?.instructionCount, 9);
    assert.deepEqual(handoff.confirmedDecisions, []); // Ordinary messages are not fabricated question/answer confirmations.
    const page = await reader.read({ section: 'instructions', messageId: 'original' }) as { text: string; hasMore: boolean; next: { input: AcpHandoffReadInput } };
    assert.equal(page.hasMore, true);
    const tail = await reader.read(page.next.input) as { text: string; hasMore: boolean };
    assert.match(tail.text, /不要修改实验参数/);
    assert.equal(page.text + tail.text, original);
  });

  it('discloses a bounded preview and keeps every omitted instruction reachable instead of dropping the middle of history', async () => {
    const messages = Array.from({ length: 80 }, (_, i) => message(`user-${i}`, `第${i}条：${'要求'.repeat(320)}`, i + 1));
    const f = await fixture(messages), reader = f.fresh(), handoff = await reader.project();
    assert.equal(handoff.history?.instructionCount, 80);
    assert.ok(handoff.history!.includedInstructions < 80);
    const next = await reader.read(handoff.history!.instructions.input) as { instructions: Array<{ messageId: string }> };
    assert.equal(next.instructions[0]!.messageId, `user-${handoff.history!.includedInstructions}`);
    const middle = await reader.read({ section: 'instructions', messageId: 'user-43' }) as { text: string };
    assert.equal(middle.text, messages[43]!.text);
  });

  it('uses recorded answers and current document heads without relabelling unknown changes as human edits', async () => {
    const f = await fixture([message('goal', '改第二页，不改封面')]);
    await f.append('question', { toolName: 'ask_user', status: 'completed',
      question: { text: '保留哪一版标题？', options: [{ label: '老师版' }, { label: '新生成版' }], multiple: false }, answer: { choices: [0] } });
    f.artifacts([{ path: 'lesson.glx', documentId: 'document', revision: 'epoch:3', dirty: true,
      undoHead: { operationId: 'teacher-edit', actor: 'human' } },
    { path: 'second.glx', documentId: 'other-document', revision: 'other:2', dirty: true }]);
    const reader = f.fresh(), handoff = await reader.project();
    assert.match(handoff.confirmedDecisions[0]!, /老师版/);
    assert.match(handoff.humanChanges[0]!, /人工修改 teacher-edit/);
    assert.match(handoff.humanChanges[0]!, /不同于原会话引用版本/);
    assert.match(handoff.humanChanges[1]!, /不推定作者/);
    assert.doesNotMatch(handoff.humanChanges[1]!, /当前撤销头是人工修改/);
    const decision = await reader.read({ section: 'item', runId: 'old-native-run', itemId: 'question', field: 'decision' }) as { text: string };
    assert.deepEqual(JSON.parse(decision.text).answer, { choices: [0] });
  });

  it('reads a committed result and an unsettled input from durable owners after all native connection objects are gone', async () => {
    const f = await fixture([message('goal', '修改价格后保存')]);
    const result = JSON.stringify({ kind: 'applied', operationId: 'domain-op', documentId: 'document', revision: 3, note: '已提交，网络回包未确认。' });
    await f.append('old-connection-ticket', { toolName: 'project.apply', status: 'running', input: '{"price":30}' });
    await f.append('old-connection-ticket', { toolName: 'project.apply', status: 'completed', applicationStatus: 'applied',
      documentId: 'document', operationId: 'domain-op', revision: 3, output: result });
    await f.append('unknown-save', { toolName: 'file.save', status: 'running', input: '{"documentId":"document","expectedRevision":3}' });
    await f.append('state', { status: 'stopped', remainingGoal: ['核对保存是否已经完成，不重复提交价格修改'] }, 'run.end');
    const reader = f.fresh(), before = await f.events.snapshot('chosen'), handoff = await reader.project();
    assert.match(handoff.unsettledOperations.join('\n'), /unknown-save/);
    assert.doesNotMatch(handoff.unsettledOperations.join('\n'), /old-connection-ticket/);
    assert.match(handoff.unfinishedWork.join('\n'), /不重复提交价格修改/);
    const receipt = await reader.read({ section: 'item', runId: 'old-native-run', itemId: 'old-connection-ticket' }) as { text: string; applicationStatus: string; operationId: string };
    assert.equal(receipt.text, result); assert.equal(receipt.applicationStatus, 'applied'); assert.equal(receipt.operationId, 'domain-op');
    const pending = await reader.read({ section: 'item', runId: 'old-native-run', itemId: 'unknown-save', field: 'input' }) as { text: string; status: string };
    assert.equal(pending.status, 'running'); assert.equal(JSON.parse(pending.text).expectedRevision, 3);
    assert.deepEqual(await f.events.snapshot('chosen'), before); // Readback neither replays nor rewrites the old outcome.
  });

  it('rejects another conversation, restricted reasoning and caller-selected conversation IDs', async () => {
    const f = await fixture([message('own', '当前任务')]);
    await f.conversations.createConversation({ workspaceId: 'space', conversationId: 'other' });
    await f.append('foreign-operation', { status: 'completed', output: 'another conversation secret' }, 'tool', 'other');
    await f.append('private', { text: 'provider private reasoning' }, 'reasoning');
    const reader = f.fresh();
    await assert.rejects(reader.read({ section: 'item', runId: 'old-native-run', itemId: 'foreign-operation' }), /不属于当前会话/);
    await assert.rejects(reader.read({ section: 'item', runId: 'old-native-run', itemId: 'private', field: 'text' }), /不是可交接的公开事实/);
    await assert.rejects(reader.read({ section: 'instructions', conversationId: 'other' } as AcpHandoffReadInput));
    await assert.rejects(reader.read({ section: 'instructions', messageId: 'foreign-message' }), /不属于当前会话/);
    const work = await reader.read({ section: 'work' });
    assert.doesNotMatch(JSON.stringify(work), /provider private|another conversation/);
  });
});
