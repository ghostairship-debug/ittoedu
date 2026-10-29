import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

type JsonObject = Record<string, unknown>;
type RpcId = string | number;
type RpcMessage = JsonObject & { id?: RpcId; method?: string; params?: JsonObject };
type Phase = 'created' | 'initialized' | 'opening' | 'ready' | 'configuring' | 'prompting' | 'closing' | 'closed' | 'failed';
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const errorOf = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));
const declared = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

export interface AcpTransport {
  send(message: RpcMessage): void;
  onMessage(listener: (message: RpcMessage) => void): () => void;
  onClose(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export interface AcpConfigOption extends JsonObject {
  id: string;
  category?: string;
  currentValue: unknown;
  options?: Array<JsonObject>;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: JsonObject;
  options: Array<{ optionId: string; kind: string; name?: string }>;
}

export interface AcpSessionOptions {
  transport: AcpTransport;
  /** Return an offered optionId. No policy means reject; titles never grant permission. */
  permissionPolicy?: (request: AcpPermissionRequest, signal: AbortSignal) => string | undefined | Promise<string | undefined>;
  /** Composition owner revokes domain writes before protocol cancellation/owned-process cleanup. */
  onBeforeCancel?: (context: { sessionId?: string; reason: string }) => void | Promise<void>;
  beforeCancelTimeoutMs?: number;
  onSessionUpdate?: (event: { sessionId: string; update: JsonObject; replay: boolean }) => void;
  requestTimeoutMs?: number;
  cancellationTimeoutMs?: number;
  /** Optional silence detection, reset by progress. This is not a total task limit. */
  promptIdleTimeoutMs?: number;
}

interface Pending {
  method: string;
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Turn {
  requestId?: number;
  cancelled: boolean;
  failure?: Error;
  done?: Promise<JsonObject>;
  beforeCancel?: Promise<void>;
  cancelling?: Promise<void>;
}
interface Permission {
  id: RpcId;
  turn: Turn;
  abort: AbortController;
}

export class AcpSessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'AcpSessionError'; this.code = code; }
}

/** One ACP connection/session owner. It does not own model history, domain writes or artifact adoption. */
export class AcpAgentSession {
  private phase: Phase = 'created';
  private failure?: Error;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private permissions = new Map<RpcId, Permission>();
  private initialized: JsonObject = {};
  private config: AcpConfigOption[] = [];
  private expected?: { modelId: string; effort: string; modelKey: string; effortKey: string };
  private sessionId?: string;
  private turn?: Turn;
  private replay = false;
  private earlyUpdates: RpcMessage[] = [];
  private closePromise?: Promise<void>;
  private unsubscribe: Array<() => void>;
  private readonly options: AcpSessionOptions;

  constructor(options: AcpSessionOptions) {
    this.options = options;
    this.unsubscribe = [
      options.transport.onMessage(message => { try { this.receive(message); } catch (error) { this.fail(errorOf(error)); } }),
      options.transport.onClose(error => this.fail(error)),
    ];
  }

  get snapshot() {
    return { phase: this.phase, sessionId: this.sessionId, pendingRequests: this.pending.size,
      pendingPermissions: this.permissions.size, cancelling: this.turn?.cancelled ?? false,
      modelId: this.expected?.modelId, effort: this.expected?.effort };
  }

  get configuration(): AcpConfigOption[] { return structuredClone(this.config); }

  async initialize(): Promise<JsonObject> {
    this.requirePhase('created');
    const result = await this.request('initialize', { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'guoling-workbench', version: '1.0.0' } });
    this.requirePhase('created');
    if (result.protocolVersion !== 1) throw this.fail(new AcpSessionError('protocol_version', 'Unsupported ACP protocol version'));
    this.initialized = result;
    this.phase = 'initialized';
    return structuredClone(result);
  }

  async open(input: { cwd: string; mcpServers: JsonObject[] }): Promise<JsonObject> {
    return this.setup('session/new', input);
  }

  async restore(input: { sessionId: string; cwd: string; mcpServers: JsonObject[]; configOptions?: AcpConfigOption[] }): Promise<JsonObject> {
    this.requirePhase('initialized');
    if (!input.sessionId) throw new AcpSessionError('session_id', 'A native session ID is required for recovery');
    const caps = object(this.initialized.agentCapabilities);
    const method = declared(object(caps.sessionCapabilities).resume) ? 'session/resume'
      : caps.loadSession === true ? 'session/load' : undefined;
    if (!method) throw new AcpSessionError('recovery_unsupported', 'Agent did not advertise resume or load support');
    return this.setup(method, input);
  }

  private async setup(method: string, input: { cwd: string; mcpServers: JsonObject[]; sessionId?: string; configOptions?: AcpConfigOption[] }): Promise<JsonObject> {
    this.requirePhase('initialized');
    if (!path.isAbsolute(input.cwd)) throw new AcpSessionError('cwd', 'ACP cwd must be absolute');
    const caps = object(object(this.initialized.agentCapabilities).mcpCapabilities);
    for (const server of input.mcpServers) {
      if (server.type === 'http' && caps.http !== true || server.type === 'sse' && caps.sse !== true) {
        throw new AcpSessionError('mcp_transport', `Agent did not advertise ${String(server.type)} MCP transport`);
      }
      if (server.type !== undefined && !['stdio', 'http', 'sse'].includes(String(server.type))) throw new AcpSessionError('mcp_transport', 'Unknown MCP transport');
    }
    this.phase = 'opening';
    this.sessionId = input.sessionId;
    this.replay = method === 'session/load';
    try {
      const result = await this.request(method, { cwd: input.cwd, mcpServers: input.mcpServers,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}) });
      this.requirePhase('opening');
      const sessionId = result.sessionId ?? input.sessionId;
      if (typeof sessionId !== 'string' || !sessionId || input.sessionId && sessionId !== input.sessionId) {
        throw new AcpSessionError('session_id', 'ACP returned a missing or changed native session ID');
      }
      this.sessionId = sessionId;
      this.config = this.readConfig(result.configOptions ?? input.configOptions ?? []);
      this.phase = 'ready';
      for (const update of this.earlyUpdates.splice(0)) this.receive(update);
      return { ...result, sessionId, recoveryMethod: input.sessionId ? method : undefined };
    } catch (error) { throw this.fail(errorOf(error)); }
    finally { this.replay = false; }
  }

  /** Verify authoritative currentValue after each change; never fall back to a label or previous value. */
  async configure(input: { modelId: string; effort: string }): Promise<AcpConfigOption[]> {
    this.requirePhase('ready');
    this.expected = undefined;
    this.phase = 'configuring';
    try {
      const model = this.config.find(option => option.category === 'model' || option.id === 'model');
      if (!model || !this.values(model.options).includes(input.modelId)) throw new AcpSessionError('model_unavailable', `Exact model ${input.modelId} is not advertised`);
      await this.request('session/set_config_option', { sessionId: this.sessionId, configId: model.id, value: input.modelId });
      this.requirePhase('configuring');
      this.assertValue(model.id, input.modelId);
      const effort = this.config.find(option => option.category === 'thought_level' || /reasoning.*effort|^thought_level$/.test(option.id));
      if (!effort || !this.values(effort.options).includes(input.effort)) throw new AcpSessionError('effort_unavailable', `Exact effort ${input.effort} is not advertised`);
      await this.request('session/set_config_option', { sessionId: this.sessionId, configId: effort.id, value: input.effort });
      this.requirePhase('configuring');
      this.assertValue(model.id, input.modelId);
      this.assertValue(effort.id, input.effort);
      this.expected = { ...input, modelKey: model.id, effortKey: effort.id };
      return this.configuration;
    } finally { if (this.phase === 'configuring') this.phase = 'ready'; }
  }

  async prompt(prompt: JsonObject[]): Promise<JsonObject> {
    this.requirePhase('ready');
    if (!prompt.length) throw new AcpSessionError('empty_prompt', 'ACP prompt must contain content');
    if (!this.expected) throw new AcpSessionError('configuration_unverified', 'Verify exact model and effort before prompting');
    this.assertValue(this.expected.modelKey, this.expected.modelId);
    this.assertValue(this.expected.effortKey, this.expected.effort);
    const caps = object(object(this.initialized.agentCapabilities).promptCapabilities);
    for (const block of prompt) {
      const capability = block.type === 'resource' ? 'embeddedContext' : block.type;
      if (!['text', 'resource_link'].includes(String(block.type)) && caps[String(capability)] !== true) {
        throw new AcpSessionError('prompt_capability', `Agent did not advertise ${String(block.type)} prompt content`);
      }
    }
    const turn: Turn = { cancelled: false };
    this.turn = turn;
    this.phase = 'prompting';
    try {
      turn.done = this.request('session/prompt', { sessionId: this.sessionId, prompt });
      const result = await turn.done;
      if (turn.failure) throw turn.failure;
      if (turn.cancelled && result.stopReason !== 'cancelled') throw new AcpSessionError('cancel_race', 'Turn ended during cancellation; inspect domain receipts before any retry');
      return result;
    } finally {
      try { await turn.beforeCancel; }
      finally {
        for (const permission of [...this.permissions.values()]) if (permission.turn === turn) this.settlePermission(permission);
        if (this.turn === turn) this.turn = undefined;
        if (this.phase === 'prompting') this.phase = 'ready';
      }
    }
  }

  async cancel(): Promise<void> {
    const turn = this.turn;
    if (!turn) return;
    await this.beginCancel(turn);
    await turn.done;
  }

  private beforeCancel(turn: Turn, reason: string): Promise<void> {
    if (turn.beforeCancel) return turn.beforeCancel;
    let resolveRevoke!: () => void, rejectRevoke!: (error: Error) => void;
    // Reserve the same revocation before abort listeners or the owner hook can reenter cancellation.
    turn.beforeCancel = new Promise<void>((resolve, reject) => { resolveRevoke = resolve; rejectRevoke = reject; });
    turn.cancelled = true;
    if (turn.requestId !== undefined) clearTimeout(this.pending.get(turn.requestId)?.timer);
    for (const permission of [...this.permissions.values()]) if (permission.turn === turn) this.settlePermission(permission);
    if (!this.options.onBeforeCancel) { resolveRevoke(); return turn.beforeCancel; }
    let result: void | Promise<void>;
    try { result = this.options.onBeforeCancel({ sessionId: this.sessionId, reason }); }
    catch (error) { result = Promise.reject(error); }
    const timer = setTimeout(() => rejectRevoke(new AcpSessionError('domain_revoke_timeout', 'Domain cancellation hook did not acknowledge revocation')),
      this.options.beforeCancelTimeoutMs ?? 5000);
    Promise.resolve(result).then(() => { clearTimeout(timer); resolveRevoke(); }, error => {
      clearTimeout(timer); rejectRevoke(new AcpSessionError('domain_revoke_failed', `Domain cancellation hook failed: ${errorOf(error).message}`));
    });
    return turn.beforeCancel;
  }

  private beginCancel(turn: Turn, reason = 'cancel'): Promise<void> {
    if (turn.cancelling) return turn.cancelling;
    const revoked = this.beforeCancel(turn, reason);
    return turn.cancelling ??= revoked.then(() => {
      const pending = turn.requestId === undefined ? undefined : this.pending.get(turn.requestId);
      if (!pending || this.failure) return;
      this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } });
      this.arm(pending, this.options.cancellationTimeoutMs ?? 3000, () => {
        this.fail(new AcpSessionError('cancel_timeout', 'ACP did not acknowledge cancellation; connection closed without replaying writes'));
      });
    }).catch(error => { throw this.fail(errorOf(error)); });
  }

  private request(method: string, params: JsonObject, timeoutMs = this.options.requestTimeoutMs ?? 30000): Promise<JsonObject> {
    if (this.failure || this.phase === 'closed') return Promise.reject(this.failure ?? new AcpSessionError('closed', 'ACP session is closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const pending: Pending = { method, resolve, reject };
      this.pending.set(id, pending);
      if (method === 'session/prompt' && this.turn) { this.turn.requestId = id; this.refreshPromptTimer(); }
      else this.arm(pending, timeoutMs, () => this.fail(new AcpSessionError('request_timeout', `${method} timed out; connection cannot be reused safely`)));
      try { this.options.transport.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { this.fail(errorOf(error)); }
    });
  }

  private receive(message: RpcMessage): void {
    if (this.failure || this.phase === 'closed') return;
    if (message.id !== undefined && !message.method) {
      const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
      if (!pending) return;
      this.pending.delete(message.id as number); clearTimeout(pending.timer);
      if (message.error) pending.reject(Object.assign(new AcpSessionError('rpc_error', String(object(message.error).message ?? 'ACP request failed')), { rpcError: message.error }));
      else if ('result' in message) {
        const result = object(message.result);
        try {
          // Consume acknowledgements in wire order so an await continuation cannot overwrite a later update.
          if (pending.method === 'session/set_config_option') this.config = this.readConfig(result.configOptions);
          pending.resolve(result);
        } catch (error) { pending.reject(errorOf(error)); }
      }
      else pending.reject(new AcpSessionError('invalid_response', 'ACP response has neither result nor error'));
      return;
    }
    if (message.method === 'session/update' && message.id === undefined) {
      const params = object(message.params);
      if (!this.sessionId && this.phase === 'opening') { this.earlyUpdates.push(message); return; }
      if (params.sessionId !== this.sessionId) return;
      const update = object(params.update);
      if (update.sessionUpdate === 'config_option_update') {
        this.config = this.readConfig(update.configOptions);
        if (this.turn && this.expected) {
          try { this.assertValue(this.expected.modelKey, this.expected.modelId); this.assertValue(this.expected.effortKey, this.expected.effort); }
          catch (error) { this.turn.failure = errorOf(error); void this.beginCancel(this.turn, 'configuration_changed').catch(() => undefined); }
        }
      }
      this.refreshPromptTimer();
      this.options.onSessionUpdate?.({ sessionId: this.sessionId!, update, replay: this.replay });
      return;
    }
    if (message.id === undefined) return;
    if (message.method === 'session/request_permission') { void this.permission(message); return; }
    this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `ACP client does not implement ${message.method}` } });
  }

  private async permission(message: RpcMessage): Promise<void> {
    const params = object(message.params);
    if (params.sessionId !== this.sessionId) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown ACP session' } }); return;
    }
    const turn = this.turn;
    if (!turn || !this.isActiveTurn(turn)) {
      this.send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }); return;
    }
    const options = Array.isArray(params.options) ? params.options.map(object).filter(value => typeof value.optionId === 'string' && typeof value.kind === 'string') as AcpPermissionRequest['options'] : [];
    const permission: Permission = { id: message.id!, turn, abort: new AbortController() };
    this.permissions.set(permission.id, permission);
    this.refreshPromptTimer();
    let picked: string | undefined;
    try { picked = await this.options.permissionPolicy?.({ sessionId: this.sessionId!, toolCall: object(params.toolCall), options }, permission.abort.signal); }
    catch { /* A failed or dismissed policy never grants permission. */ }
    if (this.permissions.get(permission.id) !== permission) return;
    const chosen = options.find(option => option.optionId === picked) ?? options.find(option => option.kind === 'reject_once');
    this.settlePermission(permission, chosen?.optionId);
  }

  private settlePermission(permission: Permission, optionId?: string): void {
    if (this.permissions.get(permission.id) !== permission) return;
    this.permissions.delete(permission.id);
    permission.abort.abort();
    const selected = optionId !== undefined && this.isActiveTurn(permission.turn);
    this.send({ jsonrpc: '2.0', id: permission.id, result: { outcome: selected ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } });
    this.refreshPromptTimer();
  }

  private isActiveTurn(turn: Turn): boolean {
    // A terminal RPC receipt ends permission selection before prompt() resumes its asynchronous cleanup.
    return this.turn === turn && !turn.cancelled && this.phase === 'prompting'
      && turn.requestId !== undefined && this.pending.has(turn.requestId);
  }

  private refreshPromptTimer(): void {
    const turn = this.turn;
    if (!turn || turn.cancelled || turn.requestId === undefined) return;
    const pending = this.pending.get(turn.requestId);
    if (!pending) return;
    clearTimeout(pending.timer); pending.timer = undefined;
    if (!this.permissions.size && this.options.promptIdleTimeoutMs) this.arm(pending, this.options.promptIdleTimeoutMs, () => {
      turn.failure = new AcpSessionError('prompt_idle', 'ACP stopped reporting progress; cancellation requested');
      void this.beginCancel(turn, 'no_progress').catch(() => undefined);
    });
  }

  private arm(pending: Pending, timeoutMs: number, callback: () => void): void { clearTimeout(pending.timer); pending.timer = setTimeout(callback, timeoutMs); }
  private values(options?: JsonObject[]): string[] { return (options ?? []).flatMap(option => Array.isArray(option.options) ? this.values(option.options.map(object)) : typeof option.value === 'string' ? [option.value] : []); }
  private readConfig(value: unknown): AcpConfigOption[] {
    if (!Array.isArray(value) || value.some(option => typeof object(option).id !== 'string' || !('currentValue' in object(option)))) throw new AcpSessionError('configuration_invalid', 'ACP must return complete configuration with current values');
    return structuredClone(value) as AcpConfigOption[];
  }
  private assertValue(id: string, value: string): void {
    if (this.config.find(option => option.id === id)?.currentValue !== value) throw new AcpSessionError('configuration_mismatch', `ACP did not confirm ${id}=${value}`);
  }
  private requirePhase(phase: Phase): void {
    if (this.failure) throw this.failure;
    if (this.phase !== phase) throw new AcpSessionError('lifecycle', `Expected ACP ${phase}, got ${this.phase}`);
  }
  private send(message: RpcMessage): void { if (this.failure || this.phase === 'closed') return; try { this.options.transport.send(message); } catch (error) { this.fail(errorOf(error)); } }
  private fail(error: Error): Error {
    if (this.failure || this.phase === 'closed') return this.failure ?? error;
    this.failure = error;
    const revoke = this.turn ? this.beforeCancel(this.turn, 'connection_failure') : Promise.resolve();
    if (this.phase !== 'closing') this.phase = 'failed';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    void revoke.catch(() => undefined).then(() => this.options.transport.close()).catch(() => undefined);
    return error;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      const wasFailed = !!this.failure;
      this.phase = 'closing';
      if (this.turn) { try { await this.beginCancel(this.turn, 'close'); } catch { /* Still stop the owned process when domain revocation failed. */ } }
      if (!wasFailed && !this.failure && this.sessionId && declared(object(object(this.initialized.agentCapabilities).sessionCapabilities).close)) {
        try { await this.request('session/close', { sessionId: this.sessionId }, this.options.cancellationTimeoutMs ?? 3000); } catch { /* Close the owned transport below. */ }
      }
      this.fail(new AcpSessionError('closed', 'ACP session closed'));
      try { await this.options.transport.close(); }
      finally { this.phase = 'closed'; for (const off of this.unsubscribe) off(); }
    })();
    return this.closePromise;
  }
}

/** Stdio is the only transport this consumer currently needs. Own and stop only the launched process tree. */
export function createStdioAcpTransport(options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; onStderr?: (text: string) => void }): AcpTransport {
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const messages = new Set<(message: RpcMessage) => void>(), exits = new Set<(error: Error) => void>();
  let ended: Error | undefined, closing: Promise<void> | undefined;
  const lines = createInterface({ input: child.stdout });
  const finish = (error: Error) => { if (ended) return; ended = error; for (const listener of exits) listener(error); };
  child.stderr.on('data', data => options.onStderr?.(String(data)));
  child.stdin.on('error', error => finish(error));
  child.on('error', error => finish(error));
  child.on('close', (code, signal) => finish(new AcpSessionError('transport_closed', `ACP process closed (${code ?? signal ?? 'unknown'})`)));
  lines.on('line', line => {
    let message: unknown;
    try { message = JSON.parse(line); } catch { finish(new AcpSessionError('invalid_frame', 'ACP stdout contained a non-JSON frame')); return; }
    if (!message || object(message).jsonrpc !== '2.0') { finish(new AcpSessionError('invalid_frame', 'ACP stdout contained an invalid JSON-RPC frame')); return; }
    for (const listener of messages) listener(message as RpcMessage);
  });
  const waitClose = (ms: number) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); child.off('close', done); resolve(); };
    const timer = setTimeout(done, ms); child.once('close', done);
  });
  return {
    send(message) { if (ended) throw ended; child.stdin.write(JSON.stringify(message) + '\n'); },
    onMessage(listener) { messages.add(listener); return () => { messages.delete(listener); }; },
    onClose(listener) { exits.add(listener); if (ended) queueMicrotask(() => listener(ended!)); return () => { exits.delete(listener); }; },
    close() {
      return closing ??= (async () => {
        child.stdin.end(); await waitClose(1500);
        if (child.exitCode === null && child.signalCode === null && child.pid) {
          if (process.platform === 'win32') await new Promise<void>(resolve => {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            const done = () => { clearTimeout(timer); resolve(); }, timer = setTimeout(done, 2000);
            killer.once('error', done); killer.once('close', done);
          }); else child.kill('SIGTERM');
          await waitClose(1000);
          if (process.platform !== 'win32' && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await waitClose(1000); }
        }
        lines.close();
        if (child.pid && child.exitCode === null && child.signalCode === null) throw new AcpSessionError('cleanup_timeout', 'The owned ACP process did not exit during cleanup');
      })();
    },
  };
}
