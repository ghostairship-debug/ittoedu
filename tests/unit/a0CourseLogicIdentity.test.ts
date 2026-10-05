// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { executeCourseLogicAuthoringCommand, commitCourseLogicAuthoringCommand } from '../../src/renderer/course/courseLogicAuthoringCommands'
import { interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { JsonValue } from '../../src/shared/contracts/component-platform'

function fixture() {
  const project = createBlankCourseProjectV10('库组件状态引用')
  project.logic = { courseState: [{ key: 'score', valueType: 'number', defaultValue: 0 }], navigationGuards: [] }
  for (const [id, source] of [['local', false], ['global', true]] as const) {
    const definitionId = `library-${id}-rules`
    project.definitions[definitionId] = { id: definitionId, role: 'behavior', professionalBuiltinKey: 'guoling.interactions',
      implementation: source ? { kind: 'source', language: 'javascript', source: 'export default {}' } : { kind: 'builtin', key: 'guoling.interactions' } }
    project.instances[id] = { id, definitionId, attachments: [{ instanceId: id,
      target: id === 'local' ? { kind: 'surface', surfaceId: project.surfaces[0].id } : { kind: 'project' } }], data: { rules: [{
      id: `rule-${id}`, enabled: true, trigger: { type: 'scene.enter' },
      conditions: [{ type: 'course-state.compare', key: 'score', operator: 'gte', value: 1 }, { type: 'course-state.exists', key: 'score', exists: true }],
      actions: [{ id: `action-${id}`, start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'score', value: 2 } }],
    }] } }
    if (id === 'local') project.surfaces[0].childIds.push(id)
    else project.global.underlay.push(id)
  }
  return project
}

it('renames state references in library rebound and source interaction behaviors in the same formal edit', () => {
  const project = fixture(), driver = new CourseV10Driver()
  const originalSource = project.definitions['library-global-rules'].implementation
  const result = executeCourseLogicAuthoringCommand(project, { projectId: project.id, baseRevision: project.revision,
    kind: 'course-state.update', key: 'score', declaration: { key: 'mastery', valueType: 'number', defaultValue: 0 } })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  expect(result.edits.filter(edit => edit.type === 'data.set').map(edit => edit.instanceId)).toEqual(['local', 'global'])
  const model = driver.apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, result.edits))
  if (model.kind !== 'course-v10') throw new Error('Expected a formal V10 model')
  expect(model.project.logic!.courseState).toEqual([{ key: 'mastery', valueType: 'number', defaultValue: 0 }])
  for (const id of ['local', 'global']) {
    const rule = interactionRules(model.project.instances[id])[0]
    expect(rule.conditions).toEqual([{ type: 'course-state.compare', key: 'mastery', operator: 'gte', value: 1 }, { type: 'course-state.exists', key: 'mastery', exists: true }])
    expect(rule.actions[0].action).toEqual({ type: 'course-state.set', key: 'mastery', value: 2 })
    expect(model.project.instances[id].definitionId).toBe(project.instances[id].definitionId)
  }
  expect(model.project.definitions['library-global-rules'].implementation).toEqual(originalSource)
})

it('refuses deletion of a state still referenced by either library rebound or source interaction behavior', () => {
  for (const id of ['local', 'global']) {
    const project = fixture()
    for (const other of ['local', 'global']) if (other !== id) project.instances[other].data = { rules: [] }
    const original = structuredClone(project)
    const result = executeCourseLogicAuthoringCommand(project, { projectId: project.id, baseRevision: project.revision, kind: 'course-state.delete', key: 'score' })
    expect(result).toMatchObject({ ok: false, code: 'state-referenced', historyEntry: false })
    expect(project).toEqual(original)
  }
})

const fixtures: { bridge: CourseV10DocumentBridge; directory: string }[] = []
afterEach(async () => {
  for (const { bridge, directory } of fixtures.splice(0)) {
    bridge.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('updates course logic from a named presentation state across base/question/answer and restores the whole edit with one undo', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.logic!.courseState.push({ key: 'stateOnly', valueType: 'boolean', defaultValue: true })
  project.surfaces[0].presentation = { initialStateId: 'question', thumbnailStateId: 'answer', states: [
    { id: 'question', title: '问题', overrides: { local: { style: { label: '保留问题样式' } } } },
    { id: 'answer', title: '答案', overrides: { local: { visible: false, style: { label: '保留答案样式' } } } },
  ] }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-logic-state-'))
  const host = new DocumentHostService(directory), bridge = new CourseV10DocumentBridge()
  fixtures.push({ bridge, directory })
  const api = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(), subscribe: listener => host.subscribeEvents(listener) } as DocumentHostAPI
  await bridge.connect(api)
  await bridge.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  const documentId = bridge.read().activeDocumentId!
  const kernel = createEditorStoreKernel({ bridge, commit: vi.fn() })
  for (const stateId of ['question', 'answer']) {
    bridge.selectPresentationState(documentId, stateId, surfaceId)
    const rules = [...interactionRules(project.instances.local), { id: `state-only-${stateId}`, enabled: true, trigger: { type: 'scene.enter' },
      conditions: [{ type: 'course-state.exists', key: 'stateOnly', exists: true }],
      actions: [{ id: `set-${stateId}`, start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'score', value: 10 } }],
    }]
    const target = kernel.captureTarget(documentId)
    await kernel.editCaptured(kernel.capture([{ type: 'data.set', instanceId: 'local', path: ['rules'], value: JSON.parse(JSON.stringify(rules)) as JsonValue }], target))
  }
  bridge.selectPresentationState(documentId, 'question', surfaceId)
  const before = structuredClone(bridge.read().project!), undoDepth = bridge.read().snapshot!.undoDepth
  const deleted = await commitCourseLogicAuthoringCommand(kernel, documentId, { projectId: before.id, baseRevision: before.revision,
    kind: 'course-state.delete', key: 'stateOnly' })
  expect(deleted).toMatchObject({ ok: false, code: 'state-referenced', historyEntry: false })
  expect(bridge.read().project).toEqual(before)
  const renamed = await commitCourseLogicAuthoringCommand(kernel, documentId, { projectId: before.id, baseRevision: before.revision,
    kind: 'course-state.update', key: 'score', declaration: { key: 'mastery', valueType: 'number', defaultValue: 0 } })
  expect(renamed.ok).toBe(true)
  if (!renamed.ok) throw new Error(renamed.reason)
  expect(renamed.historyEntry).toBe(true)
  expect(renamed.edits.filter(edit => edit.type === 'surface.presentation.set')).toHaveLength(1)
  expect(bridge.read().snapshot!.undoDepth).toBe(undoDepth + 1)
  expect(bridge.read().activeStateId).toBe('question')
  const after = bridge.read().project!, presentation = after.surfaces[0].presentation!
  expect(after.logic!.courseState.map(state => state.key)).toEqual(['mastery', 'stateOnly'])
  const ruleSlots = [interactionRules(after.instances.local), interactionRules(after.instances.global),
    ...presentation.states.map(state => interactionRules({ ...after.instances.local, data: state.overrides.local.data! }))]
  for (const rules of ruleSlots) {
    expect(rules[0].conditions).toEqual([{ type: 'course-state.compare', key: 'mastery', operator: 'gte', value: 1 }, { type: 'course-state.exists', key: 'mastery', exists: true }])
    for (const rule of rules) expect(rule.actions[0].action).toMatchObject({ type: 'course-state.set', key: 'mastery' })
  }
  for (let index = 0; index < presentation.states.length; index++) {
    const state = presentation.states[index], original = before.surfaces[0].presentation!.states[index]
    expect(state.overrides.local.style).toEqual(original.overrides.local.style)
    expect(state.overrides.local.visible).toBe(original.overrides.local.visible)
    expect(interactionRules({ ...after.instances.local, data: state.overrides.local.data! })[1].conditions).toEqual([{ type: 'course-state.exists', key: 'stateOnly', exists: true }])
  }
  expect(presentation.initialStateId).toBe('question')
  expect(presentation.thumbnailStateId).toBe('answer')
  await bridge.undo(documentId)
  expect(bridge.read().project!.logic).toEqual(before.logic)
  expect(bridge.read().project!.instances).toEqual(before.instances)
  expect(bridge.read().project!.surfaces).toEqual(before.surfaces)
  expect(bridge.read().snapshot!.undoDepth).toBe(undoDepth)
})
