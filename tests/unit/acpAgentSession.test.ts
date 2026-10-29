import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { AcpAgentSession, createStdioAcpTransport, type AcpTransport } from '../../src/main/workbench/external/acp/AcpAgentSession';

type Message = Parameters<AcpTransport['send']>[0];
const modelId = 'gpt-6.1-terra';
const configuration = () => [
  { id: 'model', category: 'model', currentValue: modelId, options: [{ value: modelId }, { value: 'gpt-6-luna' }] },
  { id: 'reasoning_effort', category: 'thought_level', currentValue: 'medium', options: [{ value: 'medium' }] },
];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class FakeTransport implements AcpTransport {
  sent: Message[] = [];
  listeners = new Set<(message: Message) => void>();
  exits = new Set<(error: Error) => void>();
  closed = false;
  config = configuration();
  capabilities: Record<string, unknown> = { mcpCapabilities: { http: true }, loadSession: true, sessionCapabilities: { resume: {} } };
  intercept?: (message: Message) => boolean;
  send(message: Message) {
    if (this.closed) throw new Error('transport disconnected');
    this.sent.push(structuredClone(message));
    if (!message.method || message.id === undefined || this.intercept?.(message)) return;
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: this.capabilities };
    else if (message.method === 'session/new') result = { sessionId: 'session-1', configOptions: this.config };
    else if (message.method === 'session/resume' || message.method === 'session/load') result = { configOptions: this.config };
    else if (message.method === 'session/set_config_option') {
      this.config = this.config.map(option => option.id === message.params?.configId ? { ...option, currentValue: String(message.params.value) } : option);
      result = { configOptions: this.config };
    } else if (message.method === 'session/close') result = {};
    else return;
    queueMicrotask(() => this.reply(message.id!, result));
  }
  reply(id: string | number, result: unknown) { this.emit({ jsonrpc: '2.0', id, result }); }
  emit(message: Message) { for (const listener of this.listeners) listener(message); }
  onMessage(listener: (message: Message) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onClose(listener: (error: Error) => void) { this.exits.add(listener); return () => { this.exits.delete(listener); }; }
  disconnect() { this.closed = true; for (const listener of this.exits) listener(new Error('transport disconnected')); }
  async close() { if (!this.closed) this.disconnect(); }
  permission(id: number, sessionId = 'session-1') {
    this.emit({ jsonrpc: '2.0', id, method: 'session/request_permission', params: { sessionId,
      toolCall: { kind: 'edit', rawInput: { server: 'guoling', tool: 'text.replace' } },
      options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
  }
  promptId() { return this.sent.findLast(message => message.method === 'session/prompt')!.id!; }
}

async function ready(transport: FakeTransport, options: Omit<ConstructorParameters<typeof AcpAgentSession>[0], 'transport'> = {}) {
  const session = new AcpAgentSession({ transport, ...options });
  await session.initialize();
  await session.open({ cwd: process.cwd(), mcpServers: [{ type: 'http', name: 'guoling', url: 'http://127.0.0.1:13084/mcp', headers: [] }] });
  await session.configure({ modelId, effort: 'medium' });
  return session;
}

describe('AcpAgentSession lifecycle', () => {
  it('does not report initialization or recovery after a reply races with disconnect', async () => {
    for (const method of ['initialize', 'session/new', 'session/resume']) {
      const transport = new FakeTransport(), session = new AcpAgentSession({ transport });
      if (method !== 'initialize') await session.initialize();
      transport.intercept = message => {
        if (message.method !== method) return false;
        transport.reply(message.id!, method === 'initialize'
          ? { protocolVersion: 1, agentCapabilities: transport.capabilities }
          : { sessionId: 'session-1', configOptions: configuration() });
        transport.disconnect(); return true;
      };
      const opening = method === 'initialize' ? session.initialize()
        : method === 'session/new' ? session.open({ cwd: process.cwd(), mcpServers: [] })
        : session.restore({ sessionId: 'session-1', cwd: process.cwd(), mcpServers: [] });
      await assert.rejects(opening, /transport disconnected/);
      assert.equal(session.snapshot.phase, 'failed');
      assert.equal(session.snapshot.pendingRequests, 0);
      await session.close();
    }
  });

  it('requires a live connection when confirming configuration after recovery', async () => {
    const transport = new FakeTransport(), session = new AcpAgentSession({ transport });
    await session.initialize();
    await session.restore({ sessionId: 'session-1', cwd: process.cwd(), mcpServers: [], configOptions: configuration() });
    await assert.rejects(session.prompt([{ type: 'text', text: 'continue' }]), /Verify exact model/);
    transport.intercept = message => {
      if (message.params?.configId !== 'reasoning_effort') return false;
      transport.reply(message.id!, { configOptions: configuration() }); transport.disconnect(); return true;
    };
    await assert.rejects(session.configure({ modelId, effort: 'medium' }), /transport disconnected/);
    assert.equal(session.snapshot.phase, 'failed');
    assert.equal(session.snapshot.modelId, undefined);
    assert.equal(transport.sent.some(message => message.method === 'session/prompt'), false);
    await session.close();
  });

  it('rejects a stale model setting even when the requested model was advertised', async () => {
    const transport = new FakeTransport();
    transport.config[0].currentValue = 'gpt-6-luna';
    transport.intercept = message => {
      if (message.method !== 'session/set_config_option') return false;
      transport.reply(message.id!, { configOptions: transport.config }); return true;
    };
    const session = new AcpAgentSession({ transport });
    await session.initialize(); await session.open({ cwd: process.cwd(), mcpServers: [] });
    await assert.rejects(session.configure({ modelId, effort: 'medium' }), /did not confirm model/);
    await assert.rejects(session.prompt([{ type: 'text', text: 'edit' }]), /Verify exact model/);
    assert.equal(transport.sent.some(message => message.method === 'session/prompt'), false);
    await session.close();
  });

  it('rechecks the model after configuring effort, without falling back to previous config', async () => {
    const transport = new FakeTransport();
    transport.intercept = message => {
      if (message.params?.configId !== 'reasoning_effort') return false;
      transport.config[0].currentValue = 'gpt-6-luna';
      transport.reply(message.id!, { configOptions: transport.config }); return true;
    };
    const session = new AcpAgentSession({ transport });
    await session.initialize(); await session.open({ cwd: process.cwd(), mcpServers: [] });
    await assert.rejects(session.configure({ modelId, effort: 'medium' }), /did not confirm model/);
    await session.close();
  });

  it('keeps a later configuration update authoritative over an earlier acknowledgement', async () => {
    const transport = new FakeTransport(), session = new AcpAgentSession({ transport });
    await session.initialize(); await session.open({ cwd: process.cwd(), mcpServers: [] });
    transport.intercept = message => {
      if (message.params?.configId !== 'reasoning_effort') return false;
      transport.reply(message.id!, { configOptions: configuration() });
      const changed = configuration(); changed[0].currentValue = 'gpt-6-luna';
      transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1',
        update: { sessionUpdate: 'config_option_update', configOptions: changed } } });
      return true;
    };
    await assert.rejects(session.configure({ modelId, effort: 'medium' }), /did not confirm model/);
    assert.equal(session.configuration[0].currentValue, 'gpt-6-luna');
    await assert.rejects(session.prompt([{ type: 'text', text: 'edit' }]), /Verify exact model/);
    assert.equal(transport.sent.some(message => message.method === 'session/prompt'), false);
    await session.close();
  });

  it('cancels pending and late permission requests exactly once, then allows a new turn', async () => {
    const transport = new FakeTransport();
    let decide!: (option: string) => void, aborted = false;
    const session = await ready(transport, { permissionPolicy: (_request, signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(resolve => { decide = resolve; });
    } });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    transport.permission(101);
    const cancelling = session.cancel();
    assert.equal(aborted, true);
    transport.permission(102);
    decide('yes'); await tick();
    for (const id of [101, 102]) {
      const answers = transport.sent.filter(message => message.id === id && !message.method);
      assert.equal(answers.length, 1);
      assert.deepEqual(answers[0].result, { outcome: { outcome: 'cancelled' } });
    }
    transport.reply(transport.promptId(), { stopReason: 'cancelled' });
    assert.equal((await running).stopReason, 'cancelled'); await cancelling;
    assert.equal(session.snapshot.pendingPermissions, 0);
    const next = session.prompt([{ type: 'text', text: 'continue' }]);
    transport.reply(transport.promptId(), { stopReason: 'end_turn' });
    assert.equal((await next).stopReason, 'end_turn');
    await session.close();
  });

  it('revokes permission at the terminal prompt receipt before asynchronous cleanup', async () => {
    const transport = new FakeTransport();
    let decisions = 0;
    const session = await ready(transport, { permissionPolicy: () => { decisions++; return 'yes'; } });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    transport.permission(101);
    transport.reply(transport.promptId(), { stopReason: 'end_turn' });
    transport.permission(102);
    assert.equal((await running).stopReason, 'end_turn'); await tick();
    assert.equal(decisions, 1);
    for (const id of [101, 102]) {
      const answers = transport.sent.filter(message => message.id === id && !message.method);
      assert.equal(answers.length, 1);
      assert.deepEqual(answers[0].result, { outcome: { outcome: 'cancelled' } });
    }
    assert.equal(session.snapshot.pendingPermissions, 0);
    await session.close();
  });

  it('does not treat an end_turn racing with cancellation as a successful turn', async () => {
    const transport = new FakeTransport(), session = await ready(transport);
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    const rejected = assert.rejects(running, /inspect domain receipts/);
    const cancelled = session.cancel();
    transport.reply(transport.promptId(), { stopReason: 'end_turn' });
    await Promise.all([rejected, cancelled]);
    await session.close();
  });

  it('denies permission immediately but waits for domain revocation before cancelling ACP', async () => {
    const transport = new FakeTransport();
    let finishRevoke!: () => void, revokeCalls = 0;
    const session = await ready(transport, { onBeforeCancel: () => { revokeCalls++; return new Promise(resolve => { finishRevoke = resolve; }); } });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    const cancelling = session.cancel();
    transport.permission(101); await tick();
    assert.equal(session.snapshot.cancelling, true);
    assert.deepEqual(transport.sent.find(message => message.id === 101)?.result, { outcome: { outcome: 'cancelled' } });
    assert.equal(transport.sent.some(message => message.method === 'session/cancel'), false);
    finishRevoke(); await tick();
    assert.equal(transport.sent.some(message => message.method === 'session/cancel'), true);
    transport.reply(transport.promptId(), { stopReason: 'cancelled' });
    await Promise.all([running, cancelling]); assert.equal(revokeCalls, 1); await session.close();
  });

  it('revokes and cancels once when a permission abort callback reenters cancellation', async () => {
    const transport = new FakeTransport();
    let revokeCalls = 0, reentrant: Promise<void> | undefined;
    const session = await ready(transport, {
      onBeforeCancel: () => { revokeCalls++; },
      permissionPolicy: (_request, signal) => {
        signal.addEventListener('abort', () => { reentrant = session.cancel(); });
        return new Promise<string | undefined>(() => undefined);
      },
    });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    transport.permission(101);
    const cancelling = session.cancel(); await tick();
    const cancelMessages = transport.sent.filter(message => message.method === 'session/cancel').length;
    transport.reply(transport.promptId(), { stopReason: 'cancelled' });
    await Promise.all([running, cancelling, reentrant]);
    assert.equal(revokeCalls, 1);
    assert.equal(cancelMessages, 1);
    assert.equal(transport.sent.filter(message => message.id === 101 && !message.method).length, 1);
    await session.close();
  });

  it('reports failed domain revocation and still stops the owned transport', async () => {
    const transport = new FakeTransport();
    const session = await ready(transport, { onBeforeCancel: () => { throw new Error('scope stop failed'); } });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    const rejected = assert.rejects(running, /Domain cancellation hook failed/);
    const cancelling = assert.rejects(session.cancel(), /Domain cancellation hook failed/);
    await Promise.all([rejected, cancelling]); await tick();
    assert.equal(session.snapshot.pendingRequests, 0); assert.equal(transport.closed, true);
    assert.equal(transport.sent.some(message => message.method === 'session/cancel'), false);
    await session.close();
  });

  it('bounds missing cancellation acknowledgement and rejects all pending work', async () => {
    const transport = new FakeTransport(), session = await ready(transport, { cancellationTimeoutMs: 15 });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    const rejected = assert.rejects(running, /acknowledge cancellation/);
    const cancelled = assert.rejects(session.cancel(), /acknowledge cancellation/);
    await Promise.all([rejected, cancelled]);
    assert.equal(transport.closed, true);
    assert.equal(session.snapshot.pendingRequests, 0);
    assert.equal(session.snapshot.phase, 'failed');
    assert.equal(transport.sent.filter(message => message.method === 'session/prompt').length, 1);
    await session.close();
  });

  it('settles a disconnected prompt and prevents a stale permission decision from being sent', async () => {
    const transport = new FakeTransport();
    let decide!: (option: string) => void;
    const session = await ready(transport, { permissionPolicy: () => new Promise(resolve => { decide = resolve; }) });
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    const rejected = assert.rejects(running, /disconnected/);
    transport.permission(101); transport.disconnect(); decide('yes'); await rejected; await tick();
    assert.equal(session.snapshot.pendingRequests, 0);
    assert.equal(session.snapshot.pendingPermissions, 0);
    assert.equal(transport.sent.some(message => message.id === 101 && JSON.stringify(message.result).includes('yes')), false);
    await session.close();
  });

  it('rejects unknown permissions by default and rejects another session', async () => {
    const transport = new FakeTransport(), session = await ready(transport);
    const running = session.prompt([{ type: 'text', text: 'edit' }]);
    transport.permission(101); transport.permission(102, 'unrelated'); await tick();
    assert.deepEqual(transport.sent.find(message => message.id === 101)?.result, { outcome: { outcome: 'selected', optionId: 'no' } });
    assert.equal((transport.sent.find(message => message.id === 102)?.error as { code: number }).code, -32602);
    transport.reply(transport.promptId(), { stopReason: 'end_turn' }); await running; await session.close();
  });

  it('checks transport capability before opening and recovers only the requested native session', async () => {
    const transport = new FakeTransport(); transport.capabilities.mcpCapabilities = {};
    const session = new AcpAgentSession({ transport }); await session.initialize();
    await assert.rejects(session.open({ cwd: process.cwd(), mcpServers: [{ type: 'http' }] }), /did not advertise http/);
    assert.equal(transport.sent.some(message => message.method === 'session/new'), false);
    transport.intercept = message => {
      if (message.method !== 'session/resume') return false;
      transport.reply(message.id!, { sessionId: 'wrong-session', configOptions: configuration() }); return true;
    };
    await assert.rejects(session.restore({ sessionId: 'session-1', cwd: process.cwd(), mcpServers: [] }), /changed native session ID/);
    assert.equal(session.snapshot.phase, 'failed'); await session.close();
  });

  it('marks load history as replay and resumes live updates without executing them', async () => {
    const transport = new FakeTransport(); transport.capabilities.sessionCapabilities = {};
    const updates: Array<{ replay: boolean; update: Record<string, unknown> }> = [];
    transport.intercept = message => {
      if (message.method !== 'session/load') return false;
      transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'previous-edit' } } });
      transport.reply(message.id!, { configOptions: configuration() }); return true;
    };
    const session = new AcpAgentSession({ transport, onSessionUpdate: update => updates.push(update) });
    await session.initialize();
    const restored = await session.restore({ sessionId: 'session-1', cwd: process.cwd(), mcpServers: [] });
    assert.equal(restored.recoveryMethod, 'session/load');
    assert.equal(updates[0].replay, true);
    assert.equal(transport.sent.some(message => message.method === 'session/prompt'), false);
    await session.configure({ modelId, effort: 'medium' });
    transport.emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'available_commands_update', availableCommands: [] } } });
    assert.equal(updates[1].replay, false); await session.close();
  });

  it('uses the real stdio transport for a zero-model handshake and clean shutdown', async () => {
    const program = `const r=require('node:readline').createInterface({input:process.stdin});r.on('line',s=>{const m=JSON.parse(s);if(m.method==='session/prompt')process.exit(8);if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:1,agentCapabilities:{}}:{}}));});r.on('close',()=>process.exit(0));`;
    const session = new AcpAgentSession({ transport: createStdioAcpTransport({ command: process.execPath, args: ['-e', program], cwd: process.cwd() }) });
    assert.equal((await session.initialize()).protocolVersion, 1);
    await session.close(); assert.equal(session.snapshot.phase, 'closed');
  });
});
