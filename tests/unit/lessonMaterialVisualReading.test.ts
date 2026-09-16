// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { LessonAuthoring } from '../../src/main/lessonAuthoring'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { encodeImageTransformPng } from '../../src/shared/imageTransform'
import type { MaterialExtraction } from '../../src/shared/materialExtraction'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture(options: { legacy?: boolean; corrupt?: boolean; otherGap?: boolean } = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-material-')); roots.push(root)
 const workspace = new LessonWorkspaceService(path.join(root, 'app'))
 const lesson = (await workspace.create(root, '扫描页')).identity
 const target = { lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory }
 const validate = async () => { await workspace.read(lesson) }
 const materials = new LessonMaterials(validate)
 const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: validate })
 const authoring = new LessonAuthoring({ workspace, materials, files })
 const locator = { part: 'document.pdf', page: 1 }
 const bytes = encodeImageTransformPng({ width: 2, height: 1, data: new Uint8Array([255,0,0,255,0,0,255,255]) })
 if (options.corrupt) bytes[bytes.length - 8] ^= 1
 const extraction: MaterialExtraction = { version: 1, extractorVersion: 'material-3', format: 'pdf',
  fragments: [{ id: 'page', kind: 'image', assetId: 'page-1.png', locator }, { id: 'other', kind: 'text', text: '页注', locator }],
  assets: [{ id: 'page-1.png', mime: 'image/png', bytes }],
  gaps: [{ locator, reason: '需要实际阅读页面图', ...(options.legacy ? {} : { resolution: { kind: 'read-page-image' as const, assetId: 'page-1.png' } }) }, ...(options.otherGap ? [{ locator, reason: '真实未展开对象' }] : [])] }
 const record = await materials.import(target, { title: '扫描.pdf', original: new Uint8Array([37,80,68,70]), extraction })
 const selected = { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: ['page'] }
 return { lesson, target, materials, authoring, record, selected }
}
it('reads the selected saved PNG, retains its version and provenance without claiming comprehension', async () => {
 const f = await fixture()
 const receipt = await f.materials.read(f.target, f.selected)
 expect(receipt.fragments[0].locator).toEqual({ part: 'document.pdf', page: 1 })
 expect(receipt.assets[0].bytes.length).toBeGreaterThan(45)
 const view = await f.authoring.setMode(f.lesson, 'manual', [f.selected])
 expect(view.state.materials).toEqual([{ ...f.selected, sourceVersion: f.record.sourceVersion }])
 expect((await f.materials.list(f.target))[0].gaps[0].resolution).toEqual({ kind: 'read-page-image', assetId: 'page-1.png' })
})
it.each([{ legacy: true }, { corrupt: true }, { otherGap: true }])('keeps unresolved or corrupt visual input blocking: %j', async options => {
 const f = await fixture(options)
 await expect(f.authoring.setMode(f.lesson, 'automatic', [f.selected])).rejects.toThrow('未完整读取')
})
it('requires the exact page image to be selected, not nearby readable text', async () => {
 const f = await fixture()
 await expect(f.authoring.setMode(f.lesson, 'manual', [{ ...f.selected, fragmentIds: ['other'] }])).rejects.toThrow('未完整读取')
})
it.each(['missing', 'changed', 'stale-extraction'] as const)('rejects %s saved page evidence', async failure => {
 const f = await fixture(), imagePath = path.join(f.lesson.normalizedDirectory, f.record.assets[0].path)
 if (failure === 'missing') await fs.unlink(imagePath)
 if (failure === 'changed') await fs.writeFile(imagePath, new Uint8Array([1,2,3]))
 if (failure === 'stale-extraction') f.selected.extractionVersion = '0'.repeat(64)
 await expect(f.authoring.setMode(f.lesson, 'automatic', [f.selected])).rejects.toThrow()
})
