import { createHash } from 'node:crypto'
import type { ModelChatMessage, ModelJsonObject } from '../../../shared/workbench/modelProvider'
import { imageDerivativePlan, imageDerivativeTraits } from '../../../shared/imageDerivative'
import { getImageDecoder } from '../imageDecoder'
import { diagnosticLog } from '../../diagnosticLog'

interface ImagePart {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}
interface OriginalPosition { sourceId: string; imageIndex: number }
export interface ModelImageFacts {
  /** Identifies these derived pixels; it is not a new file or a read authority. */
  resourceId: string
  mimeType: string
  width: number
  height: number
  byteLength: number
  original: { digest: string; mimeType: string; width: number; height: number; byteLength: number }
}
interface ProjectedImage { image: ImagePart; facts: ModelImageFacts }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const isImage = (part: unknown): part is ImagePart => !!part && typeof part === 'object'
  && (part as { type?: unknown }).type === 'image_url' && typeof (part as ImagePart).image_url?.url === 'string'

/** A disposable model-window projection of already authorized, host-retained
 * image bytes. It owns no originals, filesystem grants or persistent resources.
 * Keeping the journal intact is what makes context.read restore exact originals
 * after a stop/restart, when a live observation resource may no longer exist. */
export class ExecutionModelImageProjection {
  private readonly cache = new WeakMap<object, { url: string; value: Promise<ProjectedImage | null> }>()
  private positions = new WeakMap<object, OriginalPosition>()
  private originals?: readonly ModelChatMessage[]
  private indexed = 0
  constructor(private readonly options: {
    prepare?(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<ProjectedImage | null>
    onFailure?(error: unknown): void | Promise<void>
  } = {}) {}

  async project(messages: readonly ModelChatMessage[], input: {
    runId: string
    originals: readonly ModelChatMessage[]
    signal?: AbortSignal
    /** Explicit context.read/imageIndexes messages bypass compression this round. */
    originalMessages?: ReadonlySet<ModelChatMessage>
  }): Promise<ModelChatMessage[]> {
    input.signal?.throwIfAborted()
    if (input.originals !== this.originals || this.indexed > input.originals.length) {
      this.originals = input.originals; this.indexed = 0; this.positions = new WeakMap()
    }
    for (; this.indexed < input.originals.length; this.indexed++) {
      const message = input.originals[this.indexed]
      if (!Array.isArray(message?.content)) continue
      let imageIndex = 0
      for (const part of message.content) if (isImage(part)) {
        this.positions.set(part.image_url, { sourceId: `run:${input.runId}:${this.indexed}`, imageIndex: imageIndex++ })
      }
    }
    const result: ModelChatMessage[] = []
    for (const message of messages) {
      input.signal?.throwIfAborted()
      if (!Array.isArray(message.content) || input.originalMessages?.has(message)) { result.push(message); continue }
      let changed = false
      const content: ModelJsonObject[] = []
      for (const part of message.content) {
        input.signal?.throwIfAborted()
        // high is the existing full-detail request. image.preview original and
        // context.read explicitly select it; do not shrink a requested detail.
        if (!isImage(part) || part.image_url.detail === 'high') { content.push(part as ModelJsonObject); continue }
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url.url)
        if (!match) { content.push(part as ModelJsonObject); continue }
        let cached = this.cache.get(part.image_url)
        if (!cached || cached.url !== part.image_url.url) {
          const value = (this.options.prepare ?? prepareModelImage)(Buffer.from(match[2]!, 'base64'), match[1]!, input.signal).catch(async error => {
            input.signal?.throwIfAborted()
            if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error
            // This is optional transport preparation, not a new image-admission
            // gate. Its failure must keep the previous original-byte path usable.
            try {
              if (this.options.onFailure) await this.options.onFailure(error)
              else await diagnosticLog.append({ source: 'main', message: '模型观察图派生未完成，保留原图',
                details: { code: 'model-image-projection-failed', reason: error instanceof Error ? error.message : String(error) } })
            } catch { /* A diagnostic failure cannot replace the original. */ }
            input.signal?.throwIfAborted()
            return null
          })
          cached = { url: part.image_url.url, value }
          this.cache.set(part.image_url, cached)
          void value.catch(() => { if (this.cache.get(part.image_url)?.value === value) this.cache.delete(part.image_url) })
        }
        const projected = await cached.value
        input.signal?.throwIfAborted()
        if (!projected) { content.push(part as ModelJsonObject); continue }
        const position = this.positions.get(part.image_url)
        const represented: ModelJsonObject[] = [{ type: 'text', text: '模型观察图的表示信息（上一回执仍描述原图；不改变捕获身份、元素句柄或权限）：'
          + JSON.stringify({ ...projected.facts, ...(position ? { originalRead: { sourceId: position.sourceId, imageIndexes: [position.imageIndex] } } : {}),
            notice: '需要小字或图示细节时显式回读原图；以下图片对应本表示的尺寸、类型和字节长度。' }) },
          { ...projected.image, image_url: { ...projected.image.image_url,
            ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) } } as unknown as ModelJsonObject]
        // Count the complete transport representation, including its mandatory
        // metadata/read address. Re-encoding a compact original can otherwise
        // save a few image bytes while making the actual request larger.
        if (Buffer.byteLength(JSON.stringify(represented)) >= Buffer.byteLength(JSON.stringify([part]))) {
          content.push(part as ModelJsonObject); continue
        }
        content.push(...represented)
        changed = true
      }
      result.push(changed ? { ...message, content } : message)
    }
    return result
  }
}

/** Uses the app's existing lazy native decoder and derivative sizing rule.
 * Unclassified text/diagrams retain a lossless carrier; no photo classifier or
 * paid request is involved. Animated/vector originals keep their semantics. */
async function prepareModelImage(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<ProjectedImage | null> {
  signal?.throwIfAborted()
  const traits = imageDerivativeTraits(bytes, mimeType)
  if (traits.animated || mimeType === 'image/svg+xml') return null
  const decoder = getImageDecoder()
  const original = Buffer.from(bytes), metadata = await decoder(original, { failOn: 'error' }).metadata()
  signal?.throwIfAborted()
  const actual = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
    heif: 'image/heif', tiff: 'image/tiff' } as Record<string, string>)[metadata.format ?? '']
  if (!actual || actual !== mimeType || !metadata.width || !metadata.height)
    throw new Error('模型观察图的实际格式或尺寸与原资源不一致')
  if ((metadata.pages ?? 1) > 1) return null
  const swapped = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8
  const size = { width: swapped ? metadata.height : metadata.width, height: swapped ? metadata.width : metadata.height }
  const plan = imageDerivativePlan(size, mimeType, traits, { width: 2048, height: 2048, dpr: 1, fit: 'contain', quality: 'detail' })
  const output = await decoder(original, { failOn: 'error' }).rotate()
    .resize({ width: plan.width, height: plan.height, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
  signal?.throwIfAborted()
  // Do not enlarge a compact, correctly oriented source just to rename it.
  if (!plan.resized && (!metadata.orientation || metadata.orientation === 1)
    && (mimeType === 'image/png' || mimeType === 'image/jpeg') && output.data.byteLength >= bytes.byteLength) return null
  const facts: ModelImageFacts = { resourceId: `model-image:${hash(output.data)}`, mimeType: 'image/png',
    width: output.info.width, height: output.info.height, byteLength: output.data.byteLength,
    original: { digest: `sha256:${hash(bytes)}`, mimeType, width: size.width, height: size.height, byteLength: bytes.byteLength } }
  return { image: { type: 'image_url', image_url: { url: `data:${facts.mimeType};base64,${output.data.toString('base64')}` } }, facts }
}
