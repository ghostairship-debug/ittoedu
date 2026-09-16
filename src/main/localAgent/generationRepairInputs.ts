import { generationRequestSchema, type GenerationRequest } from '../../shared/generationContract'
import type { AiHostResult, AiProposal, AiTask } from '../../shared/localAgentTaskContract'
import { workspaceIdentityKey } from '../../shared/workspaceIdentity'

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** A read-only projection of this task's rejected work, never a candidate to replay.
 * The existing request resource writer owns its files, limits and lifetime. */
export function generationRepairInputs(request: GenerationRequest, prior: GenerationRequest, task: AiTask,
  result: AiHostResult | undefined, proposal: AiProposal | undefined): { request: GenerationRequest; guidance?: string } {
  if (!proposal || result?.status !== 'rejected' || result.failure?.stage !== 'prepare'
    || task.intent !== 'edit' || !['checking', 'feeding-back'].includes(task.status)
    || !task.execution || Date.now() >= task.execution.deadlineAt
    || request.requestId === prior.requestId || request.documentRevision !== prior.documentRevision
    || request.sessionGeneration !== prior.sessionGeneration) return { request }
  const workspace = workspaceIdentityKey(task.workspace)
  if ([request, prior, result, proposal].some(value => workspaceIdentityKey(value.workspace) !== workspace)
    || [result, proposal].some(value => value.taskId !== task.taskId || value.epoch !== task.epoch
      || value.observationId !== task.observationId || value.requestId !== prior.requestId)
    || result.candidateId !== proposal.candidateId || proposal.candidate.requestId !== prior.requestId
    || proposal.candidate.candidateId !== proposal.candidateId) return { request }

  const root = `repair/component-changes-${prior.requestId}`
  const resources: NonNullable<GenerationRequest['resourceFiles']> = []
  const changes: unknown[] = []
  for (const [stepIndex, step] of proposal.candidate.steps.entries()) {
    const input = object(step.input)
    if (step.tool !== 'component.package' || !input || !['patch', 'revise'].includes(String(input.operation))) continue
    const field = input.operation === 'patch' ? 'changedFiles' : 'files'
    const files = object(input[field])
    if (!files || !Object.keys(files).length) continue
    const sources: { packagePath: string; resourcePath: string }[] = []
    for (const [fileIndex, [packagePath, value]] of Object.entries(files).entries()) {
      const descriptor = object(value)
      let encoding: 'utf8' | 'base64', content: string
      if (descriptor?.encoding === 'utf8' && typeof descriptor.text === 'string' && Object.keys(descriptor).length === 2) {
        encoding = 'utf8'; content = descriptor.text
      } else if (typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value) {
        encoding = 'base64'; content = value
      } else return { request, guidance: '上一候选的组件文件编码无法作为修复输入读取，已省略复用；请依据当前观察修正。' }
      // Package names remain metadata; they never select a filesystem path.
      const extension = packagePath.match(/\.(js|json|css|txt|svg)$/i)?.[0] ?? '.bin'
      const relativePath = `${root}/step-${stepIndex + 1}/file-${fileIndex + 1}${extension}`
      resources.push({ path: relativePath, encoding, content, role: 'source' })
      sources.push({ packagePath, resourcePath: `resources/${relativePath}` })
    }
    const { [field]: _files, ...originalInput } = input
    changes.push({ stepId: step.id, originalDestination: step.destination, originalInput, sources })
  }
  if (!changes.length) return { request }
  const relativePath = `${root}/index.json`
  const instruction = '仅用于修复的未提交组件源码，不是当前工程或可直接重交的候选。按当前 request.json 的目标与 context.componentSources 基线初始化本轮 component-work，将需要保留的源码按 packagePath 复制到工作副本，修正后由当前 helper 重建补丁；不得沿用原 requestId、目标别名或基线身份。原候选的其他步骤仍须依据当前观察重建并接受完整检查。'
  resources.push({ path: relativePath, encoding: 'utf8', role: 'structure', mediaType: 'application/json', content: JSON.stringify({
    version: 1, purpose: 'repair-input-only', instruction,
    origin: { taskId: task.taskId, epoch: task.epoch, requestId: prior.requestId, candidateId: proposal.candidateId,
      documentRevision: prior.documentRevision, sessionGeneration: prior.sessionGeneration }, changes,
  }) })
  const enriched = generationRequestSchema.safeParse({ ...request, resourceFiles: [...request.resourceFiles ?? [], ...resources] })
  if (!enriched.success) return { request, guidance: '上一候选的组件修复输入超出本轮资源合同（容量、文件数或路径），已省略复用；本轮仍使用当前真实观察。' }
  return { request: enriched.data, guidance: `上一候选的组件改动已保存为本轮可读修复输入：${`resources/${relativePath}`}（相对 fileAccess.root）。先读该索引并复用所需源码，避免重新编写已完成的改动。${instruction}` }
}
