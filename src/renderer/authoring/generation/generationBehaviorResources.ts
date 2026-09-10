import { generationCommitReceiptSchema, generationRequestSchema, type GenerationCommitReceipt, type GenerationRequest } from '../../../shared/generationContract'
import { dynamicBehaviorEvidenceSchema, type DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { workspaceIdentityKey } from '../../../shared/workspaceIdentity'

/** Lifecycle images yield to current host frames after commit; explicit private
 * input evidence remains labelled as candidate-host observations. */
export function attachGenerationBehaviorEvidence(request: GenerationRequest, input: readonly DynamicBehaviorObservation[], receipt?: GenerationCommitReceipt): GenerationRequest {
  if (!input.length) return request
  if (!request.observation) throw new Error('动态验证结果需要当前实际观察')
  const evidence = dynamicBehaviorEvidenceSchema.parse(input)
  const committed = receipt ? generationCommitReceiptSchema.parse(receipt) : undefined
  if (committed && (workspaceIdentityKey(committed.workspace) !== workspaceIdentityKey(request.workspace)
    || committed.afterRevision !== request.documentRevision)) throw new Error('动态验证回执与当前工程观察不一致')
  const files = [...request.observation.files], resources = [...request.resourceFiles ?? []]
  const metadata = evidence.map((item, index) => {
    if (item.projectId !== request.workspace.projectId) throw new Error('动态验证结果不属于当前工程')
    return { ...item, frames: item.frames.map((frame, frameIndex) => {
      const { dataUrl, ...facts } = frame
      if (committed && frame.phase !== 'before-button-click' && frame.phase !== 'after-button-click') return { ...facts, imageAttachment: 'not-forwarded-after-commit' as const }
      const content = dataUrl.slice('data:image/png;base64,'.length)
      const decoded = atob(content)
      if (btoa(decoded) !== content) throw new Error('动态验证帧不是规范 PNG 编码')
      const fileId = `dynamic-frame-${index}-${frameIndex}`, relativePath = `observation/dynamic/${index}/frame-${frameIndex}.png`
      files.push({ fileId, relativePath, role: 'image', mediaType: 'image/png', byteLength: decoded.length })
      resources.push({ path: relativePath, content, encoding: 'base64', role: 'image', mediaType: 'image/png' })
      return { ...facts, source: 'candidate-host-before-commit', fileId, path: `resources/${relativePath}` }
    }) }
  })
  const relativePath = 'observation/dynamic/behavior.json'
  const content = JSON.stringify({ source: 'actual-candidate-host', semanticVerdict: 'requires-review',
    imageFeedback: committed ? evidence.some(item => item.buttonClick)
      ? 'current-formal-host-with-explicit-candidate-input-evidence' : 'current-formal-host-only' : 'candidate-host-frames',
    committedCandidate: committed ? { requestId: committed.requestId, candidateId: committed.candidateId,
      beforeRevision: committed.beforeRevision, afterRevision: committed.afterRevision } : null,
    instruction: committed
      ? '这些是提交前候选检查的生命周期与公开状态诊断，不代表最终布局、裁剪或速度。buttonClick包含独立候选宿主的一次实际鼠标输入及约500ms后文本/帧，可直接核对按钮修复；没有点击教师live session。无变化不能否定超过该窗口的异步结果。最终布局与速度仍看正式宿主current-frame/motion，不把observed当语义通过。'
      : '这些是尚未正式提交的候选检查期间真实宿主的连续帧和公开状态；可用于失败诊断与纠错，不能当作正式工程。请结合 sourceIdentities 检查动画、暂停和恢复效果，不把 observed 当作已达到用户要求。',
    observations: metadata })
  files.push({ fileId: 'dynamic-behavior', relativePath, role: 'runtime-evidence', mediaType: 'application/json', byteLength: new TextEncoder().encode(content).byteLength })
  resources.push({ path: relativePath, content, encoding: 'utf8', role: 'runtime-evidence', mediaType: 'application/json' })
  const context = request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context : {}
  return generationRequestSchema.parse({ ...request, observation: { ...request.observation, files }, resourceFiles: resources,
    context: { ...context, behaviorEvidence: { path: `resources/${relativePath}`, observations: metadata.length, semanticVerdict: 'requires-review',
      buttonClicks: evidence.flatMap(item => item.buttonClick ? [{ ...item.buttonClick,
        source: 'candidate-host-before-commit', beforeText: item.buttonClick.beforeText.slice(0, 2000), afterText: item.buttonClick.afterText.slice(0, 2000),
        textTruncated: item.buttonClick.textTruncated || item.buttonClick.beforeText.length > 2000 || item.buttonClick.afterText.length > 2000 }] : []) } } })
}
