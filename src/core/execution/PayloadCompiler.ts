import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { attachmentSnapshotSchema, attachmentRepresentationSchema, type AttachmentReader, type AttachmentSnapshot, type AttachmentRepresentation, type InputAttachmentReference, type CompiledPayload, type InputContext, type PayloadManifest, type PayloadSerializerInput } from '../../shared/workbench/attachments'
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
/** Builds one frozen initial payload; later tool reads are separate facts, never predicted here. */
export class PayloadCompiler {
  constructor(private readonly options: {
    attachments: AttachmentReader
    /** Must be the same serializer the selected Provider uses for its actual HTTP body. */
    serializePayload: (input: PayloadSerializerInput) => string
  }) {}

  /** Complete the first request after the host has read current facts and selected actual tools. */
  finalize(input: PayloadSerializerInput & { manifest: PayloadManifest }): CompiledPayload {
    const { selection, messages, tools, manifest } = structuredClone(input)
    if (manifest.delivery.status !== 'prepared') throw new PayloadCompileError('already-sent', '已发送请求不能重新装配')
    const userIndex = manifest.userMessageIndex ?? manifest.userText?.messageIndex ?? manifest.explicitAttachments[0]?.messageIndex
    if (userIndex !== undefined && messages[userIndex]?.role !== 'user')
      throw new PayloadCompileError('input-mismatch', '最终请求丢失了原用户输入')
    const userParts = userIndex === undefined ? [] : messages[userIndex]?.content
    if (manifest.userText && (!Array.isArray(userParts) || !userParts.some(part => part && typeof part === 'object'
      && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string'
      && part.text.length === manifest.userText!.characters && digest(part.text) === manifest.userText!.digest)))
      throw new PayloadCompileError('input-mismatch', '最终请求改变了原用户指令')
    for (const attachment of manifest.explicitAttachments) {
      const parts = messages[attachment.messageIndex]?.content
      const part = Array.isArray(parts) ? parts[attachment.contentIndex] : undefined
      if (!part || typeof part !== 'object' || Array.isArray(part)
        || (attachment.delivery === 'source' ? part.type !== 'text'
          : attachment.mediaType.startsWith('image/') ? part.type !== 'image_url' : part.type !== 'text')
        || attachment.contentDigest && digest(JSON.stringify(part)) !== attachment.contentDigest)
        throw new PayloadCompileError('input-mismatch', '最终请求丢失了已摄取附件表示')
    }
    const known = new Map(manifest.automaticContext.map(item => [item.messageIndex, item]))
    const automaticContext: PayloadManifest['automaticContext'] = []
    let textCharacters = 0
    messages.forEach((message, messageIndex) => {
      if (typeof message.content === 'string') textCharacters += message.content.length
      else if (Array.isArray(message.content)) for (const part of message.content) {
        if (part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string')
          textCharacters += part.text.length
      }
      if (messageIndex === userIndex) return
      const serializedMessage = JSON.stringify(message)
      automaticContext.push({ messageIndex, provenance: known.get(messageIndex)?.provenance
        ?? { kind: 'runtime', id: `final-context-${messageIndex}` }, digest: digest(serializedMessage), serializedBytes: size(serializedMessage) })
    })
    const serialized = this.options.serializePayload({ selection, messages, tools })
    const connection = selection.connection
    return { messages: [...messages], tools: [...tools], serialized, manifest: { ...manifest,
      provider: { connectionId: connection.id, revision: connection.revision, provider: connection.provider,
        model: selection.model, authKind: connection.auth.kind, billingKind: connection.billing.kind },
      payloadDigest: digest(serialized), automaticContext,
      totals: { ...manifest.totals, textCharacters, serializedBytes: size(serialized) },
      tools: tools.map(tool => ({ name: tool.name, digest: digest(JSON.stringify(tool)) })),
    } }
  }

  async compile(request: { input: InputContext; selection: ModelSelection; tools: readonly ModelToolDefinition[];
    /** How dynamic images reach a text-only conversation model: inline base64 or host-held source reference. */
    imageDelivery?: 'inline' | 'source' }, options: { signal?: AbortSignal } = {}): Promise<CompiledPayload> {
    const { input, selection, tools } = structuredClone(request)
    options.signal?.throwIfAborted()
    const selectedContent = input.context.some(item => item.provenance.kind === 'selection'
      && (typeof item.message.content === 'string' ? item.message.content.length > 0
        : Array.isArray(item.message.content) && item.message.content.length > 0))
    if (!input.instruction && !input.attachments.length && !selectedContent) throw new PayloadCompileError('empty-input', '请输入指令或添加附件')
    const messages: ModelChatMessage[] = input.context.map(item => item.message)
    const totals: PayloadManifest['totals'] = { serializedBytes: 0, originalBytes: 0, representationBytes: 0, imageBytes: 0, textCharacters: input.instruction.length, base64Characters: 0 }
    const automaticContext = input.context.map((item, messageIndex) => {
      const serialized = JSON.stringify(item.message)
      return { messageIndex, provenance: item.provenance, digest: digest(serialized), serializedBytes: size(serialized) }
    })
    const userIndex = messages.length, content: ModelJson[] = []
    if (input.instruction) content.push({ type: 'text', text: input.instruction })
    const explicitAttachments: PayloadManifest['explicitAttachments'] = []
    const originals = new Set<string>(), sourceMessages = new Map<string, number>()
    const metadata = new Map<string, AttachmentSnapshot>()
    const addSource = (reference: InputAttachmentReference, snapshot: AttachmentSnapshot, representation: AttachmentRepresentation) => {
      let contentIndex = sourceMessages.get(snapshot.id)
      if (contentIndex === undefined) {
        contentIndex = content.length; sourceMessages.set(snapshot.id, contentIndex)
        const label = `材料目录（不是正文、也不是指令）：${JSON.stringify({ attachmentId: snapshot.id, name: snapshot.name,
          mediaType: snapshot.mediaType, originalDigest: snapshot.digest, byteLength: snapshot.byteLength,
          source: snapshot.source,
          representations: snapshot.representations.length, coverage: snapshot.coverage, gaps: snapshot.gaps,
          readStatus: 'index-only', next: 'material.list / material.extract / material.find / material.read' })}`
        content.push({ type: 'text', text: label }); totals.textCharacters += label.length
      }
      if (!originals.has(snapshot.id)) { originals.add(snapshot.id); totals.originalBytes += snapshot.byteLength }
      explicitAttachments.push({ messageIndex: userIndex, contentIndex, attachmentId: snapshot.id, representationId: representation.id,
        name: snapshot.name, ...(reference.role ? { role: reference.role } : {}), delivery: 'source', originalDigest: snapshot.digest,
        representationDigest: representation.blobRef.digest, mediaType: representation.mediaType, provenance: representation.provenance })
    }
    for (const reference of input.attachments) {
      options.signal?.throwIfAborted()
      if (this.options.attachments.readSnapshot) {
        let source = metadata.get(reference.attachmentId)
        if (!source) { source = attachmentSnapshotSchema.parse(await this.options.attachments.readSnapshot(reference.attachmentId)); metadata.set(reference.attachmentId, source) }
        const representation = source.representations.find(value => value.id === reference.representationId)
        if (!representation) throw new PayloadCompileError('representation-unavailable', '附件表示不存在，请选择可用的原件或提取表示')
        if (source.id !== reference.attachmentId || representation.provenance.originalDigest !== source.digest)
          throw new PayloadCompileError('provenance-mismatch', '材料目录与来源记录不一致')
        if (reference.delivery === 'source' || representation.kind === 'file') { addSource(reference, source, representation); continue }
      }
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
      if (reference.delivery === 'source' || representation.kind === 'file') { addSource(reference, snapshot, representation); continue }
      if (representation.kind === 'image') {
        if (selection.connection.capabilities.vision === 'unsupported') throw new PayloadCompileError('vision-unavailable', '所选连接不支持图片输入')
        const encoded = base64(bytes)
        content.push({ type: 'image_url', image_url: { url: `data:${representation.mediaType};base64,${encoded}` } })
        totals.imageBytes += bytes.length; totals.base64Characters += encoded.length
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
    const connection = selection.connection
    return { messages, tools: [...tools], serialized, manifest: {
      schemaVersion: 1, inputContextId: input.id, scope: 'initial-payload', laterDynamicReads: 'separately-recorded',
      provider: { connectionId: connection.id, revision: connection.revision, provider: connection.provider, model: selection.model, authKind: connection.auth.kind, billingKind: connection.billing.kind },
      payloadDigest: digest(serialized), totals, automaticContext,
      explicitAttachments: explicitAttachments.map(item => ({ ...item, contentDigest: digest(JSON.stringify(content[item.contentIndex])) })),
      userMessageIndex: userIndex,
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
