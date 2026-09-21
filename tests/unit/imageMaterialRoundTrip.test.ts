// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { extractMaterial } from '../../src/renderer/project/materialExtraction'
import { decodeImageTransformPng, encodeImageTransformPng } from '../../src/shared/imageTransform'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))

it('imports, reopens and reads a standalone image with original pixels and source location', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r20-image-material-'))
  try {
    const original = encodeImageTransformPng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) })
    const target = { lessonId: 'image-lesson', rootPath: root }
    const extraction = await extractMaterial(original, '电路图.png')
    const record = await new LessonMaterials(async () => {}).import(target, { title: '电路图', original, extraction })
    const reopened = new LessonMaterials(async () => {})
    expect((await reopened.list(target))[0]).toMatchObject({ id: record.id, format: 'image', sourcePath: expect.stringMatching(/original\.png$/) })
    const read = await reopened.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: [record.fragments[0]!.id] })
    expect(read.fragments[0]).toMatchObject({ kind: 'image', locator: { part: '电路图.png', page: 1 } })
    expect(read.fragments[0]!.text).toBeUndefined()
    expect(decodeImageTransformPng(read.assets[0]!.bytes)).toEqual(decodeImageTransformPng(original))
    await fs.writeFile(path.join(root, record.sourcePath), 'changed')
    await expect(reopened.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: [record.fragments[0]!.id] })).rejects.toThrow('原件版本已变化')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
