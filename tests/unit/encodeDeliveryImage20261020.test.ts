import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { beginDeliveryImageEncoding, encodeDeliveryImage, setDeliveryImageDocuments } from '../../src/renderer/export/componentPlatform/encodeDeliveryImage'
import type { ComponentAsset } from '../../src/shared/contracts/component-platform'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { buildComponentPublished, type ComponentCompilePort } from '../../src/renderer/export/componentPlatform/buildHtml'
import { createImageData } from '../../src/components/image/data'
import { setRootContainers } from '../helpers/glxWorkFixture'

vi.mock('../../src/renderer/export/loadCompiledPlayerBundle', () => ({ loadCompiledPlayerBundle: () => 'var CompiledCoursePlayer={};' }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const asset: ComponentAsset = { id: 'source', path: 'assets/source.jpeg', mimeType: 'image/jpeg', filename: 'source.jpeg' }
const source = () => Uint8Array.from({ length: 100 }, (_, i) => i)
function openDocument(documentId = 'course', epoch = 'epoch', ids = ['source', 'duplicate']): DocumentSnapshot {
  const project = createBlankCourseProjectV10('image cache')
  project.assets = Object.fromEntries(ids.map(id => [id, { ...asset, id }]))
  return { documentId, epoch, revision: 0, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'image cache' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

function webp(chunks: Array<[string, Uint8Array]>): Uint8Array {
  const bytes = new Uint8Array(12 + chunks.reduce((length, [, data]) => length + 8 + data.length + (data.length & 1), 0))
  const word = (offset: number, value: string) => bytes.set([...value].map(character => character.charCodeAt(0)), offset)
  const view = new DataView(bytes.buffer); word(0, 'RIFF'); word(8, 'WEBP'); view.setUint32(4, bytes.length - 8, true)
  let offset = 12
  for (const [type, data] of chunks) { word(offset, type); view.setUint32(offset + 4, data.length, true); bytes.set(data, offset + 8); offset += 8 + data.length + (data.length & 1) }
  return bytes
}

function canvasDocument(options: { size?: number; type?: string; failDecode?: boolean; waitDecode?: Promise<void> } = {}) {
  vi.stubGlobal('crypto', webcrypto)
  const create = vi.fn(() => 'blob:source'), revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const decode = vi.fn(async () => { await options.waitDecode; if (options.failDecode) throw new Error('decode failed') })
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((resolve: (blob: unknown) => void) => resolve({ size: options.size ?? 10, type: options.type ?? 'image/webp', arrayBuffer: async () => new ArrayBuffer(options.size ?? 10) })) }
  const dom = { defaultView: { Image: class { src = ''; naturalWidth = 1234; naturalHeight = 567; decode = decode } }, createElement: vi.fn(() => canvas) } as unknown as Document
  const snapshot = openDocument()
  setDeliveryImageDocuments(dom, [snapshot])
  const job = beginDeliveryImageEncoding(dom, snapshot)
  return { dom, canvas, decode, create, revoke, options, snapshot, job }
}

it('uses production q0.9 at intrinsic pixels and reuses content across concurrent exports and filenames', async () => {
  const h = canvasDocument(), original = source()
  const [first, renamed] = await Promise.all([
    h.job.encode(asset, original),
    h.job.encode({ ...asset, id: 'duplicate', filename: 'renamed.jpeg' }, original.slice()),
  ])
  expect(first).toMatchObject({ mimeType: 'image/webp', filename: 'source.webp' })
  expect(renamed?.filename).toBe('renamed.webp')
  expect(h.canvas).toMatchObject({ width: 1234, height: 567 })
  expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
  expect(h.decode).toHaveBeenCalledTimes(1)
  h.job.finish(true)
  const next = beginDeliveryImageEncoding(h.dom, h.snapshot)
  await next.encode(asset, original.slice())
  next.finish(true)
  expect(h.decode).toHaveBeenCalledTimes(1)
  expect(original).toEqual(source())
  expect(h.revoke).toHaveBeenCalledWith('blob:source')
})

it('content changes invalidate the derivative and document lifetime owns the cache', async () => {
  const h = canvasDocument(), changed = source(); changed[99] = 0
  await h.job.encode(asset, source())
  await h.job.encode(asset, changed)
  expect(h.decode).toHaveBeenCalledTimes(2)
  const second = canvasDocument()
  await second.job.encode(asset, source())
  expect(second.decode).toHaveBeenCalledTimes(1)
})

it('retains smaller sources and unsupported Canvas output without recompressing on retry', async () => {
  for (const options of [{ size: 100 }, { size: 120 }, { type: 'image/png' }]) {
    const h = canvasDocument(options)
    expect(await h.job.encode(asset, source())).toBeUndefined()
    expect(await h.job.encode(asset, source())).toBeUndefined()
    expect(h.decode).toHaveBeenCalledTimes(1)
  }
})

it('preserves animation in APNG and other formats without decoding a single frame', async () => {
  const h = canvasDocument(), apng = new Uint8Array(24)
  apng.set([97, 99, 84, 76], 12)
  expect(await h.job.encode({ ...asset, mimeType: 'image/png' }, apng)).toBeUndefined()
  for (const mimeType of ['image/gif', 'image/webp', 'image/avif', 'image/svg+xml']) {
    expect(await h.job.encode({ ...asset, mimeType }, source())).toBeUndefined()
  }
  expect(h.create).not.toHaveBeenCalled()
})

it('encodes static lossless WebP through the same q0.9 cache while preserving lossy and animated WebP', async () => {
  const h = canvasDocument(), metadata = new Uint8Array(10), image = { ...asset, mimeType: 'image/webp', filename: 'source.webp' }
  const original = webp([['VP8X', metadata], ['ICCP', new Uint8Array(5)], ['VP8L', source()]])
  const before = original.slice()
  expect(await h.job.encode(image, original)).toMatchObject({ mimeType: 'image/webp', filename: 'source.webp' })
  await h.job.encode(image, original.slice())
  expect(h.decode).toHaveBeenCalledTimes(1)
  expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
  expect(original).toEqual(before)
  metadata[0] = 2
  for (const input of [webp([['VP8 ', source()]]), webp([['VP8X', metadata], ['VP8L', source()]]),
    webp([['ANIM', new Uint8Array(6)], ['VP8L', source()]]), webp([['ANMF', source()]]), original.subarray(0, original.length - 2)]) {
    expect(await h.job.encode(image, input)).toBeUndefined()
  }
  expect(h.decode).toHaveBeenCalledTimes(1)
})

it('retries a failed decode and does not poison shared derivatives when one export is cancelled', async () => {
  const h = canvasDocument({ failDecode: true })
  await expect(h.job.encode(asset, source())).rejects.toThrow('decode failed')
  h.options.failDecode = false
  await h.job.encode(asset, source())
  expect(h.decode).toHaveBeenCalledTimes(2)
  const controller = new AbortController(); controller.abort()
  await expect(h.job.encode(asset, source(), controller.signal)).rejects.toThrow()
  expect(await h.job.encode(asset, source())).toBeDefined()
  expect(h.decode).toHaveBeenCalledTimes(2)
})

it('releases replaced successful build entries while another open document retains shared content', async () => {
  const h = canvasDocument(), second = openDocument('second'), changed = source(); changed[99] = 0
  setDeliveryImageDocuments(h.dom, [h.snapshot, second])
  await h.job.encode(asset, source()); h.job.finish(true)
  const secondJob = beginDeliveryImageEncoding(h.dom, second)
  await secondJob.encode(asset, source()); secondJob.finish(true)
  const newer = { ...h.snapshot, revision: 1 }
  const next = beginDeliveryImageEncoding(h.dom, newer)
  await next.encode(asset, changed); next.finish(true)
  setDeliveryImageDocuments(h.dom, [newer, second])
  const stillShared = beginDeliveryImageEncoding(h.dom, second)
  await stillShared.encode(asset, source()); stillShared.finish(true)
  expect(h.decode).toHaveBeenCalledTimes(2)
  setDeliveryImageDocuments(h.dom, [newer])
  const retired = beginDeliveryImageEncoding(h.dom)
  await retired.encode(asset, source()); retired.finish()
  expect(h.decode).toHaveBeenCalledTimes(3)
  const current = beginDeliveryImageEncoding(h.dom, newer)
  await current.encode(asset, changed); current.finish(true)
  expect(h.decode).toHaveBeenCalledTimes(3)
})

it('asset removal and an epoch replacement retire completed entries without disturbing active jobs', async () => {
  const h = canvasDocument()
  await h.job.encode(asset, source()); h.job.finish(true)
  setDeliveryImageDocuments(h.dom, [openDocument('course', 'epoch', [])])
  const oldEpoch = beginDeliveryImageEncoding(h.dom, h.snapshot)
  await oldEpoch.encode(asset, source())
  expect(h.decode).toHaveBeenCalledTimes(2)
  setDeliveryImageDocuments(h.dom, [openDocument('course', 'new-epoch')])
  oldEpoch.finish(true)
  await encodeDeliveryImage(asset, source(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(3)
})

it('keeps pending shared work alive through close and never revives its retired owner', async () => {
  let resolve!: () => void
  const h = canvasDocument({ waitDecode: new Promise<void>(done => { resolve = done }) })
  const controller = new AbortController()
  const first = h.job.encode(asset, source(), controller.signal)
  await vi.waitFor(() => expect(h.decode).toHaveBeenCalledTimes(1))
  const concurrent = beginDeliveryImageEncoding(h.dom, h.snapshot)
  const other = concurrent.encode(asset, source())
  setDeliveryImageDocuments(h.dom, [])
  controller.abort()
  resolve()
  await expect(first).rejects.toThrow()
  expect(await other).toBeDefined()
  h.job.finish(); concurrent.finish(true)
  expect(h.decode).toHaveBeenCalledTimes(1)
  await encodeDeliveryImage(asset, source(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(2)
  await encodeDeliveryImage(asset, source(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(3)
})

it('does not let an older or failed build replace a newer successful retention set', async () => {
  const h = canvasDocument(), changed = source(); changed[99] = 0
  await h.job.encode(asset, source())
  const newer = beginDeliveryImageEncoding(h.dom, { ...h.snapshot, revision: 1 })
  await newer.encode(asset, changed); newer.finish(true)
  h.job.finish(true)
  const failed = beginDeliveryImageEncoding(h.dom, { ...h.snapshot, revision: 2 })
  await failed.encode(asset, source()); failed.finish()
  expect(h.decode).toHaveBeenCalledTimes(3)
  const current = beginDeliveryImageEncoding(h.dom, { ...h.snapshot, revision: 1 })
  await current.encode(asset, changed); current.finish(true)
  expect(h.decode).toHaveBeenCalledTimes(3)
})

it('uses display/crop/DPR demand in the same content cache and keeps differing requests separate', async () => {
  const h = canvasDocument(), demand = { width: 100, height: 50, dpr: 2, fit: 'cover' as const }
  const first = await h.job.encode(asset, source(), undefined, demand)
  expect(first).toMatchObject({ width: 218, height: 100 })
  expect(h.canvas).toMatchObject({ width: 218, height: 100 })
  await h.job.encode({ ...asset, id: 'duplicate' }, source().slice(), undefined, { ...demand })
  expect(h.decode).toHaveBeenCalledTimes(1)
  await h.job.encode(asset, source(), undefined, { ...demand, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } })
  expect(h.decode).toHaveBeenCalledTimes(2)
  expect(h.canvas).toMatchObject({ width: 400, height: 184 })
  await h.job.encode(asset, source(), undefined, { ...demand, dpr: 1 })
  expect(h.decode).toHaveBeenCalledTimes(3)
  h.job.finish()
})

it('only decodes and reduces a lossy WebP when its actual runtime pixels can decrease', async () => {
  const h = canvasDocument(), bytes = webp([['VP8 ', source()]]), image = { ...asset, mimeType: 'image/webp' }
  expect(await h.job.encode(image, bytes)).toBeUndefined()
  expect(h.decode).not.toHaveBeenCalled()
  expect(await h.job.encode(image, bytes, undefined, { width: 2000, height: 2000 })).toBeUndefined()
  expect(h.canvas.toBlob).not.toHaveBeenCalled()
  expect(await h.job.encode(image, bytes, undefined, { width: 200, height: 100 })).toMatchObject({ width: 400, height: 184 })
  expect(h.canvas.toBlob).toHaveBeenCalledTimes(1)
  h.job.finish()
})

it('preserves an unclassified PNG losslessly and only permits its WebP conversion for explicit photography', async () => {
  const h = canvasDocument(), png = { ...asset, mimeType: 'image/png', filename: 'diagram.png' }
  expect(await h.job.encode(png, source())).toBeUndefined()
  expect(h.canvas.toBlob).not.toHaveBeenCalled()
  h.options.type = 'image/png'
  expect(await h.job.encode(png, source(), undefined, { width: 100, height: 50 })).toMatchObject({ mimeType: 'image/png', width: 200, height: 92 })
  expect(h.canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/png', 0.9)
  h.options.type = 'image/webp'
  expect(await h.job.encode(png, source(), undefined, { width: 100, height: 50, quality: 'photo' })).toMatchObject({ mimeType: 'image/webp' })
  h.job.finish()
})

it('the actual published builder retains only live-owner work and releases ownerless build work', async () => {
  const h = canvasDocument()
  h.job.finish()
  const snapshot = h.snapshot
  if (snapshot.model.kind !== 'course-v10') throw new Error('fixture')
  const project = snapshot.model.project
  project.definitions = { image: { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } } }
  project.instances = { image: { id: 'image', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData(asset.id))),
    frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } } }
  setRootContainers(project, [{ id: 'slide', title: 'image', kind: 'slide', childIds: ['image'], designSize: { width: 100, height: 100 } }])
  snapshot.model.resources.assets[asset.id] = source()
  const compile: ComponentCompilePort = async () => { throw new Error('No custom source in this sample') }
  vi.stubGlobal('document', h.dom)
  const first = await buildComponentPublished(snapshot, compile, undefined, undefined, undefined, undefined, true)
  expect(first.payload.assets[asset.id]).toMatchObject({ mimeType: 'image/webp', url: expect.stringContaining('data:image/webp;') })
  await buildComponentPublished(snapshot, compile, undefined, undefined, undefined, undefined, true)
  expect(h.decode).toHaveBeenCalledTimes(1)
  setDeliveryImageDocuments(h.dom, [])
  await buildComponentPublished(snapshot, compile, undefined, undefined, undefined, undefined, true)
  await buildComponentPublished(snapshot, compile, undefined, undefined, undefined, undefined, true)
  expect(h.decode).toHaveBeenCalledTimes(3)
  expect(snapshot.model.resources.assets[asset.id]).toEqual(source())
})
