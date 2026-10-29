import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainToolDefinitions, createPiDomainSession, domainReply, piToolName,
  providerRequestFacts, schemaHash, selectDomainTools } from './pi-domain-session.mjs';

const tool = name => ({ name, description: name, inputSchema: { type: 'object',
  properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false } });
const response = { content: [{ type: 'text', text: '{"status":"applied"}' }],
  structuredContent: { ticket: 'host-ticket', result: { status: 'applied', revision: 7 } } };

test('exact catalog selection preserves schemas and never invents text.read', () => {
  const catalog = [tool('read'), tool('text.replace')];
  const selected = selectDomainTools(catalog, ['read', 'text.replace']);
  assert.deepEqual(selected[0].inputSchema, catalog[0].inputSchema);
  assert.notEqual(selected[0].inputSchema, catalog[0].inputSchema);
  assert.throws(() => selectDomainTools(catalog, ['text.read']), /missing/);
  assert.notEqual(piToolName('text.read'), piToolName('text_read'));
  assert.match(piToolName('source.' + 'x'.repeat(100)), /^[a-zA-Z0-9_]{1,64}$/);
});

test('native tool identity is stable, errors retain receipts, stopped calls never dispatch', async () => {
  const calls = [], receipts = [];
  let stopped = false;
  const client = { callTool: async (...args) => { calls.push(args); return response; } };
  const [definition] = createDomainToolDefinitions(selectDomainTools([tool('text.replace')], ['text.replace']),
    { client, sessionId: 'native-1', isStopped: () => stopped, onReceipt: receipt => receipts.push(receipt) });
  const signal = new AbortController().signal;
  const first = await definition.execute('call-1', { target: 'opaque-target' }, signal);
  await definition.execute('call-1', { target: 'opaque-target' }, signal);
  assert.equal(calls[0][0].name, 'text.replace');
  assert.equal(calls[0][0]._meta['guoling/ticket'], calls[1][0]._meta['guoling/ticket']);
  assert.equal(calls[0][2].signal, signal);
  assert.deepEqual(first.details.domain, response.structuredContent);
  assert.equal(receipts.length, 2);
  stopped = true;
  await assert.rejects(definition.execute('call-2', {}, signal), /no tool was dispatched/);
  assert.equal(calls.length, 2);
  assert.throws(() => domainReply({ ...response, isError: true }), /host-ticket/);
});

test('provider payload observation keeps the actual schema and payload unchanged', () => {
  const payload = { model: 'selected-model', messages: [{ role: 'user', content: 'short change' }],
    tools: [{ type: 'function', function: { name: 'glx_read', parameters: tool('read').inputSchema } }] };
  const before = structuredClone(payload);
  const facts = providerRequestFacts(payload);
  assert.equal(facts.tools[0].name, 'glx_read');
  assert.equal(facts.tools[0].schemaSha256.length, 64);
  assert.equal(facts.tools[0].schemaSha256, schemaHash({ additionalProperties: false,
    required: ['target'], properties: { target: { type: 'string' } }, type: 'object' }));
  assert.notEqual(facts.tools[0].schemaSha256, schemaHash({ ...tool('read').inputSchema, required: [] }));
  assert.deepEqual(payload, before);
});

test('an uncertain transport failure carries original identity and real read-only recovery without a fake receipt', async () => {
  const diagnostics = [], receipts = [];
  const definitions = createDomainToolDefinitions(selectDomainTools(
    [tool('text.replace'), tool('operation.read')], ['text.replace', 'operation.read']), {
    client: { callTool: async () => { throw Error('transport disconnected after send'); } },
    sessionId: 'native-1', isStopped: () => false,
    onReceipt: value => receipts.push(value), onTransportFailure: value => diagnostics.push(value),
  });
  await assert.rejects(definitions[0].execute('call-unknown', { target: 'opaque-target' }), error => {
    const info = JSON.parse(error.message);
    assert.equal(info.hostReceiptConfirmed, false);
    assert.equal(info.recovery[0].input.ticket, info.requestedTicket);
    assert.equal(info.recovery[0].tool, definitions[1].name);
    return error.name === 'GuolingDomainTransportError';
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(receipts.length, 0);
});

test('host revocation finishes before native abort and one stop is shared', async () => {
  const order = [];
  let release;
  const revocation = new Promise(resolve => { release = resolve; });
  const model = { provider: 'explicit-provider', id: 'explicit-model' };
  const manager = { getSessionId: () => 'native-id', getSessionFile: () => '/tmp/native.jsonl' };
  let options;
  const session = { model, messages: [], bindExtensions: async () => {},
    getActiveToolNames: () => options.tools, subscribe: () => () => order.push('unsubscribe'),
    abort: async () => { order.push('abort'); }, dispose: () => order.push('dispose') };
  const adapter = await createPiDomainSession({
    pi: { SessionManager: { create: () => manager }, createAgentSession: async value => { options = value; return { session }; } },
    client: { listTools: async () => ({ tools: [tool('read')] }) },
    revokeDomain: async () => { order.push('revoke-start'); await revocation; order.push('revoke-end'); },
    model, modelRuntime: {}, resourceLoader: {}, settingsManager: {},
    cwd: '/tmp', agentDir: '/tmp/pi', sessionDir: '/tmp/pi/sessions', allowedToolNames: ['read'],
  });
  assert.equal(options.noTools, 'builtin');
  const first = adapter.stop();
  assert.equal(first, adapter.stop());
  assert.deepEqual(order, ['revoke-start']);
  release();
  await first;
  assert.deepEqual(order, ['revoke-start', 'revoke-end', 'abort']);
  await assert.rejects(adapter.prompt('late'), /stopped/);
  await adapter.close();
});

test('unconfirmed host revocation cannot hang local abort or become a successful stop', async () => {
  let aborted = false, options;
  const model = { provider: 'explicit-provider', id: 'explicit-model' };
  const manager = { getSessionId: () => 'native-id', getSessionFile: () => '/tmp/native.jsonl' };
  const session = { model, bindExtensions: async () => {}, getActiveToolNames: () => options.tools,
    subscribe: () => () => {}, abort: async () => { aborted = true; }, dispose: () => {} };
  const adapter = await createPiDomainSession({
    pi: { SessionManager: { create: () => manager }, createAgentSession: async value => { options = value; return { session }; } },
    client: { listTools: async () => ({ tools: [tool('read')] }) },
    revokeDomain: () => new Promise(() => {}), revokeTimeoutMs: 10, abortTimeoutMs: 50,
    model, modelRuntime: {}, resourceLoader: {}, settingsManager: {},
    cwd: '/tmp', agentDir: '/tmp/pi', sessionDir: '/tmp/pi/sessions', allowedToolNames: ['read'],
  });
  await assert.rejects(adapter.stop(), /revocation is unconfirmed/);
  assert.equal(aborted, true);
  await assert.rejects(adapter.close(), /revocation is unconfirmed/);
});
