import { randomUUID } from 'node:crypto';
import type { AcpAgentId, AcpAuthenticationMethod, AcpHostEvent, AcpHostSnapshot, AcpPermissionPrompt, AcpSessionSegment, AcpStructuredHandoff } from '../../../../shared/workbench/acp';
import { AcpAgentSession, createStdioAcpTransport, type AcpPermissionRequest, type AcpSessionOptions, type AcpTransport } from './AcpAgentSession';
import { acpLaunchInvocation, discoverAcpAgents, type AcpAgentLaunch } from './AcpAgentDiscovery';
import { acpConfigurationControls } from './AcpConfiguration';
import { acpHandoffContent, emptyAcpHandoff } from './AcpHandoff';
import { AcpAgentRuntime } from './AcpAgentRuntime';

type ExternalAgentId = Exclude<AcpAgentId, 'builtin'>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value);

/** The existing execution/MCP owner supplies authority. This host does not mint its own domain leases. */
export interface AcpDomainBinding {
  cwd: string;
  mcpServers: JsonObject[];
  /** Thin transport alternatives to the same private domain service for stdio-only Agents. */
  stdioMcpServers?: JsonObject[];
  handoff: AcpStructuredHandoff;
  /** Open the existing domain execution lease before each prompt. */
  activate(): Promise<void>;
  /** Revoke domain mutations synchronously at the owner, then acknowledge completion. Idempotent. */
  revoke(reason: string): Promise<void>;
  /** Wait for in-flight commits and preserve their receipts, including conflict outcomes. */
  settle(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AcpAgentHostOptions {
  cwd: string;
  runtimeDirectory?: string;
  /** Stop/settle the built-in execution owner before changing Agent. */
  beforeSwitch(): Promise<void>;
  createBinding(input: { agentId: ExternalAgentId; segmentId: string }): Promise<AcpDomainBinding>;
  onEvent?(event: AcpHostEvent): void;
  /** Persist through the existing conversation owner if persistence is available. */
  onSegment?(segment: AcpSessionSegment): void | Promise<void>;
  /** Read this product conversation's segment index from its existing event owner. */
  readSegments?(): Promise<AcpSessionSegment[]>;
  /** The conversation/event owner confirms no accepted task belongs to this native history. Unknown is not empty. */
  canReplaceUnpersistedSession?(segment: AcpSessionSegment): Promise<boolean>;
  discover?: () => ReturnType<typeof discoverAcpAgents>;
  install?: (agentId: ExternalAgentId) => Promise<void>;
  createTransport?: (launch: AcpAgentLaunch, cwd: string) => AcpTransport;
  sessionOptions?: Pick<AcpSessionOptions, 'requestTimeoutMs' | 'cancellationTimeoutMs' | 'beforeCancelTimeoutMs' | 'authenticationTimeoutMs'>;
}

/** Lightweight product owner for one native conversation segment and the existing MCP binding. */
export class AcpAgentHost {
  private state: AcpHostSnapshot = { selectedAgentId: 'builtin', phase: 'idle', agents: [], configuration: [], authenticationMethods: [], pendingPermissions: [], segments: [], nativeDiskAccess: false };
  private launches: AcpAgentLaunch[] = [];
  private session?: AcpAgentSession;
  private binding?: AcpDomainBinding;
  private nextSegmentId?: string;
  private recoverySegment?: AcpSessionSegment;
  private sessionMcpServers?: JsonObject[];
  private handoff?: AcpStructuredHandoff;
  private generation = 0;
  private transition?: Promise<void>;
  private prompting?: Promise<JsonObject>;
  private permissionDecisions = new Map<string, { prompt: AcpPermissionPrompt; resolve: (value: string | undefined) => void }>();

  constructor(private readonly options: AcpAgentHostOptions) {}

  get snapshot(): AcpHostSnapshot { return structuredClone(this.state); }

  async discover(): Promise<AcpHostSnapshot> {
    const found = await (this.options.discover?.() ?? discoverAcpAgents({ cwd: this.options.cwd, runtimeDirectory: this.options.runtimeDirectory }));
    this.launches = found.launches;
    this.state.agents = found.agents.map(agent => {
      const prior = this.state.agents.find(candidate => candidate.id === agent.id);
      return this.session && this.state.selectedAgentId === agent.id && prior ? { ...agent, readiness: prior.readiness, detail: prior.detail } : agent;
    });
    this.publish(); return this.snapshot;
  }

  async installAgent(agentId: ExternalAgentId): Promise<AcpHostSnapshot> {
    if (!['codex', 'claude', 'opencode'].includes(agentId)) throw new Error('未知 Agent');
    if (this.transition) throw new Error('正在切换或安装 Agent，请等待当前操作结束');
    const generation = ++this.generation;
    this.state.phase = 'switching'; this.state.error = undefined; this.publish();
    this.transition = (async () => {
      await this.stopCurrent('install');
      await this.options.beforeSwitch();
      this.assertGeneration(generation);
      this.state.selectedAgentId = agentId; this.state.nativeDiskAccess = false;
      this.state.phase = 'installing';
      this.setReadiness('installing', '正在安装，完成后自动连接'); this.publish();
      if (this.options.install) await this.options.install(agentId);
      else {
        if (!this.options.runtimeDirectory) throw new Error('尚未配置当前用户的 Agent 安装目录');
        await new AcpAgentRuntime({ directory: this.options.runtimeDirectory, cwd: this.options.cwd }).install(agentId);
      }
      this.assertGeneration(generation);
      await this.discover();
      this.assertGeneration(generation);
    })();
    try { await this.transition; }
    catch (error) {
      if (generation === this.generation) {
        this.state.phase = 'error'; this.state.error = errorMessage(error);
        this.setReadiness('error', this.state.error);
      }
      throw error;
    } finally { this.transition = undefined; this.publish(); }
    this.assertGeneration(generation);
    return this.selectAgent(agentId);
  }

  async selectAgent(agentId: AcpAgentId, input: { fresh?: boolean } = {}): Promise<AcpHostSnapshot> {
    if (!['builtin', 'codex', 'claude', 'opencode'].includes(agentId)) throw new Error('未知 Agent');
    if (this.transition) throw new Error('正在切换 Agent，请等待当前操作结束');
    if (!input.fresh && agentId === this.state.selectedAgentId && this.state.phase === 'ready' && this.session?.snapshot.phase === 'ready') return this.snapshot;
    const generation = ++this.generation;
    this.state.phase = 'switching'; this.state.error = undefined; this.publish();
    this.transition = (async () => {
      await this.stopCurrent('switch');
      await this.options.beforeSwitch();
      this.assertGeneration(generation);
      this.state.selectedAgentId = agentId;
      this.state.nativeDiskAccess = agentId !== 'builtin';
      this.state.configuration = []; this.state.authenticationMethods = [];
      if (agentId === 'builtin') { this.state.phase = 'idle'; return; }
      // A different Agent may already be discoverable while this adapter was just installed.
      if (!this.launches.some(candidate => candidate.id === agentId)) await this.discover();
      this.assertGeneration(generation);
      const launch = this.launches.find(candidate => candidate.id === agentId);
      if (!launch) throw new Error(this.state.agents.find(candidate => candidate.id === agentId)?.detail
        ?? '尚未发现这个 Agent 的 ACP 入口，请按安装说明完成安装后重新检测');
      const persisted = await this.options.readSegments?.() ?? [];
      this.assertGeneration(generation);
      const segments = new Map(persisted.map(segment => [segment.id, structuredClone(segment)]));
      for (const segment of this.state.segments) segments.set(segment.id, segment);
      this.state.segments = [...segments.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      this.recoverySegment = input.fresh ? undefined : this.state.segments.findLast(segment => segment.agentId === agentId);
      this.nextSegmentId = randomUUID();
      this.binding = await this.options.createBinding({ agentId, segmentId: this.nextSegmentId });
      this.assertGeneration(generation);
      this.handoff = structuredClone(this.binding.handoff ?? emptyAcpHandoff());
      const transport = this.options.createTransport?.(launch, this.binding.cwd)
        ?? createStdioAcpTransport({ ...acpLaunchInvocation(launch), cwd: this.binding.cwd });
      this.session = new AcpAgentSession({ ...this.options.sessionOptions, transport,
        onBeforeCancel: ({ reason }) => this.binding?.revoke(reason),
        permissionPolicy: (request, signal) => this.requestPermission(request, signal),
        onSessionUpdate: event => {
          this.state.configuration = acpConfigurationControls(this.session?.configuration ?? []);
          this.options.onEvent?.({ type: 'update', segmentId: this.nextSegmentId,
            nativeSessionId: event.sessionId, update: event.update, replay: event.replay });
          this.publish();
        } });
      this.setReadiness('connecting', '正在确认本机 Agent 的协议、认证和能力');
      const initialized = await this.session.initialize();
      this.assertGeneration(generation);
      const mcpCapabilities = object(object(initialized.agentCapabilities).mcpCapabilities);
      const compatible = this.binding.mcpServers.every(server => server.type !== 'http' && server.type !== 'sse' || mcpCapabilities[String(server.type)] === true);
      this.sessionMcpServers = !compatible && this.binding.stdioMcpServers?.length ? this.binding.stdioMcpServers : this.binding.mcpServers;
      this.state.authenticationMethods = this.authenticationMethods(initialized.authMethods);
      await this.openSegment(generation);
    })();
    try { await this.transition; }
    catch (error) {
      if (generation === this.generation) {
        const authRequired = object(object(error).rpcError).code === -32000;
        this.state.phase = 'error'; this.state.error = errorMessage(error);
        this.setReadiness(authRequired ? 'authentication_required' : 'error', this.state.error);
      }
      throw error;
    } finally { this.transition = undefined; this.publish(); }
    return this.snapshot;
  }

  async authenticate(methodId: string): Promise<AcpHostSnapshot> {
    if (this.transition || this.state.phase === 'authenticating' || !this.session || this.session.snapshot.phase !== 'initialized') throw new Error('请先连接已安装的 Agent');
    const generation = this.generation;
    this.state.phase = 'authenticating'; this.state.error = undefined; this.publish();
    try {
      await this.session.authenticate(methodId);
      this.assertGeneration(generation);
      await this.openSegment(generation);
      return this.snapshot;
    } catch (error) {
      if (generation === this.generation) { this.state.phase = 'error'; this.state.error = errorMessage(error); this.publish(); }
      throw error;
    }
  }

  async configure(values: Record<string, string | boolean>): Promise<AcpHostSnapshot> {
    if (this.state.phase !== 'ready' || !this.session || this.transition) throw new Error('请在 Agent 就绪且空闲时修改配置');
    const session = this.session, generation = this.generation;
    this.state.phase = 'switching'; this.state.error = undefined; this.publish();
    this.transition = (async () => {
      await session.configureOptions(values);
      this.assertGeneration(generation);
      this.state.configuration = acpConfigurationControls(session.configuration);
      if (this.state.segment) {
        this.state.segment.modelId = session.snapshot.modelId; this.state.segment.effort = session.snapshot.effort;
        const confirmed = session.configuration;
        const choices = Object.fromEntries(Object.entries({ ...this.state.segment.configurationChoices, ...values })
          .filter(([id, value]) => confirmed.some(option => option.id === id && option.currentValue === value)));
        if (Object.keys(choices).length) this.state.segment.configurationChoices = choices;
        else delete this.state.segment.configurationChoices;
        await this.options.onSegment?.(structuredClone(this.state.segment));
      }
      this.assertGeneration(generation);
      this.state.phase = 'ready';
    })();
    try {
      await this.transition;
      return this.snapshot;
    } catch (error) {
      // A rejected explicit choice must not silently return the user to the previous model.
      if (generation === this.generation) { this.state.phase = 'error'; this.state.error = errorMessage(error); }
      throw error;
    } finally { this.transition = undefined; this.publish(); }
  }

  prompt(text: string): Promise<JsonObject> {
    if (!text.trim()) return Promise.reject(new Error('请输入消息'));
    if (this.state.phase !== 'ready' || !this.session || !this.binding || this.transition || this.prompting) return Promise.reject(new Error('所选 Agent 尚未就绪，请先连接或完成认证'));
    const session = this.session, binding = this.binding, generation = this.generation;
    this.state.phase = 'prompting'; this.state.error = undefined; this.publish();
    const run = (async () => {
      let activated = false;
      try {
        await binding.activate(); activated = true;
        this.assertGeneration(generation);
        const handoff = this.handoff && acpHandoffContent(this.handoff);
        const content = [...(handoff ? [handoff] : []), { type: 'text', text }];
        const result = await session.prompt(content);
        this.handoff = undefined;
        return result;
      } catch (error) {
        if (generation === this.generation) { this.state.error = errorMessage(error); this.state.phase = 'error'; }
        throw error;
      } finally {
        try {
          try { await binding.revoke(activated ? 'turn_finished' : 'activation_failed'); }
          finally { await binding.settle(); }
          if (generation === this.generation && this.state.phase === 'prompting') this.state.phase = 'ready';
        } catch (error) {
          if (generation === this.generation) { this.state.phase = 'error'; this.state.error = errorMessage(error); }
          throw error;
        } finally { this.publish(); }
      }
    })();
    this.prompting = run;
    void run.finally(() => { if (this.prompting === run) this.prompting = undefined; }).catch(() => undefined);
    return run;
  }

  respondPermission(id: string, optionId: string): void {
    const decision = this.permissionDecisions.get(id);
    if (!decision || !decision.prompt.options.some(option => option.optionId === optionId)) throw new Error('权限请求已结束或选项不可用');
    decision.resolve(optionId);
  }

  /** Stop native disk access as well as domain writes; never represent a domain lease as a native sandbox. */
  async cancel(): Promise<AcpHostSnapshot> {
    if (this.transition) throw new Error('正在切换 Agent');
    ++this.generation;
    this.state.phase = 'switching'; this.publish();
    this.transition = this.stopCurrent('cancel');
    try {
      await this.transition;
      this.state.phase = this.state.selectedAgentId === 'builtin' ? 'idle' : 'error';
      this.state.error = this.state.selectedAgentId === 'builtin' ? undefined : '已停止本机会话。重新连接会优先恢复原生历史，已接收的任务不会自动重发。';
      if (this.state.selectedAgentId !== 'builtin') this.setReadiness('unverified', this.state.error);
      return this.snapshot;
    } catch (error) { this.state.phase = 'error'; this.state.error = errorMessage(error); throw error; }
    finally { this.transition = undefined; this.publish(); }
  }

  async dispose(): Promise<void> { ++this.generation; await this.transition?.catch(() => undefined); await this.stopCurrent('close'); }

  private async openSegment(generation: number): Promise<void> {
    const session = this.session!, binding = this.binding!;
    const recovery = this.recoverySegment;
    const restoring = !!recovery && !!session.recoveryMethod;
    let replacedEmptySession = false;
    const mcpServers = this.sessionMcpServers ?? binding.mcpServers;
    if (restoring) {
      try { await session.restore({ sessionId: recovery!.nativeSessionId, cwd: binding.cwd, mcpServers }); }
      catch (error) {
        const rpcError = object(object(error).rpcError), details = object(rpcError.data).details;
        const missingRollout = this.state.selectedAgentId === 'codex' && rpcError.code === -32603
          && typeof details === 'string' && details.includes('no rollout found for thread id');
        if (!missingRollout || await this.options.canReplaceUnpersistedSession?.(recovery!) !== true) throw error;
        this.assertGeneration(generation);
        // Codex does not persist a thread before its first message. No accepted task is replayed.
        await session.open({ cwd: binding.cwd, mcpServers });
        replacedEmptySession = true;
      }
    }
    else await session.open({ cwd: binding.cwd, mcpServers });
    this.assertGeneration(generation);
    const choices = restoring ? recovery!.configurationChoices ?? {} : {};
    const model = session.configuration.find(option => option.category === 'model' || option.id === 'model');
    // The model may replace the effort list; restore that explicit choice before dependent options.
    const orderedChoices = model && model.id in choices ? { [model.id]: choices[model.id], ...choices } : choices;
    await session.configureOptions(orderedChoices);
    this.assertGeneration(generation);
    const segment: AcpSessionSegment = { id: this.nextSegmentId!, agentId: this.state.selectedAgentId as ExternalAgentId,
      nativeSessionId: session.snapshot.sessionId!, startedAt: new Date().toISOString(), modelId: session.snapshot.modelId, effort: session.snapshot.effort,
      ...(Object.keys(choices).length ? { configurationChoices: structuredClone(choices) } : {}) };
    this.state.segment = segment; this.state.segments.push(segment);
    await this.options.onSegment?.(structuredClone(segment));
    this.state.configuration = acpConfigurationControls(session.configuration);
    this.state.phase = 'ready'; this.state.error = undefined;
    this.setReadiness('ready', replacedEmptySession ? '原生空会话尚未保存；已建立新会话并保留显式配置'
      : restoring ? '已恢复同一 Agent 的原生会话；已接收的任务不会自动重发'
      : recovery ? '该 Agent 未声明原生恢复能力，已建立新会话并准备当前工作交接' : '原生会话已就绪'); this.publish();
  }

  private async stopCurrent(reason: string): Promise<void> {
    const binding = this.binding, session = this.session;
    let failure: unknown;
    try { await binding?.revoke(reason); } catch (error) { failure = error; }
    try {
      if (session?.snapshot.phase === 'prompting') { try { await session.cancel(); } catch (error) { failure ??= error; } }
    } finally {
      try { await session?.close(); } catch (error) { failure ??= error; }
      try { await this.prompting; } catch { /* The prompt caller receives its failure; settlement below still gates activation. */ }
      try { await binding?.settle(); } catch (error) { failure ??= error; }
      try { await binding?.dispose(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
    if (this.state.segment) { this.state.segment.endedAt = new Date().toISOString(); await this.options.onSegment?.(structuredClone(this.state.segment)); }
    if (this.state.selectedAgentId !== 'builtin') this.setReadiness('unverified', '原生会话已关闭，可重新连接');
    this.session = undefined; this.binding = undefined; this.handoff = undefined; this.nextSegmentId = undefined; this.recoverySegment = undefined; this.sessionMcpServers = undefined;
    this.state.segment = undefined; this.state.configuration = []; this.state.authenticationMethods = [];
  }

  private requestPermission(request: AcpPermissionRequest, signal: AbortSignal): Promise<string | undefined> {
    const id = randomUUID();
    const prompt: AcpPermissionPrompt = { id, title: typeof request.toolCall.title === 'string' ? request.toolCall.title : 'Agent 请求执行操作',
      kind: typeof request.toolCall.kind === 'string' ? request.toolCall.kind : undefined,
      options: request.options.map(option => ({ ...option, name: option.name ?? option.kind })) };
    return new Promise(resolve => {
      const finish = (value?: string) => {
        if (!this.permissionDecisions.delete(id)) return;
        signal.removeEventListener('abort', aborted);
        this.state.pendingPermissions = this.state.pendingPermissions.filter(item => item.id !== id);
        resolve(value); this.publish();
      };
      const aborted = () => finish();
      this.permissionDecisions.set(id, { prompt, resolve: finish });
      this.state.pendingPermissions.push(prompt);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      this.publish();
    });
  }

  private authenticationMethods(value: unknown): AcpAuthenticationMethod[] {
    return (Array.isArray(value) ? value : []).flatMap(item => {
      const method = object(item);
      return typeof method.id === 'string' && method.type !== 'terminal' ? [{ id: method.id, name: typeof method.name === 'string' ? method.name : method.id,
        description: typeof method.description === 'string' ? method.description : undefined }] : [];
    });
  }
  private setReadiness(readiness: AcpHostSnapshot['agents'][number]['readiness'], detail?: string): void {
    this.state.agents = this.state.agents.map(agent => agent.id === this.state.selectedAgentId ? { ...agent, readiness, detail } : agent);
  }
  private assertGeneration(generation: number): void { if (generation !== this.generation) throw new Error('Agent 会话已被停止或替换'); }
  private publish(): void { this.options.onEvent?.({ type: 'state', snapshot: this.snapshot }); }
}
