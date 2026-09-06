import { generationRequestSchema, type GenerationCandidate, type GenerationRequest } from '../../../shared/generationContract'

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, ordered(entry)]))
  return value
}

/** IDs and summary edits alone are not progress toward passing the same gate. */
export function generationRepairMadeProgress(before: GenerationCandidate, after: GenerationCandidate) {
  const normalize = (candidate: GenerationCandidate) => {
    const ids = new Map(candidate.steps.map((step, index) => [step.id, index]))
    const input = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(input)
      if (!value || typeof value !== 'object') return value
      if ('$result' in value) {
        const reference = value.$result as { stepId: string }
        return { $result: { ...reference, stepId: ids.get(reference.stepId) } }
      }
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, input(entry)]))
    }
    return candidate.steps.map((step, index) => ({ ...step, id: index,
      destination: 'stepId' in step.destination ? { ...step.destination, stepId: ids.get(step.destination.stepId) } : step.destination,
      input: input(step.input), lowerCarrierReason: undefined }))
  }
  return JSON.stringify(ordered(normalize(before))) !== JSON.stringify(ordered(normalize(after)))
}

export function captureGenerationRepair(request: GenerationRequest, candidate: GenerationCandidate, finding: string): GenerationRequest {
  return generationRequestSchema.parse({ ...structuredClone(request), requestId: crypto.randomUUID(),
    context: { ...(request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context : { snapshot: request.context }), repair: { budget: 1, previousRequestId: request.requestId,
      candidate, finding: finding.slice(0, 4000),
      instruction: '只修复此候选的已报告问题，保持原任务、范围和不可变工程基线。仍须通过同一宿主检查；不要宣称已修改工程。' } } })
}
