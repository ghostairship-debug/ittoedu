import { formatExecutionFileContext } from '../../../../shared/workbench/fileContext';
import { randomUUID } from 'node:crypto';
import type { ConversationPatch, ConversationRecord } from '../../../../shared/workbench/conversations';
import type { ExecutionBlobRef, ExecutionEventInput, ExecutionProjection } from '../../../../shared/workbench/executionEvents';
import type { AcpDesktopRequest, AcpDesktopResult, AcpSendInput } from '../../../../shared/workbench/acpDesktop';
import type { AcpHandoffReadInput, AcpHostEvent, AcpHostSnapshot, AcpSessionSegment, AcpStructuredHandoff } from '../../../../shared/workbench/acp';
import type { ExecutionPermissionMode } from '../../../../shared/workbench/executionPermission';
import { AcpAgentHost, type AcpDomainBinding } from './AcpAgentHost';
import { AcpHandoffFacts } from './AcpHandoffFacts';

type Identity = { workspaceId: string; conversationId: string };
interface Turn { runId: string; taskId: string; text: string; finalText: string; startedAt: number }
interface SubmissionAuthority { generation: number; segmentId?: string }
export interface AcpExecutionControllerOptions extends Identity {
  cwd: string;
  runtimeDirectory?: string;
  read(): Promise<ConversationRecord>;
  /** Existing event-store projection, scoped to this product conversation. */
  readSegments?(): Promise<AcpSessionSegment[]>;
  readExecution?(): Promise<ExecutionProjection>;
  readExecutionBlob?(ref: ExecutionBlobRef): Promise<Uint8Array>;
  /** Refine nonempty conversation history using the existing durable event sequence. */
  canReplaceUnpersistedSession?(segment: AcpSessionSegment, acceptedRunIds: readonly string[]): Promise<boolean>;
  /** Prepare current document scopes only for a new submission, never for an ACK lookup. */
  prepareDocuments?(input: AcpSendInput): Promise<AcpSendInput['documents']>;
  update(change: (current: ConversationRecord) => ConversationPatch | null): Promise<ConversationRecord>;
  stopBuiltin(): Promise<void>;
  append(event: ExecutionEventInput): Promise<void>;
  flush(): Promise<void>;
  onSnapshot(snapshot: AcpHostSnapshot): void;
  openDocumentation(url: string): Promise<void>;
  artifactFacts(): AcpStructuredHandoff['artifacts'];
  createBinding(input: { segmentId: string; handoff: AcpStructuredHandoff; permission(): ExecutionPermissionMode;
    readHandoff(input: AcpHandoffReadInput): Promise<unknown>;
    pending(operations: string[]): void; linkRun(input: { runId: string; portId: string }): Promise<string> }): Promise<AcpDomainBinding>;
}

/** Adapts native ACP turns to the existing conversation and ordered execution event owners. */
export class AcpExecutionController {
  readonly host: AcpAgentHost;
  private turn?: Turn;
  private accepting = false;
  private authorityGeneration = 0;
  private submissions = new Map<string, { text: string; result: Promise<AcpDesktopResult> }>();
  private settlingTurn?: Promise<void>;
  private permission: ExecutionPermissionMode = 'read-only';
  private unsettled: string[] = [];
  private disposed = false;
  private readonly handoffFacts: AcpHandoffFacts;

  constructor(private readonly options: AcpExecutionControllerOptions) {
    this.handoffFacts = new AcpHandoffFacts({ read: options.read, artifacts: options.artifactFacts,
      execution: options.readExecution, blob: options.readExecutionBlob });
    this.host = new AcpAgentHost({ cwd: options.cwd, runtimeDirectory: options.runtimeDirectory, beforeSwitch: async () => { await this.settlingTurn; await options.stopBuiltin(); },
      createBinding: async ({ segmentId }) => options.createBinding({ segmentId, handoff: await this.handoff(),
        readHandoff: input => this.handoffFacts.read(input),
        permission: () => this.permission, pending: operations => { this.unsettled = operations; },
        linkRun: async ({ runId, portId }) => {
          const current = await options.update(record => ({ runIndex: { ...record.runIndex,
            externalRunIds: [...new Set([...record.runIndex.externalRunIds, runId])], externalPortIds: [...new Set([...record.runIndex.externalPortIds, portId])] } }));
          return current.conversationId;
        } }),
      readSegments: options.readSegments, onSegment: segment => this.recordSegment(segment),
      canReplaceUnpersistedSession: async segment => {
        const accepted = (await options.read()).runIndex.externalRunIds;
        if (!Array.isArray(accepted)) return false;
        return accepted.length === 0 || await options.canReplaceUnpersistedSession?.(segment, accepted) === true;
      },
      onEvent: event => this.onEvent(event),
    });
  }

  async operate(input: AcpDesktopRequest): Promise<AcpDesktopResult> {
    if (this.disposed) throw new Error('ACP 会话已关闭');
    switch (input.action) {
      case 'documentation': {
        const agent = this.host.snapshot.agents.find(candidate => candidate.id === input.agentId);
        if (!agent) throw new Error('Agent 安装说明不可用');
        await this.options.openDocumentation(agent.documentationUrl); break;
      }
      case 'status': if (!this.host.snapshot.agents.length) await this.host.discover(); break;
      case 'discover': await this.host.discover(); break;
      case 'select': ++this.authorityGeneration; await this.host.selectAgent(input.agentId, { fresh: input.fresh }); await this.settlingTurn; break;
      case 'install': ++this.authorityGeneration; await this.host.installAgent(input.agentId); await this.settlingTurn; break;
      case 'authenticate': await this.host.authenticate(input.methodId); break;
      case 'configure':
        if (this.accepting || this.turn) throw new Error('请等待当前任务处理结束后修改配置');
        await this.host.configure(input.values); break;
      case 'permission': this.host.respondPermission(input.id, input.optionId); break;
      case 'cancel': ++this.authorityGeneration; await this.host.cancel(); await this.settlingTurn; break;
      case 'confirm': await this.submissions.get(input.submissionId)?.result.catch(() => undefined); break;
    }
    return { snapshot: this.host.snapshot, conversation: await this.options.read() };
  }

  send(input: AcpSendInput): Promise<AcpDesktopResult> {
    const pending = this.submissions.get(input.submissionId);
    if (pending) return pending.text === input.text ? pending.result : Promise.reject(new Error('相同提交身份已绑定不同消息'));
    const result = this.acceptOrRecover(input);
    this.submissions.set(input.submissionId, { text: input.text, result });
    void result.finally(() => { if (this.submissions.get(input.submissionId)?.result === result) this.submissions.delete(input.submissionId); }).catch(() => undefined);
    return result;
  }

  private async acceptOrRecover(input: AcpSendInput): Promise<AcpDesktopResult> {
    if (this.disposed) throw new Error('ACP 会话已关闭');
    // A lost desktop ACK is a read of the original submission, even while its Agent is busy,
    // disconnected, or not yet selected after a product restart. Never require a new native turn.
    const current = await this.options.read();
    const previous = current.messages.find(message => message.messageId === input.submissionId);
    if (previous) {
      if (previous.role !== 'user' || previous.text !== input.text) throw new Error('相同提交身份已绑定不同消息');
      return { snapshot: this.host.snapshot, conversation: current };
    }
    const snapshot = this.host.snapshot;
    if (this.disposed || snapshot.phase !== 'ready' || this.turn || this.accepting) throw new Error('所选 Agent 尚未就绪或上一条任务仍在处理中');
    const authority: SubmissionAuthority = { generation: this.authorityGeneration, segmentId: snapshot.segment?.id };
    // Reserve before the conversation owner's asynchronous CAS, so two different messages cannot
    // both be accepted into the same idle native session.
    this.accepting = true;
    try { return await this.accept(input, authority); }
    finally { this.accepting = false; }
  }

  private async accept(input: AcpSendInput, authority: SubmissionAuthority): Promise<AcpDesktopResult> {
    const documents = await this.options.prepareDocuments?.(input) ?? input.documents;
    this.assertUnacceptedAuthority(authority);
    let accepted = false;
    const turn: Turn = { runId: randomUUID(), taskId: input.submissionId, text: input.text, finalText: '', startedAt: Date.now() };
    const conversation = await this.options.update(current => {
      const previous = current.messages.find(message => message.messageId === input.submissionId);
      if (previous) {
        if (previous.role !== 'user' || previous.text !== input.text) throw new Error('相同提交身份已绑定不同消息');
        return null; // Confirm an accepted submission without replaying the native turn.
      }
      this.assertUnacceptedAuthority(authority);
      if (current.revision !== input.expectedRevision || current.inputDraft !== input.text || current.inputAttachments.length) throw new Error('会话草稿已有变化；新草稿已保留，请核对后重新发送');
      accepted = true;
      return { inputDraft: '', title: current.title || input.text.slice(0, 30),
        messages: [...current.messages, { messageId: input.submissionId, role: 'user', text: input.text, createdAt: turn.startedAt, attachmentIds: [], runId: turn.runId }],
        runIndex: { ...current.runIndex, externalRunIds: [...current.runIndex.externalRunIds, turn.runId] } };
    });
    if (!accepted) return { snapshot: this.host.snapshot, conversation };
    this.permission = input.permission; this.turn = turn;
    if (!this.currentAuthority(authority)) return this.stopAcceptedBeforePrompt(turn);
    try { await this.emit(turn, 'state', 'run.state', { status: 'running', label: '原生 Agent 处理中', phase: 'waiting-response' }); }
    catch (error) { if (this.turn === turn) this.turn = undefined; throw error; }
    if (!this.currentAuthority(authority)) return this.stopAcceptedBeforePrompt(turn);
    const documentPrompt = documents.length ? input.text + '\n\n果铃文档引用（当前版本与范围，调用领域工具前重新读取）：\n'
      + JSON.stringify(documents.map(({ documentId, epoch, revision, writable, selection }) => ({ documentId, epoch, revision, writable, selection }))) : input.text;
    const fileContext = formatExecutionFileContext(input.fileContext);
    const prompt = documentPrompt + (fileContext ? '\n\n' + fileContext : '');
    this.settlingTurn = this.host.prompt(prompt).then(async result => {
      const cancelled = result.stopReason === 'cancelled';
      if (turn.finalText) await this.options.update(current => current.messages.some(message => message.messageId === `${turn.taskId}:reply`) ? null : ({
        messages: [...current.messages, { messageId: `${turn.taskId}:reply`, role: 'assistant', text: turn.finalText, createdAt: Date.now(), attachmentIds: [], runId: turn.runId }] }));
      await this.emit(turn, 'end', 'run.end', { status: cancelled ? 'stopped' : 'completed', label: cancelled ? '原生会话已停止' : '原生 Agent 本轮结束', phase: 'ended' });
    }, async error => {
      await this.emit(turn, 'end', 'run.end', { status: 'failed', label: '原生 Agent 本轮未完成', error: error instanceof Error ? error.message : String(error), phase: 'ended' });
      if (turn.finalText) await this.options.update(current => current.messages.some(message => message.messageId === `${turn.taskId}:reply`) ? null : ({
        messages: [...current.messages, { messageId: `${turn.taskId}:reply`, role: 'assistant', text: turn.finalText, createdAt: Date.now(), attachmentIds: [], runId: turn.runId }] }));
      // The accepted user message already preserves the input. Returning it to the composer
      // would mint a fresh submission on the next Send and could replay an uncertain side effect.
    }).finally(async () => {
      try { await this.options.flush(); }
      finally {
        if (this.turn === turn) this.turn = undefined;
        this.options.onSnapshot(this.host.snapshot);
      }
    });
    void this.settlingTurn.catch(() => undefined); // Durable owner reports event-storage failures; never replay a native task.
    return { snapshot: this.host.snapshot, conversation };
  }

  async dispose(): Promise<void> {
    this.disposed = true; ++this.authorityGeneration;
    await this.host.dispose();
    await this.settlingTurn;
  }

  private currentAuthority(authority: SubmissionAuthority): boolean {
    const snapshot = this.host.snapshot;
    return !this.disposed && authority.generation === this.authorityGeneration
      && authority.segmentId === snapshot.segment?.id && snapshot.phase === 'ready';
  }

  private assertUnacceptedAuthority(authority: SubmissionAuthority): void {
    if (!this.currentAuthority(authority)) throw new Error('Agent 已被停止或切换，消息尚未接受；当前草稿已保留。');
  }

  private async stopAcceptedBeforePrompt(turn: Turn): Promise<AcpDesktopResult> {
    const settled = (async () => {
      try {
        await this.emit(turn, 'end', 'run.end', { status: 'stopped', phase: 'ended',
          label: '消息已接收，但在发送前 Agent 已停止或切换；未交给原生 Agent' });
        await this.options.flush();
      } finally { if (this.turn === turn) this.turn = undefined; this.options.onSnapshot(this.host.snapshot); }
    })();
    this.settlingTurn = settled;
    await settled;
    return { snapshot: this.host.snapshot, conversation: await this.options.read() };
  }

  private async handoff(): Promise<AcpStructuredHandoff> {
    const handoff = await this.handoffFacts.project();
    return { ...handoff, unsettledOperations: [...handoff.unsettledOperations,
      ...this.unsettled.map(value => `${value}（旧连接传输提示；使用 handoff.read 核对持久事实，旧 ticket 不可跨连接重放）`)] };
  }

  private async recordSegment(segment: AcpSessionSegment): Promise<void> {
    await this.options.append({ eventId: randomUUID(), conversationId: this.options.conversationId, runId: segment.id, taskId: segment.id,
      itemId: 'native-session', time: Date.now(), source: 'external-mcp', type: 'run.state', update: 'snapshot',
      data: { label: `${segment.agentId} 原生会话段${segment.endedAt ? '已结束' : '已连接'}`, status: segment.endedAt ? 'stopped' : 'ready',
        output: JSON.stringify({ kind: 'acp-session-segment', ...segment }) } });
  }

  private onEvent(event: AcpHostEvent): void {
    if (event.type === 'state' && event.snapshot) { this.options.onSnapshot(event.snapshot); return; }
    const turn = this.turn, update = event.update;
    if (!turn || !update || event.replay) return;
    if (update.sessionUpdate === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (content?.type !== 'text' || typeof content.text !== 'string') return;
      turn.finalText += content.text;
      void this.emit(turn, 'reply', 'text', { text: content.text, status: 'running' }, 'append').catch(() => undefined);
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      if (typeof update.toolCallId !== 'string') return;
      void this.emit(turn, `native:${update.toolCallId}`, 'tool', { label: typeof update.title === 'string' ? `原生工具 · ${update.title}` : '原生工具',
        status: typeof update.status === 'string' ? update.status : 'running', toolName: typeof update.kind === 'string' ? `native.${update.kind}` : 'native.tool' }).catch(() => undefined);
    }
  }

  private emit(turn: Turn, itemId: string, type: ExecutionEventInput['type'], data: ExecutionEventInput['data'], update: ExecutionEventInput['update'] = 'snapshot'): Promise<void> {
    return this.options.append({ eventId: randomUUID(), conversationId: this.options.conversationId, runId: turn.runId, taskId: turn.taskId,
      itemId, time: Date.now(), source: 'external-mcp', type, update, data });
  }
}
