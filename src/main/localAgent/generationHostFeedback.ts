import { generationRequestSchema, type GenerationFailure, type GenerationRequest } from '../../shared/generationContract'
import { dynamicBehaviorEvidenceSchema } from '../../shared/dynamicBehaviorObservation'
import type { LocalAgentHostResult } from '../../shared/localAgentContract'
import type { AiHostResult } from '../../shared/localAgentTaskContract'

/** Native history needs the committed facts, not the duplicated persistence
 * envelope. Exact owner + item IDs preserve target identity; the full receipt,
 * including authoring addresses, remains in the local session record. */
export function generationReceiptFeedback(results: readonly AiHostResult[]) {
  return results.map(result => ({
    resultId: result.resultId, requestId: result.requestId, candidateId: result.candidateId,
    status: result.status, beforeRevision: result.beforeRevision, afterRevision: result.afterRevision,
    summary: result.summary,
    affected: result.receipts.flatMap(receipt => receipt.affected.map(({ id, operation, ownerKey }) => ({ id, operation, ownerKey }))),
    resources: result.receipts.map(receipt => receipt.resources),
    ...(result.diagnostics.length ? { diagnostics: result.diagnostics } : {}),
    ...(result.failure ? { failure: { ...result.failure,
      ...(result.failure.behaviorEvidence?.length ? { behaviorEvidence: result.failure.behaviorEvidence.map(observation => ({
        ...observation, frames: observation.frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
        frameDelivery: 'Binary frames remain in the durable task record; edit continuation supplies verified observation resources.',
      })) } : {}),
    } } : {}),
    ...(result.afterCommit ? { afterCommit: result.afterCommit } : {}),
  }))
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
