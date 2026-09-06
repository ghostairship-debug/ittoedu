import { generationCandidateSchema, type GenerationCandidate } from './generationContract'

export const GENERATION_OPEN = '<courseware-candidate-v1>'
export const GENERATION_CLOSE = '</courseware-candidate-v1>'
export const MAX_GENERATION_RESULT_BYTES = 8 * 1024 * 1024

/** Only the explicitly designated channel is authoritative; ordinary chat and tool logs are not candidates. */
export function parseGenerationText(text: string, requestId: string): GenerationCandidate | null {
  const start = text.indexOf(GENERATION_OPEN)
  if (start < 0) return null
  if (new TextEncoder().encode(text).byteLength > MAX_GENERATION_RESULT_BYTES) throw new Error('生成结果超过大小上限')
  const end = text.indexOf(GENERATION_CLOSE, start + GENERATION_OPEN.length)
  if (end < 0 || text.indexOf(GENERATION_OPEN, start + GENERATION_OPEN.length) >= 0 || text.indexOf(GENERATION_CLOSE, end + GENERATION_CLOSE.length) >= 0) throw new Error('生成结果通道不完整或重复')
  return parseGenerationCandidate(JSON.parse(text.slice(start + GENERATION_OPEN.length, end)), requestId)
}

export function parseGenerationCandidate(value: unknown, requestId: string): GenerationCandidate {
  const candidate = generationCandidateSchema.parse(value)
  if (candidate.requestId !== requestId) throw new Error('生成结果属于其他请求')
  return candidate
}
