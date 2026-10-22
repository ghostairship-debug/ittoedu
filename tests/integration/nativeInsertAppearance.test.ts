// @vitest-environment node
import { setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { defaultShapeData } from '../../src/components/shape/data'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}
function applied(result: ToolResult) {
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (result.kind !== 'document-operation') throw new Error('Expected insertion receipt')
  return result
}
async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'guoling-native-insert-appearance-'))
  const host = new DocumentHostService(path.join(root, 'recovery'))
  const project = createBlankCourseProjectV10('初始外观')
  project.global.overlay = []
  project.instances = {}
  project.definitions = { [TEXT_DEFINITION.id]: TEXT_DEFINITION }
  for (const [id, text] of [['slide-old', '人工内容'], ['flow-before', '前文'], ['flow-after', '后文']]) {
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(text))) }
  }
  setRootContainers(project, [
    { id: 'slide', kind: 'slide', title: '演示页', childIds: ['slide-old'], designSize: { width: 1280, height: 720 },
      presentation: { states: [{ id: 'default', title: 'Default', order: ['slide-old'], overrides: {} },
        { id: 'other', title: 'Other', order: ['slide-old'], overrides: {} }] } },
    { id: 'flow', kind: 'flow', title: '讲义', childIds: ['flow-before', 'flow-after'] },
  ])
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'appearance.glx')
  await host.tools.beginRun({ runId: 'appearance', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  await host.tools.loadToolFamilies('appearance', ['content'])
  let operation = 0
  const call = (name: string, input: unknown) => host.tools.execute('appearance', `appearance-${++operation}`, { name, input })
  const issue = (target: ToolTarget) => host.tools.issueTarget('appearance', initial.documentId, target)
  const read = () => host.internalAPI.read(initial.documentId)
  const history = async (type: 'undo' | 'redo') => {
    const snapshot = await read()
    return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      actor: 'human', operationId: `history-${++operation}`, mutation: { type } })
  }
  const cleanup = async () => {
    await host.tools.stop('appearance')
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('guoling-native-insert-appearance-'))
      throw new Error('Unexpected test temporary directory')
    await rm(root, { recursive: true, force: true })
  }
  return { root, host, initial, call, issue, read, history, cleanup }
}

it('inserts native content, frame and initial appearance in one history entry and preserves them through redo and disk cold-open', async () => {
  const f = await harness()
  try {
    const target = await f.issue({ kind: 'course-surface', surfaceId: 'slide' })
    const text = 'Why do they do it?'
    applied(await f.call('object.insert', { target, kind: 'text', text, x: 60, y: 34, width: 720, height: 58,
      appearance: { fontSize: 40, color: '#1f3a5f', bold: true, shadows: [{ x: 1, y: 2, blur: 3, color: '#445566' }] } }))
    const after = await f.read(), project = course(after).project
    const id = componentSurfaces(project)[0].childIds[1], instance = project.instances[id]
    const expected = createTextComponentData(text)
    expected.appearance = { ...expected.appearance, fontSize: 40, color: '#1f3a5f', bold: true }
    expect(after.revision).toBe(f.initial.revision + 1)
    expect(after.undoDepth).toBe(1)
    expect(instance.data).toEqual(expected)
    expect(instance.frame).toEqual({ width: 720, height: 58, transform: [1, 0, 0, 1, 60, 34] })
    expect(instance.style).toEqual({ textShadow: '1px 2px 3px #445566' })
    expect(project.instances['slide-old']).toEqual(course(f.initial).project.instances['slide-old'])
    expect(await f.history('undo')).toMatchObject({ status: 'applied' })
    const undone = await f.read()
    expect(course(undone).project.instances[id]).toBeUndefined()
    expect(componentSurfaces(course(undone).project)[0].childIds).toEqual(['slide-old'])
    expect(undone.undoDepth).toBe(0)
    expect(await f.history('redo')).toMatchObject({ status: 'applied' })
    expect(course(await f.read()).project.instances[id]).toEqual(instance)

    const shapeTarget = await f.issue({ kind: 'course-surface', surfaceId: 'slide' })
    applied(await f.call('object.insert', { target: shapeTarget, kind: 'shape', shapeType: 'rounded-rectangle',
      appearance: { fillColor: '#f7fafd', borderColor: '#d9e5f1', borderWidth: 3 } }))
    const saved = await f.read(), savedProject = course(saved).project
    const shapeId = componentSurfaces(savedProject)[0].childIds[2], shape = savedProject.instances[shapeId]
    const shapeDefault = defaultShapeData('rounded-rectangle')
    expect(shape.data).toEqual({ ...shapeDefault, style: { ...shapeDefault.style, fillColor: '#f7fafd', borderColor: '#d9e5f1', borderWidth: 3 } })
    const filename = path.join(f.root, 'saved.glx')
    await f.host.internalAPI.save(f.initial.documentId, filename)
    const cold = await new DocumentHostService(path.join(f.root, 'cold')).internalAPI.open(filename)
    expect(course(cold).project.instances[id]).toEqual(instance)
    expect(course(cold).project.instances[shapeId]).toEqual(shape)
    expect(componentSurfaces(course(cold).project)[0].childIds).toEqual(['slide-old', id, shapeId])
    expect(cold.dirty).toBe(false)
  } finally { await f.cleanup() }
})

it('matches post-insert appearance in a named Slide state, retains Flow reading order and rejects invalid initial appearance without a partial insertion', async () => {
  const f = await harness()
  try {
    const target = await f.issue({ kind: 'course-surface', surfaceId: 'slide', stateId: 'default' })
    const input = { kind: 'text', text: '状态内容', x: 120, y: 160, width: 300, height: 80 }
    const appearance = { fontSize: 32, color: '#234567', italic: true, shadows: [{ x: 2, y: 1, blur: 0, color: '#345678' }] }
    applied(await f.call('object.insert', { ...input, target, appearance }))
    const first = componentSurfaces(course(await f.read()).project)[0].childIds[1]
    const legacy = applied(await f.call('object.insert', { ...input, target }))
    const second = componentSurfaces(course(await f.read()).project)[0].childIds[2]
    applied(await f.call('object.update', { target: legacy.affected![0], properties: { appearance } }))
    const snapshot = await f.read(), project = course(snapshot).project
    const base = createTextComponentData(input.text)
    expect(project.instances[first].data).toEqual(base)
    expect(project.instances[second].data).toEqual(base)
    expect(project.instances[first].style).toBeUndefined()
    expect(project.instances[second].style).toBeUndefined()
    expect(project.instances[first].visible).toBe(false)
    expect(project.instances[second].visible).toBe(false)
    const active = resolveComponentPresentation(project, 'slide', 'default')
    expect(active.instances[first].data).toEqual(active.instances[second].data)
    expect(active.instances[first].style).toEqual(active.instances[second].style)
    expect(active.instances[first].frame).toEqual(active.instances[second].frame)
    expect(active.instances[first].visible).toBe(true)
    expect(componentSurfaces(active)[0].childIds).toEqual(['slide-old', first, second])
    const other = resolveComponentPresentation(project, 'slide', 'other')
    expect(other.instances[first].data).toEqual(base)
    expect(other.instances[first].visible).toBe(false)
    expect(componentSurfaces(project)[0].presentation!.states[1]).toEqual(componentSurfaces(course(f.initial).project)[0].presentation!.states[1])
    expect(project.instances['slide-old']).toEqual(course(f.initial).project.instances['slide-old'])

    const flowTarget = await f.issue({ kind: 'course-surface', surfaceId: 'flow' })
    applied(await f.call('object.insert', { target: flowTarget, kind: 'text', text: '中间新正文', destination: 'document', index: 1,
      appearance: { fontSize: 30, bold: true } }))
    const flowSnapshot = await f.read(), flowProject = course(flowSnapshot).project
    const flow = componentSurfaces(flowProject)[1], flowId = flow.childIds[1]
    expect(flow.childIds).toEqual(['flow-before', flowId, 'flow-after'])
    expect(flowProject.instances[flowId].data).toMatchObject({ content: { inlines: [{ type: 'text', text: '中间新正文' }] }, appearance: { fontSize: 30, bold: true } })
    expect(flowProject.instances[flowId].flowPlacement).toBeUndefined()
    expect(flowProject.instances['flow-before']).toEqual(course(f.initial).project.instances['flow-before'])
    expect(flowProject.instances['flow-after']).toEqual(course(f.initial).project.instances['flow-after'])
    for (const invalid of [{ kind: 'text', appearance: { fontSize: 0 } }, { kind: 'input', appearance: { color: '#234567' } }]) {
      expect(await f.call('object.insert', { target: flowTarget, ...invalid }), JSON.stringify(invalid)).toMatchObject({ kind: 'error' })
      const rejected = await f.read()
      expect(rejected.revision).toBe(flowSnapshot.revision)
      expect(rejected.undoDepth).toBe(flowSnapshot.undoDepth)
      expect(course(rejected).project).toEqual(flowProject)
    }
  } finally { await f.cleanup() }
})
