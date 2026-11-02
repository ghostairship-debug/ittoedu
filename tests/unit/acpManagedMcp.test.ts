import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { ExternalMcpService, type ExternalMcpServiceOptions } from '../../src/main/workbench/external/ExternalMcpService';
import { ResidentMcpServer, type ResidentMcpCall } from '../../src/main/workbench/external/ResidentMcpServer';
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents';
import { runAcpMcpStdioBridge } from '../../src/main/workbench/external/acp/AcpMcpStdioBridge';
import { AcpAgentHost } from '../../src/main/workbench/external/acp/AcpAgentHost';
import type { AcpTransport } from '../../src/main/workbench/external/acp/AcpAgentSession';
import { emptyAcpHandoff } from '../../src/main/workbench/external/acp/AcpHandoff';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const call = (name: string, args: Record<string, unknown> = {}): ResidentMcpCall => ({ requestId: 1, method: 'tools/call', params: { name, arguments: args }, delivery: Promise.resolve(true), notify: () => undefined });

function managedFixture(readHandoff?: NonNullable<ExternalMcpServiceOptions['managedConversation']>['readHandoff']) {
  const events: ExecutionEventInput[] = [], begun: string[] = [], stopped: string[] = [];
  let beforeBegin: (() => Promise<void>) | undefined;
  let beforeWrite: (() => Promise<void>) | undefined;
  let beforeStop: (() => Promise<void>) | undefined;
  let contents = 'teacher version', writeCount = 0;
  const workspace = { workspaceId: 'space', rootPath: process.cwd(), revision: 1, managed: false, authorization: 'user-selected', createdAt: 1, updatedAt: 1 };
  const options = {
    settings: { read: async () => ({ enabled: true, port: 0, permission: 'workspace', closeAction: 'ask' }), update: async () => { throw new Error('must not change user settings'); } },
    conversations: { listWorkspaces: async () => [workspace], readWorkspace: async () => workspace, listConversations: async () => [],
      createConversation: async () => { throw new Error('must use the selected conversation'); }, updateConversation: async () => { throw new Error('must use the selected conversation owner'); } },
    registry: { list: () => [] },
    gateway: { beginRun: async ({ runId }: { runId: string }) => { begun.push(runId); await beforeBegin?.(); },
      stop: async (runId: string) => { stopped.push(runId); await beforeStop?.(); }, subscribeCatalogChanges: () => () => undefined,
      describe: async () => [], describeRun: async () => [], availableToolFamilies: async () => [], runFileAccess: () => ({ boundPaths: {} }),
      captureHostOperation: () => undefined, operationIdentity: (_run: string, ticket: string) => ticket },
    files: { preflightMutation: async () => ({ paths: [process.cwd()], outside: false }), releaseRun: () => undefined,
      execute: async (context: { assertActive(): void }) => { await beforeWrite?.(); context.assertActive(); writeCount++; contents = 'agent version'; return { data: { saved: true } }; } },
    workspaceRoot: async () => process.cwd(), uiState: async () => null, appendEvent: async (event: ExecutionEventInput) => { events.push(event); }, confirm: async () => true,
    transportToken: 'private-test-token', managedConversation: { workspaceId: 'space', conversationId: 'chosen-conversation', linkRun: async () => 'chosen-conversation', readHandoff },
  } as unknown as ExternalMcpServiceOptions;
  return { service: new ExternalMcpService(options), options, events, begun, stopped,
    setAppend: (append: ExternalMcpServiceOptions['appendEvent']) => { options.appendEvent = append; }, writeCount: () => writeCount,
    gateBegin: (callback?: () => Promise<void>) => { beforeBegin = callback; }, gateWrite: (callback?: () => Promise<void>) => { beforeWrite = callback; },
    gateStop: (callback?: () => Promise<void>) => { beforeStop = callback; },
    setTeacherVersion: (text: string) => { contents = text; }, contents: () => contents };
}

function deliveryDeferred() {
  let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
  const promise = new Promise<boolean>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const receiptCall = (ticket: string, delivery: Promise<boolean>) => {
  const c = call('file.write', { path: 'x', content: 'x' });
  return { ...c, params: { ...c.params, _meta: { 'guoling/ticket': ticket } }, delivery };
};
const transportFacts = (f: ReturnType<typeof managedFixture>, ticket: string) =>
  f.events.filter(event => event.itemId === ticket && event.data.transportDelivery).map(event => event.data.transportDelivery);
const startManaged = async (f: ReturnType<typeof managedFixture>) => {
  await f.service.start();
  const { sessionId } = await f.service.initialize({ name: 'native', version: '1' });
  await f.service.activateManaged();
  return sessionId;
};
const flushDelivery = () => new Promise<void>(resolve => setImmediate(resolve));

describe('ACP durable transport facts', () => {
  it('does not execute a side effect if its initial unknown marker cannot persist', async () => {
    const f = managedFixture();
    try {
      const session = await startManaged(f);
      f.setAppend(async event => { if (event.data.transportDelivery === 'unknown') throw Error('marker unavailable'); f.events.push(event); });
      await assert.rejects(f.service.request(session, receiptCall('marker', Promise.resolve(true))), /marker unavailable/);
      assert.equal(f.writeCount(), 0); assert.equal(f.contents(), 'teacher version');
      assert.deepEqual(transportFacts(f, 'marker'), []);
    } finally { await f.service.close(); }
  });

  it('retains a committed result when its terminal record fails, and never claims delivery', async () => {
    const f = managedFixture();
    try {
      const session = await startManaged(f);
      f.setAppend(async event => { if (event.itemId === 'terminal' && event.data.status === 'completed') throw Error('terminal unavailable'); f.events.push(event); });
      const original = await f.service.request(session, receiptCall('terminal', Promise.resolve(true))) as { structuredContent: { ticket: string; result: unknown } };
      assert.equal(original.structuredContent.ticket, 'terminal'); assert.equal(f.writeCount(), 1);
      await assert.rejects(f.service.settleManaged(), /terminal unavailable/);
      assert.deepEqual(transportFacts(f, 'terminal'), ['unknown']);
      const receipt = await f.service.request(session, call('operation.read', { ticket: 'terminal' }));
      assert.match(JSON.stringify(receipt), /saved/); assert.equal(f.writeCount(), 1);
      const replay = await f.service.request(session, receiptCall('terminal', Promise.resolve(false))) as { structuredContent: { ticket: string; replayed: boolean; result: unknown } };
      assert.equal(replay.structuredContent.replayed, true); assert.deepEqual(replay.structuredContent.result, original.structuredContent.result);
      await assert.rejects(f.service.settleManaged(), /terminal unavailable/);
      assert.equal(f.writeCount(), 1); assert.ok(transportFacts(f, 'terminal').every(value => value === 'unknown'));
    } finally { await assert.rejects(f.service.close(), /terminal unavailable/); }
  });

  it('settles domain work while a reply remains pending, preserving durable unknown', async () => {
    const f = managedFixture(), delivery = deliveryDeferred();
    try {
      const session = await startManaged(f);
      await f.service.request(session, receiptCall('pending', delivery.promise));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { assert.equal(await Promise.race([f.service.settleManaged().then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]), true); }
      finally { if (timer) clearTimeout(timer); }
      assert.equal(f.writeCount(), 1); assert.deepEqual(transportFacts(f, 'pending'), ['unknown']);
      delivery.resolve(false); await flushDelivery(); await f.service.settleManaged();
      assert.equal(transportFacts(f, 'pending').at(-1), 'undelivered');
    } finally { delivery.resolve(false); await f.service.close(); }
  });

  it('records fresh uncertainty before replying with an existing ticket, without executing twice', async () => {
    const f = managedFixture(), delivery = deliveryDeferred();
    try {
      const session = await startManaged(f);
      await f.service.request(session, receiptCall('retry', Promise.resolve(false))); await flushDelivery(); await f.service.settleManaged();
      assert.equal(transportFacts(f, 'retry').at(-1), 'undelivered');
      const replay = await f.service.request(session, receiptCall('retry', delivery.promise)) as { structuredContent: { ticket: string; replayed: boolean } };
      assert.equal(replay.structuredContent.ticket, 'retry'); assert.equal(replay.structuredContent.replayed, true);
      assert.equal(f.writeCount(), 1); assert.equal(transportFacts(f, 'retry').at(-1), 'unknown');
      delivery.resolve(true); await flushDelivery(); await f.service.settleManaged();
      assert.deepEqual(transportFacts(f, 'retry'), ['unknown', 'undelivered', 'unknown', 'delivered']); assert.equal(f.writeCount(), 1);
    } finally { delivery.resolve(false); await f.service.close(); }
  });

  for (const oldOutcome of ['false', 'reject'] as const) it('ignores a late ' + oldOutcome + ' from an older response attempt', async () => {
    const f = managedFixture(), old = deliveryDeferred();
    try {
      const session = await startManaged(f);
      await f.service.request(session, receiptCall('same', old.promise));
      await f.service.request(session, receiptCall('same', Promise.resolve(true))); await flushDelivery(); await f.service.settleManaged();
      oldOutcome === 'false' ? old.resolve(false) : old.reject(Error('old transport failure'));
      await flushDelivery(); await f.service.settleManaged();
      assert.equal(transportFacts(f, 'same').at(-1), 'delivered'); assert.equal(f.writeCount(), 1);
    } finally { old.resolve(false); await f.service.close(); }
  });

  it('reports delivery persistence failure while retaining unknown and the original result', async () => {
    const f = managedFixture();
    try {
      const session = await startManaged(f);
      f.setAppend(async event => { if (event.data.transportDelivery === 'undelivered') throw Error('delivery store unavailable'); f.events.push(event); });
      await f.service.request(session, receiptCall('lost', Promise.resolve(false))); await flushDelivery();
      await assert.rejects(f.service.settleManaged(), /delivery store unavailable/);
      assert.deepEqual(transportFacts(f, 'lost'), ['unknown']); assert.equal(f.writeCount(), 1);
    } finally { await assert.rejects(f.service.close(), /delivery store unavailable/); }
  });

  it('keeps an undelivered receipt when a retry marker fails, then recovers without repeating the write', async () => {
    const f = managedFixture();
    try {
      const session = await startManaged(f);
      await f.service.request(session, receiptCall('retry-marker', Promise.resolve(false))); await flushDelivery(); await f.service.settleManaged();
      f.setAppend(async event => { if (event.data.transportDelivery === 'unknown') throw Error('retry marker unavailable'); f.events.push(event); });
      await assert.rejects(f.service.request(session, receiptCall('retry-marker', Promise.resolve(true))), /retry marker unavailable/);
      assert.equal(f.writeCount(), 1); assert.equal(f.service.managedOperations().find(op => op.ticket === 'retry-marker')?.delivered, false);
      f.setAppend(async event => { f.events.push(event); });
      const replay = await f.service.request(session, receiptCall('retry-marker', Promise.resolve(true))) as { structuredContent: { replayed: boolean } };
      assert.equal(replay.structuredContent.replayed, true); await flushDelivery(); await f.service.settleManaged();
      assert.equal(transportFacts(f, 'retry-marker').at(-1), 'delivered'); assert.equal(f.writeCount(), 1);
    } finally { await f.service.close(); }
  });

  for (const managed of [true, false]) it('does not turn a large readonly reply rejection into a managed record failure: ' + managed, async () => {
    const f = managedFixture(), delivery = deliveryDeferred();
    f.options.files.execute = async () => ({ data: { value: 'x'.repeat(200000) } });
    if (!managed) f.options.managedConversation = undefined;
    try {
      await f.service.start(); const { sessionId } = await f.service.initialize({ name: 'native', version: '1' });
      if (managed) await f.service.activateManaged();
      await f.service.request(sessionId, { ...call('file.read', { path: 'x' }), delivery: delivery.promise });
      delivery.reject(Error('read reply disappeared')); await flushDelivery(); await f.service.settleManaged();
      assert.equal(f.writeCount(), 0); assert.equal(f.events.some(e => e.data.transportDelivery), false);
    } finally { delivery.resolve(false); await f.service.close(); }
  });
});

describe('ACP managed MCP authority', () => {
  it('advertises the scoped handoff reader only when installed and applies the same active-turn authority to it', async () => {
    const reads: unknown[] = [];
    const f = managedFixture(async input => { reads.push(input); return { instructions: [{ messageId: 'old-user', text: '保留原标题' }] }; });
    const without = managedFixture();
    try {
      await f.service.start(); const connected = await f.service.initialize({ name: 'native', version: '1' });
      const listed = await f.service.request(connected.sessionId, { ...call(''), method: 'tools/list' }) as { tools: Array<{ name: string }> };
      assert.ok(listed.tools.some(tool => tool.name === 'handoff.read'));
      await assert.rejects(f.service.request(connected.sessionId, call('handoff.read', { section: 'instructions' })), /没有活动任务/);
      assert.equal(reads.length, 0);
      await f.service.activateManaged();
      const result = await f.service.request(connected.sessionId, call('handoff.read', { section: 'instructions' }));
      assert.match(JSON.stringify(result), /保留原标题/); assert.equal(reads.length, 1);
      const forbidden = await f.service.request(connected.sessionId, call('handoff.read', { section: 'instructions', conversationId: 'someone-else' })) as { isError: boolean };
      assert.equal(forbidden.isError, true); assert.equal(reads.length, 1);
      assert.equal(f.contents(), 'teacher version');
      await f.service.suspendManaged();
      await assert.rejects(f.service.request(connected.sessionId, call('handoff.read', { section: 'work' })), /没有活动任务/);
      await without.service.start(); const other = await without.service.initialize({ name: 'native', version: '1' });
      const uninstalled = await without.service.request(other.sessionId, { ...call(''), method: 'tools/list' }) as { tools: Array<{ name: string }> };
      assert.equal(uninstalled.tools.some(tool => tool.name === 'handoff.read'), false);
    } finally { await f.service.close(); await without.service.close(); }
  });

  it('requires the private bearer on initialization and on every session request', async () => {
    let initialized = 0, requests = 0;
    const server = new ResidentMcpServer({ initialize: async () => { initialized++; return { sessionId: 'session', instructions: '' }; },
      terminate: () => undefined, request: async () => { requests++; return { tools: [] }; } }, 'test-token');
    await server.start(0);
    const endpoint = `http://127.0.0.1:${server.listeningPort}/mcp`;
    const post = (token?: string, sessionId?: string) => fetch(endpoint, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: sessionId ? 'tools/list' : 'initialize', params: sessionId ? {} : { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    try {
      assert.equal((await post()).status, 403); assert.equal((await post('wrong')).status, 403); assert.equal(initialized, 0);
      const connected = await post('test-token'); assert.equal(connected.status, 200); assert.equal(initialized, 1);
      assert.equal(connected.headers.get('mcp-session-id'), 'session');
      assert.equal((await post('wrong', 'session')).status, 403); assert.equal(requests, 0);
    } finally { await server.stop(); }
  });

  it('permits capability discovery while idle, but grants tools only for an active prompt', async () => {
    const fixture = managedFixture(), { service } = fixture;
    try {
      await service.start(); const { sessionId } = await service.initialize({ name: 'native', version: '1' });
      const listed = await service.request(sessionId, { ...call(''), method: 'tools/list' }) as { tools: unknown[] };
      assert.ok(listed.tools.length > 0);
      await assert.rejects(service.request(sessionId, call('workspace.list')), /没有活动任务/);
      await service.activateManaged();
      await service.request(sessionId, call('file.write', { path: 'a.txt', text: 'agent version' }));
      assert.equal(fixture.contents(), 'agent version');
      assert.ok(fixture.events.length > 0); assert.ok(fixture.events.every(event => event.conversationId === 'chosen-conversation'));
      await service.suspendManaged();
      await assert.rejects(service.request(sessionId, call('workspace.list')), /没有活动任务/);
      assert.ok(fixture.stopped.includes(fixture.begun.at(-1)!));
    } finally { await service.close(); }
  });

  it('does not reactivate a lease whose asynchronous activation was revoked', async () => {
    const fixture = managedFixture(), { service } = fixture, began = deferred(), released = deferred();
    try {
      await service.start(); const { sessionId } = await service.initialize({ name: 'native', version: '1' });
      fixture.gateBegin(async () => { began.resolve(); await released.promise; });
      const activating = service.activateManaged(); const failed = assert.rejects(activating, /激活已被停止/);
      await began.promise; const stopped = service.suspendManaged(); released.resolve();
      await Promise.all([failed, stopped]);
      await assert.rejects(service.request(sessionId, call('workspace.list')), /没有活动任务/);
      fixture.gateBegin();
      const late = await service.initialize({ name: 'late-native', version: '1' });
      await assert.rejects(service.request(late.sessionId, call('workspace.list')), /没有活动任务/);
    } finally { released.resolve(); await service.close(); }
  });

  it('waits for a pending commit and preserves the teacher version when the old task resumes late', async () => {
    const fixture = managedFixture(), { service } = fixture, entered = deferred(), released = deferred();
    try {
      await service.start(); const { sessionId } = await service.initialize({ name: 'native', version: '1' });
      await service.activateManaged();
      fixture.gateWrite(async () => { entered.resolve(); await released.promise; });
      const pending = service.request(sessionId, call('file.write', { path: 'a.txt', text: 'old agent edit' }));
      await entered.promise;
      assert.ok(fixture.events.some(event => event.type === 'tool' && event.data.status === 'running'
        && event.data.input === JSON.stringify({ path: 'a.txt', text: 'old agent edit' })));
      let settled = false; const stopping = service.suspendManaged().then(() => { settled = true; });
      fixture.setTeacherVersion('new human edit');
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
      released.resolve(); const result = await pending as { isError: boolean }; await stopping;
      assert.equal(result.isError, true); assert.equal(fixture.contents(), 'new human edit');
    } finally { released.resolve(); await service.close(); }
  });

  it('keeps the actual managed MCP authority and tool consumer behind the stdio transport', async () => {
    const fixture = managedFixture(), { service } = fixture;
    const input = new PassThrough(), output = new PassThrough();
    const messages = createInterface({ input: output });
    let nextId = 0, bridge: Promise<void> | undefined;
    const waiting = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    messages.on('line', line => {
      const message = JSON.parse(line) as Record<string, unknown>;
      const pending = waiting.get(message.id as number);
      if (pending) { waiting.delete(message.id as number); clearTimeout(pending.timer); pending.resolve(message); }
    });
    const request = (method: string, params: Record<string, unknown>) => {
      const id = ++nextId;
      const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Managed stdio request did not return')); }, 5000);
        waiting.set(id, { resolve, reject, timer });
      });
      input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return result;
    };
    try {
      const status = await service.start(); assert.equal(status.state, 'running');
      bridge = runAcpMcpStdioBridge({ endpoint: status.endpoint!, token: 'private-test-token', input, output });
      void bridge.catch(() => undefined);
      assert.ok((await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-managed', version: '1' } })).result);
      input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      assert.ok((await request('tools/list', {})).result);
      const write = () => request('tools/call', { name: 'file.write', arguments: { path: 'a.txt', text: 'agent version' } });
      assert.match(JSON.stringify((await write()).error), /没有活动任务/);
      await service.activateManaged();
      const accepted = await write(); assert.ok(accepted.result);
      assert.equal(fixture.contents(), 'agent version');
      assert.ok(fixture.events.length > 0); assert.ok(fixture.events.every(event => event.conversationId === 'chosen-conversation'));
      await service.suspendManaged(); fixture.setTeacherVersion('new human edit');
      assert.match(JSON.stringify((await write()).error), /没有活动任务/);
      assert.equal(fixture.contents(), 'new human edit');
      input.end(); await bridge;
    } finally {
      input.end(); await bridge?.catch(() => undefined);
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Test finished')); }
      messages.close(); await service.close();
    }
  });

  it('cancels the native Host before managed gateway shutdown and pending tool settlement finish', async () => {
    const f = managedFixture(), { service } = f;
    const stopGate = deferred(), writeEntered = deferred(), writeGate = deferred();
    type Message = Parameters<AcpTransport['send']>[0];
    const listeners = new Set<(message: Message) => void>();
    let promptId: string | number | undefined, cancelled = false, closed = false;
    const reply = (id: string | number, result: unknown) => queueMicrotask(() => { for (const listener of listeners) listener({ jsonrpc: '2.0', id, result }); });
    const transport: AcpTransport = {
      send: message => {
        if (message.method === 'initialize') reply(message.id!, { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } });
        else if (message.method === 'session/new') reply(message.id!, { sessionId: 'native-probe', configOptions: [] });
        else if (message.method === 'session/prompt') promptId = message.id;
        else if (message.method === 'session/cancel') { cancelled = true; reply(promptId!, { stopReason: 'cancelled' }); }
      },
      onMessage: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      onClose: () => () => undefined, close: async () => { closed = true; },
    };
    const host = new AcpAgentHost({ cwd: process.cwd(), beforeSwitch: async () => undefined,
      discover: async () => ({ agents: [{ id: 'codex', name: 'Protocol probe', nativeInstalled: true, adapterInstalled: true, readiness: 'unverified', documentationUrl: '', nativeLoginHint: '' }],
        launches: [{ id: 'codex', command: 'not-launched', args: [] }] }), createTransport: () => transport,
      createBinding: async () => ({ cwd: process.cwd(), handoff: emptyAcpHandoff(), mcpServers: [], activate: () => service.activateManaged(),
        revoke: () => service.revokeManaged(), settle: () => service.settleManaged(), dispose: () => service.close() }),
    });
    try {
      await service.start(); await host.selectAgent('codex');
      const { sessionId } = await service.initialize({ name: 'native-probe', version: '1' });
      const turn = host.prompt('Explicit deterministic task'); await new Promise<void>(resolve => setImmediate(resolve));
      f.gateWrite(async () => { writeEntered.resolve(); await writeGate.promise; });
      const mutation = service.request(sessionId, call('file.write', { path: 'a.txt', text: 'late native write' }));
      await writeEntered.promise;
      f.gateStop(() => stopGate.promise);
      let settled = false; const stopping = host.cancel().then(() => { settled = true; });
      await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(cancelled, true); assert.equal(closed, true); assert.equal(settled, false);
      assert.ok(f.stopped.includes(f.begun.at(-1)!));
      f.setTeacherVersion('human edit after revocation');
      writeGate.resolve(); stopGate.resolve();
      assert.equal((await mutation as { isError: boolean }).isError, true);
      await Promise.all([turn, stopping]);
      assert.equal(f.contents(), 'human edit after revocation'); assert.equal(settled, true);
    } finally { writeGate.resolve(); stopGate.resolve(); await host.dispose(); await service.close(); }
  });
});
