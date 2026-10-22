// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'

const roots: string[] = []
const services: WorkspaceFilesDesktopService[] = []
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks()
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected temporary test root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-listing-'))
  roots.push(directory)
  for (let index = 0; index < 5; index++) await fs.writeFile(path.join(directory, `${index}.txt`), String(index))
  const files = new WorkspaceFiles()
  const root = await files.registerRoot(directory)
  return { directory, files, root }
}

it('reads and sorts one directory snapshot for all pages, and reuses its known entry metadata', async () => {
  const { directory, files, root } = await fixture()
  const scan = vi.spyOn(fs, 'readdir')
  const canonicalize = vi.spyOn(fs, 'realpath')
  const names: string[] = []
  let cursor: string | undefined
  do {
    const page = await files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId, limit: 2, cursor })
    names.push(...page.entries.map(entry => entry.name)); cursor = page.nextCursor
  } while (cursor)
  expect(names).toEqual(['0.txt', '1.txt', '2.txt', '3.txt', '4.txt'])
  expect(scan.mock.calls.filter(([filename]) => filename === directory)).toHaveLength(1)
  // Each listed file is canonicalized once; the directory is checked at each page boundary.
  for (const name of names) expect(canonicalize.mock.calls.filter(([filename]) => filename === path.join(directory, name))).toHaveLength(1)
})

it('rejects a continuation from an older directory snapshot instead of silently mixing pages', async () => {
  const { directory, files, root } = await fixture()
  const input = { workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId, limit: 2 }
  const page = await files.listChildren(input)
  await fs.writeFile(path.join(directory, 'new.txt'), 'new')
  // Force a distinct directory metadata version even on coarse timestamp filesystems.
  const time = new Date(Date.now() + 2000)
  await fs.utimes(directory, time, time)
  await expect(files.listChildren({ ...input, cursor: page.nextCursor })).rejects.toMatchObject({ code: 'stale-directory-cursor' })
  expect((await files.listChildren({ ...input, limit: 200 })).entries.some(entry => entry.name === 'new.txt')).toBe(true)
})

it('shares one watcher and releases its derived listings only when the final UI lease leaves', async () => {
  const { directory, files, root } = await fixture()
  const close = vi.fn()
  let changed!: (paths?: readonly string[]) => void
  const watch = vi.spyOn(files, 'watch').mockImplementation((_workspaceId, callback) => { changed = callback; return close })
  const release = vi.spyOn(files, 'releaseDirectoryListings')
  const service = new WorkspaceFilesDesktopService(files)
  services.push(service)
  await service.authorizeRoot(directory)
  const events: unknown[] = []
  service.subscribe(event => events.push(event))
  await service.operate({ type: 'watch', workspaceId: root.workspaceId, watchId: 'tree-a' })
  await service.operate({ type: 'watch', workspaceId: root.workspaceId, watchId: 'tree-b' })
  expect(watch).toHaveBeenCalledTimes(1)
  vi.useFakeTimers()
  changed(['unit/a.md']); changed(['unit/b.md'])
  await vi.advanceTimersByTimeAsync(80)
  expect(events).toEqual([{ workspaceId: root.workspaceId, changedPaths: ['unit/a.md', 'unit/b.md'] }])
  await service.operate({ type: 'unwatch', workspaceId: root.workspaceId, watchId: 'tree-a' })
  expect(close).not.toHaveBeenCalled()
  await service.operate({ type: 'unwatch', workspaceId: root.workspaceId, watchId: 'tree-b' })
  expect(close).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledWith(root.workspaceId)
  // Releasing a UI observer does not revoke the authorized root.
  expect(await service.operate({ type: 'root', directory })).toMatchObject(root)
})
