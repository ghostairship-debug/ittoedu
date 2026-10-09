// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createProjectFileServices } from '../../src/main/workbench/projectFiles/projectFileServices'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { sourceFileKind } from '../../src/shared/workbench/sourceFileKind'
import { launchFileArguments } from '../../src/main/launchFileArguments'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
  await fs.rm(root, { recursive: true, force: true })
} })

it('creates .glx through the actual file service, saves resources, cold opens both filenames and keeps workspace authorization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-glx-')); roots.push(root)
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const context = { runId: 'native-glx', workspaceRoot: workspace, permission: 'workspace' as const }
  const created = await host.agentFiles.execute(context, 'file.create', { kind: 'course-v10', name: '真实工程' }, 'create-glx')
  expect(created.opened).toBeDefined()
  const snapshot = await host.internalAPI.read(created.opened!.documentId)
  expect(snapshot.binding).toMatchObject({ kind: 'file', path: path.join(workspace, '真实工程.glx') })
  if (snapshot.model.kind !== 'course-v10') throw new Error('Missing actual V10')
  const bytes = new Uint8Array([17, 23, 44])
  expect(await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
    baseRevision: snapshot.revision, operationId: 'resource', actor: 'human', mutation: { type: 'command',
      command: captureComponentOperation(snapshot.model.project, [{ type: 'asset.add',
        asset: { id: 'retained', path: 'assets/retained.bin', mimeType: 'application/octet-stream' }, bytes }]) } })).toMatchObject({ status: 'applied' })
  const saved = await host.saveToPath(snapshot.documentId)
  expect(saved.dirty).toBe(false)
  expect(saved.revision).toBe(snapshot.revision + 1)
  const filename = path.join(workspace, '真实工程.glx'), previous = path.join(workspace, '现有工程.h5lesson')
  await fs.copyFile(filename, previous)
  const cold = new DocumentHostService(path.join(root, 'cold-journal'))
  const services = createProjectFileServices(cold), access = { permission: 'workspace' as const, workspaceRoot: workspace }
  for (const name of ['真实工程.glx', '现有工程.h5lesson']) {
    expect(sourceFileKind(name)).toBe('course-v10')
    const result = await services.openProject!({ runId: context.runId, path: name, fileAccess: access })
    const opened = await cold.internalAPI.read(result.documentId)
    expect(opened.dirty).toBe(false)
    if (opened.model.kind !== 'course-v10') throw new Error('Lost native driver')
    expect(opened.model.resources.assets.retained).toEqual(bytes)
    expect(opened.model.project.title).toBe('真实工程')
  }
  expect(await launchFileArguments(['guoling-workbench.exe', filename], workspace, true)).toEqual([filename])
  const outside = path.join(root, 'outside.glx'); await fs.copyFile(filename, outside)
  await expect(services.openProject!({ runId: context.runId, path: outside, fileAccess: access })).rejects.toThrow('只能使用工作空间内的文件')
  await fs.writeFile(path.join(workspace, '损坏.glx'), 'not an archive')
  await expect(cold.open(path.join(workspace, '损坏.glx'))).rejects.toThrow()
})
