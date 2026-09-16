// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { encodeImageTransformPng } from '../../src/shared/imageTransform'
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'material-copy-')); roots.push(root)
 const service = new LessonWorkspaceService(path.join(root, 'app')), source = await service.create(root, 'source')
 const owner = new LessonMaterials(async target => { await service.read({ schemaVersion: 1, lessonId: target.lessonId, normalizedDirectory: target.rootPath }) })
 const target = { lessonId: source.identity.lessonId, rootPath: source.identity.normalizedDirectory }
 const records = []
 for (let n = 0; n < 2; n++) records.push(await owner.import(target, { title: `材料${n}`, original: new Uint8Array([n+1]), extraction: { version: 1, format: 'text', extractorVersion: 'test', fragments: [{ id: 'text', kind: 'text', text: `正文${n}`, locator: { part: 'body' } }, { id: 'image', kind: 'image', assetId: 'diagram', locator: { part: 'body' } }], assets: [{ id: 'diagram', mime: 'image/png', bytes: encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, n, 0, 255]) }) }], gaps: [] } }))
 await fs.writeFile(path.join(target.rootPath, '.courseware/authoring-state.json'), JSON.stringify({ preserveOriginal: true }))
 const copy = path.join(root, 'copy')
 async function copyDirectory(from: string, to: string) { await fs.mkdir(to); for (const entry of await fs.readdir(from, { withFileTypes: true })) { if (entry.isDirectory()) await copyDirectory(path.join(from, entry.name), path.join(to, entry.name)); else await fs.copyFile(path.join(from, entry.name), path.join(to, entry.name)) } }
 await copyDirectory(target.rootPath, copy)
 const paths = ['.courseware/lesson.json', '.courseware/authoring-state.json', ...records.map(record => `materials/${record.id}/extraction.json`)]
 const before = await Promise.all(paths.map(p => fs.readFile(path.join(copy, p))))
 return { root, service, source, owner, target, records, copy, paths, before }
}
it('copies all saved material ownership without changing content versions and preserves identity after a directory move', async () => {
 const f = await fixture(), copied = await f.service.open(f.copy, { asCopy: true })
 expect(copied.identity.lessonId).not.toBe(f.target.lessonId)
 const target = { lessonId: copied.identity.lessonId, rootPath: copied.identity.normalizedDirectory }
 const records = await f.owner.list(target)
 expect(records).toHaveLength(2)
 for (const original of f.records) {
  const record = records.find(record => record.id === original.id)!
  expect(record).toEqual({ ...original, lessonId: copied.identity.lessonId })
  expect(await fs.readFile(path.join(target.rootPath, record.assets[0].path))).toEqual(await fs.readFile(path.join(f.target.rootPath, original.assets[0].path)))
  expect((await f.owner.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: ['text', 'image'] })).fragments).toEqual(original.fragments)
 }
 await expect(fs.stat(path.join(f.copy, '.courseware/authoring-state.json'))).rejects.toMatchObject({ code: 'ENOENT' })
 for (const [index, p] of f.paths.entries()) expect(await fs.readFile(path.join(f.target.rootPath, p))).toEqual(f.before[index])
 const moved = path.join(f.root, 'moved'); await fs.rename(f.copy, moved)
 const reopened = await f.service.open(moved)
 expect(reopened.identity.lessonId).toBe(copied.identity.lessonId)
 expect(await f.owner.list({ lessonId: copied.identity.lessonId, rootPath: reopened.identity.normalizedDirectory })).toEqual(records)
})
it.each(['second-material', 'manifest', 'registration'] as const)('rolls back all copied identities and approvals when %s writing fails', async failure => {
 const f = await fixture(), rename = fs.rename.bind(fs)
 let count = 0, injected = false
 vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
  const destination = String(to).replace(/\\/g, '/')
  const isMaterial = destination.startsWith(f.copy.replace(/\\/g, '/') + '/materials/') && destination.endsWith('/extraction.json')
  if (isMaterial) count++
  const trigger = failure === 'second-material' ? isMaterial && count === 2 : failure === 'manifest' ? destination === path.join(f.copy, '.courseware/lesson.json').replace(/\\/g, '/') : destination.includes('/lesson-locations/v1/')
  if (!injected && trigger) { injected = true; throw Object.assign(new Error('injected write failure'), { code: 'EIO' }) }
  return rename(from, to)
 })
 await expect(f.service.open(f.copy, { asCopy: true })).rejects.toThrow('injected write failure')
 expect(injected).toBe(true)
 for (const [index, p] of f.paths.entries()) {
  expect(await fs.readFile(path.join(f.copy, p))).toEqual(f.before[index])
  expect(await fs.readFile(path.join(f.target.rootPath, p))).toEqual(f.before[index])
 }
 expect((await fs.readdir(path.join(f.root, 'app/lesson-locations/v1')))).toEqual([f.target.lessonId + '.json'])
 vi.restoreAllMocks()
 const retried = await f.service.open(f.copy, { asCopy: true })
 expect((await f.owner.list({ lessonId: retried.identity.lessonId, rootPath: retried.identity.normalizedDirectory }))).toHaveLength(2)
})
it('fails before rebinding any record when an independent saved original is missing', async () => {
 const f = await fixture()
 await fs.unlink(path.join(f.copy, f.records[1].sourcePath))
 await expect(f.service.open(f.copy, { asCopy: true })).rejects.toThrow()
 for (const [index, p] of f.paths.entries()) expect(await fs.readFile(path.join(f.copy, p))).toEqual(f.before[index])
})
