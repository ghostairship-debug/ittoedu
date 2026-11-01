import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { AcpAgentHost, type AcpAgentHostOptions, type AcpDomainBinding } from '../../src/main/workbench/external/acp/AcpAgentHost';
import type { AcpTransport } from '../../src/main/workbench/external/acp/AcpAgentSession';
import { emptyAcpHandoff } from '../../src/main/workbench/external/acp/AcpHandoff';
import type { AcpSessionSegment } from '../../src/shared/workbench/acp';

type Message = Parameters<AcpTransport['send']>[0];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class NativeAgent implements AcpTransport {
  sent: Message[] = [];
  closed = false;
  authenticated = true;
  capabilities: Record<string, unknown> = { mcpCapabilities: { http: true } };
  restoreError?: string;
  restoreRpcError?: { code: number; message: string; data?: Record<string, unknown> };
  config: Array<Record<string, unknown>> = [];
  onConfigure?: (id: string, value: unknown) => void;
  listeners = new Set<(message: Message) => void>();
  exits = new Set<(error: Error) => void>();
  send(message: Message): void {
    this.sent.push(message);
    if (message.method === 'session/cancel') { this.finish('cancelled'); return; }
    if (message.id === undefined || !message.method) return;
    if (message.method === 'initialize') this.reply(message.id, { protocolVersion: 1, agentCapabilities: this.capabilities, authMethods: [{ id: 'native', name: '原生登录' }] });
    if (message.method === 'authenticate') { this.authenticated = true; this.reply(message.id, {}); }
    if (message.method === 'session/new') {
      if (this.authenticated) this.reply(message.id, { sessionId: 'native-1', configOptions: this.config });
      else queueMicrotask(() => this.emit({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } }));
    }
    if (message.method === 'session/resume' || message.method === 'session/load') {
      if (this.restoreRpcError) queueMicrotask(() => this.emit({ jsonrpc: '2.0', id: message.id, error: this.restoreRpcError }));
      else if (this.restoreError) queueMicrotask(() => this.emit({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: this.restoreError } }));
      else this.reply(message.id, { sessionId: message.params?.sessionId, configOptions: this.config });
    }
    if (message.method === 'session/set_config_option') {
      this.config = this.config.map(option => option.id === message.params?.configId ? { ...option, currentValue: message.params?.value } : option);
      this.onConfigure?.(String(message.params?.configId), message.params?.value);
      this.reply(message.id, { configOptions: this.config });
    }
  }
  reply(id: string | number, result: unknown) { queueMicrotask(() => this.emit({ jsonrpc: '2.0', id, result })); }
  emit(message: Message) { for (const listener of this.listeners) listener(message); }
  finish(stopReason = 'end_turn') {
    const prompt = this.sent.findLast(message => message.method === 'session/prompt');
    if (prompt) this.reply(prompt.id!, { stopReason });
  }
  onMessage(listener: (message: Message) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onClose(listener: (error: Error) => void) { this.exits.add(listener); return () => { this.exits.delete(listener); }; }
  async close() { this.closed = true; }
}

function fixture(agent = new NativeAgent(), overrides: Partial<AcpDomainBinding> = {}, hostOptions: Partial<AcpAgentHostOptions> = {}) {
  const order: string[] = [];
  const binding: AcpDomainBinding = { cwd: process.cwd(), mcpServers: [{ type: 'http', name: 'guoling', url: 'http://127.0.0.1:12345/mcp', headers: [] }], handoff: emptyAcpHandoff(),
    activate: async () => { order.push('activate'); }, revoke: async () => { order.push('revoke'); }, settle: async () => { order.push('settle'); }, dispose: async () => { order.push('dispose'); }, ...overrides };
  const host = new AcpAgentHost({ cwd: process.cwd(), beforeSwitch: async () => { order.push('builtin-stopped'); },
    discover: async () => ({ agents: [{ id: 'codex', name: 'Codex', nativeInstalled: true, adapterInstalled: true, readiness: 'unverified', documentationUrl: 'https://github.com/zed-industries/codex-acp', nativeLoginHint: 'codex login' }],
      launches: [{ id: 'codex', command: 'unused', args: [] }] }),
    createBinding: async () => { order.push('binding'); return binding; }, createTransport: () => agent, ...hostOptions,
  });
  return { host, agent, binding, order };
}

describe('ACP product host', () => {
  it('keeps built-in as default and does not confuse discovered installation with readiness', async () => {
    const { host, agent, order } = fixture();
    assert.equal(host.snapshot.selectedAgentId, 'builtin');
    await host.discover(); assert.equal(host.snapshot.agents[0].readiness, 'unverified'); assert.equal(agent.sent.length, 0);
    await host.selectAgent('codex');
    assert.equal(host.snapshot.phase, 'ready'); assert.equal(host.snapshot.segment?.nativeSessionId, 'native-1');
    assert.deepEqual(host.snapshot.configuration, []); assert.equal(order.includes('activate'), false);
    const prompt = host.prompt('Fixed protocol probe'); await tick();
    assert.equal(order.includes('activate'), true); agent.finish(); await prompt;
    assert.deepEqual(order.slice(-3), ['activate', 'revoke', 'settle']);
    await host.selectAgent('builtin'); assert.equal(agent.closed, true); assert.equal(host.snapshot.selectedAgentId, 'builtin');
  });

  it('keeps a healthy selected Agent and its native session when selecting it again', async () => {
    const { host, agent, order } = fixture();
    await host.selectAgent('codex');
    const segment = host.snapshot.segment;
    await host.selectAgent('codex');
    assert.deepEqual(host.snapshot.segment, segment); assert.equal(agent.closed, false);
    assert.equal(order.filter(item => item === 'builtin-stopped').length, 1);
    assert.equal(agent.sent.filter(message => message.method === 'initialize').length, 1);
    assert.equal(agent.sent.filter(message => message.method === 'session/new').length, 1);
    await host.dispose();
  });

  it('waits for revocation before cancellation and for settlement before activating the replacement', async () => {
    const revoke = deferred(), settle = deferred(); let gated = false;
    const { host, agent, order } = fixture(new NativeAgent(), {
      revoke: async () => { if (gated) await revoke.promise; }, settle: async () => { if (gated) await settle.promise; },
    });
    await host.selectAgent('codex');
    const prompt = host.prompt('Work'); await tick(); gated = true;
    const switching = host.selectAgent('builtin'); await tick();
    assert.equal(agent.sent.some(message => message.method === 'session/cancel'), false);
    assert.equal(host.snapshot.selectedAgentId, 'codex');
    revoke.resolve(); await tick(); await tick();
    assert.equal(agent.sent.some(message => message.method === 'session/cancel'), true);
    assert.equal(order.filter(value => value === 'builtin-stopped').length, 1);
    settle.resolve(); await prompt; await switching;
    assert.equal(agent.closed, true); assert.equal(host.snapshot.selectedAgentId, 'builtin');
    assert.equal(order.filter(value => value === 'builtin-stopped').length, 2);
  });

  it('stops the owned process but refuses replacement when domain revocation fails', async () => {
    let fail = false;
    const { host, agent, order } = fixture(new NativeAgent(), { revoke: async () => { if (fail) throw new Error('revocation failed'); } });
    await host.selectAgent('codex'); fail = true;
    await assert.rejects(host.selectAgent('builtin'), /revocation failed/);
    assert.equal(agent.closed, true); assert.equal(host.snapshot.selectedAgentId, 'codex');
    assert.equal(host.snapshot.phase, 'error'); assert.equal(order.filter(value => value === 'builtin-stopped').length, 1);
    fail = false; await host.dispose();
  });

  it('uses native advertised authentication without installing a CLI or selecting another Agent', async () => {
    const agent = new NativeAgent(); agent.authenticated = false;
    const { host } = fixture(agent);
    await assert.rejects(host.selectAgent('codex'), /Authentication required/);
    assert.equal(host.snapshot.agents[0].readiness, 'authentication_required');
    assert.equal(host.snapshot.selectedAgentId, 'codex');
    await host.authenticate('native'); assert.equal(host.snapshot.phase, 'ready');
    assert.equal(agent.sent.filter(message => message.method === 'session/prompt').length, 0);
    await host.dispose();
  });

  it('does not fall back when a selected Agent has no installed ACP entry', async () => {
    const { host } = fixture();
    await assert.rejects(host.selectAgent('claude'), /尚未发现/);
    assert.equal(host.snapshot.selectedAgentId, 'claude'); assert.equal(host.snapshot.phase, 'error');
    await assert.rejects(host.prompt('Work'), /尚未就绪/);
    await host.selectAgent('builtin'); assert.equal(host.snapshot.phase, 'idle');
  });

  it('refreshes discovery for a newly installed adapter even when another Agent was already found', async () => {
    let installed = false, discoveries = 0;
    const { host, agent } = fixture(new NativeAgent(), {}, { discover: async () => {
      discoveries++;
      return { agents: [{ id: 'codex', name: 'Codex', nativeInstalled: true, adapterInstalled: installed,
        readiness: installed ? 'unverified' : 'adapter_missing', documentationUrl: '', nativeLoginHint: 'codex login' }],
      launches: [{ id: 'opencode', command: 'opencode', args: ['acp'] },
        ...(installed ? [{ id: 'codex' as const, command: 'codex-acp', args: [] }] : [])] };
    } });
    await host.discover(); installed = true;
    await host.selectAgent('codex');
    assert.equal(discoveries, 2); assert.equal(host.snapshot.phase, 'ready');
    assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false);
    await host.dispose();
  });

  it('reports the discovered missing adapter detail instead of a generic connection error', async () => {
    const { host } = fixture(new NativeAgent(), {}, { discover: async () => ({
      agents: [{ id: 'codex', name: 'Codex', nativeInstalled: true, adapterInstalled: false, readiness: 'adapter_missing',
        detail: '尚未发现 ACP 适配器 codex-acp（@agentclientprotocol/codex-acp）', documentationUrl: '', nativeLoginHint: 'codex login' }], launches: [],
    }) });
    await assert.rejects(host.selectAgent('codex'), /@agentclientprotocol\/codex-acp/);
    assert.match(host.snapshot.error ?? '', /codex-acp/);
    await host.dispose();
  });

  it('installs the selected adapter and connects automatically without sending a model prompt', async () => {
    let installed = false;
    const phases: string[] = [];
    const installationOwners: string[] = [];
    const { host, agent, order } = fixture(new NativeAgent(), {}, {
      discover: async () => ({ agents: [{ id: 'codex', name: 'Codex', nativeInstalled: true, adapterInstalled: installed,
        readiness: installed ? 'unverified' : 'adapter_missing', documentationUrl: '', nativeLoginHint: 'codex login' }],
      launches: installed ? [{ id: 'codex', command: 'codex-acp', args: [] }] : [] }),
      install: async id => { assert.equal(id, 'codex'); order.push('install'); installed = true; },
      onEvent: event => { if (event.snapshot) {
        phases.push(event.snapshot.phase);
        if (event.snapshot.phase === 'installing') installationOwners.push(event.snapshot.selectedAgentId);
      } },
    });
    await host.discover();
    await host.installAgent('codex');
    assert.equal(host.snapshot.phase, 'ready'); assert.equal(host.snapshot.selectedAgentId, 'codex');
    assert.ok(phases.includes('installing')); assert.ok(order.indexOf('builtin-stopped') < order.indexOf('install'));
    assert.ok(installationOwners.every(id => id === 'codex'));
    assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false);
    await host.dispose();
  });

  it('keeps a failed installation actionable and does not try to start an absent adapter', async () => {
    const { host, agent } = fixture(new NativeAgent(), {}, { install: async () => { throw new Error('npm unavailable'); } });
    await host.discover();
    await assert.rejects(host.installAgent('codex'), /npm unavailable/);
    assert.equal(host.snapshot.phase, 'error'); assert.match(host.snapshot.error ?? '', /npm unavailable/);
    assert.equal(agent.sent.length, 0);
    await host.dispose();
  });

  it('does not send a prompt whose lease activation finishes after the user stops it', async () => {
    const activated = deferred();
    const { host, agent } = fixture(new NativeAgent(), { activate: () => activated.promise });
    await host.selectAgent('codex');
    const prompt = host.prompt('Work');
    const failed = assert.rejects(prompt, /会话已被停止/);
    const stop = host.cancel(); await tick(); activated.resolve();
    await Promise.all([failed, stop]);
    assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false); assert.equal(agent.closed, true);
  });

  it('restores the same native history after a switch and sends fresh document facts only on a new user prompt', async () => {
    const first = new NativeAgent(), resumed = new NativeAgent();
    resumed.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} }, loadSession: true };
    const transports = [first, resumed];
    const recorded: AcpSessionSegment[] = [];
    const { host, binding, order } = fixture(first, {}, { createTransport: () => transports.shift()!, onSegment: segment => { recorded.push(structuredClone(segment)); } });
    await host.selectAgent('codex');
    const original = host.snapshot.segment!;
    await host.selectAgent('builtin');
    binding.handoff.artifacts = [{ path: 'teacher.glx', revision: 'epoch:9' }];
    await host.selectAgent('codex');
    const request = resumed.sent.find(message => message.method === 'session/resume');
    assert.equal(request?.params?.sessionId, original.nativeSessionId);
    assert.equal(resumed.sent.some(message => message.method === 'session/new' || message.method === 'session/prompt'), false);
    assert.notEqual(host.snapshot.segment?.id, original.id);
    assert.equal(host.snapshot.segment?.nativeSessionId, original.nativeSessionId);
    assert.ok(recorded.some(segment => segment.id === original.id && segment.endedAt));
    assert.equal(order.includes('activate'), false);
    const prompt = host.prompt('Continue after my edit'); await tick();
    const content = resumed.sent.find(message => message.method === 'session/prompt')?.params?.prompt as Array<{ text: string }>;
    assert.match(content[0].text, /epoch:9/);
    resumed.finish(); await prompt; await host.dispose();
  });

  it('loads the latest persisted segment for this Agent after a product restart without granting a prompt lease', async () => {
    const agent = new NativeAgent(); agent.capabilities = { mcpCapabilities: { http: true }, loadSession: true };
    const segments: AcpSessionSegment[] = [
      { id: 'codex-old', agentId: 'codex', nativeSessionId: 'native-old', startedAt: '2026-10-30T00:00:00.000Z' },
      { id: 'codex-latest', agentId: 'codex', nativeSessionId: 'native-saved', startedAt: '2026-10-31T00:00:00.000Z' },
      { id: 'other-agent', agentId: 'claude', nativeSessionId: 'unrelated', startedAt: '2026-11-01T00:00:00.000Z' },
    ];
    const { host, order } = fixture(agent, {}, { readSegments: async () => segments });
    assert.equal(host.snapshot.selectedAgentId, 'builtin');
    await host.selectAgent('codex');
    assert.equal(agent.sent.find(message => message.method === 'session/load')?.params?.sessionId, 'native-saved');
    assert.equal(host.snapshot.segment?.nativeSessionId, 'native-saved');
    assert.equal(agent.sent.some(message => message.method === 'session/new' || message.method === 'session/prompt'), false);
    assert.equal(order.includes('activate'), false);
    assert.equal(segments.length, 3); await host.dispose();
  });

  it('opens a new segment with an explicit explanation when the Agent declares no recovery capability', async () => {
    const { host, agent } = fixture(new NativeAgent(), {}, { readSegments: async () => [
      { id: 'prior', agentId: 'codex', nativeSessionId: 'old-native', startedAt: '2026-10-30T00:00:00.000Z' },
    ] });
    await host.selectAgent('codex');
    assert.ok(agent.sent.some(message => message.method === 'session/new'));
    assert.match(host.snapshot.agents[0].detail!, /未声明原生恢复能力/);
    assert.equal(host.snapshot.segments[0].nativeSessionId, 'old-native'); await host.dispose();
  });

  it('preserves a failed native recovery and creates another history only when the user explicitly requests it', async () => {
    const failed = new NativeAgent(), fresh = new NativeAgent();
    failed.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } };
    failed.restoreError = 'Native history is unavailable';
    const transports = [failed, fresh];
    const { host, order } = fixture(failed, {}, { createTransport: () => transports.shift()!, readSegments: async () => [
      { id: 'prior', agentId: 'codex', nativeSessionId: 'old-native', startedAt: '2026-10-30T00:00:00.000Z' },
    ] });
    await assert.rejects(host.selectAgent('codex'), /Native history is unavailable/);
    assert.equal(host.snapshot.phase, 'error');
    assert.equal(failed.sent.some(message => message.method === 'session/new' || message.method === 'session/prompt'), false);
    assert.equal(order.includes('activate'), false);
    await host.selectAgent('codex', { fresh: true });
    assert.equal(failed.closed, true);
    assert.ok(fresh.sent.some(message => message.method === 'session/new'));
    assert.equal(host.snapshot.segments[0].nativeSessionId, 'old-native'); await host.dispose();
  });

  it('replaces a proven unaccepted Codex empty session while retaining explicit native choices', async () => {
    const agent = new NativeAgent();
    agent.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } };
    agent.restoreRpcError = { code: -32603, message: 'Internal error', data: { details: 'no rollout found for thread id old-native' } };
    agent.config = [
      { id: 'model', category: 'model', currentValue: 'model-a', options: [{ value: 'model-a' }, { value: 'model-b' }] },
      { id: 'reasoning_effort', category: 'thought_level', currentValue: 'low', options: [{ value: 'low' }, { value: 'high' }] },
      { id: 'mode', category: 'mode', currentValue: 'read-only', options: [{ value: 'read-only' }, { value: 'agent' }] },
    ];
    const choices = { model: 'model-b', reasoning_effort: 'high', mode: 'agent' };
    const { host, order } = fixture(agent, {}, { canReplaceUnpersistedSession: async segment => {
      assert.equal(segment.nativeSessionId, 'old-native'); return true;
    }, readSegments: async () => [
      { id: 'prior', agentId: 'codex', nativeSessionId: 'old-native', startedAt: '2026-10-30T00:00:00.000Z', configurationChoices: choices },
    ] });
    await host.selectAgent('codex');
    assert.equal(host.snapshot.phase, 'ready'); assert.equal(host.snapshot.segment?.nativeSessionId, 'native-1');
    assert.deepEqual(host.snapshot.segment?.configurationChoices, choices);
    assert.equal(host.snapshot.segment?.modelId, 'model-b'); assert.equal(host.snapshot.segment?.effort, 'high');
    assert.match(host.snapshot.agents[0].detail ?? '', /空会话/);
    assert.equal(agent.sent.filter(message => message.method === 'session/new').length, 1);
    assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false);
    assert.equal(order.includes('activate'), false);
    await host.dispose();
  });

  it('preserves missing history for accepted or unknown tasks and does not mask another recovery failure', async () => {
    for (const [empty, details] of [[false, 'no rollout found for thread id old-native'],
      [undefined, 'no rollout found for thread id old-native'], [true, 'MCP initialization failed']] as const) {
      const agent = new NativeAgent();
      agent.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } };
      agent.restoreRpcError = { code: -32603, message: 'Internal error', data: { details } };
      const { host } = fixture(agent, {}, { canReplaceUnpersistedSession: empty === undefined ? undefined : async () => empty, readSegments: async () => [
        { id: 'prior', agentId: 'codex', nativeSessionId: 'old-native', startedAt: '2026-10-30T00:00:00.000Z' },
      ] });
      await assert.rejects(host.selectAgent('codex'), /Internal error/);
      assert.equal(host.snapshot.phase, 'error'); assert.equal(host.snapshot.segments[0].nativeSessionId, 'old-native');
      assert.equal(agent.sent.some(message => message.method === 'session/new' || message.method === 'session/prompt'), false);
      await host.dispose();
    }
  });

  it('uses the private stdio transport only when the Agent does not advertise the existing HTTP transport', async () => {
    for (const http of [false, true]) {
      const agent = new NativeAgent(); agent.capabilities = { mcpCapabilities: { http } };
      const stdio = { name: 'guoling-private-segment', command: 'owned-bridge', args: [], env: [] };
      const { host } = fixture(agent, { stdioMcpServers: [stdio] });
      await host.selectAgent('codex');
      const servers = agent.sent.find(message => message.method === 'session/new')?.params?.mcpServers as Array<Record<string, unknown>>;
      assert.equal(servers.length, 1);
      if (http) assert.equal(servers[0].type, 'http');
      else assert.deepEqual(servers[0], stdio);
      assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false);
      await host.dispose();
    }
  });

  it('persists only explicit still-confirmed configuration and restores it through the native readback', async () => {
    const first = new NativeAgent(), resumed = new NativeAgent();
    const model = { id: 'model', category: 'model', type: 'select', currentValue: 'model-a', options: [{ value: 'model-a' }, { value: 'model-b' }] };
    first.config = [model, { id: 'reasoning_effort', category: 'thought_level', currentValue: 'low', options: [{ value: 'low' }, { value: 'high' }] },
      { id: 'mode', currentValue: 'safe', options: [{ value: 'safe' }] }];
    first.onConfigure = id => { if (id === 'model') first.config = first.config.filter(option => option.id !== 'reasoning_effort'); };
    resumed.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } };
    resumed.config = [structuredClone(model)];
    const transports = [first, resumed];
    const { host } = fixture(first, {}, { createTransport: () => transports.shift()! });
    await host.selectAgent('codex');
    assert.equal(host.snapshot.segment?.configurationChoices, undefined);
    await host.configure({ reasoning_effort: 'high' });
    await host.configure({ model: 'model-b' });
    assert.deepEqual(host.snapshot.segment?.configurationChoices, { model: 'model-b' });
    await host.selectAgent('builtin'); await host.selectAgent('codex');
    assert.equal(host.snapshot.segment?.modelId, 'model-b');
    assert.deepEqual(host.snapshot.segment?.configurationChoices, { model: 'model-b' });
    assert.deepEqual(resumed.sent.filter(message => message.method === 'session/set_config_option').map(message => message.params?.configId), ['model']);
    await host.dispose();
  });

  it('publishes a non-ready state while configuring and rejects overlapping choices or prompts without poisoning the session', async () => {
    const agent = new NativeAgent(), configured = deferred();
    agent.config = [{ id: 'model', category: 'model', currentValue: 'model-a', options: [{ value: 'model-a' }, { value: 'model-b' }] }];
    const send = agent.send.bind(agent);
    agent.send = message => {
      if (message.method === 'session/set_config_option') void configured.promise.then(() => send(message));
      else send(message);
    };
    const phases: string[] = [];
    const { host } = fixture(agent, {}, { onEvent: event => { if (event.snapshot) phases.push(event.snapshot.phase); } });
    await host.selectAgent('codex');
    const changing = host.configure({ model: 'model-b' });
    assert.equal(host.snapshot.phase, 'switching'); assert.equal(phases.at(-1), 'switching');
    await assert.rejects(host.configure({ model: 'model-a' }), /就绪且空闲/);
    await assert.rejects(host.prompt('Work while model is changing'), /尚未就绪/);
    assert.equal(host.snapshot.phase, 'switching'); assert.equal(host.snapshot.error, undefined);
    assert.equal(agent.sent.some(message => message.method === 'session/prompt'), false);
    configured.resolve(); await changing;
    assert.equal(host.snapshot.phase, 'ready'); assert.equal(host.snapshot.segment?.modelId, 'model-b');
    const prompt = host.prompt('Work after model changed'); await tick(); agent.finish(); await prompt;
    await host.dispose();
  });

  it('does not silently accept a native recovery that no longer supports the explicitly selected model', async () => {
    const agent = new NativeAgent(); agent.capabilities = { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } };
    agent.config = [{ id: 'model', category: 'model', currentValue: 'other-model', options: [{ value: 'other-model' }] }];
    const { host } = fixture(agent, {}, { readSegments: async () => [
      { id: 'prior', agentId: 'codex', nativeSessionId: 'old-native', startedAt: '2026-10-30T00:00:00.000Z', configurationChoices: { model: 'exact-model' } },
    ] });
    await assert.rejects(host.selectAgent('codex'), /not advertised/);
    assert.equal(host.snapshot.phase, 'error');
    assert.equal(agent.sent.some(message => message.method === 'session/new' || message.method === 'session/prompt'), false);
    await host.dispose();
  });
});
