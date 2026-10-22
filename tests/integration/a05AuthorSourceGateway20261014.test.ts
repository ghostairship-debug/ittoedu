// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const model = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}

it('uses public object source paths with existing project authorization for private edits, undo and cold reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'a05-source-gateway-'))
  const host = new DocumentHostService(path.join(directory, 'host'))
  try {
    const project = createBlankCourseProjectV10('Source Gateway')
    project.definitions.web = { id: 'web', role: 'content', title: 'Web', implementation: { kind: 'builtin', key: 'guoling.web' } }
    for (const id of ['a', 'b']) project.instances[id] = { id, definitionId: 'web', data: { html: `<h1>${id}</h1>` },
      frame: { width: 320, height: 180, transform: [1, 0, 0, 1, id === 'a' ? 30 : 420, 50] } }
    testContainerInstance(project, 0).childIds = ['a', 'b']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'a05.glx')
    const target = { kind: 'course-instance' as const, surfaceId: componentSurfaces(project)[0].id, instanceId: 'a' }
    await host.tools.beginRun({ runId: 'source', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }], selection: [target] }] })
    await host.tools.loadToolFamilies('source', ['content'])
    let sequence = 0
    const tool = (name: string, input: unknown) => host.tools.execute('source', `source-${++sequence}`, { name, input })
    const initialFiles = componentProjectFiles(project, model(initial).resources)
    const entry = initialFiles.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && !file.authorSource?.dependencyId)!
    expect(await tool('project.read', { path: entry.path })).toMatchObject({ kind: 'read', data: { content: entry.content } })
    const firstApply = await tool('project.apply', { path: entry.path, edits: [{ old: 'return implementation.mount(context);', new: 'context.root.dataset.private = "a"; return implementation.mount(context);' }] })
    expect(firstApply, JSON.stringify(firstApply))
      .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const afterRoot = await host.internalAPI.read(initial.documentId)
    expect(model(afterRoot).project.instances.b).toEqual(project.instances.b)
    const files = componentProjectFiles(model(afterRoot).project, model(afterRoot).resources)
    const dependency = files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && file.authorSource?.dependencyId)!
    expect(await tool('project.read', { path: dependency.path, offset: 0, limit: 64 })).toMatchObject({ kind: 'read' })
    expect(await tool('project.apply', { path: dependency.path, content: `${dependency.content}\n// Private author change\n` }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const saved = await host.internalAPI.read(initial.documentId)
    expect(saved.undoDepth).toBe(2)
    expect(model(saved).project.instances.b).toEqual(project.instances.b)
    expect(await host.internalAPI.dispatch({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
      actor: 'human', operationId: 'undo-source', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = await host.internalAPI.read(initial.documentId)
    expect(model(undone).project.definitions).toEqual(model(afterRoot).project.definitions)
    expect(await host.internalAPI.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
      actor: 'human', operationId: 'redo-source', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
    const filename = path.join(directory, 'saved.glx')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    const latest = await host.internalAPI.read(initial.documentId)
    expect(reopened.model).toEqual(latest.model)
  } finally {
    await host.tools.stop('source')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
