// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { moveNewFile, publishNewFile } from '../../src/main/workbench/publishNewFile'
import { workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-native-publish-')); roots.push(root)
  const source = path.join(root, '暂存-候选.tmp'), target = path.join(root, '新文件-甲.txt')
  await fs.writeFile(source, 'complete UTF-8 甲😀')
  return { root, source, target }
}
it.runIf(process.platform === 'win32')('uses the real native same-directory no-replace primitive, including Unicode filenames', async () => {
  const f = await fixture()
  expect(await moveNewFile(f.source, f.target, false)).toBe(true)
  expect(await fs.readFile(f.target, 'utf8')).toBe('complete UTF-8 甲😀')
  await expect(fs.stat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
  await fs.writeFile(f.source, 'another complete candidate')
  await expect(moveNewFile(f.source, f.target, false)).rejects.toMatchObject({ publication: 'not-published', code: 'EEXIST' })
  expect(await fs.readFile(f.target, 'utf8')).toBe('complete UTF-8 甲😀')
  expect(await fs.readFile(f.source, 'utf8')).toBe('another complete candidate')
})
it.runIf(process.platform === 'win32')('routes an unsupported hard-link through a verified alternate primitive without replacing another target', async () => {
  const f = await fixture()
  vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('no hardlinks fixture'), { code: 'ENOTSUP' }))
  await publishNewFile(f.source, f.target, { moveNew: (source, target) => moveNewFile(source, target, false) })
  expect(await fs.readFile(f.target, 'utf8')).toBe('complete UTF-8 甲😀')
})
it('never interprets EACCES as an unsupported filesystem and never overwrites an existing export', async () => {
  const f = await fixture(), move = vi.fn()
  vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(publishNewFile(f.source, f.target, { moveNew: move })).rejects.toMatchObject({ code: 'EACCES' })
  expect(move).not.toHaveBeenCalled()
  await fs.writeFile(f.target, 'other owner')
  await expect(workbenchExportWriter.writeNew(f.target, Buffer.from('new export'))).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await fs.readFile(f.target, 'utf8')).toBe('other owner')
})
