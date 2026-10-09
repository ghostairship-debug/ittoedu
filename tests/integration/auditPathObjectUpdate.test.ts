// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import bundledSkills from '../../src/shared/generated/bundledSkills.json'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelToolCall, ToolResult } from '../../src/shared/workbench/tools'

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model.project
}
function readData<T>(result: ToolResult): T {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('Expected read')
  return result.data as T
}

it('edits observed object paths through public Gateway direct/batch, preserves identities and data, and rejects stale or non-free geometry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-audit-path-'))
  const host = new DocumentHostService(path.join(directory, 'journal'))
  host.tools.configureHostServices({ skills: new BundledSkillService(bundledSkills) })
  let serial = 0
  const project = createBlankCourseProjectV10('移动', () => `fixture-${++serial}`)
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  for (const [index, id] of ['a', 'b', 'neighbor'].entries()) project.instances[id] = {
    id, definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextComponentData(`人工文字 ${id}`))),
    style: { opacity: 0.8, color: '#123456' },
    frame: { width: 170 + index, height: 70, transform: [1, 0, 0.2, 1, 42 + index * 200, 31] },
    ...(id === 'neighbor' ? { locked: true } : {}),
  }
  const surfaceId = project.surfaces[0].id
  project.surfaces[0].childIds = ['a', 'b', 'neighbor']
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextComponentData('连续正文'))) }
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body'] })
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '移动.h5lesson')
  const documentId = initial.documentId
  const gateway = host.tools
  const tool = (name: string, input: unknown) => gateway.execute('path', `call-${++serial}`, { name, input })
  const snapshot = () => host.internalAPI.read(documentId)
  const human = async (edits: ComponentEdit[]) => {
    const current = await snapshot()
    return host.internalAPI.dispatch({ documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: `human-${++serial}`, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(course(current), edits) } })
  }
  const list = async () => readData<{ files: { path: string; type: string }[] }>(await tool('project.list', {})).files
  const apply = async (call: ModelToolCall) => {
    const result = await gateway.execute('path', `call-${++serial}`, call)
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    return result
  }
  try {
    await gateway.beginRun({ runId: 'path', actor: 'agent', documents: [{ documentId, writable: [{ kind: 'document' }] }] })
    expect(await tool('skills.read', { skill: 'orchestrate-courseware' })).toMatchObject({ kind: 'read' })
    await gateway.loadToolFamilies('path', ['layout'])
    const names = (await gateway.describeRun('path')).map(tool => tool.name)
    // Project paths and authorized target handles are both current V10 read entrances.
    expect(names).toEqual(expect.arrayContaining(['project.list', 'project.read', 'read', 'inspect', 'object.update', 'batch']))
    expect(await tool('object.update', { path: 'pages/01-第 1 页/01-文字.data.json', properties: { frame: { x: 70 } } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('尚未观察') })

    const files = await list()
    const paths = files.filter(file => /^pages\/01-[^/]+\/\d+-文字\.data\.json$/.test(file.path)).map(file => file.path)
    expect(paths).toHaveLength(3)
    for (const objectPath of paths.slice(0, 2)) expect(readData<{ content: string }>(await tool('project.read', { path: objectPath })).content).toContain('人工文字')
    const structure = files.find(file => file.path.startsWith('pages/01-') && file.type === 'structure')!
    expect(readData<{ content: string }>(await tool('project.read', { path: structure.path })).content).toContain('"frame"')
    const before = await snapshot(), original = structuredClone(course(before).instances)
    const batch: ModelToolCall = { name: 'batch', input: { operations: [
      { name: 'object.update', input: { project: '移动', path: paths[0], properties: { frame: { x: 70, width: 190 } } } },
      { name: 'object.update', input: { path: paths[1], properties: { frame: { y: 90, height: 80 } } } },
    ] } }
    const effects = ['a', 'b'].map(instanceId => ({ documentId, epoch: initial.epoch, target: { kind: 'course-instance', surfaceId, instanceId } }))
    expect(await gateway.effectTargets('path', batch)).toEqual(effects)
    expect(await gateway.preflightBatch('path', batch.input)).toBeNull()
    await apply(batch)
    const changed = await snapshot(), instances = course(changed).instances
    expect(changed.undoDepth).toBe(before.undoDepth + 1)
    expect(instances.a.frame).toEqual({ ...original.a.frame!, width: 190, transform: [1, 0, 0.2, 1, 70, 31] })
    expect(instances.b.frame).toEqual({ ...original.b.frame!, height: 80, transform: [1, 0, 0.2, 1, 242, 90] })
    for (const id of ['a', 'b']) {
      expect(instances[id].data).toEqual(original[id].data)
      expect(instances[id].style).toEqual(original[id].style)
    }
    expect(instances.neighbor).toEqual(original.neighbor)
    expect(await host.internalAPI.dispatch({ documentId, epoch: changed.epoch, baseRevision: changed.revision,
      operationId: 'one-undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    expect(course(await snapshot()).instances).toEqual(original)

    await tool('project.read', { path: paths[0] })
    const direct: ModelToolCall = { name: 'object.update', input: { project: '移动.h5lesson', path: paths[0], properties: { frame: { x: 95 } } } }
    await apply(direct)
    expect(course(await snapshot()).instances.a.frame).toEqual({ ...original.a.frame!, transform: [1, 0, 0.2, 1, 95, 31] })
    // A completed call releases its capture; even the same JS input can start a later call.
    expect(await gateway.execute('path', `repeat-${++serial}`, direct)).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
    const selected = await gateway.issueTarget('path', documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
    await apply({ name: 'object.update', input: { target: selected, properties: { frame: { width: 222 } } } })
    expect(course(await snapshot()).instances.a.frame?.width).toBe(222)

    await tool('project.read', { path: paths[1] })
    expect(await human([{ type: 'style.set', instanceId: 'b', path: ['color'], value: '#abcdef' }])).toMatchObject({ status: 'applied' })
    const humanChanged = await snapshot()
    const stale: ModelToolCall = { name: 'batch', input: { operations: [
      { name: 'object.update', input: { path: paths[0], properties: { frame: { y: 123 } } } },
      { name: 'object.update', input: { path: paths[1], properties: { frame: { x: 888 } } } },
    ] } }
    expect(await gateway.preflightBatch('path', stale.input)).toMatchObject({ kind: 'error', code: 'target-conflict' })
    expect(await gateway.execute('path', `stale-${++serial}`, stale)).toMatchObject({ kind: 'error', code: 'target-conflict' })
    expect(course(await snapshot()).instances).toEqual(course(humanChanged).instances)
    expect((await snapshot()).undoDepth).toBe(humanChanged.undoDepth)

    const freshFiles = await list()
    const bodyPath = freshFiles.find(file => file.path.startsWith('pages/02-') && file.path.endsWith('/01-文字.data.json'))!.path
    expect(await tool('object.update', { path: bodyPath, properties: { frame: { x: 15 } } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('没有自由布局 frame') })
    expect(course(await snapshot()).instances.body.frame).toBeUndefined()
    expect(await tool('object.update', { path: paths[2], properties: { frame: { x: 15 } } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('已锁定') })

    const capturedBatch: ModelToolCall = { name: 'batch', input: { operations: [
      { name: 'object.update', input: { path: paths[0], properties: { frame: { y: 345 } } } },
      { name: 'object.update', input: { path: paths[1], properties: { frame: { x: 678 } } } },
    ] } }
    expect(await gateway.effectTargets('path', capturedBatch)).toEqual(effects)
    expect(await human([{ type: 'instance.move', instanceId: 'a', container: { kind: 'surface', surfaceId }, index: 1 }]))
      .toMatchObject({ status: 'applied' })
    // The directory now reuses each original path for its neighbor. This pending call must keep a/b.
    await list()
    expect(course(await snapshot()).surfaces[0].childIds).toEqual(['b', 'a', 'neighbor'])
    expect(await gateway.effectTargets('path', capturedBatch)).toEqual(effects)
    expect(await gateway.preflightBatch('path', capturedBatch.input)).toBeNull()
    await apply(capturedBatch)
    const afterMapping = course(await snapshot()).instances
    expect(afterMapping.a.frame?.transform).toEqual([1, 0, 0.2, 1, 95, 345])
    expect(afterMapping.b.frame?.transform).toEqual([1, 0, 0.2, 1, 678, 31])
    expect(afterMapping.a.data).toEqual(original.a.data)
    expect(afterMapping.b.data).toEqual(original.b.data)
    expect(afterMapping.a.style).toEqual(original.a.style)
    expect(afterMapping.b.style).toEqual({ ...original.b.style, color: '#abcdef' })
    expect(afterMapping.neighbor).toEqual(original.neighbor)
  } finally {
    await gateway.stop('path')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
