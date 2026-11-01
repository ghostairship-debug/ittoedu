import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { AcpExecutionController, type AcpExecutionControllerOptions } from '../../src/main/workbench/external/acp/AcpExecutionController';
import type { AcpHostSnapshot } from '../../src/shared/workbench/acp';
import type { AcpSendInput } from '../../src/shared/workbench/acpDesktop';
import type { ConversationRecord } from '../../src/shared/workbench/conversations';
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  let record = { workspaceId: 'workspace', conversationId: 'conversation', revision: 1, title: '',
    inputDraft: 'Work', inputAttachments: [], messages: [], runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] } } as unknown as ConversationRecord;
  let gateUpdate: Promise<void> | undefined, afterUpdate: Promise<void> | undefined, startEvent: Promise<void> | undefined, rejectEvents = false;
  const events: ExecutionEventInput[] = [];
  const options: AcpExecutionControllerOptions = {
    workspaceId: record.workspaceId, conversationId: record.conversationId, cwd: process.cwd(),
    read: async () => structuredClone(record),
    update: async change => {
      await gateUpdate;
      const patch = change(structuredClone(record));
      if (patch) record = { ...record, ...patch, revision: record.revision + 1 };
      await afterUpdate;
      return structuredClone(record);
    },
    stopBuiltin: async () => undefined,
    append: async event => { if (rejectEvents) throw new Error('event storage unavailable'); events.push(event); if (event.type === 'run.state') await startEvent; },
    flush: async () => undefined, onSnapshot: () => undefined, openDocumentation: async () => undefined,
    artifactFacts: () => [], createBinding: async () => { throw new Error('native processes must not be launched in this test'); },
  };
  const controller = new AcpExecutionController(options);
  const state: AcpHostSnapshot = { selectedAgentId: 'codex', phase: 'ready', agents: [], configuration: [], authenticationMethods: [],
    pendingPermissions: [], segments: [], nativeDiskAccess: true };
  vi.spyOn(controller.host, 'snapshot', 'get').mockImplementation(() => structuredClone(state));
  vi.spyOn(controller.host, 'selectAgent').mockImplementation(async agentId => {
    state.selectedAgentId = agentId; state.phase = agentId === 'builtin' ? 'idle' : 'ready';
    state.segment = agentId === 'builtin' ? undefined : { id: 'replacement-segment', agentId, nativeSessionId: 'replacement-native', startedAt: new Date().toISOString() };
    return structuredClone(state);
  });
  vi.spyOn(controller.host, 'cancel').mockImplementation(async () => { state.phase = 'error'; state.segment = undefined; return structuredClone(state); });
  const native = deferred<Record<string, unknown>>();
  const prompt = vi.spyOn(controller.host, 'prompt').mockImplementation(async () => {
    state.phase = 'prompting';
    try { return await native.promise; }
    finally { state.phase = 'ready'; }
  });
  const input: AcpSendInput = { workspaceId: record.workspaceId, conversationId: record.conversationId, submissionId: 'submission-1',
    expectedRevision: 1, text: 'Work', documents: [], permission: 'read-only' };
  return { controller, options, state, native, prompt, input, events, read: () => record,
    gate: (value?: Promise<void>) => { gateUpdate = value; }, failEvents: (value: boolean) => { rejectEvents = value; },
    gateAfterUpdate: (value?: Promise<void>) => { afterUpdate = value; }, gateStartEvent: (value?: Promise<void>) => { startEvent = value; },
    draft: (text: string) => { record = { ...record, inputDraft: text, revision: record.revision + 1 }; } };
}

afterEach(() => vi.restoreAllMocks());

describe('ACP submission acceptance', () => {
  it('confirms an accepted submission while its original native turn is still running', async () => {
    const f = fixture();
    let preparations = 0;
    f.options.prepareDocuments = async input => { preparations++; if (preparations > 1) throw new Error('document was closed after acceptance'); return input.documents; };
    const accepted = await f.controller.send(f.input);
    assert.equal(accepted.snapshot.phase, 'prompting');
    const confirmed = await f.controller.send(f.input);
    assert.equal(confirmed.conversation.messages.length, 1);
    assert.equal(confirmed.conversation.messages[0].runId, accepted.conversation.messages[0].runId);
    assert.equal(f.prompt.mock.calls.length, 1);
    assert.equal(preparations, 1);
    assert.equal(f.read().inputDraft, '');
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
  });

  it('reads durable acceptance after a cold controller starts with the built-in default', async () => {
    const f = fixture(); await f.controller.send(f.input);
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
    const restarted = new AcpExecutionController(f.options);
    const prompt = vi.spyOn(restarted.host, 'prompt');
    const result = await restarted.send(f.input);
    assert.equal(result.snapshot.selectedAgentId, 'builtin');
    assert.equal(result.conversation.messages.length, 1);
    assert.equal(prompt.mock.calls.length, 0); await restarted.dispose();
  });

  it('shares one pending acceptance for simultaneous confirmations of the same identity', async () => {
    const f = fixture(), gate = deferred<void>(); f.gate(gate.promise);
    const first = f.controller.send(f.input), second = f.controller.send(f.input);
    assert.equal(first, second);
    await tick(); assert.equal(f.prompt.mock.calls.length, 0);
    gate.resolve(); await Promise.all([first, second]);
    assert.equal(f.prompt.mock.calls.length, 1); assert.equal(f.read().messages.length, 1);
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
  });

  it('does not accept another identity while the first conversation CAS is still pending', async () => {
    const f = fixture(), gate = deferred<void>(); f.gate(gate.promise);
    const first = f.controller.send(f.input); await tick();
    await assert.rejects(f.controller.send({ ...f.input, submissionId: 'different-submission' }), /上一条任务仍在处理中/);
    gate.resolve(); await first;
    assert.equal(f.read().messages.length, 1); assert.equal(f.prompt.mock.calls.length, 1);
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
  });

  it('never rebinds an accepted identity to different text or overwrites a newer human draft', async () => {
    const f = fixture(); await f.controller.send(f.input); f.draft('New human draft');
    await assert.rejects(f.controller.send({ ...f.input, text: 'Different work' }), /相同提交身份已绑定不同消息/);
    const confirmed = await f.controller.send(f.input);
    assert.equal(confirmed.conversation.inputDraft, 'New human draft');
    assert.equal(f.prompt.mock.calls.length, 1);
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
  });

  it('keeps an uncertain failed turn in history without placing it back into the composer as new work', async () => {
    const f = fixture(); await f.controller.send(f.input);
    f.native.reject(new Error('native connection dropped after a tool may have committed'));
    await tick(); await tick();
    assert.equal(f.read().inputDraft, ''); assert.equal(f.read().messages[0].text, 'Work');
    assert.ok(f.events.some(event => event.type === 'run.end' && event.data.status === 'failed'));
    await f.controller.send(f.input); assert.equal(f.prompt.mock.calls.length, 1);
    await f.controller.dispose();
  });

  it('does not replay an accepted message when recording the start event fails', async () => {
    const f = fixture(); f.failEvents(true);
    await assert.rejects(f.controller.send(f.input), /event storage unavailable/);
    f.failEvents(false);
    const confirmed = await f.controller.send(f.input);
    assert.equal(confirmed.conversation.messages.length, 1);
    assert.equal(f.prompt.mock.calls.length, 0);
    f.draft('A separate explicit message');
    await f.controller.send({ ...f.input, submissionId: 'new-submission', expectedRevision: f.read().revision, text: f.read().inputDraft });
    assert.equal(f.prompt.mock.calls.length, 1);
    f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
  });

  it('confirms only after pending acceptance settles and lets a definitively unaccepted input leave ACK recovery', async () => {
    for (const fail of [false, true]) {
      const f = fixture(), preparation = deferred<void>();
      f.options.prepareDocuments = async input => { await preparation.promise; if (fail) throw new Error('document preparation failed'); return input.documents; };
      const sending = f.controller.send(f.input);
      const expected = fail ? assert.rejects(sending, /document preparation failed/) : sending;
      await tick();
      let finished = false;
      const confirmation = f.controller.operate({ action: 'confirm', workspaceId: f.input.workspaceId, conversationId: f.input.conversationId,
        submissionId: f.input.submissionId }).then(result => { finished = true; return result; });
      await tick(); assert.equal(finished, false);
      preparation.resolve(); await expected;
      const result = await confirmation;
      assert.equal(result.conversation.messages.some(message => message.messageId === f.input.submissionId), !fail);
      assert.equal(f.prompt.mock.calls.length, fail ? 0 : 1);
      assert.equal(result.conversation.inputDraft, fail ? 'Work' : '');
      f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
    }
  });

  it('preserves the draft when the selected Agent changes during document preparation', async () => {
    const f = fixture(), preparation = deferred<void>();
    f.options.prepareDocuments = async input => { await preparation.promise; return input.documents; };
    const rejected = assert.rejects(f.controller.send(f.input), /消息尚未接受/); await tick();
    await f.controller.operate({ action: 'select', workspaceId: f.input.workspaceId, conversationId: f.input.conversationId, agentId: 'claude' });
    preparation.resolve(); await rejected;
    assert.equal(f.prompt.mock.calls.length, 0); assert.equal(f.read().messages.length, 0); assert.equal(f.read().inputDraft, 'Work');
    await f.controller.dispose();
  });

  it('preserves an unaccepted draft while native configuration is changing, including a delayed conversation CAS', async () => {
    for (const boundary of ['before-send', 'during-cas'] as const) {
      const f = fixture(), writing = deferred<void>();
      if (boundary === 'before-send') f.state.phase = 'switching'; else f.gate(writing.promise);
      const rejected = assert.rejects(f.controller.send(f.input), boundary === 'before-send' ? /尚未就绪/ : /消息尚未接受/);
      if (boundary === 'during-cas') { await tick(); f.state.phase = 'switching'; writing.resolve(); }
      await rejected;
      assert.equal(f.read().inputDraft, 'Work'); assert.equal(f.read().messages.length, 0); assert.equal(f.prompt.mock.calls.length, 0);
      await f.controller.dispose();
    }
  });

  it('does not change native configuration after submission acceptance has reserved the next turn', async () => {
    for (const boundary of ['document-preparation', 'start-event'] as const) {
      const f = fixture(), pending = deferred<void>();
      if (boundary === 'document-preparation') f.options.prepareDocuments = async input => { await pending.promise; return input.documents; };
      else f.gateStartEvent(pending.promise);
      const configure = vi.spyOn(f.controller.host, 'configure').mockImplementation(async () => structuredClone(f.state));
      const sending = f.controller.send(f.input); await tick();
      await assert.rejects(f.controller.operate({ action: 'configure', workspaceId: f.input.workspaceId, conversationId: f.input.conversationId,
        values: { model: 'different-model' } }), /当前任务处理结束/);
      assert.equal(configure.mock.calls.length, 0);
      pending.resolve(); await sending;
      assert.equal(f.prompt.mock.calls.length, 1); assert.equal(f.read().messages.length, 1);
      f.native.resolve({ stopReason: 'end_turn' }); await f.controller.dispose();
    }
  });

  it('rechecks authority inside the delayed conversation CAS after cancellation', async () => {
    const f = fixture(), writing = deferred<void>(); f.gate(writing.promise);
    const rejected = assert.rejects(f.controller.send(f.input), /消息尚未接受/); await tick();
    await f.controller.operate({ action: 'cancel', workspaceId: f.input.workspaceId, conversationId: f.input.conversationId });
    writing.resolve(); await rejected;
    assert.equal(f.prompt.mock.calls.length, 0); assert.equal(f.read().messages.length, 0); assert.equal(f.read().inputDraft, 'Work');
    await f.controller.dispose();
  });

  it('records a stopped accepted message when a switch races with the durable acceptance receipt or start event', async () => {
    for (const boundary of ['accepted-update', 'start-event'] as const) {
      const f = fixture(), gate = deferred<void>();
      if (boundary === 'accepted-update') f.gateAfterUpdate(gate.promise); else f.gateStartEvent(gate.promise);
      const sending = f.controller.send(f.input); await tick();
      assert.equal(f.read().messages.length, 1);
      await f.controller.operate({ action: 'select', workspaceId: f.input.workspaceId, conversationId: f.input.conversationId, agentId: 'claude' });
      f.draft('New draft for the selected Agent');
      gate.resolve(); const result = await sending;
      assert.equal(f.prompt.mock.calls.length, 0); assert.equal(result.conversation.messages.length, 1);
      assert.equal(result.conversation.inputDraft, 'New draft for the selected Agent');
      assert.ok(f.events.some(event => event.type === 'run.end' && event.data.status === 'stopped'));
      assert.equal((await f.controller.send(f.input)).conversation.messages.length, 1);
      assert.equal(f.prompt.mock.calls.length, 0); await f.controller.dispose();
    }
  });

  it('never launches accepted work whose start-event receipt arrives after controller disposal', async () => {
    const f = fixture(), recording = deferred<void>(); f.gateStartEvent(recording.promise);
    const sending = f.controller.send(f.input); await tick();
    await f.controller.dispose(); recording.resolve(); await sending;
    assert.equal(f.prompt.mock.calls.length, 0);
    assert.ok(f.events.some(event => event.type === 'run.end' && event.data.status === 'stopped'));
    assert.equal(f.read().inputDraft, '');
  });
});
