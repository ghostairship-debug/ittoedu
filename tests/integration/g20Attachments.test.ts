// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { PayloadCompiler, markPayloadSent } from '../../src/core/execution/PayloadCompiler'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import type { InputContext } from '../../src/shared/workbench/attachments'
import type { ModelSelection, ModelToolDefinition } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-attachments-')); roots.push(directory)
  const source = path.join(directory, 'same.png'), store = path.join(directory, 'managed')
  const service = new AttachmentService({ directory: store, resolveAuthorizedPath: async id => { if (id !== 'selected-file') throw new Error('Unauthorized'); return { path: source } } })
  return { directory, source, store, service }
}
const selection: ModelSelection = { model: 'vision-test', parameters: { temperature: 0.2 }, connection: { id: 'connection', revision: 4, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://example.com/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'secret-not-a-payload-field' }, billing: { kind: 'metered' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'unknown' } } }
const input = (): InputContext => ({ id: 'input', capturedAt: 100, instruction: '', context: [], attachments: [] })
const png = (color: string) => sharp({ create: { width: 2, height: 3, channels: 4, background: color } }).png().toBuffer()

describe('managed attachment snapshots and actual provider payload', () => {
  it('captures same-name distinct content, survives original changes and restart, and validates real images and cancellation', async () => {
    const { service, source, store } = await fixture()
    const red = await png('red'), blue = await png('blue')
    await fs.writeFile(source, red)
    const first = await service.receivePath({ authorizationId: 'selected-file' })
    await fs.writeFile(source, blue)
    const mutable = Buffer.from(blue)
    const pending = service.receiveBytes({ name: 'same.png', bytes: mutable, source: { kind: 'paste' } })
    mutable.fill(0)
    const second = await pending
    expect(first.name).toBe(second.name)
    expect(first.id).not.toBe(second.id); expect(first.digest).not.toBe(second.digest)
    const reopened = new AttachmentService({ directory: store })
    const restored = await reopened.readRepresentation(first.id, 'original-image')
    expect(Buffer.from(restored.bytes)).toEqual(red)
    expect(restored.representation).toMatchObject({ kind: 'image', width: 2, height: 3, provenance: { complete: true, downsampled: false, originalDigest: first.digest } })
    expect(Buffer.from((await reopened.readRepresentation(second.id, 'original-image')).bytes)).toEqual(blue)
    await expect(service.receiveBytes({ name: 'bad.png', bytes: blue, declaredMediaType: 'image/jpeg', source: { kind: 'paste' } })).rejects.toMatchObject({ code: 'media-type-mismatch' })
    await expect(service.receiveBytes({ name: 'bad.png', bytes: Buffer.from('not pixels'), source: { kind: 'paste' } })).rejects.toMatchObject({ code: 'invalid-image' })
    await expect(service.receiveBytes({ name: 'bad.png', bytes: blue.subarray(0, 40), source: { kind: 'paste' } })).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(service.receiveBytes({ name: 'same.png', bytes: blue, source: { kind: 'drop' } }, { signal: controller.signal })).rejects.toThrow()
    await expect(service.receivePath({ authorizationId: source })).rejects.toThrow('Unauthorized')
  })

  it('sends attachment-only actual image bytes and precise provenance without claiming read or inventing a prompt', async () => {
    const { service } = await fixture(), bytes = await png('green')
    const snapshot = await service.receiveBytes({ name: '图片.png', bytes, source: { kind: 'drop' } })
    const context = { ...input(), attachments: [{ attachmentId: snapshot.id, representationId: 'original-image', role: 'reference' as const }] }
    const compiler = new PayloadCompiler({ attachments: service, serializePayload: serializeModelRequest })
    const compiled = await compiler.compile({ input: context, selection, tools: [], budget: { maxSerializedBytes: 100_000 } })
    const body = JSON.parse(compiled.serialized)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] }])
    expect(compiled.serialized).toBe(serializeModelRequest({ selection, messages: compiled.messages, tools: compiled.tools }))
    expect(compiled.manifest).toMatchObject({ scope: 'initial-payload', laterDynamicReads: 'separately-recorded', userText: null, automaticContext: [], delivery: { status: 'prepared' }, readStatus: 'unknown', totals: { serializedBytes: Buffer.byteLength(compiled.serialized), imageBytes: bytes.length, base64Characters: bytes.toString('base64').length } })
    expect(compiled.manifest.explicitAttachments[0]).toMatchObject({ attachmentId: snapshot.id, originalDigest: snapshot.digest, representationDigest: snapshot.digest, messageIndex: 0, contentIndex: 0, role: 'reference' })
    expect(JSON.stringify(compiled.manifest)).not.toContain('secret-not-a-payload-field')
    const sent = markPayloadSent(compiled.manifest, { kind: 'backend-accepted', requestId: 'request', payloadDigest: compiled.manifest.payloadDigest, acceptedAt: 123 })
    expect(sent.delivery.status).toBe('sent'); expect(sent.readStatus).toBe('unknown'); expect(compiled.manifest.delivery.status).toBe('prepared')
    expect(() => markPayloadSent(compiled.manifest, { kind: 'backend-accepted', requestId: 'request', payloadDigest: 'different', acceptedAt: 123 })).toThrow()
    const unknownVision = await compiler.compile({ input: context, selection: { ...selection, connection: { ...selection.connection,
      capabilities: { ...selection.connection.capabilities, vision: 'unknown' } } }, tools: [], budget: { maxSerializedBytes: 100_000 } })
    expect(unknownVision.serialized).toContain(`data:image/png;base64,${bytes.toString('base64')}`)
    await expect(compiler.compile({ input: context, selection: { ...selection, connection: { ...selection.connection,
      capabilities: { ...selection.connection.capabilities, vision: 'unsupported' } } }, tools: [], budget: { maxSerializedBytes: 100_000 } }))
      .rejects.toMatchObject({ code: 'vision-unavailable' })
  })

  it('budgets the complete actual wire body with tools and automatic context; refuses missing extraction and corrupt provenance', async () => {
    const { service } = await fixture(), bytes = Buffer.from('# 源文\r\n完整🙂')
    const snapshot = await service.receiveBytes({ name: 'notes.md', bytes, source: { kind: 'workspace', authorizationId: 'workspace-read' } })
    const context: InputContext = { ...input(), instruction: '保留原文', context: [
      { message: { role: 'system', content: '运行时说明' }, provenance: { kind: 'runtime', id: 'runtime-v1' } },
      { message: { role: 'user', content: '当前选区' }, provenance: { kind: 'selection', id: 'selection', documentId: 'document', revision: 7, range: { from: 2, to: 6 } } },
    ], attachments: [{ attachmentId: snapshot.id, representationId: 'original-text' }] }
    const tools: ModelToolDefinition[] = [{ name: 'document.read', description: '正式工具'.repeat(60), inputSchema: { type: 'object', properties: { documentId: { type: 'string' } } } }]
    const compiler = new PayloadCompiler({ attachments: service, serializePayload: serializeModelRequest })
    const request = { input: context, selection, tools, budget: { maxSerializedBytes: 100_000 } }
    const compiled = await compiler.compile(request), actual = Buffer.byteLength(compiled.serialized)
    expect(compiled.manifest.totals.serializedBytes).toBe(actual)
    expect(actual).toBeGreaterThan(Buffer.byteLength(JSON.stringify(compiled.messages)))
    expect(JSON.parse(compiled.serialized).messages[2].content[1].text).toBe(`附件名称："notes.md"\n附件正文开始\n${bytes.toString('utf8')}\n附件正文结束`)
    expect(compiled.manifest.automaticContext[1]).toMatchObject({ messageIndex: 1, provenance: context.context[1].provenance })
    expect(compiled.manifest.explicitAttachments[0].provenance.range).toEqual({ unit: 'characters', from: 0, to: bytes.toString('utf8').length, total: bytes.toString('utf8').length })
    await expect(compiler.compile({ ...request, budget: { maxSerializedBytes: actual - 1 } })).rejects.toMatchObject({ code: 'payload-too-large' })
    await expect(compiler.compile({ ...request, budget: { maxSerializedBytes: actual } })).resolves.toMatchObject({ serialized: compiled.serialized })
    const corrupt = new PayloadCompiler({ serializePayload: serializeModelRequest, attachments: { readRepresentation: async (id, rep) => ({ ...await service.readRepresentation(id, rep), bytes: Buffer.from('changed') }) } })
    await expect(corrupt.compile(request)).rejects.toMatchObject({ code: 'provenance-mismatch' })
    for (const [name, content] of [['source.pdf', '%PDF-1.7'], ['source.docx', 'PK\u0003\u0004']] as const) {
      const unavailable = await service.receiveBytes({ name, bytes: Buffer.from(content), source: { kind: 'paste' } })
      expect(unavailable.representations).toEqual([expect.objectContaining({ id: 'original-file', kind: 'file' })]); expect(unavailable.gaps[0].code).toBe('extraction-unavailable')
      await expect(compiler.compile({ ...request, input: { ...input(), attachments: [{ attachmentId: unavailable.id, representationId: 'guessed-text' }] } })).rejects.toMatchObject({ code: 'representation-unavailable' })
    }
    const limited = new AttachmentService({ directory: path.join(roots[roots.length - 1], 'limited'), maxSourceBytes: 1 })
    await expect(limited.receiveBytes({ name: 'notes.md', bytes, source: { kind: 'paste' } })).rejects.toMatchObject({ code: 'source-too-large' })
  })

  it('labels immutable text material in both provider wire formats and budgets the complete wrapper', async () => {
    const { service } = await fixture()
    const name = '参考"材料\n.md', source = '观察之后再解释，解释时在蓝卡记录证据。'
    const bytes = Buffer.from(source, 'utf8')
    const snapshot = await service.receiveBytes({ name, bytes, source: { kind: 'paste' } })
    const inputContext: InputContext = { ...input(), instruction: '结合附件作答', attachments: [
      { attachmentId: snapshot.id, representationId: 'original-text', role: 'reference' },
    ] }
    const oauthSelection: ModelSelection = { model: 'gpt-6-luna', connection: {
      id: 'oauth-connection', revision: 2, provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL,
      accountId: 'account', auth: { kind: 'oauth', credentialRef: 'local-reference' }, billing: { kind: 'subscription' },
      capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
    } }
    for (const [selected, serialize] of [
      [selection, serializeModelRequest], [oauthSelection, serializeChatGPTResponsesRequest],
    ] as const) {
      const compiler = new PayloadCompiler({ attachments: service, serializePayload: serialize })
      const request = { input: inputContext, selection: selected, tools: [], budget: { maxSerializedBytes: 100_000 } }
      const compiled = await compiler.compile(request)
      const body = JSON.parse(compiled.serialized)
      const user = selected.connection.protocol === 'chatgpt-responses' ? body.input[0] : body.messages[0]
      const part = user.content[1]
      expect(part.type).toBe(selected.connection.protocol === 'chatgpt-responses' ? 'input_text' : 'text')
      expect(part.text).toBe(`附件名称：${JSON.stringify(name)}\n附件正文开始\n${source}\n附件正文结束`)
      expect(part.text).not.toContain('附件名称："参考"材料')
      expect(compiled.manifest.explicitAttachments).toMatchObject([{ messageIndex: 0, contentIndex: 1,
        name, originalDigest: snapshot.digest, representationDigest: snapshot.digest }])
      expect(compiled.manifest.totals.textCharacters).toBe(inputContext.instruction.length + part.text.length)
      expect(compiled.manifest.totals.serializedBytes).toBe(Buffer.byteLength(compiled.serialized))
      expect(compiled.manifest.payloadDigest).toBe(createHash('sha256').update(compiled.serialized).digest('hex'))
      expect(compiled.serialized).toBe(serialize({ selection: selected, messages: compiled.messages, tools: compiled.tools }))
      await expect(compiler.compile({ ...request, budget: { maxSerializedBytes: compiled.manifest.totals.serializedBytes - 1 } }))
        .rejects.toMatchObject({ code: 'payload-too-large' })
      await expect(compiler.compile({ ...request, budget: { maxSerializedBytes: 100_000,
        maxTextCharacters: inputContext.instruction.length + source.length } }))
        .rejects.toMatchObject({ code: 'payload-too-large' })
    }
  })
})
