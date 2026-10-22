// @vitest-environment node
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { ElementChangeTracker } from '../../src/main/workbench/execution/ElementChangeTracker'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { componentSurface } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'

const frame = (x: number) => ({ width: 200, height: 80, transform: [1, 0, 0, 1, x, 5] as [number, number, number, number, number, number] })
const textData = (text: string) => textDataEdit('text', createTextComponentData(text)).value

it.each([false, true])('reverts a real named-state card without changing base or another state (nested=%s)', async nested => {
  const project = createBlankCourseProjectV10('状态撤回卡'), rootId = project.rootIds[0]!
  const scopeId = nested ? 'inner' : rootId
  if (nested) {
    project.instances.inner = { id: 'inner', definitionId: project.instances[rootId].definitionId, data: {}, childIds: [], container: { kind: 'slide' } }
    project.instances[rootId].childIds = ['inner']
  }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: textData('基础文字'), frame: frame(10) }
  const scope = project.instances[scopeId]
  scope.childIds = ['text']
  scope.container!.presentation = { states: [
    { id: 'detail', title: '当前状态', overrides: { text: { frame: frame(20) } } },
    { id: 'other', title: '其他状态', overrides: { text: { frame: frame(40), data: textData('其他状态文字') } } },
  ] }
  const base = structuredClone(project.instances.text), originalStates = structuredClone(scope.container!.presentation!.states)
  const session = await DocumentSession.create({ documentId: 'state-card', epoch: 'epoch',
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'state-card.glx' } }, new CourseV10Driver(), {
    async append() {}, async save() { throw new Error('This focused card does not save files') },
  })
  const tracker = new ElementChangeTracker('conversation', session.documentId,
    { kind: 'course-instance', surfaceId: scopeId, instanceId: 'text', stateId: 'detail' }, session, session.read())
  tracker.bindRun('agent-run')
  try {
    const command = captureComponentOperation(project, presentationComponentEdits(project, scopeId, 'detail', [
      { type: 'frame.set', instanceId: 'text', frame: frame(30) },
      { type: 'data.set', instanceId: 'text', path: [], value: textData('AI 状态文字') },
      { type: 'style.set', instanceId: 'text', path: [], value: { opacity: 0.7 } },
    ]))
    expect(await session.execute({ documentId: session.documentId, epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'agent-state-edit', actor: 'agent', runId: 'agent-run', mutation: { type: 'command', command } })).toMatchObject({ status: 'applied' })
    tracker.finish()
    expect(tracker.view('submission')).toMatchObject({ state: 'applied' })
    const current = () => {
      const model: DocumentModel = session.read().model
      if (model.kind !== 'course-v10') throw new Error('Expected work project')
      return model.project
    }
    const states = () => componentSurface(current(), scopeId)!.presentation!.states
    const edited = structuredClone(states()[0])
    expect(await tracker.revert('submission', 'undo')).toMatchObject({ status: 'applied', change: { state: 'undone' } })
    expect(states()).toEqual(originalStates)
    expect(states()[0].overrides.text).not.toHaveProperty('data')
    expect(states()[0].overrides.text).not.toHaveProperty('style')
    expect(current().instances.text).toEqual(base)
    expect(await tracker.revert('submission', 'redo')).toMatchObject({ status: 'applied', change: { state: 'applied' } })
    expect(states()[0]).toEqual(edited)
    expect(states()[1]).toEqual(originalStates[1])
    expect(current().instances.text).toEqual(base)
  } finally { tracker.dispose() }
})
