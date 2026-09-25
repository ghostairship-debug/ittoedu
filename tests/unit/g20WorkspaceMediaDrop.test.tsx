import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { deliverWorkspaceMediaDrop } from '../../src/renderer/lessonWorkspace/workspaceMediaDrop'
import { flowMediaDropAfterBlock } from '../../src/renderer/ui/flow/flowMediaDropPosition'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

const roots: string[] = []
const services: WorkspaceFilesDesktopService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

it('reads an authorized media handle with picker content checks and never returns a path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-media-drop-'))
  roots.push(directory)
  const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iKisAAAAASUVORK5CYII=', 'base64'))
  await fs.writeFile(path.join(directory, 'photo.png'), image)
  await fs.writeFile(path.join(directory, 'fake.png'), 'not an image')
  await fs.writeFile(path.join(directory, 'note.md'), '# Notes')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service)
  const root = await service.authorizeRoot(directory)
  const listed = await service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const id = (name: string) => {
    const entry = listed.entries.find(item => item.status === 'accessible' && item.name === name)
    if (!entry || entry.status !== 'accessible') throw new Error(`Missing ${name}`)
    return entry.entryId
  }
  const read = await service.operate({ type: 'read-media', workspaceId: root.workspaceId, entryId: id('photo.png') })
  expect(read).toMatchObject({ workspaceId: root.workspaceId, name: 'photo.png', mimeType: 'image/png', mediaKind: 'image' })
  expect(read.bytes).toEqual(image)
  expect(read).not.toHaveProperty('path')
  await expect(service.operate({ type: 'read-media', workspaceId: root.workspaceId, entryId: id('fake.png') })).rejects.toThrow()
  await expect(service.operate({ type: 'read-media', workspaceId: root.workspaceId, entryId: id('note.md') })).rejects.toThrow('不是受支持的图片、视频或音频')
  await expect(service.operate({ type: 'read-media', workspaceId: 'foreign', entryId: id('photo.png') })).rejects.toThrow('工作空间尚未授权')
})

it('reads the entire media selection before one callback, and rejects a failed member without partial commit', async () => {
  let rejectSecond = true
  const api = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    if (request.type === 'root') return { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: 'C:\\lesson' }
    if (request.type === 'resolve') return { workspaceId: 'workspace', entryId: request.entryId, kind: 'file', resolvedPath: `C:\\lesson\\${request.entryId}.png` }
    if (request.type === 'read-media') {
      if (request.entryId === 'second' && rejectSecond) throw new Error('第二张图片已经损坏')
      return { workspaceId: 'workspace', entryId: request.entryId, name: `${request.entryId}.png`, mimeType: 'image/png', mediaKind: 'image', bytes: new Uint8Array([137, 80, 78, 71]) }
    }
    throw new Error(`Unexpected ${request.type}`)
  }) as WorkspaceFilesAPI
  const source = { directory: 'C:\\lesson', files: api }
  const target = { documentId: 'document', projectId: 'project', revision: 7, locationId: 'scene', surfaceId: 'surface', sessionGeneration: 3 }
  const raw = JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['first', 'second'] })
  const commit = vi.fn(async () => ({ ok: true }))
  const failed = await deliverWorkspaceMediaDrop(raw, source, { surface: 'slide', x: 200, y: 100 }, target, commit)
  expect(failed).toEqual({ ok: false, reason: '第二张图片已经损坏' })
  expect(commit).not.toHaveBeenCalled()
  rejectSecond = false
  expect(await deliverWorkspaceMediaDrop(raw, source, { surface: 'slide', x: 200, y: 100 }, target, commit)).toEqual({ ok: true })
  expect(commit).toHaveBeenCalledTimes(1)
  expect(commit).toHaveBeenCalledWith(expect.objectContaining({ placement: { surface: 'slide', x: 200, y: 100 }, target,
    items: [expect.objectContaining({ entryId: 'first' }), expect.objectContaining({ entryId: 'second' })] }))
  expect(await deliverWorkspaceMediaDrop(raw, source, { surface: 'slide', x: 200, y: 100 }, target, commit, () => false))
    .toEqual({ ok: false, reason: '工作空间已切换，请重新拖入媒体' })
  expect(commit).toHaveBeenCalledTimes(1)
})

it('uses Flow document order and block midpoints for insertion, including before the first and after the last', () => {
  const paper = document.createElement('article')
  for (const [id, top] of [['first', 100], ['second', 200]] as const) {
    const block = document.createElement('p')
    block.dataset.flowBlockId = id
    block.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) })
    paper.append(block)
  }
  expect(flowMediaDropAfterBlock(paper, ['first', 'second'], 90)).toBeNull()
  expect(flowMediaDropAfterBlock(paper, ['first', 'second'], 150)).toBe('first')
  expect(flowMediaDropAfterBlock(paper, ['first', 'second'], 230)).toBe('second')
})
