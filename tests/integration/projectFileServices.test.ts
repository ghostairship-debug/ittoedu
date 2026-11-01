// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createProjectFileServices } from '../../src/main/workbench/projectFiles/projectFileServices'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { readComponentProjectFileInput } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})

it('reads current and granted prior assembly sources while keeping each media closure inside its own run root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'assembly-source-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), assembly = path.join(root, 'runs', 'current', 'assembly'), prior = path.join(root, 'runs', 'prior', 'assembly')
  await fs.mkdir(workspace)
  const code = 'export const own = new URL("./own.wav", import.meta.url); export const neighbor = new URL("../private.wav", import.meta.url);'
  for (const directory of [assembly, prior]) {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'main.js'), code)
    await fs.writeFile(path.join(directory, 'own.wav'), new Uint8Array([1, 2, 3]))
    await fs.writeFile(path.join(directory, '..', 'private.wav'), new Uint8Array([4, 5, 6]))
    for (const permission of ['workspace', 'full'] as const) {
      const captured = await readComponentProjectFileInput({ from: path.join(directory, 'main.js'),
        fileAccess: { permission, workspaceRoot: workspace, assemblyRoot: assembly, assemblyReadRoots: [prior] } })
      expect(captured.text).toBe(code)
      expect(captured.siblingFiles?.get('own.wav')).toEqual(new Uint8Array([1, 2, 3]))
      expect([...captured.siblingFiles!.keys()]).not.toContain('../private.wav')
      expect(captured.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ reference: '../private.wav' })]))
    }
  }
  expect((await readComponentProjectFileInput({ from: 'main.js', fileAccess: { permission: 'workspace', assemblyRoot: assembly } })).text).toBe(code)
  await expect(readComponentProjectFileInput({ from: path.join(prior, 'main.js'),
    fileAccess: { permission: 'workspace', workspaceRoot: workspace, assemblyRoot: assembly } })).rejects.toThrow('授权工作空间外')
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
  for (const filename of ['../outside/课.glx', 'escape.glx']) await expect(open(filename)).rejects.toThrow('只能使用工作空间内')
  await expect(open('图.png')).rejects.toThrow('.glx')
  await expect(services.openProject!({ runId: 'r', path: '课.glx', fileAccess: undefined })).rejects.toThrow('工作空间')
  expect(host.registry.list()).toEqual(before)
  const external = await open('../outside/课.glx', 'full')
  expect(external).toMatchObject({ writable: true }); expect(external.documentId).not.toBe(first.documentId)
  const fileAccess = { permission: 'workspace' as const, workspaceRoot: workspace, boundPaths: { provided: path.join(outside, '课.glx') } }
  expect(await services.openProject!({ runId: 'r', path: '../outside/课.glx', fileAccess })).toEqual({ ...external, writable: false })
  await fs.writeFile(path.join(outside, '其他课.glx'), bytes)
  await expect(services.openProject!({ runId: 'r', path: '../outside/其他课.glx', fileAccess })).rejects.toThrow('明确绑定')
})
