// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import type { MaterialExtraction } from '../../src/shared/materialExtraction'
const page = (n: number): MaterialExtraction => ({ version: 1, extractorVersion: 'material-3', format: 'pdf',
  fragments: [{ id: `fragment-${n}`, kind: 'image', locator: { part: 'document.pdf', page: n }, assetId: `page-${n}.png` }],
  assets: [{ id: `page-${n}.png`, mime: 'image/png', bytes: Uint8Array.of(n) }], gaps: [] })
it('persists each consumed page before the next and reopens the original record format', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'material-stream-')), target = { lessonId: 'lesson', rootPath: root }
  try {
    const owner = new LessonMaterials(async current => { expect(current).toEqual(target) })
    const saved = await owner.importPages(target, { title: '教材', original: Uint8Array.of(7, 8) }, async consume => {
      await consume(page(1))
      // An extraction must not hold the singleton material queue over the whole PDF.
      expect((await owner.list(target)).records).toEqual([])
      const pending = (await fs.readdir(path.join(root, 'materials'))).find(name => name.startsWith('.pending-'))!
      expect([...await fs.readFile(path.join(root, 'materials', pending, 'assets/0.png'))]).toEqual([1])
      expect(await fs.readdir(path.join(root, 'materials', pending))).not.toContain('extraction.json')
      await consume(page(2))
    })
    const reopened = new LessonMaterials(async () => {}), listed = await reopened.list(target)
    expect(listed.diagnostics).toEqual([]); expect(listed.records[0]).toEqual(saved)
    const read = await reopened.read(target, { id: saved.id, extractionVersion: saved.extractionVersion, fragmentIds: ['fragment-2'] })
    expect(read.assets.map(asset => [asset.id, ...asset.bytes])).toEqual([['page-2.png', 2]])
    expect([...await fs.readFile(path.join(root, saved.sourcePath))]).toEqual([7, 8])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
it('cancelling a streamed import removes only its pending data and preserves published materials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'material-cancel-')), target = { lessonId: 'lesson', rootPath: root }, stop = new AbortController()
  try {
    const owner = new LessonMaterials(async () => {}), original = Uint8Array.of(7)
    const published = await owner.import(target, { title: '已有材料', original, extraction: page(1) })
    await expect(owner.importPages(target, { title: '取消材料', original }, async consume => { await consume(page(2)); stop.abort(new Error('取消')); await consume(page(3)) }, stop.signal)).rejects.toThrow('取消')
    expect(await fs.readdir(path.join(root, 'materials'))).toEqual([published.id])
    expect((await owner.list(target)).records.map(record => record.id)).toEqual([published.id])
    expect([...original]).toEqual([7])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
