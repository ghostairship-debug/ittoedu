import type { ExecutionRole, ExecutionSelectionSnapshot } from '../../../shared/workbench/executionSettings'
import { matchesDisclosedSelection, type DisclosedExecutionSettings } from '../../../shared/workbench/executionDesktop'
import type { ImageModelSelection } from '../../../shared/workbench/images'
import type { ImageRoleAvailability, ImageRoleAvailabilitySnapshot } from '../../../shared/workbench/toolPorts'
import { imageRoute } from './imageRoute'

type FrozenImageRole = { selection: ImageModelSelection } | { error: string }
/** An unconfigured image role does not prevent text-only work. It remains unavailable for that run. */
export function frozenImageRoles(snapshot: (role: ExecutionRole) => Promise<ExecutionSelectionSnapshot>) {
  const runs = new Map<string, Map<'generate' | 'edit', FrozenImageRole>>()
  return {
    async beginRun(runId: string, disclosedSettings?: DisclosedExecutionSettings, parentRunId?: string) {
      if (parentRunId) {
        const inherited = runs.get(parentRunId)
        // A native child inherits the parent's already frozen route, including
        // unavailable facts. A missing old scope is not permission to charge a
        // newly selected connection after a restart or user continuation.
        runs.set(runId, inherited ? structuredClone(inherited) : new Map((['generate', 'edit'] as const).map(operation =>
          [operation, { error: '原父任务冻结的图片连接未保留，此续接无法恢复该图片通道；请在新主任务中配置并生成图片。' }])))
        return
      }
      const roles = new Map<'generate' | 'edit', FrozenImageRole>()
      await Promise.all((['generate', 'edit'] as const).map(async operation => {
        const roleName = operation === 'generate' ? 'imageGenerate' : 'imageEdit'
        let role: ExecutionSelectionSnapshot
        try {
          role = await snapshot(roleName)
        } catch {
          if (disclosedSettings?.roles[roleName]) throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
          roles.set(operation, { error: '此任务开始时图片连接尚未接通或配置不可读取；请完成图片模型设置后开始新任务。' })
          return
        }
        if (disclosedSettings && !matchesDisclosedSelection(disclosedSettings, role))
          throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
        try { imageRoute({ jobId: '', runId, documentId: '', operation, prompt: '',
          selection: { connection: role.connection, imageModel: role.model } }) }
        catch { roles.set(operation, { error: '此任务的图片角色需要已接通的 GPT OAuth 或已启用 OpenAI Images API 的连接。' }); return }
        if (Object.keys(role.parameters ?? {}).length) {
          roles.set(operation, { error: '此任务的图片角色含当前不支持的额外模型参数；请在设置中清空为 {} 后开始新任务。' }); return
        }
        roles.set(operation, { selection: structuredClone({ connection: role.connection, imageModel: role.model }) })
      }))
      runs.set(runId, roles)
    },
    describe(runId: string): ImageRoleAvailabilitySnapshot | undefined {
      const roles = runs.get(runId)
      if (!roles) return undefined
      const describeRole = (operation: 'generate' | 'edit'): ImageRoleAvailability => {
        const role = roles.get(operation)
        return role && 'selection' in role ? { status: 'configured' }
          : { status: 'unavailable', reason: role && 'error' in role ? role.error : '图片任务没有冻结的模型配置。' }
      }
      return { generate: describeRole('generate'), edit: describeRole('edit') }
    },
    selection(runId: string, operation: 'generate' | 'edit'): ImageModelSelection {
      const role = runs.get(runId)?.get(operation)
      if (!role) throw new Error('图片任务没有冻结的模型配置。')
      if ('error' in role) throw new Error(role.error)
      return structuredClone(role.selection)
    },
  }
}

