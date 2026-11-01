import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

type Message = Record<string, unknown>;
const object = (value: unknown): value is Message => !!value && typeof value === 'object' && !Array.isArray(value);

export interface AcpMcpStdioBridgeOptions {
  endpoint: string;
  token: string;
  input: Readable;
  output: Writable;
  fetch?: typeof fetch;
}

/** A transport for one private ResidentMcpServer. It owns no tools, history, permissions or retry policy. */
export async function runAcpMcpStdioBridge(options: AcpMcpStdioBridgeOptions): Promise<void> {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
    || !endpoint.port || endpoint.pathname !== '/mcp' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !options.token) {
    throw new Error('ACP MCP bridge requires its private loopback endpoint and capability');
  }
  const request = options.fetch ?? fetch;
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  const lifetime = new AbortController(), pending = new Set<Promise<void>>();
  let sessionId: string | undefined, protocolVersion: string | undefined, initialization: Promise<void> | undefined, initializedNotification: Promise<void> | undefined;
  let failure: Error | undefined, ending = false, outputFailure: Error | undefined;
  let writes = Promise.resolve();
  const headers = () => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${options.token}`, ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) });
  const write = (message: Message) => {
    const sent = writes.then(() => new Promise<void>((resolve, reject) => {
      if (outputFailure) { reject(outputFailure); return; }
      options.output.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
    }));
    writes = sent.catch(() => undefined);
    return sent;
  };
  const stop = (error: Error) => {
    failure ??= error;
    lines.close(); options.input.pause(); lifetime.abort();
  };
  const onOutputError = (error: Error) => { outputFailure = error; stop(new Error('ACP MCP bridge lost its stdio consumer; no request was retried')); };
  options.output.on('error', onOutputError);

  const forward = async (message: Message) => {
    const initializing = message.method === 'initialize';
    if (!initializing) await initialization;
    if (!initializing && message.method !== 'notifications/initialized') await initializedNotification;
    if (ending || failure) return;
    const response = await request(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(message),
      redirect: 'error', signal: lifetime.signal });
    if (!response.ok) throw new Error(`ACP MCP transport returned HTTP ${response.status}; the original operation was not retried`);
    if (response.status === 202 || response.status === 204) {
      if (message.id !== undefined) throw new Error('ACP MCP transport did not acknowledge the original request');
      return;
    }
    let answered = false;
    const forwardMessage = async (value: unknown) => {
      if (!object(value) || value.jsonrpc !== '2.0') throw new Error('ACP MCP transport returned an invalid JSON-RPC frame');
      if (value.id !== undefined) {
        if (value.id !== message.id) throw new Error('ACP MCP transport returned a mismatched request identity');
        answered = true;
      } else if (typeof value.method !== 'string') throw new Error('ACP MCP transport returned an invalid notification');
      if (initializing && object(value.result)) {
        sessionId = response.headers.get('mcp-session-id') ?? undefined;
        if (!sessionId || typeof value.result.protocolVersion !== 'string') throw new Error('ACP MCP initialization returned no session identity');
        protocolVersion = value.result.protocolVersion;
      }
      await write(value);
    };
    if (response.headers.get('content-type')?.startsWith('application/json')) {
      await forwardMessage(await response.json());
      if (message.id !== undefined && !answered) throw new Error('ACP MCP transport closed without a request receipt');
      return;
    }
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('ACP MCP transport returned an unsupported response');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffered = '', data: string[] = [];
    const consume = async (line: string) => {
      if (!line) {
        if (data.length) { const value = data.join('\n'); data = []; await forwardMessage(JSON.parse(value)); }
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    };
    try {
      for (;;) {
        const chunk = await reader.read();
        buffered += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline).replace(/\r$/, ''); buffered = buffered.slice(newline + 1);
          await consume(line);
        }
        if (chunk.done) break;
      }
      if (buffered) await consume(buffered.replace(/\r$/, ''));
      await consume('');
      if (message.id !== undefined && !answered) throw new Error('ACP MCP transport closed without a request receipt');
    } finally { reader.releaseLock(); }
  };
  const processMessage = async (message: Message) => {
    try { await forward(message); }
    catch (error) {
      if (ending || failure) return;
      const cause = error instanceof Error ? error : new Error(String(error));
      try {
        if (message.id !== undefined && !outputFailure) await write({ jsonrpc: '2.0', id: message.id,
          error: { code: -32603, message: '果铃领域连接中断，原操作结果未知；未自动重试，请核对原回执与当前文档。' } });
      } finally { stop(cause); }
    }
  };
  try {
    for await (const line of lines) {
      if (failure || ending) break;
      if (!line.trim()) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { await write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC frame' } }); stop(new Error('ACP MCP stdin contained invalid JSON')); break; }
      if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
        || message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number') {
        await write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }); stop(new Error('ACP MCP stdin contained an invalid request')); break;
      }
      if (message.method === 'initialize' && initialization) {
        await write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32600, message: 'This private MCP connection is already initialized' } });
        continue;
      }
      const task = processMessage(message);
      if (message.method === 'initialize') initialization = task;
      if (message.method === 'notifications/initialized') initializedNotification = task;
      pending.add(task);
      void task.finally(() => pending.delete(task)).catch(error => stop(error instanceof Error ? error : new Error(String(error))));
    }
  } finally {
    ending = true; lifetime.abort(); lines.close();
    await Promise.allSettled([...pending]);
    await writes;
    if (sessionId) {
      // Deleting this transport only revokes its existing domain session; it never replays work.
      await request(endpoint, { method: 'DELETE', headers: headers(), redirect: 'error', signal: AbortSignal.timeout(2000) }).catch(() => undefined);
    }
    options.output.off('error', onOutputError);
  }
  if (failure) throw failure;
}
