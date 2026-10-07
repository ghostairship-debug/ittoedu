import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { AttachmentService } from '../../../../src/main/workbench/attachments/AttachmentService'
import { extractAttachmentMaterial } from '../../../../src/renderer/workbench/attachments/materialExtractionWorker'
import { WebResearchService } from '../../../../src/main/workbench/network/WebResearchService'
import { dispatchMaterialTool } from '../../../../src/main/workbench/execution/MaterialReadTools'
import { MATERIAL_TEXT, r19LessonMaterials } from '../../../fixtures/r19LessonMaterials'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))

it.each(['pdf', 'docx'] as const)('public %s bytes enter the existing real extractor and shared material reader with source and honest locations', async format => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-material-'))
  const fixture = r19LessonMaterials().find(material => material.format === format)!
  const url = `https://example.com/lesson.${format}`
  const contentType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  let fetches = 0
  const materials = new AttachmentService({ directory, extractor: { extract: extractAttachmentMaterial } })
  // HTTP response seam supplies real format bytes; this does not prove network or search-provider availability.
  const web = new WebResearchService({ materials, fetch: async () => { fetches++; return { url, status: 200, contentType, bytes: fixture.bytes } } })
  web.beginRun('run')
  try {
    const opened = await web.open({ runId: 'run', url })
    expect(opened.status).toBe('material')
    if (opened.status !== 'material') throw new Error('Expected readable downloaded material')
    expect(opened.source).toMatchObject({ url, contentType })
    expect(opened.observation).toBe('index-only')
    expect((await materials.readSnapshot(opened.material.originalAttachmentId)).source).toMatchObject({ pathHint: url })
    const ids = new Set(opened.attachmentIds)
    const found = await dispatchMaterialTool(materials, ids, 'material.find', { attachmentId: opened.material.attachmentId, query: MATERIAL_TEXT })
    expect(found.data).toMatchObject({ hits: [expect.objectContaining({ representationId: expect.any(String) })] })
    const hits = (found.data as { hits: { representationId: string; location?: { page?: number; paragraph?: number } }[] }).hits
    if (format === 'pdf') expect(hits[0].location).toMatchObject({ page: 1 })
    else { expect(hits[0].location?.paragraph).toBeGreaterThan(0); expect(hits[0].location).not.toHaveProperty('page') }
    const read = await dispatchMaterialTool(materials, ids, 'material.read', { attachmentId: opened.material.attachmentId, representationId: hits[0].representationId })
    expect(read.data).toMatchObject({ text: expect.stringContaining(MATERIAL_TEXT) })
    await expect(dispatchMaterialTool(materials, new Set(), 'material.read', { attachmentId: opened.material.attachmentId, representationId: hits[0].representationId })).rejects.toThrow('当前显式输入')
    expect(await web.open({ runId: 'run', sourceId: opened.source.sourceId, version: opened.source.version })).toMatchObject({ status: 'material', attachmentIds: opened.attachmentIds })
    const stopped = new AbortController(); stopped.abort(new Error('Teacher cancelled material read'))
    expect(await web.open({ runId: 'run', sourceId: opened.source.sourceId, version: opened.source.version, signal: stopped.signal })).toMatchObject({ status: 'rejected' })
    expect(fetches).toBe(1)
  } finally {
    await web.stopRun('run'); web.endRun('run')
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('stopping during downloaded material extraction returns no late material result and does not fetch or extract again', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-material-stop-'))
  let entered!: () => void, release!: () => void, fetches = 0, extractions = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const materials = new AttachmentService({ directory, extractor: { extract: async input => { extractions++; entered(); await gate; return extractAttachmentMaterial(input) } } })
  const url = 'https://example.com/lesson.docx'
  const web = new WebResearchService({ materials, fetch: async () => { fetches++; return { url, status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: r19LessonMaterials().find(material => material.format === 'docx')!.bytes } } })
  web.beginRun('run')
  try {
    const pending = web.open({ runId: 'run', url })
    await started
    await web.stopRun('run'); release()
    expect((await pending).status).toBe('rejected')
    expect((await web.open({ runId: 'run', url })).status).toBe('rejected')
    expect(fetches).toBe(1); expect(extractions).toBe(1)
  } finally {
    release(); await web.stopRun('run'); web.endRun('run')
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
