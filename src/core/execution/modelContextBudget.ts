import type { ModelFailure, ModelSelection } from '../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../shared/workbench/modelRouting'
import { modelOutputParameter } from '../../shared/workbench/modelOutputParameters'

/** Host-side estimate, not an exact tokenizer or a claim about an unknown provider. */
export function estimateSerializedTokens(serialized: string): number {
  let images = 0
  // Anthropic serializes image pixels as a typed source object instead of a
  // data URL. Count those images with the same estimate; ordinary data fields
  // and signed reasoning blocks remain text and are never reinterpreted.
  let typedImages = serialized
  try {
    typedImages = JSON.stringify(JSON.parse(serialized), (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const block = value as { type?: string; source?: { type?: string; media_type?: string; data?: string } }
        if (block.type === 'image' && block.source?.type === 'base64' && /^image\/(png|jpeg|webp|gif)$/.test(block.source.media_type ?? '')
          && typeof block.source.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(block.source.data)) {
          images++
          return { ...block, source: { ...block.source, data: '[host-image]' } }
        }
      }
      return value
    })
  } catch { /* Custom serializers still receive the plain text estimate. */ }
  const text = typedImages.replace(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+/g, () => { images++; return '[host-image]' })
  let nonAscii = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) nonAscii++
  return Math.ceil((text.length - nonAscii) / 3 + nonAscii * 1.5) + images * 2048
}
export function modelContextBudget(selection: ModelSelection) {
  const configured = selection.contextWindow
  const window = Number.isSafeInteger(configured) && configured! > 0 ? configured! : null
  const value = modelOutputParameter(effectiveModelProtocol(selection), selection.parameters)?.value
  const explicitOutput = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
  const protocolOutput = effectiveModelProtocol(selection) === 'anthropic-messages' ? selection.outputLimit : undefined
  // An unknown provider window is not a host-imposed task limit. Only declared
  // limits or an actual context rejection can cause context reduction.
  if (window === null) return { window, outputReserve: explicitOutput ?? protocolOutput ?? Infinity,
    inputTokens: Infinity, source: 'unknown' as const }
  const outputReserve = Math.min(Math.max(0, window - 512), explicitOutput ?? protocolOutput ?? Math.min(16_384, Math.ceil(window / 4)))
  return { window, outputReserve, inputTokens: Math.floor((window - outputReserve) * .9), source: 'configured' as const }
}
export function isContextLengthFailure(failure: ModelFailure): boolean {
  return failure.outcome === 'rejected' && /context[_ -]?(length|window)|maximum context|context.{0,35}(exceed|limit)|prompt.{0,20}too (long|large)|上下文.{0,12}(超出|超过)/i.test(failure.code + ' ' + failure.message)
}
