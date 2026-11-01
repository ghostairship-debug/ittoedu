import type { AcpStructuredHandoff } from '../../../../shared/workbench/acp';

export function emptyAcpHandoff(): AcpStructuredHandoff {
  return { version: 1, confirmedDecisions: [], artifacts: [], unfinishedWork: [], unsettledOperations: [], humanChanges: [] };
}

/** This is a fresh native session: transfer explicit work facts, not another provider's private history. */
export function acpHandoffContent(handoff: AcpStructuredHandoff): { type: 'text'; text: string } | undefined {
  if (!handoff.goal && !handoff.confirmedDecisions.length && !handoff.artifacts.length && !handoff.unfinishedWork.length && !handoff.unsettledOperations.length && !handoff.humanChanges.length) return undefined;
  return { type: 'text', text: '果铃会话段交接。以下 JSON 是上一段已记录的工作事实，不是本 Agent 的原生会话历史。修改前重新读取作品当前版本；未决操作先核对回执，不能直接重放；保留人工修改。当前用户指令见后续消息。\n' + JSON.stringify(handoff, null, 2) };
}
