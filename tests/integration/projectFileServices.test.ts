// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { createProjectFileServices } from '../../src/main/workbench/projectFiles/projectFileServices'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})

it('reads workspace images and opens courses only within the task file access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-file-services-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
  await fs.mkdir(path.join(workspace, '材料'), { recursive: true }); await fs.mkdir(outside)
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00ff00' } }).png().toBuffer()
  await fs.writeFile(path.join(workspace, '材料', '图.png'), png)
  await fs.writeFile(path.join(outside, '图.png'), png)
  await fs.writeFile(path.join(workspace, '课.h5lesson'), 'x'); await fs.writeFile(path.join(outside, '课.h5lesson'), 'x')
  const opened: string[] = []
  const services = createProjectFileServices({ open: async filename => {
    opened.push(filename)
    return { documentId: 'doc', model: { kind: 'course-v9' } } as unknown as DocumentSnapshot
  } })
  const workspaceAccess = { permission: 'workspace' as const, workspaceRoot: workspace }
  const image = await services.readFile!({ runId: 'r', path: '材料/图.png', fileAccess: workspaceAccess })
  expect(image).toMatchObject({ mimeType: 'image/png', filename: '图.png' })
  expect(image.bytes.byteLength).toBe(png.byteLength)
  await expect(services.readFile!({ runId: 'r', path: '../outside/图.png', fileAccess: workspaceAccess })).rejects.toThrow('只能使用工作空间内的文件')
  expect(await services.readFile!({ runId: 'r', path: '../outside/图.png', fileAccess: { permission: 'full', workspaceRoot: workspace } })).toMatchObject({ filename: '图.png' })
  await expect(services.readFile!({ runId: 'r', path: '课.h5lesson', fileAccess: workspaceAccess })).rejects.toThrow('只能复制')
  await expect(services.readFile!({ runId: 'r', path: '材料/图.png', fileAccess: undefined })).rejects.toThrow('工作空间')

  expect(await services.openProject!({ runId: 'r', path: '课.h5lesson', fileAccess: workspaceAccess })).toEqual({ documentId: 'doc', writable: true })
  expect(await services.openProject!({ runId: 'r', path: '课.h5lesson', fileAccess: { permission: 'read-only', workspaceRoot: workspace } })).toEqual({ documentId: 'doc', writable: false })
  await expect(services.openProject!({ runId: 'r', path: '../outside/课.h5lesson', fileAccess: workspaceAccess })).rejects.toThrow('只能使用工作空间内的文件')
  expect(await services.openProject!({ runId: 'r', path: '../outside/课.h5lesson', fileAccess: { permission: 'full', workspaceRoot: workspace } })).toEqual({ documentId: 'doc', writable: true })
  await expect(services.openProject!({ runId: 'r', path: '材料/图.png', fileAccess: workspaceAccess })).rejects.toThrow('.h5lesson')
  expect(opened).toHaveLength(3)
})
