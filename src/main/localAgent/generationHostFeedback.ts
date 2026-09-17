import { generationRequestSchema, type GenerationFailure, type GenerationRequest } from '../../shared/generationContract'
import { dynamicBehaviorEvidenceSchema } from '../../shared/dynamicBehaviorObservation'
import type { LocalAgentHostResult } from '../../shared/localAgentContract'
import type { AiHostResult } from '../../shared/localAgentTaskContract'
import type { AiWorkspaceIdentity } from '../../shared/workspaceIdentity'

type BehaviorEvidenceReference = { path: string; observations: number; semanticVerdict: 'requires-review' }
type FeedbackFailure = Omit<GenerationFailure, 'behaviorEvidence'> & {
  behaviorEvidence?: GenerationFailure['behaviorEvidence'] | BehaviorEvidenceReference
}
type HostResultProjection = Omit<LocalAgentHostResult, 'failure'> & { failure?: FeedbackFailure }
type AiHostResultProjection = Omit<AiHostResult, 'failure'> & { failure?: FeedbackFailure }

function compactSemanticChanges(changes: NonNullable<AiHostResult['semanticChanges']>) {
  return { changeCount: changes.changes.length, omitted: changes.omitted, comparison: changes.comparison, truncation: changes.truncation }
}

/** Feedback retains receipt identity and status while moving bulky change
 * values behind the durable request/resource boundary. */
export function generationCompactHostResult(result: HostResultProjection | AiHostResultProjection, fullReceiptPath?: string) {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= 8_192) return { ...result, ...(fullReceiptPath ? { fullReceipt: fullReceiptPath } : {}) }
  const { semanticChanges, executionEvidence, failure, ...rest } = result
  const diagnostics = 'diagnostics' in result ? result.diagnostics : undefined
  return { ...rest,
    ...('receipts' in result ? { receipts: result.receipts.map(({ semanticChanges: changes, ...receipt }) => ({ ...receipt,
      ...(changes ? { semanticChanges: compactSemanticChanges(changes) } : {}),
    })) } : {}),
    ...(semanticChanges ? { semanticChanges: compactSemanticChanges(semanticChanges) } : {}),
    ...(executionEvidence ? { executionEvidence: { entryCount: executionEvidence.length, statuses: [...new Set(executionEvidence.map(entry => entry.status))] } } : {}),
    ...(diagnostics?.length ? { diagnostics: { count: diagnostics.length, codes: [...new Set(diagnostics.map(diagnostic => diagnostic.code))] } } : {}),
    ...(failure ? { failure: { stage: failure.stage, diagnosticCodes: [...new Set(failure.diagnostics.map(diagnostic => diagnostic.code))],
      ...(Array.isArray(failure.behaviorEvidence) && failure.behaviorEvidence.length ? { behaviorEvidence: { observations: failure.behaviorEvidence.length } } : {}),
      ...(failure.recovery ? { recovery: failure.recovery } : {}), } } : {}),
    ...(fullReceiptPath ? { fullReceipt: fullReceiptPath } : {}),
  }
}

function fullReceiptFailure(failure: GenerationFailure) {
  return { ...failure,
    ...(failure.behaviorEvidence?.length ? { behaviorEvidence: failure.behaviorEvidence.map(observation => ({
      ...observation, frames: observation.frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
      frameDelivery: 'Binary frames remain in the durable task record; edit continuation supplies verified observation resources.',
    })) } : {}),
  }
}

type ReceiptProjection = ReturnType<typeof receiptFeedbackProjection>[number]
type CompleteReceiptProjection = Omit<ReceiptProjection, 'semanticChanges' | 'executionEvidence' | 'diagnostics' | 'failure'> & {
  semanticChanges?: AiHostResult['semanticChanges']
  executionEvidence?: AiHostResult['executionEvidence']
  diagnostics?: AiHostResult['diagnostics']
  failure?: ReturnType<typeof fullReceiptFailure>
}

/** Native history needs the committed facts, not the duplicated persistence
 * envelope. Exact owner + item IDs preserve target identity; the full receipt,
 * including authoring addresses, remains in the local session record. */
export function generationReceiptFeedback(results: readonly AiHostResult[], options?: { compact?: false; fullReceiptPath?: string }): CompleteReceiptProjection[]
export function generationReceiptFeedback(results: readonly AiHostResult[], options: { compact: true; fullReceiptPath?: string }): ReceiptProjection[]
export function generationReceiptFeedback(results: readonly AiHostResult[], options: { compact?: boolean; fullReceiptPath?: string } = {}) {
  return receiptFeedbackProjection(results, options)
}

function receiptFeedbackProjection(results: readonly AiHostResult[], options: { compact?: boolean; fullReceiptPath?: string }) {
  return results.map(result => ({
    resultId: result.resultId, requestId: result.requestId, candidateId: result.candidateId,
    status: result.status, beforeRevision: result.beforeRevision, afterRevision: result.afterRevision,
    summary: result.summary,
    affected: result.receipts.flatMap(receipt => receipt.affected.map(({ id, operation, ownerKey }) => ({ id, operation, ownerKey }))),
    resources: result.receipts.map(receipt => receipt.resources),
    ...(options.compact ? {
      ...(result.semanticChanges ? { semanticChanges: {
        changeCount: result.semanticChanges.changes.length,
        omitted: result.semanticChanges.omitted,
        comparison: result.semanticChanges.comparison,
        truncation: result.semanticChanges.truncation,
      } } : {}),
      ...(result.executionEvidence ? { executionEvidence: {
        entryCount: result.executionEvidence.length,
        statuses: [...new Set(result.executionEvidence.map(entry => entry.status))],
      } } : {}),
      ...(result.diagnostics.length ? { diagnostics: {
        count: result.diagnostics.length,
        codes: [...new Set(result.diagnostics.map(diagnostic => diagnostic.code))],
      } } : {}),
      ...(result.failure ? { failure: {
        stage: result.failure.stage,
        diagnosticCodes: [...new Set(result.failure.diagnostics.map(diagnostic => diagnostic.code))],
        ...(result.failure.behaviorEvidence?.length ? { behaviorEvidence: { observations: result.failure.behaviorEvidence.length } } : {}),
        ...(result.failure.recovery ? { recovery: result.failure.recovery } : {}),
      } } : {}),
      omitted: ['semanticChanges.changes', 'executionEvidence.entries', 'diagnostics.messages', 'failure.behaviorEvidence.frames'],
    } : {
      ...(result.semanticChanges ? { semanticChanges: result.semanticChanges } : {}),
      ...(result.executionEvidence ? { executionEvidence: result.executionEvidence } : {}),
      ...(result.diagnostics.length ? { diagnostics: result.diagnostics } : {}),
      ...(result.failure ? { failure: fullReceiptFailure(result.failure) } : {}),
    }),
    ...(result.afterCommit ? { afterCommit: result.afterCommit } : {}),
    ...(options.fullReceiptPath ? { fullReceipt: options.fullReceiptPath } : {}),
  }))
}

export function generationPendingReceiptPrompt(workspace: AiWorkspaceIdentity, results: readonly AiHostResult[], fullReceiptPath: string): string {
  if (!results.length) return ''
  const complete = generationReceiptFeedback(results, { fullReceiptPath })
  const projected = Buffer.byteLength(JSON.stringify(complete), 'utf8') <= 8_192
    ? complete : generationReceiptFeedback(results, { compact: true, fullReceiptPath })
  return `以下是当前工程尚未送达的宿主实际结果。只有 committed / unchanged 表示已应用或确认无需修改；rejected / stale / failed 均未应用该候选。保留已经提交的成果，不重复执行；失败结果用于理解未完成目标和原因。本轮若仅询问状态或停止原因，只作解释，不自动继续编辑。\n${JSON.stringify({ workspace, results: projected })}\n`
}

/** Keep the complete formal result in the request-scoped resource while the
 * prompt carries only the status and impact needed to decide the next turn. */
export function generationPendingReceiptResource(request: GenerationRequest, results: readonly AiHostResult[]): GenerationRequest {
  if (!results.length) return request
  const relativePath = 'pending-host-results.json'
  if (request.resourceFiles?.some(file => file.path === relativePath)) throw new Error('本轮未送达宿主回执资源已经存在')
  // A full input set remains valid. The harness writes the formal receipt as
  // an explicitly advertised file beside request.json instead of dropping input.
  if ((request.resourceFiles?.length ?? 0) >= 1000) return request
  const content = JSON.stringify({ version: 1, source: 'pending-formal-host-results', results })
  return generationRequestSchema.parse({ ...request,
    resourceFiles: [...request.resourceFiles ?? [], { path: relativePath, content, encoding: 'utf8', role: 'structure', mediaType: 'application/json' }],
  })
}

/** A continuation may be built after an earlier receipt was acknowledged. Keep
 * that complete result discoverable in the new request before compacting it. */
export function generationHostResultResource(request: GenerationRequest, result: HostResultProjection, hostResult: AiHostResultProjection | null): GenerationRequest {
  const relativePath = 'host-result.json'
  if (request.resourceFiles?.some(file => file.path === relativePath)) return request
  if ((request.resourceFiles?.length ?? 0) >= 1000) return request
  const content = JSON.stringify({ version: 1, source: 'formal-host-result', result, hostResult })
  return generationRequestSchema.parse({ ...request,
    resourceFiles: [...request.resourceFiles ?? [], { path: relativePath, content, encoding: 'utf8', role: 'structure', mediaType: 'application/json' }],
  })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('失败行为证据资源格式无效')
  return value as Record<string, unknown>
}

/** The durable failure keeps its original frames. Only this prompt view uses
 * the actual resources produced by the next observation's evidence attachment. */
export function generationHostFeedback(request: GenerationRequest, result: LocalAgentHostResult, hostResult: AiHostResult | null) {
  const projectFailure = (failure: GenerationFailure | undefined) => {
    if (!failure?.behaviorEvidence?.length) return failure
    const reference = record(record(request.context).behaviorEvidence)
    if (typeof reference.path !== 'string' || !reference.path.startsWith('resources/')) throw new Error('失败行为证据缺少本轮资源引用')
    const resources = new Map((request.resourceFiles ?? []).map(file => [`resources/${file.path}`, file]))
    const resource = resources.get(reference.path)
    if (resource?.encoding !== 'utf8' || resource.role !== 'runtime-evidence') throw new Error('失败行为证据没有本轮真实资源')
    const metadata = record(JSON.parse(resource.content))
    if (metadata.source !== 'actual-candidate-host' || metadata.imageFeedback !== 'candidate-host-frames'
      || metadata.semanticVerdict !== 'requires-review' || !Array.isArray(metadata.observations)) throw new Error('失败行为证据不是未提交候选的真实观察')
    const materialized = metadata.observations.map(value => {
      const observation = record(value)
      if (!Array.isArray(observation.frames)) throw new Error('失败行为证据缺少帧索引')
      return { ...observation, frames: observation.frames.map(value => {
        const { fileId, path, source, ...facts } = record(value)
        if (source !== undefined && source !== 'candidate-host-before-commit') throw new Error('失败行为帧不是原候选宿主来源')
        const image = typeof path === 'string' ? resources.get(path) : undefined
        const observed = request.observation?.files.find(file => file.fileId === fileId)
        if (image?.encoding !== 'base64' || image.mediaType !== 'image/png' || !observed
          || path !== `resources/${observed.relativePath}`) throw new Error('失败行为帧没有匹配的本轮图片资源')
        return { ...facts, dataUrl: `data:image/png;base64,${image.content}` }
      }) }
    })
    if (JSON.stringify(dynamicBehaviorEvidenceSchema.parse(materialized)) !== JSON.stringify(dynamicBehaviorEvidenceSchema.parse(failure.behaviorEvidence))) {
      throw new Error('失败行为证据与本轮资源不一致')
    }
    return { ...failure, behaviorEvidence: { path: reference.path,
      observations: failure.behaviorEvidence.length, semanticVerdict: 'requires-review' as const } }
  }
  const projectedResult = { ...result, ...(result.failure ? { failure: projectFailure(result.failure) } : {}) }
  const projectedHostResult = hostResult ? { ...hostResult, ...(hostResult.failure ? { failure: projectFailure(hostResult.failure) } : {}) } : null
  if (!result.failure?.behaviorEvidence?.length && !hostResult?.failure?.behaviorEvidence?.length) {
    return { request, result: projectedResult, hostResult: projectedHostResult, resourcePath: undefined }
  }
  const relativePath = 'observation/host-feedback.json'
  if (request.resourceFiles?.some(file => file.path === relativePath)) throw new Error('本轮宿主反馈资源已经存在')
  if (!request.observation) throw new Error('失败反馈需要当前实际观察')
  const content = JSON.stringify({ version: 1, source: 'formal-host-result', result: projectedResult, hostResult: projectedHostResult })
  const enriched = generationRequestSchema.parse({ ...request,
    observation: { ...request.observation, files: [...request.observation.files,
      { fileId: 'host-feedback', relativePath, role: 'runtime-evidence', mediaType: 'application/json', byteLength: Buffer.byteLength(content) }] },
    resourceFiles: [...request.resourceFiles ?? [], { path: relativePath, content, encoding: 'utf8', role: 'runtime-evidence', mediaType: 'application/json' }],
  })
  return { request: enriched, result: projectedResult, hostResult: projectedHostResult, resourcePath: `resources/${relativePath}` }
}
