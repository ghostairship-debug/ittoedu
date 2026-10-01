// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { FileBrowsePages } from '../../src/main/workbench/execution/FileBrowsePages'
import { FileGrepPages } from '../../src/main/workbench/execution/FileGrepPages'
import { AgentFileText } from '../../src/main/workbench/execution/AgentFileText'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const roots: string[] = []
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }) })
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-quota-test-')); roots.push(root); return root }

it('accepts more than eight observations, retains earlier bytes on disk and releases only the ended task', async () => {
  const root = await directory(), store = new ObservationImageStore(root)
  const images = await Promise.all(Array.from({ length: 32 }, () => store.put('active', png, 1, 1)))
  const other = await store.put('other', png, 1, 1)
  expect(new Set(images.map(image => image.resourceId)).size).toBe(32)
  expect((await store.read('active', images[0]!.resourceId)).bytes).toEqual(png)
  await expect(store.read('other', images[0]!.resourceId)).rejects.toThrow('不属于')
  expect((await fs.readdir(root)).length).toBe(2)
  await store.clearRun('active')
  await expect(store.read('active', images.at(-1)!.resourceId)).rejects.toThrow('不存在')
  expect((await store.read('other', other.resourceId)).bytes).toEqual(png)
  await store.clearRun('other')
  expect(await fs.readdir(root)).toEqual([])
})

it('does not publish a new image after its task is cleared while storage is opening', async () => {
  const root = await directory(), store = new ObservationImageStore(root)
  const pending = store.put('ending', png, 1, 1)
  const rejected = expect(pending).rejects.toThrow('取消')
  await store.clearRun('ending'); await rejected
  expect(await fs.readdir(root)).toEqual([])
})

it('keeps text, directory and grep cursors across long waits and other runs, but still checks versions and ownership', async () => {
  const root = await directory(), filename = path.join(root, 'a.py')
  await fs.writeFile(filename, 'needle needle'); await fs.writeFile(path.join(root, 'b.py'), 'second')
  const browse = new FileBrowsePages(), grep = new FileGrepPages()
  const text = new AgentFileText({ registry: { list: () => [] } } as unknown as DocumentHostService)
  const context = { runId: 'active', workspaceRoot: root, permission: 'read-only' as const }
  const firstFile = (await text.read(context, filename, 2)).data as { nextCursor: string }
  const firstDirectory = await browse.list('active', root, 1)
  const query = { runId: 'active', root: filename, kind: 'file' as const, query: 'needle', limit: 1,
    verifyDirectory: async (p: string) => p, readFile: async () => ({ source: 'needle needle', version: 'v1' }) }
  const firstGrep = await grep.search(query)
  for (let i = 0; i < 130; i++) {
    await browse.list('other', root, 1)
    await grep.search({ ...query, runId: 'other' })
    await text.read({ ...context, runId: 'other' }, filename, 2)
  }
  const later = Date.now() + 60 * 60_000
  vi.spyOn(Date, 'now').mockReturnValue(later)
  expect((await text.read(context, filename, 20, firstFile.nextCursor)).data).toMatchObject({ text: 'edle needle' })
  expect((await browse.list('active', root, 1, firstDirectory.nextCursor)).entries[0]!.name).toBe('b.py')
  expect((await grep.search({ ...query, cursor: firstGrep.nextCursor })).matches[0]!.column).toBe(8)
  await expect(browse.list('foreign', root, 1, firstDirectory.nextCursor)).rejects.toThrow('本次查询')
  await expect(grep.search({ ...query, cursor: firstGrep.nextCursor, readFile: async () => ({ source: 'changed', version: 'v2' }) })).rejects.toThrow('版本已改变')
  await fs.writeFile(filename, 'changed')
  await expect(text.read(context, filename, 20, firstFile.nextCursor)).rejects.toThrow('版本已改变')
  browse.releaseRun('active'); grep.releaseRun('active'); text.releaseRun('active')
  await expect(browse.list('active', root, 1, firstDirectory.nextCursor)).rejects.toThrow('失效')
  await expect(grep.search({ ...query, cursor: firstGrep.nextCursor })).rejects.toThrow('失效')
})
