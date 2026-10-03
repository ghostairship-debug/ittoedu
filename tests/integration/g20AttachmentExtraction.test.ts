import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { extractAttachmentMaterial } from '../../src/renderer/workbench/attachments/materialExtractionWorker'
import { extractMaterial, listMaterials, readMaterial } from '../../src/main/workbench/execution/MaterialReadTools'
import { MATERIAL_TEXT, diagramPng, r19LessonMaterials } from '../fixtures/r19LessonMaterials'
import type { AttachmentExtractor } from '../../src/shared/workbench/attachments'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture(extractor: AttachmentExtractor = { extract: extractAttachmentMaterial }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-extraction-')); roots.push(directory)
  return new AttachmentService({ directory, extractor })
}
function twoSlides() {
  const files = unzipSync(r19LessonMaterials().find(item => item.format === 'pptx')!.bytes)
  files['ppt/presentation.xml'] = strToU8(strFromU8(files['ppt/presentation.xml']).replace('</p:sldIdLst>', '<p:sldId id="257" r:id="slide2"/></p:sldIdLst>'))
  files['ppt/_rels/presentation.xml.rels'] = strToU8(strFromU8(files['ppt/_rels/presentation.xml.rels']).replace('</Relationships>', '<Relationship Id="slide2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'))
  files['ppt/slides/slide2.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace(MATERIAL_TEXT, 'Explicit second slide'))
  files['ppt/slides/_rels/slide2.xml.rels'] = files['ppt/slides/_rels/slide1.xml.rels']
  return zipSync(files)
}

describe('actual Office extraction into immutable attachment representations', () => {
  it('extracts real DOCX and PPTX text and embedded pixels, preserves original records and reopens derived representations', async () => {
    const service = await fixture()
    for (const material of r19LessonMaterials().filter(item => item.format !== 'pdf')) {
      const original = await service.receiveBytes({ name: material.name, bytes: material.bytes, source: { kind: 'drop' } })
      const derived = await service.extract(original.id)
      expect(derived.id).not.toBe(original.id); expect(derived.derivedFrom).toBe(original.id); expect(derived.digest).toBe(original.digest)
      expect(derived.coverage).toMatchObject({ format: material.format, complete: true })
      expect(derived.gaps).toEqual([])
      const text = derived.representations.find(item => item.kind === 'text')!
      expect(new TextDecoder().decode((await service.readRepresentation(derived.id, text.id)).bytes)).toBe(MATERIAL_TEXT)
      expect(text.provenance).toMatchObject({ producer: 'office-xml-v1', originalDigest: original.digest, complete: true, downsampled: false })
      const image = derived.representations.find(item => item.kind === 'image')!
      expect(image).toMatchObject({ width: 32, height: 32 })
      expect(Buffer.from((await service.readRepresentation(derived.id, image.id)).bytes)).toEqual(Buffer.from(diagramPng()))
      expect(await service.readSnapshot(original.id)).toEqual(original)
      expect((await new AttachmentService({ directory: roots[roots.length - 1] }).readSnapshot(derived.id)).representations).toEqual(derived.representations)
    }
  })

  it('selects actual PPTX slides without silent omission and refuses guessed Word or out-of-bounds page ranges', async () => {
    const service = await fixture()
    const original = await service.receiveBytes({ name: 'two.pptx', bytes: twoSlides(), source: { kind: 'paste' } })
    const second = await service.extract(original.id, { pages: { from: 2, to: 2 } })
    expect(second.coverage).toEqual({ format: 'pptx', complete: false, totalPages: 2, selectedPages: { from: 2, to: 2 } })
    for (const representation of second.representations) expect(representation.provenance.range).toEqual({ unit: 'pages', from: 2, to: 2, total: 2 })
    const text = second.representations.find(item => item.kind === 'text')!
    expect(new TextDecoder().decode((await service.readRepresentation(second.id, text.id)).bytes)).toBe('Explicit second slide')
    await expect(service.extract(original.id, { pages: { from: 2, to: 3 } })).rejects.toThrow('页范围')
    const word = r19LessonMaterials().find(item => item.format === 'docx')!
    await expect(extractAttachmentMaterial({ bytes: word.bytes, filename: word.name, pages: { from: 1, to: 1 } })).rejects.toThrow('没有可靠页边界')
  })

  it('continues from an authorized derived source after its original conversation is deleted', async () => {
    const service = await fixture()
    const original = await service.receiveBytes({ name: 'two.pptx', bytes: twoSlides(), source: { kind: 'paste' } })
    const first = await extractMaterial(service, new Set([original.id]), { attachmentId: original.id, pages: { from: 1, to: 1 } })
    const authorized = new Set([first.derivedId])
    expect(await listMaterials(service, authorized, {})).toMatchObject({ sources: [{ attachmentId: first.derivedId, derivedFrom: original.id }] })
    await service.prepareConversationRelease({ version: 1, workspaceId: 'fixture-workspace', conversationId: 'original-owner', attachmentIds: [original.id] })
    await service.collectConversationReleases([{ workspaceId: 'fixture-workspace', conversationId: 'derived-owner', attachmentIds: [first.derivedId] }])
    expect((await service.readSnapshot(original.id)).id).toBe(original.id)
    const second = await extractMaterial(service, authorized, { attachmentId: first.derivedId, pages: { from: 2, to: 2 } })
    authorized.add(second.derivedId)
    expect(second.data).toMatchObject({ derivedFrom: original.id, coverage: { selectedPages: { from: 2, to: 2 } } })
    const text = (await service.readSnapshot(second.derivedId)).representations.find(item => item.kind === 'text')!
    expect((await readMaterial(service, authorized, { attachmentId: second.derivedId, representationId: text.id })).data).toMatchObject({ text: 'Explicit second slide' })
    expect((await extractMaterial(service, authorized, { attachmentId: original.id, pages: { from: 2, to: 2 } })).data.reused).toBe(true)
    const unrelated = await service.receiveBytes({ name: original.name, bytes: twoSlides(), source: { kind: 'paste' } })
    await expect(extractMaterial(service, authorized, { attachmentId: unrelated.id, pages: { from: 2, to: 2 } })).rejects.toThrow('当前显式输入')
    await service.prepareConversationRelease({ version: 1, workspaceId: 'fixture-workspace', conversationId: 'derived-owner', attachmentIds: [...authorized] })
    await service.collectConversationReleases([])
    await expect(service.readSnapshot(original.id)).rejects.toThrow()
  })

  it('retains unresolved Office content as gaps and rejects cancellation or inconsistent worker ranges without modifying the source snapshot', async () => {
    const word = r19LessonMaterials().find(item => item.format === 'docx')!, files = unzipSync(word.bytes)
    delete files['word/media/diagram.png']
    const service = await fixture(), source = await service.receiveBytes({ name: word.name, bytes: zipSync(files), source: { kind: 'drop' } })
    const derived = await service.extract(source.id)
    expect(derived.coverage?.complete).toBe(false)
    expect(derived.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'extraction-gap', message: '图片关系缺失或为外部链接' })]))
    const controller = new AbortController(); controller.abort()
    await expect(service.extract(source.id, { signal: controller.signal })).rejects.toThrow()
    expect(await service.readSnapshot(source.id)).toEqual(source)
    const inconsistent = await fixture({ extract: async input => ({ ...await extractAttachmentMaterial(input), selectedPages: { from: 1, to: 1 } }) })
    const slides = await inconsistent.receiveBytes({ name: 'slides.pptx', bytes: twoSlides(), source: { kind: 'drop' } })
    await expect(inconsistent.extract(slides.id, { pages: { from: 2, to: 2 } })).rejects.toMatchObject({ code: 'invalid-extraction' })
  })
})

it('extracts more than one hundred slides in bounded resumable batches without changing source identity', async () => {
  const files = unzipSync(r19LessonMaterials().find(item => item.format === 'pptx')!.bytes)
  const template = files['ppt/slides/slide1.xml'], relationships = files['ppt/slides/_rels/slide1.xml.rels']
  files['ppt/presentation.xml'] = strToU8(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${Array.from({ length: 120 }, (_, i) => `<p:sldId id="${256+i}" r:id="slide${i+1}"/>`).join('')}</p:sldIdLst></p:presentation>`)
  files['ppt/_rels/presentation.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: 120 }, (_, i) => `<Relationship Id="slide${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`).join('')}</Relationships>`)
  for (let i = 1; i <= 120; i++) {
    files[`ppt/slides/slide${i}.xml`] = strToU8(strFromU8(template).replace(MATERIAL_TEXT, `Content page ${i}`))
    files[`ppt/slides/_rels/slide${i}.xml.rels`] = relationships
  }
  const controller = new AbortController(), seen: number[] = []
  let interrupt = true
  const service = await fixture({ extract: async (input, options) => {
    seen.push(input.fromPage ?? 1)
    if (interrupt && input.fromPage === 33) { interrupt = false; controller.abort(new Error('fixture cancellation')); throw controller.signal.reason }
    return extractAttachmentMaterial(input, options)
  } })
  const source = await service.receiveBytes({ name: 'large.pptx', bytes: zipSync(files), source: { kind: 'drop' } })
  await expect(service.extract(source.id, { signal: controller.signal })).rejects.toThrow('fixture cancellation')
  const all = await service.extract(source.id)
  expect(seen).toEqual([1, 33, 33, 65, 97])
  expect(all.coverage).toMatchObject({ totalPages: 120, complete: true, selectedPages: { from: 1, to: 120 } })
  expect(new Set(all.representations.map(part => part.provenance.locator?.page)).size).toBe(120)
  const tail = await service.extract(source.id, { pages: { from: 118, to: 120 } })
  expect(tail.coverage).toMatchObject({ totalPages: 120, complete: false, selectedPages: { from: 118, to: 120 } })
  expect(await service.readSnapshot(source.id)).toEqual(source)
  expect((await service.extract(source.id)).id).toBe(all.id)
})

it('accepts a real Office package above the former 32 MiB entry limit', async () => {
  const files = unzipSync(r19LessonMaterials().find(item => item.format === 'pptx')!.bytes)
  files['unused-padding.bin'] = new Uint8Array(33 * 1024 * 1024)
  const bytes = zipSync(files, { level: 0 }), service = await fixture()
  expect(bytes.byteLength).toBeGreaterThan(32 * 1024 * 1024)
  const source = await service.receiveBytes({ name: 'above32.pptx', bytes, source: { kind: 'drop' } })
  expect((await service.extract(source.id)).coverage).toMatchObject({ format: 'pptx', complete: true })
  expect((await service.readSnapshot(source.id)).byteLength).toBe(bytes.byteLength)
})

it('saves and reopens an extracted text representation beyond the former 16 MiB character quota', async () => {
  const text = 'A'.repeat(16 * 1024 * 1024 + 1)
  const service = await fixture({ extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'docx',
    fragments: [{ id: 'text', kind: 'text', locator: { part: 'word/document.xml', paragraph: 1 }, text }], assets: [], gaps: [] }, pageImages: [] }) })
  const original = await service.receiveBytes({ name: 'long.docx', bytes: Uint8Array.from([80, 75, 3, 4]), source: { kind: 'drop' } })
  const derived = await service.extract(original.id)
  const reopened = new AttachmentService({ directory: roots.at(-1)! })
  expect(new TextDecoder().decode((await reopened.readRepresentation(derived.id, 'extracted-1')).bytes)).toBe(text)
  expect(await service.readSnapshot(original.id)).toEqual(original)
})
