// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { extractMaterial, findMaterial, readMaterial } from '../../src/main/workbench/execution/MaterialReadTools'
import { MATERIAL_TEXT, r19LessonMaterials } from '../fixtures/r19LessonMaterials'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }) })

it('M27 searches immutable PDF/DOCX/PPTX fixture snapshots with format-specific locators and a bound continuation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-material-find-')); roots.push(root)
  let extractions = 0
  const service = new AttachmentService({ directory: root, extractor: { extract: async input => {
    extractions++
    const format = input.filename.split('.').at(-1) as 'pdf' | 'docx' | 'pptx'
    return { material: { version: 1 as const, extractorVersion: 'fixture-only', format,
      fragments: [{ id: 'one', kind: 'text' as const,
        locator: format === 'docx' ? { part: 'word/document.xml', paragraph: 1 } : { part: format === 'pdf' ? 'page/1' : 'ppt/slides/slide1.xml', page: 1 },
        text: `${MATERIAL_TEXT}; ${MATERIAL_TEXT}` }], assets: [], gaps: [] }, pageImages: [],
      ...(format === 'docx' ? {} : { totalPages: 1, selectedPages: { from: 1, to: 1 } }) }
  } } })
  for (const fixture of r19LessonMaterials()) {
    const original = await service.receiveBytes({ name: fixture.name, bytes: fixture.bytes, source: { kind: 'paste' } })
    const originalSearch = await findMaterial(service, new Set([original.id]), { attachmentId: original.id, query: 'Series' })
    expect(originalSearch).toMatchObject({ hits: [], searchComplete: false, unreadable: [{ kind: 'file' }] })
    const authorized = new Set([original.id])
    if (fixture.format === 'docx') await expect(extractMaterial(service, authorized,
      { attachmentId: original.id, pages: { from: 1, to: 1 } })).rejects.toThrow('没有可靠排版页码')
    const stopped = new AbortController(); stopped.abort(new Error('fixture stop'))
    await expect(extractMaterial(service, authorized, { attachmentId: original.id }, stopped.signal)).rejects.toThrow('fixture stop')
    const extracted = await extractMaterial(service, authorized, { attachmentId: original.id })
    expect(extracted.data).toMatchObject({ derivedFrom: original.id, originalDigest: original.digest,
      coverage: { format: fixture.format, complete: true }, textRepresentations: 1, reused: false })
    authorized.add(extracted.derivedId)
    const reused = await extractMaterial(service, authorized, { attachmentId: original.id })
    expect(reused.data).toMatchObject({ attachmentId: extracted.derivedId, reused: true })
    const derived = await service.readSnapshot(extracted.derivedId)
    const first = await findMaterial(service, authorized, { attachmentId: derived.id, query: 'Series', limit: 1 })
    expect(first).toMatchObject({ originalDigest: derived.digest, truncated: true, searchComplete: false,
      hits: [{ representationId: 'extracted-1', from: 0, locator: expect.objectContaining(formatLocator(fixture.format)) }] })
    expect(first.hits[0]!.location).toEqual(formatLocation(fixture.format))
    const second = await findMaterial(service, authorized, { attachmentId: derived.id, query: 'Series', limit: 1, cursor: first.nextCursor })
    expect(second).toMatchObject({ truncated: false, searchComplete: true,
      hits: [{ representationId: 'extracted-1', from: MATERIAL_TEXT.length + 2 }] })
    expect(first.hits[0]!.representationDigest).toBe(second.hits[0]!.representationDigest)
    const read = await readMaterial(service, authorized, { attachmentId: derived.id, representationId: first.hits[0]!.representationId })
    expect(read.data).toMatchObject({ originalDigest: derived.digest, text: `${MATERIAL_TEXT}; ${MATERIAL_TEXT}`,
      location: formatLocation(fixture.format) })
    await expect(findMaterial(service, new Set([derived.id]), { attachmentId: original.id, query: 'Series' })).rejects.toThrow('当前显式输入')
    await expect(findMaterial(service, authorized, { attachmentId: derived.id, query: 'different', cursor: first.nextCursor })).rejects.toThrow('当前来源、版本或查询')
  }
  expect(extractions).toBe(3)
})

function formatLocator(format: string) {
  return format === 'docx' ? { paragraph: 1, part: 'word/document.xml' } : { page: 1 }
}
function formatLocation(format: string) {
  return format === 'docx' ? { part: 'word/document.xml', paragraph: 1 }
    : format === 'pptx' ? { part: 'ppt/slides/slide1.xml', slide: 1 } : { part: 'page/1', page: 1 }
}
