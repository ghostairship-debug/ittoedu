import type { ModelFailure, ModelSelection } from '../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../shared/workbench/modelRouting'

/** Host-side estimate, not an exact tokenizer or a claim about an unknown provider. */
export function estimateSerializedTokens(serialized: string): number {
  let images = 0
  const text = serialized.replace(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+/g, () => { images++; return '[host-image]' })
  let nonAscii = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) nonAscii++
  return Math.ceil((text.length - nonAscii) / 3 + nonAscii * 1.5) + images * 2048
}
export function modelContextBudget(selection: ModelSelection) {
  const configured = selection.contextWindow
  const window = Number.isSafeInteger(configured) && configured! > 0 ? configured! : null
  const native = selection.parameters
  const explicitOutput = [native?.max_output_tokens, native?.max_completion_tokens, native?.max_tokens]
    .find((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
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
