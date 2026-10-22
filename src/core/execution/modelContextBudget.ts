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

interface JsonTokenMeasure { ascii: number; nonAscii: number; images: number }
/** Run-owned accepted scalars only. Candidate wrappers are measured and discarded.
 * The adapters still serialize their one real wire body; this avoids parsing and
 * re-encoding that complete wire merely to estimate its language/image cost. */
export class PreparedPayloadTokenEstimator {
  private readonly accepted = new WeakSet<object>()
  private readonly scalars = new Map<string, JsonTokenMeasure | undefined>()
  private readonly base64 = new Map<string, boolean>()

  retain(value: unknown): void {
    if (typeof value === 'string') {
      if (this.scalars.has(value)) return
      this.scalars.set(value, undefined)
      const image = /^data:image\/(?:png|jpeg|webp|gif);base64,([\s\S]+)$/.exec(value)
      if (image && !this.scalars.has(image[1]!)) this.scalars.set(image[1]!, undefined)
    } else if (value && typeof value === 'object' && !this.accepted.has(value)) {
      this.accepted.add(value)
      for (const child of Object.values(value)) this.retain(child)
    }
  }

  estimate(value: unknown): number {
    const total: JsonTokenMeasure = { ascii: 0, nonAscii: 0, images: 0 }
    const text = (value: string) => {
      let measured = this.scalars.get(value)
      if (!measured) {
        let images = 0
        const encoded = JSON.stringify(value).replace(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+/g,
          () => { images++; return '[host-image]' })
        let nonAscii = 0
        for (let index = 0; index < encoded.length; index++) if (encoded.charCodeAt(index) > 127) nonAscii++
        measured = { ascii: encoded.length - nonAscii, nonAscii, images }
        if (this.scalars.has(value)) this.scalars.set(value, measured)
      }
      total.ascii += measured.ascii; total.nonAscii += measured.nonAscii; total.images += measured.images
    }
    const validBase64 = (value: string) => {
      const previous = this.base64.get(value)
      if (previous !== undefined) return previous
      const valid = /^[A-Za-z0-9+/=]+$/.test(value)
      if (this.scalars.has(value)) this.base64.set(value, valid)
      return valid
    }
    const visit = (item: unknown, substitutedData = false): void => {
      if (item === null || item === undefined || typeof item === 'number' && !Number.isFinite(item)) { total.ascii += 4; return }
      if (typeof item === 'string') { text(item); return }
      if (typeof item === 'number' || typeof item === 'boolean') { total.ascii += String(item).length; return }
      if (Array.isArray(item)) {
        total.ascii += 2 + Math.max(0, item.length - 1)
        for (let index = 0; index < item.length; index++) visit(item[index])
        return
      }
      // This entry accepts adapter-built JSON values, not arbitrary serializers
      // or objects with toJSON/getters. Those keep estimateSerializedTokens.
      const object = item as Record<string, unknown>
      const source = object.source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined
      const typedImage = object.type === 'image' && source?.type === 'base64' && typeof source.media_type === 'string'
        && /^image\/(png|jpeg|webp|gif)$/.test(source.media_type) && typeof source.data === 'string' && validBase64(source.data)
      if (typedImage) total.images++
      total.ascii += 2
      let count = 0
      for (const [key, value] of Object.entries(object)) {
        if (value === undefined) continue
        if (count++) total.ascii++
        text(key); total.ascii++
        if (substitutedData && key === 'data') text('[host-image]')
        else visit(value, typedImage && key === 'source')
      }
    }
    visit(value)
    return Math.ceil(total.ascii / 3 + total.nonAscii * 1.5) + total.images * 2048
  }
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
