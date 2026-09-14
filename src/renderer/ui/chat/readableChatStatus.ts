import type { LocalAgentEvent } from '../../../shared/localAgentContract'

export { readableLocalAgentError as readableChatError } from '../../../shared/localAgentText'

export function readableActivity(event: LocalAgentEvent): string | null {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return null
  const payload = event.payload
  if (event.kind === 'tool-call' || event.kind === 'tool-result') {
    const name = String(payload.name ?? payload.toolName ?? payload.tool ?? '')
    if (/image.?gen|generate.?image/i.test(name)) return event.kind === 'tool-call' ? '正在生成图片' : payload.status === 'failed' || payload.isError ? '图片生成未完成，正在处理' : '图片已生成，正在准备后续处理'
    const failed = payload.status === 'failed' || payload.isError
    if (event.kind === 'tool-result') return failed ? '这一步未完成，正在根据结果调整' : null
    if (/read|view|inspect/i.test(name)) return '正在读取任务所需内容'
    if (/search|grep|glob|find|list/i.test(name)) return '正在查找相关内容'
    if (/write|edit|patch/i.test(name)) return '正在准备修改文件'
    if (/bash|powershell|shell|terminal|execute|command/i.test(name)) return '正在运行工具处理任务'
    if (/web|fetch|browse/i.test(name)) return '正在查阅网络资料'
    return '正在调用工具处理任务'
  }
  return null
}
