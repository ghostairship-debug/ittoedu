// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { courseAuthorData } from '../../src/renderer/media/commitCourseMediaAuthoring'
import type { ToolResult } from '../../src/shared/workbench/tools'

it('adds, names, reorders and removes observed mixed pages through the public Gateway with one History entry per change and enforced read-only authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-v10-')), host = new DocumentHostService(path.join(root, 'state'))
  try {
    const project = createBlankCourseProjectV10('页面文件'), frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 40, 50] as [number, number, number, number, number, number] }
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextData('保留人工内容')), frame }
    project.surfaces[0].childIds.push('text')
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'pages.glx')
    await host.tools.beginRun({ runId: 'agent', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('agent', ['content'])
    let serial = 0
    const tool = (name: string, input: unknown, runId = 'agent') => host.tools.execute(runId, `call-${++serial}`, { name, input })
    const current = async () => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
      return { snapshot, ...snapshot.model }
    }
    const pagePath = async (id: string) => {
      const model = await current()
      return componentProjectFiles(model.project, model.resources).find(file => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === id)!.path
    }
    const committed = (result: ToolResult) => expect(result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    await tool('project.list', {}); await tool('project.read', { path: 'pages' })
    for (const kind of ['flow', 'spatial'] as const) committed(await tool('project.apply', { path: 'pages', intent: 'surface.add', kind, title: kind }))
    let model = await current()
    expect(model.project.surfaces.map(surface => surface.kind)).toEqual(['slide', 'flow', 'spatial']); expect(model.snapshot.undoDepth).toBe(2)
    const flowId = model.project.surfaces[1].id, spatialId = model.project.surfaces[2].id, firstId = model.project.surfaces[0].id
    let flowPath = await pagePath(flowId), spatialPath = await pagePath(spatialId)
    await tool('project.read', { path: flowPath }); committed(await tool('project.apply', { path: flowPath, intent: 'surface.title', title: '讲义改名' }))
    expect((await current()).project.surfaces[1]).toMatchObject({ id: flowId, title: '讲义改名' })
    flowPath = await pagePath(flowId); spatialPath = await pagePath(spatialId)
    await tool('project.list', {}); await tool('project.read', { path: spatialPath })
    committed(await tool('project.apply', { path: spatialPath, intent: 'surface.move', before: flowPath }))
    model = await current(); expect(model.project.surfaces.map(surface => surface.id)).toEqual([firstId, spatialId, flowId]); expect(model.snapshot.undoDepth).toBe(4)
    flowPath = await pagePath(flowId); await tool('project.read', { path: flowPath })
    const beforeRemove = await current()
    committed(await tool('project.apply', { path: flowPath, intent: 'surface.remove' }))
    model = await current(); expect(model.project.surfaces.map(surface => surface.id)).toEqual([firstId, spatialId]); expect(model.snapshot.undoDepth).toBe(5)
    expect(model.project.instances.text).toEqual(project.instances.text); expect(model.project.global).toEqual(project.global)
    expect(await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: model.snapshot.epoch, baseRevision: model.snapshot.revision,
      actor: 'human', operationId: 'undo-remove', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    model = await current(); expect(model.project.surfaces).toEqual(beforeRemove.project.surfaces)
    await host.tools.beginRun({ runId: 'read-only', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [] }], fileAccess: { permission: 'read-only', workspaceRoot: root } })
    await host.tools.loadToolFamilies('read-only', ['content'])
    expect(await tool('project.list', {}, 'read-only')).toMatchObject({ kind: 'read' })
    const unchanged = await current()
    expect(await tool('project.apply', { path: 'pages', intent: 'surface.add', kind: 'slide', title: '越权' }, 'read-only')).toMatchObject({ kind: 'error' })
    expect(await current()).toEqual(unchanged)
    const filename = path.join(root, 'saved.glx'); await host.internalAPI.save(initial.documentId, filename)
    const cold = await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename)
    expect(cold.model).toEqual(model.snapshot.model)
  } finally { await host.tools.stop('agent'); await host.tools.stop('read-only'); await fs.rm(root, { recursive: true, force: true }) }
})
