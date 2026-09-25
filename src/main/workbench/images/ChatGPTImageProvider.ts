import { createHash } from 'node:crypto'
import type { HostImageInput } from '../../../core/tools/imageResource'
import type { ImageGenerationRequest, ImageJobTimingMark, ImageRequestProvenance } from '../../../shared/workbench/images'
import type { ModelConnectionSnapshot, ModelFailure, ModelJsonObject } from '../../../shared/workbench/modelProvider'
import { CHATGPT_RESPONSES_BASE_URL } from '../providers/ChatGPTResponsesProvider'
import { httpFailureKind } from '../providers/providerHttpFailure'
import { prepareImageResource } from '../admittedImageResource'
import { imageProvenance } from './imageRoute'
import { decodeImageBase64, readBoundedImageJson } from './imageResponse'
import type { ImageProviderPort, ImageProviderReference, ImageProviderResult, ImageProviderRunOptions, ImageProviderTimingStage } from './ImageProviderPort'
export type { ImageProviderPort, ImageProviderReference, ImageProviderResult, ImageProviderRunOptions, ImageProviderTimingStage } from './ImageProviderPort'

export interface ChatGPTImageProviderOptions {
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<{ accessToken: string; accountId: string }>
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  now?: () => number
}
const object = (v: unknown): v is ModelJsonObject => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export { imageProvenance } from './imageRoute'
export function serializeChatGPTImageRequest(request: ImageGenerationRequest, references: readonly ImageProviderReference[]): string {
  const { connection, imageModel, capabilities } = request.selection, output = request.output ?? {}
  if (connection.protocol !== 'chatgpt-responses' || connection.auth.kind !== 'oauth' || connection.baseURL !== CHATGPT_RESPONSES_BASE_URL
    || !nonempty(connection.id) || !nonempty(connection.auth.credentialRef) || !Number.isSafeInteger(connection.revision) || connection.revision < 1
    || !nonempty(connection.accountId) || !nonempty(imageModel) || !nonempty(request.prompt)
    || request.prompt.length > 200_000 || !['generate', 'edit'].includes(request.operation)) throw new Error('invalid-image-request')
  if (request.operation === 'edit' ? references.length < 1 : references.length !== 0) throw new Error('invalid-edit-references')
  if ((request.referenceIds ?? []).length !== references.length || references.some((ref, index) => ref.referenceId !== request.referenceIds?.[index])) throw new Error('reference-identity-mismatch')
  if (references.length > 5) throw new Error('unsupported-image-reference-count')
  if (capabilities?.[request.operation] === 'unsupported') throw new Error(`unsupported-image-${request.operation}`)
  if (references.length > 1 && capabilities?.multipleReferences === 'unsupported') throw new Error('unsupported-image-multiple-references')
  if (output.background === 'transparent' && capabilities?.transparent === 'unsupported') throw new Error('unsupported-image-transparent')
  if (output.size && output.size !== 'auto' && !/^\d{2,5}x\d{2,5}$/.test(output.size)) throw new Error('invalid-image-size')
  if (Object.keys(output).some(key => !['size', 'quality', 'format', 'background', 'moderation'].includes(key))) throw new Error('unsupported-image-option')
  if (output.format && output.format !== 'png' || output.moderation !== undefined
    || output.quality && !['auto', 'low', 'medium', 'high'].includes(output.quality)
    || output.background && !['auto', 'opaque', 'transparent'].includes(output.background)) throw new Error('unsupported-image-option')
  return JSON.stringify({ model: imageModel, prompt: request.prompt,
    ...(request.operation === 'edit' ? { images: references.map(ref => ({ image_url: `data:${ref.mimeType};base64,${Buffer.from(ref.bytes).toString('base64')}` })) } : {}),
    ...(output.size ? { size: output.size } : {}), ...(output.quality ? { quality: output.quality } : {}),
    ...(output.background ? { background: output.background } : {}) })
}

/** One direct Codex Images request, pinned OAuth account and image model. No retry or alternate billing route. */
export class ChatGPTImageProvider implements ImageProviderPort {
  constructor(private readonly options: ChatGPTImageProviderOptions) {}
  async generate(input: ImageGenerationRequest, inputReferences: readonly ImageProviderReference[], options: ImageProviderRunOptions = {}): Promise<ImageProviderResult> {
    const request = structuredClone(input), references = inputReferences.map(ref => ({ ...ref, bytes: Uint8Array.from(ref.bytes) }))
    const provenance = imageProvenance(request, references), controller = new AbortController(), abort = () => controller.abort()
    const timing = (stage: ImageProviderTimingStage, detail?: ImageJobTimingMark['detail']) => {
      try { options.onTiming?.(stage, detail) } catch { /* Diagnostics cannot alter the image request. */ }
    }
    let attempted = false, timedOut = false, phase: ModelFailure['kind'] = 'configuration', response: Response | undefined
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort()
    const timer = setTimeout(() => { timedOut = true; abort() }, this.options.timeoutMs ?? 180_000)
    try {
      const body = serializeChatGPTImageRequest(request, references)
      provenance.requestBytes = Buffer.byteLength(body); provenance.requestDigest = digest(body)
      if (provenance.requestBytes > 96 * 1024 * 1024) throw new Error('image-request-too-large')
      for (const ref of references) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(ref.mimeType)) throw new Error('unsupported-reference-format')
        await prepareImageResource(ref, () => 'reference')
      }
      timing('image.provider.prepared', { referenceCount: references.length, requestBytes: provenance.requestBytes })
      phase = 'auth'
      const credential = await this.options.credentialResolver(request.selection.connection)
      if (credential.accountId !== request.selection.connection.accountId || !credential.accessToken || /[\r\n]/.test(credential.accessToken + credential.accountId)) throw new Error('account-mismatch')
      controller.signal.throwIfAborted(); phase = 'transport'; attempted = true
      // fetch invocation is observed here; it does not prove that bytes reached the server.
      timing('image.fetch.invoked', { requestBytes: provenance.requestBytes })
      response = await (this.options.fetch ?? fetch)(provenance.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${credential.accessToken}`, 'chatgpt-account-id': credential.accountId, 'Content-Type': 'application/json',
          Accept: 'application/json', ...(/^[A-Za-z0-9_.:-]{1,200}$/.test(request.runId) ? { 'x-codex-image-turn-id': request.runId } : {}) }, body })
      timing('image.response.headers', { httpStatus: response.status })
      const providerRequestId = response.headers.get('x-request-id')
      if (providerRequestId && !providerRequestId.includes(credential.accessToken) && /^[A-Za-z0-9_.:-]{1,200}$/.test(providerRequestId)) provenance.providerRequestId = providerRequestId
      if (!response.ok) {
        const status = response.status, retry = response.headers.get('retry-after'), kind = await httpFailureKind(response)
        const retryMs = retry ? /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - (this.options.now ?? Date.now)() : undefined
        return { status: 'failed', provenance, failure: { outcome: status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown',
          kind, code: `image-http-${status}`,
          message: `图片请求返回 HTTP ${status}；未重试或切换收费路径。`, httpStatus: status,
          ...(retryMs !== undefined && Number.isFinite(retryMs) ? { retryAfterMs: Math.max(0, Math.ceil(retryMs)) } : {}) } }
      }
      phase = 'protocol'
      const payload = await readBoundedImageJson(response, this.options.maxResponseBytes ?? 96 * 1024 * 1024)
      const safeLabel = (value: unknown): string => {
        if (!nonempty(value) || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value) || value.includes(credential.accessToken)) throw new Error('invalid-image-provenance')
        return value
      }
      if (payload.id != null) provenance.providerResponseId = safeLabel(payload.id)
      const actualModels = new Set<string>()
      if (payload.model != null) actualModels.add(safeLabel(payload.model))
      if (object(payload.usage)) {
        if (JSON.stringify(payload.usage).includes(credential.accessToken)) throw new Error('invalid-image-provenance')
        provenance.usage = structuredClone(payload.usage)
      }
      const resolvedOutput: NonNullable<ImageRequestProvenance['resolvedOutput']> = {}
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
        const image: HostImageInput = { bytes: decoded.bytes, mimeType: decoded.mimeType, filename: 'generated-' + (index + 1) + '.' + decoded.extension }
        const admitted = await prepareImageResource(image, () => 'generated_' + index)
        if (request.output?.format && decoded.mimeType !== 'image/' + request.output.format) warnings.add('format-differs')
        if (request.output?.size && request.output.size !== 'auto'
          && request.output.size !== admitted.meta.width + 'x' + admitted.meta.height) warnings.add('size-differs')
        if (item.model != null) actualModels.add(safeLabel(item.model))
        if (item.generation_id != null && !provenance.providerResponseId && imageData.length === 1) provenance.providerResponseId = safeLabel(item.generation_id)
        images.push(image)
      }
      if (actualModels.size) provenance.actualImageModels = [...actualModels]
      if (warnings.size) provenance.outputWarnings = [...warnings]
      return { status: 'completed', images, provenance }
    } catch (error) {
      const kind = controller.signal.aborted ? timedOut ? 'timeout' : 'aborted' : phase
      const preflightMessages: Record<string, string> = {
        'unsupported-image-generate': '当前图片配置标记为不支持生成；请求未发送。',
        'unsupported-image-edit': '当前图片配置标记为不支持编辑；请求未发送。',
        'unsupported-image-multiple-references': '当前图片配置标记为不支持多张参考图；请求未发送。',
        'unsupported-image-transparent': '当前图片配置标记为不支持透明背景；请求未发送。',
        'unsupported-image-reference-count': '当前图片接口最多接受五张参考图；请求未发送。',
        'unsupported-image-option': '当前图片接口不支持所选输出参数；请求未发送。',
        'invalid-image-size': '图片尺寸参数无效；请求未发送。',
      }
      const preflightCode = !attempted && phase === 'configuration' && error instanceof Error
        && Object.hasOwn(preflightMessages, error.message) ? error.message : undefined
      return { status: 'failed', provenance, failure: { outcome: attempted ? 'unknown' : 'not-sent', kind,
        code: preflightCode ? `image-${preflightCode}` : `image-${kind}`,
        message: preflightCode ? preflightMessages[preflightCode]! : attempted ? '图片请求未取得可用的完整结果，状态未知；未自动重试。' : '图片请求未发送，请检查所选连接、参数与参考图。' } }
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
