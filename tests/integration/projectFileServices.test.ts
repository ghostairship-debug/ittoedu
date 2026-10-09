// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createProjectFileServices } from '../../src/main/workbench/projectFiles/projectFileServices'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})

it('opens real V10 courses under the frozen path grant, preserving read-only authority and rejecting directory and symlink escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-file-services-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
  await fs.mkdir(workspace); await fs.mkdir(outside)
  const driver = new CourseV10Driver(), project = createBlankCourseProjectV10('授权工程')
  const bytes = driver.serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  await fs.writeFile(path.join(workspace, '课.glx'), bytes); await fs.writeFile(path.join(outside, '课.glx'), bytes)
  await fs.writeFile(path.join(workspace, '图.png'), new Uint8Array([1, 2]))
  await fs.symlink(path.join(outside, '课.glx'), path.join(workspace, 'escape.glx'))
  const host = new DocumentHostService(path.join(root, 'state')), services = createProjectFileServices(host)
  const open = (filename: string, permission: 'workspace' | 'read-only' | 'full' = 'workspace') => services.openProject!({ runId: 'r', path: filename, fileAccess: { permission, workspaceRoot: workspace } })
  const first = await open('课.glx')
  expect(first).toMatchObject({ writable: true })
  expect(await host.internalAPI.read(first.documentId)).toMatchObject({ model: { kind: 'course-v10', project: { title: '授权工程' } } })
  expect(await open('课.glx', 'read-only')).toEqual({ ...first, writable: false })
  const before = host.registry.list()
  for (const filename of ['../outside/课.glx', 'escape.glx']) await expect(open(filename)).rejects.toThrow('只能使用工作空间内的文件')
  await expect(open('图.png')).rejects.toThrow('.glx')
  await expect(services.openProject!({ runId: 'r', path: '课.glx', fileAccess: undefined })).rejects.toThrow('工作空间')
  expect(host.registry.list()).toEqual(before)
  const external = await open('../outside/课.glx', 'full')
  expect(external).toMatchObject({ writable: true }); expect(external.documentId).not.toBe(first.documentId)
})
