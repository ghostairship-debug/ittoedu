import { createHash } from 'node:crypto'
import type { HostImageInput } from '../../../core/tools/imageResource'
import type { ImageGenerationRequest, ImageJobTimingMark } from '../../../shared/workbench/images'
import type { ModelConnectionSnapshot, ModelFailure, ModelJsonObject } from '../../../shared/workbench/modelProvider'
import { prepareImageResource } from '../admittedImageResource'
import { httpFailureKind } from '../providers/providerHttpFailure'
import { decodeImageBase64, readBoundedImageJson } from './imageResponse'
import type { ImageProviderPort, ImageProviderReference, ImageProviderResult, ImageProviderRunOptions } from './ImageProviderPort'
import { imageProvenance, imageRoute } from './imageRoute'

export interface OpenAIImagesApiProviderOptions {
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  now?: () => number
}
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

/** OpenAI-compatible Images API selected by an explicit, frozen connection opt-in. */
export class OpenAIImagesApiProvider implements ImageProviderPort {
  constructor(private readonly options: OpenAIImagesApiProviderOptions) {}
  async generate(input: ImageGenerationRequest, inputReferences: readonly ImageProviderReference[], options: ImageProviderRunOptions = {}): Promise<ImageProviderResult> {
    const request = structuredClone(input), references = inputReferences.map(ref => ({ ...ref, bytes: Uint8Array.from(ref.bytes) }))
    const provenance = imageProvenance(request, references), controller = new AbortController(), abort = () => controller.abort()
    const timing = (stage: Extract<ImageJobTimingMark['stage'], 'image.provider.prepared' | 'image.fetch.invoked' | 'image.response.headers'>,
      detail?: ImageJobTimingMark['detail']) => { try { options.onTiming?.(stage, detail) } catch { /* Diagnostics cannot change the request. */ } }
    let attempted = false, timedOut = false, phase: ModelFailure['kind'] = 'configuration', response: Response | undefined
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort()
    const timer = setTimeout(() => { timedOut = true; abort() }, this.options.timeoutMs ?? 300_000)
    try {
      const { connection, imageModel } = request.selection, output = request.output ?? {}
      if (imageRoute(request) !== 'openai-images-api' || !nonempty(imageModel)
        || !nonempty(connection.id) || !nonempty(connection.auth.credentialRef) || !Number.isSafeInteger(connection.revision)
        || connection.revision < 1 || !nonempty(request.prompt) || request.prompt.length > 200_000) throw new Error('invalid-image-request')
      if (request.operation === 'edit' ? references.length !== 1 : references.length !== 0) throw new Error('unsupported-image-reference-count')
      if ((request.referenceIds ?? []).length !== references.length
        || references.some((ref, index) => ref.referenceId !== request.referenceIds?.[index])) throw new Error('reference-identity-mismatch')
      if (request.selection.capabilities?.[request.operation] === 'unsupported') throw new Error(`unsupported-image-${request.operation}`)
      if (output.background === 'transparent' && request.selection.capabilities?.transparent === 'unsupported') throw new Error('unsupported-image-transparent')
      if (output.size && output.size !== 'auto' && !/^\d{2,5}x\d{2,5}$/.test(output.size)) throw new Error('invalid-image-size')
      if (Object.keys(output).some(key => !['size', 'quality', 'format', 'background'].includes(key))
        || output.format && output.format !== 'png' || output.quality && !['auto', 'low', 'medium', 'high'].includes(output.quality)
        || output.background && !['auto', 'opaque', 'transparent'].includes(output.background)) throw new Error('unsupported-image-option')
      for (const ref of references) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(ref.mimeType)) throw new Error('unsupported-reference-format')
        await prepareImageResource(ref, () => 'reference')
      }
      const fields = { model: imageModel, prompt: request.prompt,
        ...(output.size ? { size: output.size } : {}), ...(output.quality ? { quality: output.quality } : {}),
        ...(output.background ? { background: output.background } : {}), ...(output.format ? { output_format: output.format } : {}) }
      let body: Buffer, contentType: string
      if (request.operation === 'edit') {
        const form = new FormData(), ref = references[0]!
        for (const [key, value] of Object.entries(fields)) form.append(key, value)
        form.append('image', new Blob([Buffer.from(ref.bytes)], { type: ref.mimeType }), ref.filename || 'reference.png')
        // Serialize once. A second FormData encoding would choose a new boundary,
        // so its bytes would no longer match the persisted request digest.
        const encoded = new Request(provenance.endpoint, { method: 'POST', body: form })
        contentType = encoded.headers.get('content-type') ?? ''
        if (!contentType.startsWith('multipart/form-data; boundary=')) throw new Error('invalid-image-multipart')
        body = Buffer.from(await encoded.arrayBuffer())
      } else {
        body = Buffer.from(JSON.stringify(fields))
        contentType = 'application/json'
      }
      provenance.requestBytes = body.byteLength; provenance.requestDigest = digest(body)
      if (provenance.requestBytes > 96 * 1024 * 1024) throw new Error('image-request-too-large')
      timing('image.provider.prepared', { referenceCount: references.length, requestBytes: provenance.requestBytes })
      phase = 'auth'
      const credential = await this.options.credentialResolver(connection)
      if (!credential || /[\r\n]/.test(credential)) throw new Error('invalid-image-credential')
      controller.signal.throwIfAborted(); phase = 'transport'; attempted = true
      timing('image.fetch.invoked', { requestBytes: provenance.requestBytes })
      response = await (this.options.fetch ?? fetch)(provenance.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json', 'Content-Type': contentType }, body: Uint8Array.from(body) })
      timing('image.response.headers', { httpStatus: response.status })
      const providerRequestId = response.headers.get('x-request-id')
      if (providerRequestId && !providerRequestId.includes(credential) && /^[A-Za-z0-9_.:-]{1,200}$/.test(providerRequestId)) provenance.providerRequestId = providerRequestId
      if (!response.ok) {
        const status = response.status, retry = response.headers.get('retry-after'), kind = await httpFailureKind(response)
        const retryMs = retry ? /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - (this.options.now ?? Date.now)() : undefined
        return { status: 'failed', provenance, failure: { outcome: status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown',
          kind, code: `image-http-${status}`, message: `图片请求返回 HTTP ${status}；未重试或切换收费路径。`, httpStatus: status,
          ...(retryMs !== undefined && Number.isFinite(retryMs) ? { retryAfterMs: Math.max(0, Math.ceil(retryMs)) } : {}) } }
      }
      phase = 'protocol'
      const payload = await readBoundedImageJson(response, this.options.maxResponseBytes ?? 96 * 1024 * 1024)
      const safeLabel = (value: unknown): string => {
        if (!nonempty(value) || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value) || value.includes(credential)) throw new Error('invalid-image-provenance')
        return value
      }
      if (payload.id != null) provenance.providerResponseId = safeLabel(payload.id)
      if (payload.model != null) provenance.actualImageModels = [safeLabel(payload.model)]
      if (payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)) {
        if (JSON.stringify(payload.usage).includes(credential)) throw new Error('invalid-image-provenance')
        provenance.usage = structuredClone(payload.usage as ModelJsonObject)
      }
      const resolvedOutput: NonNullable<typeof provenance.resolvedOutput> = {}
      for (const key of ['size', 'quality', 'background', 'output_format'] as const) if (payload[key] != null) {
        const value = safeLabel(payload[key])
        if (key === 'output_format') resolvedOutput.format = value
        else resolvedOutput[key] = value
      }
      if (Object.keys(resolvedOutput).length) provenance.resolvedOutput = resolvedOutput
      const images: HostImageInput[] = [], warnings = new Set<'size-differs' | 'format-differs'>()
      const imageData = payload.data as ModelJsonObject[]
      for (const [index, item] of imageData.entries()) {
        const decoded = decodeImageBase64(item.b64_json)
        const image: HostImageInput = { bytes: decoded.bytes, mimeType: decoded.mimeType, filename: `generated-${index + 1}.${decoded.extension}` }
        const admitted = await prepareImageResource(image, () => `generated_${index}`)
        if (output.format && decoded.mimeType !== `image/${output.format}`) warnings.add('format-differs')
        if (output.size && output.size !== 'auto' && output.size !== `${admitted.meta.width}x${admitted.meta.height}`) warnings.add('size-differs')
        if (item.model != null) provenance.actualImageModels = [...new Set([...(provenance.actualImageModels ?? []), safeLabel(item.model)])]
        if (item.generation_id != null && !provenance.providerResponseId && imageData.length === 1) provenance.providerResponseId = safeLabel(item.generation_id)
        images.push(image)
      }
      if (warnings.size) provenance.outputWarnings = [...warnings]
      return { status: 'completed', images, provenance }
    } catch (error) {
      const kind = controller.signal.aborted ? timedOut ? 'timeout' : 'aborted' : phase
      const code = !attempted && phase === 'configuration' && error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : undefined
      return { status: 'failed', provenance, failure: { outcome: attempted ? 'unknown' : 'not-sent', kind,
        code: code ? `image-${code}` : `image-${kind}`,
        message: attempted ? '图片请求未取得可用的完整结果，状态未知；未自动重试。' : '图片请求未发送，请检查所选连接、参数与参考图。' } }
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
