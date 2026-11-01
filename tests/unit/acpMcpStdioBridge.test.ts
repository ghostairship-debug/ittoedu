import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { ResidentMcpServer } from '../../src/main/workbench/external/ResidentMcpServer';
import { runAcpMcpStdioBridge } from '../../src/main/workbench/external/acp/AcpMcpStdioBridge';

type Message = Record<string, unknown>;
const initialization = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-probe', version: '1' } } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function inbox(stream: NodeJS.ReadableStream) {
  const messages: Message[] = [], waiting = new Map<unknown, { resolve(value: Message): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const lines = createInterface({ input: stream });
  lines.on('line', line => {
    const value = JSON.parse(line) as Message; messages.push(value);
    const pending = waiting.get(value.id);
    if (pending) { waiting.delete(value.id); clearTimeout(pending.timer); pending.resolve(value); }
  });
  return { messages, read: (id: unknown) => messages.find(message => message.id === id) ? Promise.resolve(messages.find(message => message.id === id)!)
    : new Promise<Message>((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`No bridge response for ${String(id)}`)); }, 5000); waiting.set(id, { resolve, reject, timer }); }),
  close: () => { lines.close(); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Inbox closed')); } waiting.clear(); } };
}

describe('ACP private MCP stdio transport', () => {
  it('forwards actual child-process stdio calls and SSE notifications to one authenticated Resident service', async () => {
    let executions = 0, terminated = 0, stopped = false;
    const calls: string[] = [];
    const server = new ResidentMcpServer({ initialize: async () => ({ sessionId: 'private-session', instructions: 'same domain owner' }),
      terminate: () => { terminated++; }, request: async (_session, call) => {
        calls.push(call.method);
        if (call.method === 'tools/list') return { tools: [{ name: 'write', description: 'deterministic probe', inputSchema: { type: 'object' } }] };
        if (stopped) throw new Error('domain authority revoked');
        executions++; call.notify('notifications/tools/list_changed', {});
        return { content: [{ type: 'text', text: 'written once' }] };
      } }, 'bridge-test-capability');
    await server.start(0);
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(process.cwd(), 'src/main/workbench/external/acp/AcpMcpStdioEntry.ts')], {
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, GUOLING_ACP_MCP_ENDPOINT: `http://127.0.0.1:${server.listeningPort}/mcp`, GUOLING_ACP_MCP_TOKEN: 'bridge-test-capability' },
    });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
    const received = inbox(child.stdout);
    const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    const send = (value: Message) => child.stdin.write(JSON.stringify(value) + '\n');
    try {
      send(initialization); assert.ok((await received.read(1)).result);
      // Stdio ordering of initialized/list is preserved even when their HTTP requests could race.
      send(initialized); send({ jsonrpc: '2.0', id: 'catalog', method: 'tools/list', params: {} });
      assert.ok((await received.read('catalog')).result);
      send({ jsonrpc: '2.0', id: 'mutation-identity', method: 'tools/call', params: { name: 'write', arguments: {} } });
      assert.ok((await received.read('mutation-identity')).result);
      assert.ok(received.messages.some(message => message.method === 'notifications/tools/list_changed'));
      assert.equal(executions, 1);
      stopped = true;
      send({ jsonrpc: '2.0', id: 'after-revoke', method: 'tools/call', params: { name: 'write', arguments: {} } });
      assert.match(JSON.stringify((await received.read('after-revoke')).error), /domain authority revoked/);
      assert.equal(executions, 1);
      child.stdin.end(); assert.equal(await exited, 0); assert.equal(terminated, 1);
      assert.deepEqual(calls, ['tools/list', 'tools/call', 'tools/call']);
      assert.equal(stderr.includes('bridge-test-capability'), false);
    } finally { child.stdin.end(); if (child.exitCode === null) child.kill(); received.close(); await server.stop(); }
  });

  it('closes on an unknown transport outcome without retrying the original request or leaking its capability', async () => {
    const input = new PassThrough(), output = new PassThrough(), received = inbox(output);
    const requests: Message[] = [];
    const transport: typeof fetch = async (_url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      const message = JSON.parse(String(init?.body)) as Message; requests.push(message);
      if (message.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } }),
        { headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'private-session' } });
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      throw new Error('response was lost');
    };
    const done = runAcpMcpStdioBridge({ endpoint: 'http://127.0.0.1:12345/mcp', token: 'private-fixture-capability', input, output, fetch: transport });
    const rejected = assert.rejects(done, /response was lost/);
    try {
      input.write(JSON.stringify(initialization) + '\n'); await received.read(1);
      input.write(JSON.stringify(initialized) + '\n');
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 'original', method: 'tools/call', params: { name: 'file.write', arguments: { text: 'one write' } } }) + '\n');
      const result = await received.read('original');
      assert.match(JSON.stringify(result.error), /结果未知/);
      assert.equal(JSON.stringify(result).includes('private-fixture-capability'), false);
      await rejected;
      assert.equal(requests.filter(message => message.method === 'tools/call').length, 1);
    } finally { input.end(); received.close(); }
  });

  it('forwards cancellation while a tool call is outstanding and stops the HTTP request when stdio closes', async () => {
    const input = new PassThrough(), output = new PassThrough(), received = inbox(output);
    let cancelled = false, aborted = false;
    const transport: typeof fetch = async (_url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      const message = JSON.parse(String(init?.body)) as Message;
      if (message.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } }),
        { headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'private-session' } });
      if (message.method === 'tools/call') return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
      });
      if (message.method === 'notifications/cancelled') cancelled = true;
      return new Response(null, { status: 202 });
    };
    const done = runAcpMcpStdioBridge({ endpoint: 'http://127.0.0.1:12345/mcp', token: 'capability', input, output, fetch: transport });
    try {
      input.write(JSON.stringify(initialization) + '\n'); await received.read(1);
      input.write(JSON.stringify(initialized) + '\n');
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }) + '\n'); await tick();
      input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }) + '\n'); await tick();
      assert.equal(cancelled, true);
      input.end(); await done; assert.equal(aborted, true);
    } finally { input.end(); received.close(); }
  });
});
