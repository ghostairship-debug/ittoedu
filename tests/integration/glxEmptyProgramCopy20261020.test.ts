// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'

it('duplicates into an empty program native plane using its own scoped grant and keeps ordinary leaves invalid', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-empty-program-copy-'))
  const host = new DocumentHostService(path.join(directory, 'state'))
  try {
    let id = 0
    const project = createBlankCourseProjectV10('Copy source', () => `source-${++id}`), sourceRootId = project.rootIds[0]!
    const program = createBlankProgramProject('Empty destination', () => `program-${++id}`), programId = program.rootIds[0]!
    Object.assign(project.definitions, program.definitions, { [TEXT_DEFINITION.id]: TEXT_DEFINITION })
    Object.assign(project.instances, program.instances)
    project.rootIds.push(programId)
    const text = textDataEdit('original', createTextComponentData('保留可编辑正文')).value
    project.instances.original = { id: 'original', definitionId: TEXT_DEFINITION.id, data: text,
      frame: { width: 260, height: 90, transform: [1, 0, 0, 1, 40, 50] } }
    project.instances[sourceRootId].childIds = ['original']
    project.instances.leaf = { id: 'leaf', definitionId: TEXT_DEFINITION.id, data: text }
    project.rootIds.push('leaf')
    expect(project.instances[programId].childIds).toBeUndefined()
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'copy.glx')
    await host.tools.beginRun({ runId: 'copy', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [
      { kind: 'course-instance', surfaceId: sourceRootId, instanceId: 'original' },
      { kind: 'course-instance', surfaceId: programId, instanceId: programId },
      { kind: 'course-instance', surfaceId: 'leaf', instanceId: 'leaf' },
    ] }] })
    const source = await host.tools.issueTarget('copy', initial.documentId, { kind: 'course-instance', surfaceId: sourceRootId, instanceId: 'original' })
    const destination = await host.tools.issueTarget('copy', initial.documentId, { kind: 'course-instance', surfaceId: programId, instanceId: programId })
    const result = await host.tools.execute('copy', 'duplicate', { name: 'object.structure', input: { target: source, action: 'duplicate', destination } })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const copied = await host.internalAPI.read(initial.documentId)
    if (copied.model.kind !== 'course-v10') throw new Error('Expected work project')
    const children = copied.model.project.instances[programId].childIds!
    expect(children).toHaveLength(1)
    expect(children[0]).not.toBe('original')
    expect(copied.model.project.instances[children[0]!].data).toEqual(text)
    expect(copied.model.project.instances[programId]).toEqual({ ...project.instances[programId], childIds: children })
    expect(copied.model.project.instances.original).toEqual(project.instances.original)
    expect(copied.model.project.instances[sourceRootId]).toEqual(project.instances[sourceRootId])
    expect(copied.undoDepth).toBe(1)
    const freshSource = await host.tools.issueTarget('copy', initial.documentId, { kind: 'course-instance', surfaceId: sourceRootId, instanceId: 'original' })
    const invalid = await host.tools.issueTarget('copy', initial.documentId, { kind: 'course-instance', surfaceId: 'leaf', instanceId: 'leaf' })
    expect(await host.tools.execute('copy', 'invalid-leaf', { name: 'object.structure', input: { target: freshSource, action: 'duplicate', destination: invalid } })).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expect(await host.internalAPI.read(initial.documentId)).toEqual(copied)
    expect(await host.internalAPI.dispatch({ documentId: copied.documentId, epoch: copied.epoch, baseRevision: copied.revision,
      actor: 'human', operationId: 'undo-copy', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = await host.internalAPI.read(initial.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('Expected work project')
    expect(undone.model.project.instances).toEqual(project.instances)
  } finally { await host.tools.stop('copy').catch(() => undefined); await fs.rm(directory, { recursive: true, force: true }) }
})
