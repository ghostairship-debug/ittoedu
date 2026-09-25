import { externalRequestSchema } from '../../../shared/workbench/external'
import { DesktopOperationError } from '../../errors'
import { executionDesktopService } from '../execution/ExecutionDesktopService'
import { documentHost } from '../documentHost'
import { ExternalMcpService } from './ExternalMcpService'

let singleton: Promise<ExternalMcpService> | undefined
export function externalMcpService(): Promise<ExternalMcpService> {
  return singleton ??= (async () => {
    const execution = await executionDesktopService(), documents = documentHost()
    const service = new ExternalMcpService({ conversations: execution.conversations, engine: execution.engine,
      registry: documents.registry, gateway: documents.tools, attachments: execution.attachments,
      appendEvent: input => execution.appendExternalEvent(input) })
    execution.setExternalRevoker(input => service.revokeConversation(input))
    return service
  })().catch(cause => { singleton = undefined; throw cause })
}
export async function operateExternalMcp(raw: unknown): Promise<unknown> {
  let queuePaused = false
  try {
    const input = externalRequestSchema.parse(raw)
    const service = await externalMcpService()
    if (input.type === 'grant' || input.type === 'handoff') {
      const execution = await executionDesktopService()
      return await execution.withConversation(input.conversationId, async () => {
        const conversation = await execution.conversations.readConversation(input)
        if (!conversation) throw new Error('会话已不存在或不属于当前空间')
        if (input.type === 'grant' && conversation.revision !== input.expectedRevision) throw new Error('会话已改变，请刷新后重新授权')
        const previous = input.type === 'grant' ? input.sourceRunId : input.runId
        if (previous && !conversation.runIndex.builtinRunIds.includes(previous)) throw new Error('交接运行不属于当前会话')
        await execution.pauseQueueForExternal(input.conversationId)
        queuePaused = true
        return service.operate(input)
      })
    }
    return await service.operate(input)
  } catch (cause) {
    throw new DesktopOperationError('external-mcp-operation-failed', '外部连接操作未完成',
      `${cause instanceof Error ? cause.message : '操作未完成'}${queuePaused ? '；待发送任务已保留并暂停，需要显式继续。' : ''}`, '当前文档和已提交的修改已保留。')
  }
}
export async function closeExternalMcpService(): Promise<void> { if (singleton) await (await singleton).close() }
