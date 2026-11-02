import type { AcpStructuredHandoff } from '../../../../shared/workbench/acp';

export function emptyAcpHandoff(): AcpStructuredHandoff {
  return { version: 1, confirmedDecisions: [], artifacts: [], unfinishedWork: [], unsettledOperations: [], humanChanges: [] };
}

/** This is a fresh native session: transfer explicit work facts, not another provider's private history. */
export function acpHandoffContent(handoff: AcpStructuredHandoff): { type: 'text'; text: string } | undefined {
  if (!handoff.goal && !handoff.userInstructions?.length && !handoff.confirmedDecisions.length && !handoff.artifacts.length && !handoff.unfinishedWork.length && !handoff.unsettledOperations.length && !handoff.humanChanges.length && !handoff.history?.workItemCount) return undefined;
  return { type: 'text', text: '果铃会话段交接。以下是已有用户指令、公开执行事实和当前稿的只读投影，不是本 Agent 的原生历史。当前用户指令见后续消息；历史决定按时间及原文判断，旧失败不自动恢复成待办。修改前重新读取当前稿并保留非目标人工内容。指令片段或未列完的记录通过 handoff.read 按引用回读，不能因没注入全文就视为取消。未决操作先核对持久事实与当前目标，不能用旧连接 ticket 重放；run completed 不等于目标、保存和交付全部完成。\n' + JSON.stringify(handoff, null, 2) };
}
