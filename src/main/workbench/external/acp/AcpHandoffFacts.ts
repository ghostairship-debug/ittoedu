import { z } from 'zod';
import type { AcpHandoffReadInput, AcpStructuredHandoff } from '../../../../shared/workbench/acp';
import type { ConversationRecord } from '../../../../shared/workbench/conversations';
import type { ExecutionBlobRef, ExecutionItem, ExecutionProjection } from '../../../../shared/workbench/executionEvents';
import { emptyAcpHandoff } from './AcpHandoff';

const offset = z.number().int().nonnegative().optional();
export const acpHandoffReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('instructions'), offset, limit: z.number().int().min(1).max(40).optional(),
    messageId: z.string().min(1).optional(), textOffset: offset }).strict(),
  z.object({ section: z.literal('work'), offset, limit: z.number().int().min(1).max(40).optional() }).strict(),
  z.object({ section: z.literal('item'), runId: z.string().min(1), itemId: z.string().min(1),
    field: z.enum(['input', 'output', 'diff', 'error', 'text', 'decision', 'facts']).optional(), offset,
    limit: z.number().int().min(1).max(6000).optional() }).strict(),
]);

export interface AcpHandoffFactsOptions {
  read(): Promise<ConversationRecord>;
  artifacts(): AcpStructuredHandoff['artifacts'];
  /** Both ports are bound by the existing owner to this one authorized conversation. */
  execution?(): Promise<ExecutionProjection>;
  blob?(ref: ExecutionBlobRef): Promise<Uint8Array>;
}

const preview = (text: string, size: number) => text.length > size ? text.slice(0, size) + '…（原文可回读）' : text;
const itemRead = (item: Pick<ExecutionItem, 'runId' | 'itemId'>, field: Extract<AcpHandoffReadInput, { section: 'item' }>['field'] = 'output') =>
  ({ tool: 'handoff.read' as const, input: { section: 'item' as const, runId: item.runId, itemId: item.itemId, field } });
const workItem = (item: ExecutionItem) => item.itemId !== 'native-session'
  && (['tool', 'edit', 'document.commit', 'document.save', 'run.state', 'run.end'].includes(item.type));
const unfinished = new Set(['queued', 'running', 'stopping', 'stopped', 'pending', 'unknown', 'failed', 'cancelled', 'conflict']);

function workSummary(item: ExecutionItem) {
  const { toolName, label, status, applicationStatus, saveStatus, transportDelivery, operationId, documentId, revision, remainingGoal } = item.data;
  return { runId: item.runId, itemId: item.itemId, sequence: item.sequence, type: item.type,
    ...(toolName ? { toolName } : {}), ...(label ? { label: preview(label, 300) } : {}),
    ...(status ? { status } : { status: 'unknown' }), applicationStatus, saveStatus, transportDelivery, operationId, documentId, revision,
    ...(remainingGoal ? { remainingGoal: remainingGoal.slice(0, 6).map(goal => preview(goal, 300)), remainingGoalCount: remainingGoal.length } : {}),
    ...(item.data.question ? { question: preview(item.data.question.text, 300), answered: !!item.data.answer } : {}),
    read: itemRead(item, item.data.question ? 'decision' : item.type === 'run.state' || item.type === 'run.end' ? 'facts' : 'output'),
  };
}

/** No new state: every request reads the existing conversation, durable event projection and live document heads. */
export class AcpHandoffFacts {
  constructor(private readonly options: AcpHandoffFactsOptions) {}

  private async current() {
    const conversation = await this.options.read();
    const execution = await this.options.execution?.();
    if (execution && execution.conversationId !== conversation.conversationId) throw new Error('交接记录不属于当前会话');
    return { conversation, execution, items: execution?.items.filter(workItem) ?? [] };
  }

  async project(): Promise<AcpStructuredHandoff> {
    const { conversation, execution, items } = await this.current();
    const messages = conversation.messages.filter(message => message.role === 'user');
    const artifacts = this.options.artifacts();
    const instructions: string[] = [];
    let remaining = 10000;
    // Start at the original instructions, not a moving last-four window. Longer history stays addressable.
    for (const message of messages) {
      const text = `[${message.messageId}] ${preview(message.text, 600)}`;
      if (text.length > remaining) break;
      instructions.push(text); remaining -= text.length;
    }
    const decisions = items.filter(item => item.data.question && item.data.answer);
    const confirmedDecisions: string[] = [];
    let decisionBudget = 6000;
    for (const item of decisions) {
      const text = `${preview(JSON.stringify({ question: item.data.question, answer: item.data.answer }), 800)}；${JSON.stringify(itemRead(item, 'decision'))}`;
      if (text.length > decisionBudget) break;
      confirmedDecisions.push(text); decisionBudget -= text.length;
    }
    const runs = new Map<string, ExecutionItem>();
    for (const item of items) if (item.type === 'run.state' || item.type === 'run.end') {
      if (!runs.has(item.runId) || runs.get(item.runId)!.sequence < item.sequence) runs.set(item.runId, item);
    }
    const outstanding = [...runs.values()].filter(item => unfinished.has(item.data.status ?? 'unknown') || item.data.remainingGoal?.length);
    const pending = items.filter(item => (item.type === 'tool' || item.type === 'edit')
      && (['running', 'pending', 'unknown'].includes(item.data.status ?? 'unknown')
        || item.data.transportDelivery === 'undelivered' || item.data.transportDelivery === 'unknown'));
    return { ...emptyAcpHandoff(),
      goal: messages.length ? preview(messages[messages.length - 1]!.text, 2000) : undefined,
      userInstructions: instructions,
      latestPublicReply: preview(conversation.messages.findLast(message => message.role === 'assistant')?.text ?? '', 1200) || undefined,
      // Only actual user answers are confirmed facts. Ordinary old messages remain attributed instructions.
      confirmedDecisions,
      artifacts,
      humanChanges: artifacts.flatMap(artifact => {
        const frozen = conversation.frozenContextRefs.find(ref => ref.documentId === artifact.documentId);
        const changed = frozen && artifact.revision !== `${frozen.epoch}:${frozen.revision}`;
        if (!artifact.dirty && artifact.undoHead?.actor !== 'human' && !changed) return [];
        return [`${artifact.path} @ ${artifact.revision ?? '版本待读取'}：${artifact.undoHead?.actor === 'human' ? `当前撤销头是人工修改 ${artifact.undoHead.operationId}；` : ''}${artifact.dirty ? '当前稿未保存；' : ''}${changed ? '已不同于原会话引用版本；' : ''}以当前稿为准，先读再改，保留非目标内容。未注明人工来源的变化不推定作者。`];
      }),
      unfinishedWork: outstanding.slice(-12).map(item => `运行 ${item.runId} 的最后记录为 ${item.data.status ?? 'unknown'}${item.data.remainingGoal?.length ? `；记录的剩余目标：${preview(item.data.remainingGoal.join('；'), 600)}` : ''}。这是待核对的历史事实，不自动重启已取消目标。${JSON.stringify(itemRead(item, 'facts'))}`),
      unsettledOperations: pending.slice(-12).map(item => `${item.data.toolName ?? item.type} / ${item.runId}:${item.itemId}：${item.data.status ?? 'unknown'}${item.data.transportDelivery ? `；传输回复：${item.data.transportDelivery}` : ''}；先回读已记录的结果并核对当前目标，不能当未执行重放。${JSON.stringify(itemRead(item))}`),
      history: { instructionCount: messages.length, includedInstructions: instructions.length, workItemCount: items.length,
        confirmedDecisionCount: decisions.length, includedDecisions: confirmedDecisions.length,
        unfinishedRunCount: outstanding.length, pendingOperationCount: pending.length,
        ...(execution ? { eventCursor: execution.cursor } : {}),
        instructions: { tool: 'handoff.read', input: { section: 'instructions', offset: instructions.length } },
        work: { tool: 'handoff.read', input: { section: 'work', offset: 0 } } },
    };
  }

  async read(raw: AcpHandoffReadInput): Promise<unknown> {
    const input = acpHandoffReadSchema.parse(raw);
    const { conversation, execution, items } = await this.current();
    if (input.section === 'instructions') {
      const messages = conversation.messages.filter(message => message.role === 'user');
      if (input.messageId) {
        const message = messages.find(candidate => candidate.messageId === input.messageId);
        if (!message) throw new Error('用户指令不属于当前会话');
        const start = input.textOffset ?? 0;
        if (start > message.text.length) throw new Error('指令正文游标越界');
        const text = message.text.slice(start, start + 6000), next = start + text.length;
        return { conversationId: conversation.conversationId, messageId: message.messageId, createdAt: message.createdAt,
          text, offset: start, totalCharacters: message.text.length, hasMore: next < message.text.length,
          ...(next < message.text.length ? { next: { tool: 'handoff.read', input: { section: 'instructions', messageId: message.messageId, textOffset: next } } } : {}) };
      }
      const start = input.offset ?? 0, limit = input.limit ?? 20;
      if (start > messages.length) throw new Error('用户指令游标越界');
      const selected = messages.slice(start, start + limit), next = start + selected.length;
      return { conversationId: conversation.conversationId, total: messages.length, offset: start, hasMore: next < messages.length,
        instructions: selected.map(message => ({ messageId: message.messageId, createdAt: message.createdAt,
          text: preview(message.text, 600), truncated: message.text.length > 600,
          read: { tool: 'handoff.read', input: { section: 'instructions', messageId: message.messageId } } })),
        ...(next < messages.length ? { next: { tool: 'handoff.read', input: { section: 'instructions', offset: next } } } : {}) };
    }
    if (!execution) throw new Error('当前宿主未提供持久执行记录，不能把旧票据当作可恢复结果');
    if (input.section === 'work') {
      const start = input.offset ?? 0, limit = input.limit ?? 20;
      if (start > items.length) throw new Error('执行记录游标越界');
      const selected = items.slice(start, start + limit), next = start + selected.length;
      return { conversationId: conversation.conversationId, eventCursor: execution.cursor, total: items.length,
        offset: start, hasMore: next < items.length, items: selected.map(workSummary),
        note: '只读持久执行事实；完成状态不等于保存或目标达成。原连接票据不授予重放权限。',
        ...(next < items.length ? { next: { tool: 'handoff.read', input: { section: 'work', offset: next } } } : {}) };
    }
    const item = items.find(candidate => candidate.runId === input.runId && candidate.itemId === input.itemId);
    if (!item) throw new Error('执行项不属于当前会话或不是可交接的公开事实');
    const field = input.field ?? 'output';
    let text: string;
    if (field === 'decision') text = JSON.stringify({ question: item.data.question, answer: item.data.answer });
    else if (field === 'facts') text = JSON.stringify({ status: item.data.status, remainingGoal: item.data.remainingGoal,
      applicationStatus: item.data.applicationStatus, saveStatus: item.data.saveStatus, transportDelivery: item.data.transportDelivery,
      operationId: item.data.operationId, documentId: item.data.documentId, revision: item.data.revision });
    else if (field === 'text') {
      text = (await Promise.all(item.content.map(part => part.kind === 'text' ? part.text : this.blob(part.ref)))).join('');
    } else {
      const ref = item.data[`${field}Ref`];
      text = ref ? await this.blob(ref) : item.data[field] ?? '';
    }
    const start = input.offset ?? 0, limit = input.limit ?? 6000;
    if (start > text.length) throw new Error('执行正文游标越界');
    const value = text.slice(start, start + limit), next = start + value.length;
    return { conversationId: conversation.conversationId, ...workSummary(item), field, text: value,
      offset: start, totalCharacters: text.length, hasMore: next < text.length,
      ...(next < text.length ? { next: { tool: 'handoff.read', input: { section: 'item', runId: item.runId, itemId: item.itemId, field, offset: next, limit } } } : {}) };
  }

  private async blob(ref: ExecutionBlobRef): Promise<string> {
    if (!this.options.blob) throw new Error('当前宿主未提供该持久正文读取能力');
    return new TextDecoder().decode(await this.options.blob(ref));
  }
}
