import { z } from 'zod'
import { generationCandidateSchema, expandGenerationShortCandidate, generationFailureSchema, generationFailureDiagnostics, type GenerationCandidate, type GenerationRequest } from './generationContract'

export const GENERATION_OPEN = '<courseware-candidate-v1>'
export const GENERATION_CLOSE = '</courseware-candidate-v1>'
export const MAX_GENERATION_RESULT_BYTES = 8 * 1024 * 1024
export const GENERATION_RESULT_OPEN = '<courseware-result-v1>'
export const GENERATION_RESULT_CLOSE = '</courseware-result-v1>'
const terminalResultSchema = z.object({ version: z.literal(1), requestId: z.uuid(), kind: z.enum(['answer', 'edit']) }).strict()
export const generationStagedCandidateReferenceSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), candidateFile: z.literal('candidate.json'),
}).strict()
export const generationStagedCandidateMarker = (requestId: string): string =>
  `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId, kind: 'edit' })}${GENERATION_RESULT_CLOSE}`
export const generationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), requestId: z.uuid() }).strict(),
  z.object({ kind: z.literal('incomplete'), requestId: z.uuid(), finding: z.string().max(4000), failure: generationFailureSchema.optional() }).strict(),
  z.object({ kind: z.literal('candidate'), requestId: z.uuid(), candidate: generationCandidateSchema }).strict(),
  z.object({ kind: z.literal('candidate-rejected'), requestId: z.uuid(), candidateId: z.uuid(), finding: z.string().max(4000), failure: generationFailureSchema.optional() }).strict(),
  z.object({ kind: z.literal('candidate-format-error'), requestId: z.uuid(), finding: z.string().max(4000), excerpt: z.string().max(8000), failure: generationFailureSchema.optional() }).strict(),
])
export type GenerationResult = z.infer<typeof generationResultSchema>
export type GenerationFormatError = Extract<GenerationResult, { kind: 'candidate-format-error' }>
export interface GenerationCandidateParseOptions { candidateId: string }
type ResultRequest = Pick<GenerationRequest, 'requestId' | 'expectedResult'> | GenerationRequest

/** The bounded failure remains tied to the original request; it is never a fake candidate. */
export function readGenerationResult(text: string, request: ResultRequest, options?: GenerationCandidateParseOptions): GenerationResult {
  const { requestId } = request
  try {
    const candidate = parseGenerationText(text, request, options)
    if (candidate) return { kind: 'candidate', requestId, candidate }
    let required = request.expectedResult === 'candidate'
    const start = text.indexOf(GENERATION_RESULT_OPEN)
    if (start >= 0) {
      const end = text.indexOf(GENERATION_RESULT_CLOSE, start + GENERATION_RESULT_OPEN.length)
      if (end < 0 || text.indexOf(GENERATION_RESULT_OPEN, start + GENERATION_RESULT_OPEN.length) >= 0
        || text.indexOf(GENERATION_RESULT_CLOSE, end + GENERATION_RESULT_CLOSE.length) >= 0) throw new Error('终结结果通道不完整或重复')
      const result = terminalResultSchema.parse(JSON.parse(text.slice(start + GENERATION_RESULT_OPEN.length, end)))
      if (result.requestId !== requestId) throw new Error('终结结果属于其他请求')
      required ||= result.kind === 'edit'
    }
    if (required) throw new Error('本轮要求修改候选，但缺少 courseware-candidate-v1 通道')
    return { kind: 'answer', requestId }
  } catch (cause) {
    const start = Math.max(0, text.indexOf(GENERATION_OPEN))
    const candidateId = z.uuid().safeParse(options?.candidateId)
    return { kind: 'candidate-format-error', requestId,
      finding: (cause instanceof Error ? cause.message : String(cause)).slice(0, 4000),
      excerpt: text.slice(start, start + 8000), failure: { version: 1, stage: 'candidate-parse', requestId,
        ...(candidateId.success ? { candidateId: candidateId.data } : {}), diagnostics: generationFailureDiagnostics(cause, 'candidate-format'), assetIds: [], packageIds: [] } }
  }
}

/** Only the explicitly designated channel is authoritative; ordinary chat and tool logs are not candidates. */
export function parseGenerationText(text: string, request: string | ResultRequest, options?: GenerationCandidateParseOptions): GenerationCandidate | null {
  const start = text.indexOf(GENERATION_OPEN)
  if (start < 0) return null
  if (new TextEncoder().encode(text).byteLength > MAX_GENERATION_RESULT_BYTES) throw new Error('生成结果超过大小上限')
  const end = text.indexOf(GENERATION_CLOSE, start + GENERATION_OPEN.length)
  if (end < 0 || text.indexOf(GENERATION_OPEN, start + GENERATION_OPEN.length) >= 0 || text.indexOf(GENERATION_CLOSE, end + GENERATION_CLOSE.length) >= 0) throw new Error('生成结果通道不完整或重复')
  return parseGenerationCandidate(JSON.parse(text.slice(start + GENERATION_OPEN.length, end)), request, options)
}

export function parseGenerationCandidate(value: unknown, request: string | ResultRequest, options?: GenerationCandidateParseOptions): GenerationCandidate {
  value = normalizeGenerationCandidateTransport(value)
  const requestId = typeof request === 'string' ? request : request.requestId
  if (value && typeof value === 'object' && Reflect.get(value, 'version') === 2) {
    if (typeof request === 'string' || !('destinations' in request) || !options?.candidateId) throw new Error('短候选需要宿主冻结的完整请求与固定候选身份')
    return expandGenerationShortCandidate(value, request, options.candidateId)
  }
  const candidate = generationCandidateSchema.parse(value)
  if (candidate.requestId !== requestId) throw new Error('生成结果属于其他请求')
  return candidate
}

/** Decode only the documented tool-input projection, once, at every ingestion
 * boundary. Strings inside the input (including JavaScript) are never touched. */
export function normalizeGenerationCandidateTransport(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray(Reflect.get(value, 'steps'))) return value
  return { ...value, steps: Reflect.get(value, 'steps').map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const step = { ...raw } as Record<string, unknown>
    // Retire the old transport-only explanation; it is not part of a candidate.
    if (typeof step.lowerCarrierReason === 'string' || step.lowerCarrierReason === null) delete step.lowerCarrierReason
    if (typeof step.input === 'string') {
      try { step.input = JSON.parse(step.input) }
      catch { throw new z.ZodError([{ code: 'custom', path: ['steps', index, 'input'], message: '工具 input 必须是对象或一次有效 JSON 序列化' }]) }
      if (typeof step.input === 'string') throw new z.ZodError([{ code: 'custom', path: ['steps', index, 'input'], message: '工具 input 被重复序列化；请直接提供对象' }])
    }
    return step
  }) }
}
