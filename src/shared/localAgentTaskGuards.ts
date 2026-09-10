import { workspaceIdentityKey } from './workspaceIdentity'
import { generationRequestSchema, type GenerationRequest, type GenerationFailure } from './generationContract'
import { aiHostResultSchema, aiObservationSchema, aiProposalSchema, aiTaskSchema, type AiHostResult, type AiObservation, type AiProposal, type AiTask } from './localAgentTaskContract'

// Values have already passed strict JSON schemas. Object insertion order is not identity.
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(Reflect.get(left, key), Reflect.get(right, key)))
}

function requireSameTask(task: AiTask, value: { taskId: string; epoch: number; workspace: AiTask['workspace'] }) {
  if (task.taskId !== value.taskId || task.epoch !== value.epoch || workspaceIdentityKey(task.workspace) !== workspaceIdentityKey(value.workspace)) throw new Error('stale-task：任务、epoch或workspace不一致')
}

/** Only a current candidate's own destination can be repaired by the native task. */
export class AiCandidateScopeError extends Error {
  constructor(message: string, readonly failure?: GenerationFailure) { super(message) }
}

/** Validate before prepare and again synchronously inside the existing commit lease. No writer. */
export function assertAiProposalCurrent(rawTask: AiTask, rawObservation: AiObservation, rawRequest: GenerationRequest, rawProposal: AiProposal): void {
  const task = aiTaskSchema.parse(rawTask), observation = aiObservationSchema.parse(rawObservation)
  const request = generationRequestSchema.parse(rawRequest), proposal = aiProposalSchema.parse(rawProposal)
  if (task.execution && Date.now() >= task.execution.deadlineAt) throw new Error('expired-task：当前任务的执行期限已到，需以新观察重新准备')
  if (task.intent !== 'edit') throw new Error('read-only-intent：讨论和计划不能提交工程候选')
  if (observation.source === 'generation-snapshot' && task.applyPolicy !== 'preview') throw new Error('incomplete-observation：旧生成快照只能进入原有预览后手动应用路径')
  if (!['running', 'checking', 'awaiting-apply', 'committing'].includes(task.status)) throw new Error('inactive-task：任务不在可接受候选状态')
  requireSameTask(task, observation); requireSameTask(task, proposal)
  if (task.observationId !== observation.observationId || proposal.observationId !== observation.observationId) throw new Error('stale-observation：候选观察已经失效')
  if (workspaceIdentityKey(request.workspace) !== workspaceIdentityKey(task.workspace) || request.requestId !== proposal.requestId || request.documentRevision !== observation.documentRevision || request.sessionGeneration !== observation.sessionGeneration) throw new Error('stale-request：请求身份或文档版本不一致')
  if (!sameJson(observation.readScope, task.readScope)) throw new Error('scope-mismatch：观察超出当前读取授权')
  // Destinations come from canonical prepare. Exact equality retains null fields and owner scope.
  if (request.destinations.some(destination => !task.writeDestinations.some(allowed => sameJson(destination, allowed)))) throw new Error('scope-mismatch：请求超出当前写入授权')
  for (const step of proposal.candidate.steps) {
    if ('stepId' in step.destination) continue // Existing generation validation resolves prior results.
    if (!request.destinations.some(destination => sameJson(step.destination, destination))) {
      const message = 'scope-mismatch：候选修改未经授权的目标；请使用当前目标别名，或原样复制 request.destinations 的完整目标'
      throw new AiCandidateScopeError(message, { version: 1, stage: 'candidate-parse', requestId: request.requestId,
        candidateId: proposal.candidateId, stepId: step.id, tool: step.tool, destination: step.destination,
        diagnostics: [{ code: 'scope-mismatch', message, path: ['steps', proposal.candidate.steps.indexOf(step), 'destination'] }], assetIds: [], packageIds: [] })
    }
  }
}

/** Local stop invalidates the epoch immediately; earlier real commits remain recorded. */
export function stopAiTask(input: AiTask): AiTask {
  const task = aiTaskSchema.parse(input)
  if (['completed', 'failed', 'cancelled', 'partial'].includes(task.status)) return task
  return aiTaskSchema.parse({ ...task, epoch: task.epoch + 1, status: task.committedResultIds.length ? 'partial' : 'cancelled' })
}

/** Result bookkeeping only. Call after the canonical transaction returned, never before it. */
export function acceptAiHostResult(input: AiTask, proposal: AiProposal, rawResult: AiHostResult, previous: readonly AiHostResult[]): { task: AiTask; duplicate: boolean } {
  const task = aiTaskSchema.parse(input), result = aiHostResultSchema.parse(rawResult)
  const parsedProposal = aiProposalSchema.parse(proposal)
  // An identical archived result may arrive after Stop, but never from another task/workspace.
  for (const value of [result, parsedProposal]) if (value.taskId !== task.taskId || workspaceIdentityKey(value.workspace) !== workspaceIdentityKey(task.workspace)) throw new Error('result-mismatch：结果属于其他任务')
  for (const field of ['requestId', 'candidateId', 'observationId'] as const) if (result[field] !== parsedProposal[field]) throw new Error('result-mismatch：结果不属于当前候选')
  const prior = previous.find(value => value.resultId === result.resultId || (value.candidateId === result.candidateId && value.status === result.status))
  if (prior) {
    if (!sameJson(aiHostResultSchema.parse(prior), result)) throw new Error('conflicting-result：相同结果身份的内容不同')
    return { task, duplicate: true }
  }
  requireSameTask(task, parsedProposal); requireSameTask(task, result)
  if (task.observationId !== parsedProposal.observationId) throw new Error('stale-observation：结果对应观察已经失效')
  if (task.intent !== 'edit' || !['checking', 'awaiting-apply', 'committing', 'feeding-back'].includes(task.status)) throw new Error('inactive-task：当前任务不能接收新的候选结果')
  if (result.status === 'committed' && task.status !== 'committing') throw new Error('missing-commit-lease：只有提交阶段能接收新的实际写入结果')
  if (result.afterCommit?.action === 'finish' && parsedProposal.candidate.afterCommit?.action !== 'finish') throw new Error('result-mismatch：候选没有声明提交后完成')
  const complete = result.afterCommit?.action === 'finish' && ['committed', 'unchanged'].includes(result.status)
  return { task: aiTaskSchema.parse({ ...task, status: complete ? 'completed' : 'feeding-back',
    ...(complete ? { completion: { version: 1, resultId: result.resultId, outcome: result.status === 'committed' ? 'modified' : 'unchanged' } } : {}),
    committedResultIds: result.status === 'committed' ? [...task.committedResultIds, result.resultId] : task.committedResultIds }), duplicate: false }
}
