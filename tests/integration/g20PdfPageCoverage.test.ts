// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { extractAttachmentMaterial } from '../../src/renderer/workbench/attachments/materialExtractionWorker'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdfjs-dist/build/pdf.worker.min.mjs' }))
const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/** A byte-correct PDF object table; image objects contain compressed RGB raster data. */
function pdf(objects: Buffer[]): Buffer {
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]
  let length = chunks[0]!.length
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const record = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    chunks.push(record); length += record.length
  }
  const crossReference = length
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`))
  return Buffer.concat(chunks)
}
const object = (text: string) => Buffer.from(text)
function stream(bytes: Buffer, extra = ''): Buffer {
  return Buffer.concat([Buffer.from(`<< ${extra}/Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')])
}
function textPdf(): Buffer {
  const first = Buffer.from('BT /F1 14 Tf 20 60 Td (Readable first page) Tj ET\n')
  const second = Buffer.from('BT /F1 14 Tf 20 60 Td (Readable second page) Tj ET\n')
  return pdf([
    object('<< /Type /Catalog /Pages 2 0 R >>'),
    object('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'),
    object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>'),
    object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>'),
    stream(first), stream(second), object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ])
}
function scannedPdf(): Buffer {
  const rgb = Buffer.alloc(16 * 16 * 3)
  for (let offset = 0; offset < rgb.length; offset += 3) { rgb[offset] = 0; rgb[offset + 1] = 0; rgb[offset + 2] = 255 }
  const raster = deflateSync(rgb)
  const image = stream(raster, '/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ')
  const drawing = stream(Buffer.from('q 100 0 0 80 20 10 cm /Im1 Do Q\n'))
  return pdf([
    object('<< /Type /Catalog /Pages 2 0 R >>'),
    object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    image, drawing,
  ])
}

it('S08-T03 extracts selected text and scanned PDF pages without hiding page gaps in the sent payload', async () => {
  // PDF.js still performs the actual parse and render. Only its browser canvas
  // host is backed by the native Canvas implementation in this headless test.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
  // Chromium supplies these typed-array helpers; the Node test runtime does not.
  Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, value: function (this: Uint8Array) { return Buffer.from(this).toString('hex') } })
  Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: function (this: Uint8Array) { return Buffer.from(this).toString('base64') } })
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', { configurable: true, value: function <K, V>(this: Map<K, V>, key: K, create: () => V) {
    if (!this.has(key)) this.set(key, create())
    return this.get(key)
  } })
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((name: string) => name.toLowerCase() === 'canvas'
    ? createCanvas(1, 1) as unknown as HTMLCanvasElement : createElement(name)) as typeof document.createElement)

  const bodies: string[] = [], errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'pdf-fixture-vision' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local route ${request.method} ${request.url}`)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    bodies.push(Buffer.concat(chunks).toString())
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'pdf-fixture', model: 'pdf-fixture-vision', choices: [{ index: 0, delta: { role: 'assistant', content: '已收到选定页面' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => { errors.push(String(error)); response.destroy() }) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-pdf-coverage-')); roots.push(root)
  const extractor = { extract: extractAttachmentMaterial }
  const attachments = new AttachmentService({ directory: path.join(root, 'attachments'), extractor })
  const originalText = await attachments.receiveBytes({ name: 'text.pdf', bytes: textPdf(), source: { kind: 'file' } })
  const originalScan = await attachments.receiveBytes({ name: 'scan.pdf', bytes: scannedPdf(), source: { kind: 'paste' } })
  const selectedText = await attachments.extract(originalText.id, { pages: { from: 2, to: 2 } })
  const selectedScan = await attachments.extract(originalScan.id, { pages: { from: 1, to: 1 } })

  expect(selectedText.coverage).toEqual({ format: 'pdf', complete: false, totalPages: 2, selectedPages: { from: 2, to: 2 } })
  expect(selectedText.gaps).toEqual([])
  expect(selectedText.representations.map(item => item.kind)).toEqual(['text', 'image'])
  expect(selectedText.representations.every(item => item.provenance.locator?.page === 2 && item.provenance.range?.from === 2 && item.provenance.range?.to === 2 && item.provenance.range?.total === 2)).toBe(true)
  const selectedTextBytes = await attachments.readRepresentation(selectedText.id, selectedText.representations[0]!.id)
  expect(Buffer.from(selectedTextBytes.bytes).toString()).toBe('Readable second page')
  expect(Buffer.from(selectedTextBytes.bytes).toString()).not.toContain('first page')
  expect(selectedScan.coverage).toEqual({ format: 'pdf', complete: false, totalPages: 1, selectedPages: { from: 1, to: 1 } })
  expect(selectedScan.representations.map(item => item.kind)).toEqual(['image'])
  const scanImage = selectedScan.representations[0]!
  expect(scanImage.provenance).toMatchObject({ producer: 'pdfjs-v1', locator: { part: 'document.pdf', page: 1 }, range: { unit: 'pages', from: 1, to: 1, total: 1 }, complete: false })
  expect(selectedScan.gaps).toEqual([{ code: 'scanned-page', message: '本页没有可提取文字；需要实际阅读保存的页面图像', locator: { part: 'document.pdf', page: 1 }, resolutionRepresentationId: scanImage.id }])
  const imageBytes = (await attachments.readRepresentation(selectedScan.id, scanImage.id)).bytes
  const decoded = await sharp(imageBytes).raw().toBuffer({ resolveWithObject: true })
  expect(decoded.info.width).toBe(400); expect(decoded.info.height).toBe(200)
  const pixel = await sharp(imageBytes).extract({ left: 140, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  expect([...pixel]).toEqual([0, 0, 255])
  expect((await attachments.readSnapshot(originalScan.id)).representations[0]?.kind).toBe('file')

  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => Buffer.from(bytes).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'local-only', connection: { provider: 'local-pdf-fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'pdf-fixture-vision' }, vision: { connectionId: connection.connection.id, model: 'pdf-fixture-vision' }, imageGenerate: null, imageEdit: null } })
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const execution = new ExecutionDesktopService({ directory: root, documents, settings, attachments, authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  const workspace = await execution.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await execution.operate({ type: 'create-conversation', workspaceId: workspace.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const refs = [...selectedText.representations.map(item => ({ attachmentId: selectedText.id, representationId: item.id, role: 'reference' as const })),
    { attachmentId: selectedScan.id, representationId: scanImage.id, role: 'reference' as const }]
  const draft = await execution.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '', documents: [], attachments: refs }) as ConversationRecord
  const sent = await execution.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision, text: '', documents: [], attachments: refs }) as { run: ExecutionRunRecord; conversation: ConversationRecord }
  const run = await execution.engine.wait(sent.run.runId)
  expect(run.status).toBe('completed')
  let settled = await execution.operate({ type: 'conversation', ...identity }) as ConversationRecord
  for (let attempt = 0; attempt < 100 && !settled.messages.some(message => message.role === 'assistant'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    settled = await execution.operate({ type: 'conversation', ...identity }) as ConversationRecord
  }
  expect(settled.messages.some(message => message.role === 'assistant')).toBe(true)
  expect(errors).toEqual([]); expect(bodies).toHaveLength(1)
  const body = JSON.parse(bodies[0]!) as { messages: { role: string; content: unknown }[] }
  const content = body.messages.at(-1)?.content as { type: string; text?: string; image_url?: { url: string } }[]
  expect(content.map(part => part.type)).toEqual(['text', 'image_url', 'image_url'])
  expect(content[0]?.text).toBe('Readable second page')
  expect(bodies[0]).not.toContain('Readable first page')
  expect(run.initialPayload?.explicitAttachments).toHaveLength(3)
  expect(run.initialPayload?.explicitAttachments.map(item => item.provenance.locator?.page)).toEqual([2, 2, 1])
  expect(run.initialPayload).toMatchObject({ payloadDigest: sha256(bodies[0]!), delivery: { status: 'sent' }, readStatus: 'unknown' })
  const sentScan = Buffer.from(content[2]!.image_url!.url.split(',')[1]!, 'base64')
  expect(sentScan).toEqual(Buffer.from(imageBytes))
  expect(sent.conversation.messages[0]?.attachmentIds).toEqual([selectedText.id, selectedScan.id])
})
