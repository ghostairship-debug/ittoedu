import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { extractAttachmentMaterial } from '../../src/renderer/workbench/attachments/materialExtractionWorker'
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
