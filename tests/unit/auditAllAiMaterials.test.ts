// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { dispatchMaterialTool } from '../../src/main/workbench/execution/MaterialReadTools'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { PayloadCompiler } from '../../src/core/execution/PayloadCompiler'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture(extractor?: any) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-ai-materials-')); roots.push(directory); const service = new AttachmentService({ directory, extractor }); return { directory, service } }
const text = (value = 'healthy', page = 1) => ({ id: 'text', kind: 'text', text: value, locator: { part: 'page', page } })
it('CA-064 keeps extraction cache reusable while its source has an owner and releases it with the last owner', async () => {
  let count = 0
  const { directory, service } = await fixture({ extract: async () => { count++; return { material: { version: 1, extractorVersion: 'fixture', format: 'docx', fragments: [{ ...text(), locator: { part: 'word/document.xml' } }], assets: [], gaps: [] }, pageImages: [] } } })
  const original = await service.receiveBytes({ name: 'a.docx', bytes: Uint8Array.of(1), source: { kind: 'paste' } })
  const derived = await service.extract(original.id)
  await service.prepareConversationRelease({ version: 1, workspaceId: 'w', conversationId: 'gone', attachmentIds: [derived.id] })
  await service.collectConversationReleases([{ workspaceId: 'w', conversationId: 'live', attachmentIds: [original.id] }])
  expect((await service.readOriginal(original.id)).bytes).toEqual(Uint8Array.of(1))
  expect((await service.extract(original.id)).representations[0].kind).toBe('text'); expect(count).toBe(1)
  await service.prepareConversationRelease({ version: 1, workspaceId: 'w', conversationId: 'live', attachmentIds: [original.id] })
  await service.collectConversationReleases([])
  expect(await fs.readdir(path.join(directory, 'snapshots'))).toEqual([])
  expect(await fs.readdir(path.join(directory, 'blobs'))).toEqual([])
  expect(await fs.readdir(path.join(directory, 'extraction-progress'))).toEqual([])
})
it('CA-271 extracts actual PDF page images instead of treating an auto text snapshot as satisfying image input', async () => {
  const png = new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } }).png().toBuffer()); let extracts = 0
  const { service } = await fixture({ extract: async (input: any) => { extracts++; return { material: { version: 1, extractorVersion: 'fixture', format: 'pdf', fragments: input.images === 'all' ? [{ id: 'image', kind: 'image', assetId: 'page.png', locator: { part: 'page', page: 1 } }] : [text()], assets: input.images === 'all' ? [{ id: 'page.png', mime: 'image/png', bytes: png }] : [], gaps: [] }, pageImages: [{ assetId: 'page.png', width: 1, height: 1, downsampled: false }], totalPages: 1, selectedPages: { from: 1, to: 1 } } } })
  const original = await service.receiveBytes({ name: 'a.pdf', bytes: Uint8Array.of(1), source: { kind: 'paste' } }), derived = await service.extract(original.id, { images: 'auto' })
  const result = await dispatchMaterialTool(service, new Set([derived.id]), 'material.read', { attachmentId: derived.id, representation: 'image' })
  expect(extracts).toBe(2); expect((result.data as any).sections[0].kind).toBe('image')
})
it('CA-278 reports the unread prefix of a last-page snapshot and keeps literal search incomplete', async () => {
  const { service } = await fixture({ extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'pptx', fragments: [text('last page', 10)], assets: [], gaps: [] }, pageImages: [], totalPages: 10, selectedPages: { from: 10, to: 10 } }) })
  const original = await service.receiveBytes({ name: 'a.pptx', bytes: Uint8Array.of(1), source: { kind: 'paste' } }), derived = await service.extract(original.id, { fromPage: 10 })
  const result = await dispatchMaterialTool(service, new Set([derived.id]), 'material.find', { attachmentId: derived.id, query: 'missing' })
  expect(result.data).toMatchObject({ searchComplete: false, unreadPages: [{ from: 1, to: 9 }] })
})
it.each([undefined, { from: 10, to: 10 }])('CA-278 retains an unread prefix through the last-page prepared find cursor with pages %j', async pages => {
  const { service } = await fixture({ extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'pptx', fragments: [text('X X', 10)], assets: [], gaps: [] }, pageImages: [], totalPages: 10, selectedPages: { from: 10, to: 10 } }) })
  const original = await service.receiveBytes({ name: 'a.pptx', bytes: Uint8Array.of(1), source: { kind: 'paste' } }), derived = await service.extract(original.id, { fromPage: 10 }), ids = new Set([derived.id])
  const first = await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: derived.id, query: 'X', limit: 1, pages })
  expect(first.data).toMatchObject({ searchComplete: false, truncated: true, unreadPages: [{ from: 1, to: 9 }] })
  const last = await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: derived.id, query: 'X', limit: 1, pages, cursor: (first.data as any).nextCursor })
  expect(last.data).toMatchObject({ searchComplete: false, truncated: false, unreadPages: [{ from: 1, to: 9 }] })
  const historical = JSON.parse(Buffer.from((first.data as any).nextCursor.slice('prepared:'.length), 'base64url').toString('utf8'))
  historical.completeSoFar = true
  const oldCursor = `prepared:${Buffer.from(JSON.stringify(historical)).toString('base64url')}`
  expect((await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: derived.id, query: 'X', limit: 1, pages, cursor: oldCursor })).data)
    .toMatchObject({ searchComplete: false, truncated: false, unreadPages: [{ from: 1, to: 9 }] })
})
it('CA-278 still completes a full-source find traversed from page one through later batches', async () => {
  const { service } = await fixture({ extract: async (input: any) => {
    const page = input.fromPage ?? 1
    return { material: { version: 1, extractorVersion: 'fixture', format: 'pptx', fragments: [text('X', page)], assets: [], gaps: [] }, pageImages: [], totalPages: 2, selectedPages: { from: page, to: page } }
  } })
  const original = await service.receiveBytes({ name: 'a.pptx', bytes: Uint8Array.of(1), source: { kind: 'paste' } }), firstBatch = await service.extract(original.id, { fromPage: 1, maxPages: 1 }), ids = new Set([firstBatch.id])
  const first = await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: firstBatch.id, query: 'X', limit: 1 })
  const last = await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: firstBatch.id, query: 'X', limit: 1, cursor: (first.data as any).nextCursor })
  expect(first.data).toMatchObject({ searchComplete: false, truncated: true })
  expect(last.data).toMatchObject({ searchComplete: true, truncated: false, unreadPages: [] })
})
it('CA-308 maps scan gaps to a representation reference that is directly readable through the original source', async () => {
  const png = new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } }).png().toBuffer())
  const { service } = await fixture({ extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'pdf', fragments: [{ id: 'image', kind: 'image', assetId: 'page.png', locator: { part: 'page', page: 1 } }], assets: [{ id: 'page.png', mime: 'image/png', bytes: png }], gaps: [{ locator: { part: 'page', page: 1 }, reason: 'scan', resolution: { kind: 'read-page-image', assetId: 'page.png' } }] }, pageImages: [{ assetId: 'page.png', width: 1, height: 1, downsampled: false }], totalPages: 1, selectedPages: { from: 1, to: 1 } }) })
  const original = await service.receiveBytes({ name: 'a.pdf', bytes: new TextEncoder().encode('%PDF-1.7 fixture'), source: { kind: 'paste' } }), ids = new Set([original.id])
  const result = await dispatchMaterialTool(service, ids, 'material.find', { attachmentId: original.id, query: 'missing' })
  const ref = (result.data as any).gaps[0].resolutionRepresentationId
  expect(ref).toMatch(/^prepared:/)
  expect((await dispatchMaterialTool(service, ids, 'material.read', { attachmentId: original.id, representationId: ref })).data).toMatchObject({ image: { mimeType: 'image/png' } })
})
it('CA-197 rebuilds read/find derived grants from actual original-linked receipt IDs, excluding unrelated IDs', async () => {
  const original = { id: 'original', digest: 'digest', byteLength: 1 }, derived = { id: 'derived', derivedFrom: original.id, digest: 'digest', byteLength: 1 }, foreign = { id: 'foreign', derivedFrom: 'other', digest: 'digest', byteLength: 1 }
  const record = { runId: 'r', input: { conversationId: 'c' }, initialPayload: { explicitAttachments: [{ attachmentId: original.id }] }, tools: [{ state: 'returned', call: { name: 'material.read' }, result: { kind: 'read', data: { attachmentId: original.id, admittedSourceIds: [derived.id, foreign.id] } } }] }
  const h = Object.assign(Object.create(ExecutionEngine.prototype), { continuationLineage: async () => [record], options: { materials: { readSnapshot: async (id: string) => [original, derived, foreign].find(item => item.id === id) } } })
  expect([...(await h.materialSourceIds(record))]).toEqual(['original', 'derived'])
})
it('CA-262 returns a healthy material and a per-record diagnostic when a neighboring saved record is corrupt', async () => {
  const { directory } = await fixture(), target = { rootPath: directory, lessonId: 'lesson' }, owner = new LessonMaterials(async () => {})
  const healthy = await owner.import(target, { title: 'healthy', original: Uint8Array.of(1), extraction: { version: 1, format: 'text', extractorVersion: 'fixture', fragments: [{ ...text(), locator: { part: 'a.txt' } } as any], assets: [], gaps: [] } })
  const badId = randomUUID(); await fs.mkdir(path.join(directory, 'materials', badId)); await fs.writeFile(path.join(directory, 'materials', badId, 'extraction.json'), '{bad')
  expect(await owner.list(target)).toEqual({ records: [healthy], diagnostics: [{ id: badId, code: 'material-unavailable', message: expect.any(String) }] })
  expect((await owner.read(target, { id: healthy.id, extractionVersion: healthy.extractionVersion, fragmentIds: ['text'] })).fragments[0].text).toBe('healthy')
})
it.each(['inline', 'source'])('CA-131 sends the frozen material purpose in %s payloads, rather than only in the audit manifest', async delivery => {
  const { service } = await fixture(), original = await service.receiveBytes({ name: 'a.txt', bytes: new TextEncoder().encode('healthy'), source: { kind: 'paste' } })
  const compiler = new PayloadCompiler({ attachments: service, serializePayload: input => JSON.stringify(input.messages) })
  const compile = (role: any) => compiler.compile({ input: { id: 'i', capturedAt: 0, instruction: 'read', context: [], attachments: [{ attachmentId: original.id, representationId: original.representations[0].id, role, delivery: delivery as any }] }, selection: { model: 'fixture', connection: { id: 'c', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://example.org', accountId: 'a', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } }, tools: [] })
  expect((await compile('reference')).serialized).not.toBe((await compile('target')).serialized)
})
