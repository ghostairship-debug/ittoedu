// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { dispatchMaterialTool } from '../../src/main/workbench/execution/MaterialReadTools'
import { r19LessonMaterials } from '../fixtures/r19LessonMaterials'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-material-preparation-')); roots.push(root)
  const batches: { from: number; to: number }[] = []
  const service = new AttachmentService({ directory: root, extractor: { extract: async input => {
    const from = input.pages?.from ?? input.fromPage ?? 1
    const to = Math.min(70, input.pages?.to ?? 70, from + (input.maxPages ?? 70) - 1)
    batches.push({ from, to })
    return { material: { version: 1 as const, extractorVersion: 'fixture-pages', format: 'pdf' as const,
      fragments: Array.from({ length: to - from + 1 }, (_, i) => ({ id: `page-${from + i}`, kind: 'text' as const,
        locator: { part: `page/${from + i}`, page: from + i }, text: from + i === 60 ? 'page 60 target' : `page ${from + i}` })),
      assets: [], gaps: [] }, pageImages: [], totalPages: 70, selectedPages: { from, to } }
  } } })
  const pdf = r19LessonMaterials().find(item => item.format === 'pdf')!
  const source = await service.receiveBytes({ name: pdf.name, bytes: pdf.bytes, source: { kind: 'paste' } })
  return { service, source, batches, ids: new Set([source.id]) }
}

it('prepares bounded reads directly from the original source and continues past the first batch without moving derived IDs', async () => {
  const h = await fixture()
  const first = await dispatchMaterialTool(h.service, h.ids, 'material.read', { attachmentId: h.source.id, maxChars: 1000 })
  expect(first.data).toMatchObject({ attachmentId: h.source.id, truncated: true, sections: expect.arrayContaining([expect.objectContaining({ location: { part: 'page/1', page: 1 } })]),
    unreadPages: [{ from: 33, to: 70 }] })
  const again = await dispatchMaterialTool(h.service, h.ids, 'material.read', { attachmentId: h.source.id, maxChars: 1000 })
  expect(again.data).toEqual(first.data)
  expect(h.batches).toEqual([{ from: 1, to: 32 }])
  const second = await dispatchMaterialTool(h.service, h.ids, 'material.read', { attachmentId: h.source.id, maxChars: 1000, cursor: (first.data as any).nextCursor })
  expect(second.data).toMatchObject({ truncated: true, coverage: { selectedPages: { from: 33, to: 64 } }, unreadPages: [{ from: 65, to: 70 }] })
  const last = await dispatchMaterialTool(h.service, h.ids, 'material.read', { attachmentId: h.source.id, maxChars: 1000, cursor: (second.data as any).nextCursor })
  expect(last.data).toMatchObject({ truncated: false, coverage: { selectedPages: { from: 65, to: 70 } }, unreadPages: [] })
  expect(h.batches).toEqual([{ from: 1, to: 32 }, { from: 33, to: 64 }, { from: 65, to: 70 }])
})

it('reports unswept pages honestly, locates a later-page match, and reads it with the same original material identity', async () => {
  const h = await fixture()
  const first = await dispatchMaterialTool(h.service, h.ids, 'material.find', { attachmentId: h.source.id, query: 'target' })
  expect(first.data).toMatchObject({ hits: [], searchComplete: false, truncated: true, unreadPages: [{ from: 33, to: 70 }] })
  const second = await dispatchMaterialTool(h.service, h.ids, 'material.find', { attachmentId: h.source.id, query: 'target', cursor: (first.data as any).nextCursor })
  expect(second.data).toMatchObject({ hits: [{ location: { page: 60, part: 'page/60' } }], searchComplete: false, truncated: true })
  const read = await dispatchMaterialTool(h.service, h.ids, 'material.read', { attachmentId: h.source.id, representationId: (second.data as any).hits[0].representationId })
  expect(read.data).toMatchObject({ text: 'page 60 target', location: { page: 60, part: 'page/60' } })
  await expect(dispatchMaterialTool(h.service, new Set(), 'material.read', { attachmentId: h.source.id, representationId: (second.data as any).hits[0].representationId })).rejects.toThrow('当前显式输入')
  const last = await dispatchMaterialTool(h.service, h.ids, 'material.find', { attachmentId: h.source.id, query: 'target', cursor: (second.data as any).nextCursor })
  expect(last.data).toMatchObject({ hits: [], searchComplete: true, truncated: false, unreadPages: [] })
  await expect(dispatchMaterialTool(h.service, h.ids, 'material.find', { attachmentId: h.source.id, query: 'changed', cursor: (second.data as any).nextCursor })).rejects.toThrow('当前来源、版本或查询')
})
