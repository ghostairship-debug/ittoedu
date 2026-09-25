import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { attachmentSnapshotSchema, attachmentRepresentationSchema, type AttachmentReader, type CompiledPayload, type InputContext, type PayloadBudget, type PayloadManifest, type PayloadSerializerInput } from '../../shared/workbench/attachments'
import type { ModelChatMessage, ModelJson, ModelSelection, ModelToolDefinition } from '../../shared/workbench/modelProvider'

const encoder = new TextEncoder()
const digest = (value: string | Uint8Array) => bytesToHex(sha256(typeof value === 'string' ? encoder.encode(value) : value))
const size = (value: string) => encoder.encode(value).length
export class PayloadCompileError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PayloadCompileError' }
}
function base64(bytes: Uint8Array): string {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(text)
}
function limit(actual: number, maximum: number | undefined, label: string) {
  if (maximum === undefined) return
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new PayloadCompileError('invalid-budget', `${label}预算无效`)
  if (actual > maximum) throw new PayloadCompileError('payload-too-large', `${label}超过发送预算（${actual} > ${maximum}），请减少附件或上下文`)
}

/** Builds one frozen initial payload; later tool reads are separate facts, never predicted here. */
export class PayloadCompiler {
  constructor(private readonly options: {
    attachments: AttachmentReader
    /** Must be the same serializer the selected Provider uses for its actual HTTP body. */
    serializePayload: (input: PayloadSerializerInput) => string
  }) {}

  async compile(request: { input: InputContext; selection: ModelSelection; tools: readonly ModelToolDefinition[]; budget: PayloadBudget }, options: { signal?: AbortSignal } = {}): Promise<CompiledPayload> {
    const { input, selection, tools, budget } = structuredClone(request)
    options.signal?.throwIfAborted()
    if (!Number.isSafeInteger(budget.maxSerializedBytes) || budget.maxSerializedBytes < 0) throw new PayloadCompileError('invalid-budget', '最终请求字节预算无效')
    if (!input.instruction && !input.attachments.length) throw new PayloadCompileError('empty-input', '请输入指令或添加附件')
    const messages: ModelChatMessage[] = input.context.map(item => item.message)
    const totals: PayloadManifest['totals'] = { serializedBytes: 0, originalBytes: 0, representationBytes: 0, imageBytes: 0, textCharacters: input.instruction.length, base64Characters: 0 }
    const automaticContext = input.context.map((item, messageIndex) => {
      const serialized = JSON.stringify(item.message)
      return { messageIndex, provenance: item.provenance, digest: digest(serialized), serializedBytes: size(serialized) }
    })
    const userIndex = messages.length, content: ModelJson[] = []
    if (input.instruction) content.push({ type: 'text', text: input.instruction })
    const explicitAttachments: PayloadManifest['explicitAttachments'] = []
    const originals = new Set<string>(); let pixels = 0
    for (const reference of input.attachments) {
      options.signal?.throwIfAborted()
      const read = await this.options.attachments.readRepresentation(reference.attachmentId, reference.representationId)
      const snapshot = attachmentSnapshotSchema.parse(read.snapshot), representation = attachmentRepresentationSchema.parse(read.representation), bytes = Uint8Array.from(read.bytes)
      if (snapshot.id !== reference.attachmentId || representation.id !== reference.representationId ||
          !snapshot.representations.some(item => JSON.stringify(item) === JSON.stringify(representation)) ||
          snapshot.digest !== snapshot.blobRef.digest || snapshot.byteLength !== snapshot.blobRef.byteLength ||
          representation.provenance.originalDigest !== snapshot.digest || representation.provenance.originalByteLength !== snapshot.byteLength ||
          representation.blobRef.byteLength !== bytes.length || representation.blobRef.digest !== digest(bytes)) {
        throw new PayloadCompileError('provenance-mismatch', '附件表示与来源记录不一致')
      }
      const contentIndex = content.length
      if (representation.kind === 'file') throw new PayloadCompileError('representation-unavailable', '附件原件尚未提取，请先选择页或全文提取后发送')
      if (representation.kind === 'image') {
        if (selection.connection.capabilities.vision === 'unsupported') throw new PayloadCompileError('vision-unavailable', '所选连接不支持图片输入')
        const encoded = base64(bytes)
        content.push({ type: 'image_url', image_url: { url: `data:${representation.mediaType};base64,${encoded}` } })
        totals.imageBytes += bytes.length; totals.base64Characters += encoded.length
        pixels += representation.width * representation.height
      } else {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
        if (text.length !== representation.characters) throw new PayloadCompileError('provenance-mismatch', '附件文本长度与来源记录不一致')
        // The model needs the source boundary, not only a second anonymous text part.
        // Quote the untrusted filename as data; provenance below still hashes the raw bytes.
        const labeledText = `附件名称：${JSON.stringify(snapshot.name)}\n附件正文开始\n${text}\n附件正文结束`
        content.push({ type: 'text', text: labeledText })
        totals.textCharacters += labeledText.length
      }
      if (!originals.has(snapshot.id)) { originals.add(snapshot.id); totals.originalBytes += snapshot.byteLength }
      totals.representationBytes += bytes.length
      explicitAttachments.push({ messageIndex: userIndex, contentIndex, attachmentId: snapshot.id, representationId: representation.id, name: snapshot.name,
        ...(reference.role ? { role: reference.role } : {}), originalDigest: snapshot.digest, representationDigest: representation.blobRef.digest, mediaType: representation.mediaType, provenance: representation.provenance })
    }
    options.signal?.throwIfAborted()
    messages.push({ role: 'user', content })
    // The provider owns wire tool aliases, native parameters, model and stream fields.
    const serialized = this.options.serializePayload({ selection, messages, tools })
    totals.serializedBytes = size(serialized)
    limit(totals.serializedBytes, budget.maxSerializedBytes, '最终请求字节')
    limit(totals.originalBytes, budget.maxOriginalBytes, '原件字节')
    limit(totals.representationBytes, budget.maxRepresentationBytes, '附件表示字节')
    limit(pixels, budget.maxImagePixels, '图片像素')
    limit(totals.textCharacters, budget.maxTextCharacters, '输入文本字符')
    const connection = selection.connection
    return { messages, tools: [...tools], serialized, manifest: {
      schemaVersion: 1, inputContextId: input.id, scope: 'initial-payload', laterDynamicReads: 'separately-recorded',
      provider: { connectionId: connection.id, revision: connection.revision, provider: connection.provider, model: selection.model, authKind: connection.auth.kind, billingKind: connection.billing.kind },
      payloadDigest: digest(serialized), totals, automaticContext, explicitAttachments,
      userText: input.instruction ? { messageIndex: userIndex, characters: input.instruction.length, digest: digest(input.instruction) } : null,
      tools: tools.map(tool => ({ name: tool.name, digest: digest(JSON.stringify(tool)) })), delivery: { status: 'prepared' }, readStatus: 'unknown',
    } }
  }
}

/** Only a backend acceptance receipt may mark a payload sent. Acceptance never proves it was read. */
export function markPayloadSent(manifest: PayloadManifest, receipt: { kind: 'backend-accepted'; requestId: string; payloadDigest: string; acceptedAt: number }): PayloadManifest {
  if (receipt.kind !== 'backend-accepted' || !receipt.requestId || receipt.payloadDigest !== manifest.payloadDigest || !Number.isSafeInteger(receipt.acceptedAt) || receipt.acceptedAt < 0) throw new PayloadCompileError('receipt-mismatch', '发送回执与该请求不一致')
  if (manifest.delivery.status === 'sent' && manifest.delivery.requestId !== receipt.requestId) throw new PayloadCompileError('receipt-mismatch', '该请求已有其他发送回执')
  return { ...structuredClone(manifest), delivery: { status: 'sent', requestId: receipt.requestId, acceptedAt: receipt.acceptedAt }, readStatus: 'unknown' }
}
