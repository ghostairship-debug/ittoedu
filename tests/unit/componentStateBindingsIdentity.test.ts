import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { executeCourseLogicAuthoringCommand } from '../../src/core/course/courseLogicAuthoringCommands'
import { duplicateSurfaceEdits } from '../../src/core/course/courseSurfaceStructure'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { INPUT_DEFINITION, createInputData, inputDataSchema } from '../../src/components/input/data'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { CourseStateDeclaration } from '../../src/shared/contracts/course-state/types'

const resources = { assets: {}, components: {} }
function fixture(managed = false) {
  const project = createBlankCourseProjectV10('显式状态引用')
  const answer = managed ? 'input:input:value' : 'score', valid = managed ? 'input:input:valid' : 'valid'
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "export default { mount() { const authoredText = 'score'; return { dispose() {} } } }" } }
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.instances.program = { id: 'program', definitionId: 'source', data: { note: 'score' },
    stateBindings: { answer, validity: valid, progress: 'shared' } }
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id,
    data: createInputData({ stateKey: 'feedback', answer: { type: 'number', stateKey: answer, validityKey: valid, ruleFamilyRuleIds: [] } }) }
  testContainerInstance(project, 0).childIds = ['program', 'input']
  project.logic = { courseState: [{ key: answer, valueType: 'number', defaultValue: 3 }, { key: valid, valueType: 'boolean', defaultValue: false },
    { key: 'shared', valueType: 'string', defaultValue: 'incoming' }, { key: 'feedback', valueType: 'string', defaultValue: '' },
    { key: 'unused', valueType: 'number', defaultValue: 99 }], navigationGuards: [] }
  return project
}
function apply(project: CourseProjectV10, edits: ComponentEdit[]) {
  const driver = new CourseV10Driver()
  const model = driver.apply({ kind: 'course-v10', project, resources }, captureComponentOperation(project, edits))
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  return model.project
}

it('roundtrips explicit scalar aliases while retaining an undeclared alias for local diagnosis', () => {
  const project = fixture()
  project.instances.program.stateBindings!.missing = 'not-declared'
  expect(courseProjectV10Schema.parse(project).instances.program.stateBindings).toEqual(project.instances.program.stateBindings)
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project, resources }))
  expect(reopened.kind === 'course-v10' && reopened.project.instances.program.stateBindings).toEqual(project.instances.program.stateBindings)
  expect(courseProjectV10Schema.safeParse({ ...project, instances: { ...project.instances, program: { ...project.instances.program, stateBindings: { broken: 42 } } } }).success).toBe(false)
})

it('renames explicit aliases and all input state fields in base and presentation data without rewriting source or prose', () => {
  let project = fixture()
  testContainerInstance(project, 0).container!.presentation = { states: [{ id: 'answer', title: '答案', overrides: { input: { data: structuredClone(project.instances.input.data), visible: false } } }] }
  const implementation = structuredClone(project.definitions.source.implementation)
  for (const [from, to] of [['score', 'mastery'], ['valid', 'isValid'], ['feedback', 'feedbackResult']] as const) {
    const declaration = { ...project.logic!.courseState.find(value => value.key === from)!, key: to } as CourseStateDeclaration
    const planned = executeCourseLogicAuthoringCommand(project, { projectId: project.id, baseRevision: project.revision,
      kind: 'course-state.update', key: from, declaration })
    if (!planned.ok) throw new Error(planned.reason)
    project = apply(project, planned.edits)
  }
  expect(project.instances.program.stateBindings).toEqual({ answer: 'mastery', validity: 'isValid', progress: 'shared' })
  for (const data of [project.instances.input.data, testContainerInstance(project, 0).container!.presentation!.states[0].overrides.input.data!]) {
    expect(inputDataSchema.parse(data)).toMatchObject({ stateKey: 'feedbackResult', answer: { stateKey: 'mastery', validityKey: 'isValid' } })
  }
  expect(testContainerInstance(project, 0).container!.presentation!.states[0].overrides.input.visible).toBe(false)
  expect(project.instances.program.data).toEqual({ note: 'score' })
  expect(project.definitions.source.implementation).toEqual(implementation)
})

it('keeps referenced declarations when an alias or an input still uses them', () => {
  const project = fixture(), before = structuredClone(project)
  for (const key of ['shared', 'feedback', 'score', 'valid']) expect(executeCourseLogicAuthoringCommand(project, {
    projectId: project.id, baseRevision: project.revision, kind: 'course-state.delete', key,
  })).toMatchObject({ ok: false, code: 'state-referenced' })
  expect(project).toEqual(before)
})

it.each(['page', 'objects'] as const)('keeps shared aliases and follows managed input identities during same-course %s copy', mode => {
  for (const managed of [true, false]) {
    const project = fixture(managed), surfaceId = componentSurfaces(project)[0].id
    const before = structuredClone(project)
    const copy = mode === 'page' ? duplicateSurfaceEdits(project, surfaceId) : prepareCourseObjectPaste(
      { documentId: 'same-document', project, resources, roots: ['program', 'input'] },
      { capturedTarget: { documentId: 'same-document', project, resources, surfaceId }, container: { kind: 'surface', surfaceId }, index: 2 })
    const ids = 'ids' in copy ? copy.ids : copy.idMap
    const next = apply(project, copy.edits), input = inputDataSchema.parse(next.instances[ids.get('input')!].data)
    expect(next.instances[ids.get('program')!].stateBindings).toEqual({ answer: input.answer!.stateKey, validity: input.answer!.validityKey, progress: 'shared' })
    expect(input.answer!.stateKey).toBe(managed ? `input:${ids.get('input')}:value` : 'score')
    expect(next.logic!.courseState.some(state => state.key === input.answer!.stateKey)).toBe(true)
    expect(next.logic!.courseState.filter(state => state.key === 'shared')).toHaveLength(1)
    expect(project).toEqual(before)
  }
})

it('carries a copied object alias and its declaration across courses without binding to the destination same-named state', () => {
  const source = fixture(), destination = createBlankCourseProjectV10('目标'), surfaceId = componentSurfaces(destination)[0].id
  source.instances.program.stateBindings = { progress: 'shared' }
  destination.logic = { courseState: [{ key: 'shared', valueType: 'string', defaultValue: 'destination' }], navigationGuards: [] }
  const copy = prepareCourseObjectPaste({ documentId: 'source-document', project: source, resources, roots: ['program'] },
    { capturedTarget: { documentId: 'target-document', project: destination, resources, surfaceId }, container: { kind: 'surface', surfaceId }, index: 0 })
  const next = apply(destination, copy.edits), key = next.instances[copy.rootIds[0]].stateBindings!.progress
  expect(key).not.toBe('shared')
  expect(next.logic!.courseState).toContainEqual({ key, valueType: 'string', defaultValue: 'incoming' })
  expect(next.logic!.courseState).toContainEqual({ key: 'shared', valueType: 'string', defaultValue: 'destination' })
})

it('carries only explicitly referenced state declarations in a single object library entry and rebinds destination conflicts', () => {
  const source = fixture()
  source.instances.program.stateBindings = { progress: 'shared' }
  const entry = extractComponentLibraryEntry(source, resources, { id: 'state-object', title: '程序', rootIds: ['program'] }).entry
  expect(entry.logic).toEqual({ courseState: [{ key: 'shared', valueType: 'string', defaultValue: 'incoming' }], navigationGuards: [] })
  const destination = createBlankCourseProjectV10('目标')
  destination.logic = { courseState: [{ key: 'shared', valueType: 'string', defaultValue: 'destination' }], navigationGuards: [] }
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 0,
    rootIds: ['program'] })
  const next = apply(destination, insertion.command.edits), copy = next.instances[insertion.rootIds[0]]
  const rebound = copy.stateBindings!.progress
  expect(rebound).not.toBe('shared')
  expect(next.logic!.courseState).toContainEqual({ key: rebound, valueType: 'string', defaultValue: 'incoming' })
  expect(next.logic!.courseState).toContainEqual({ key: 'shared', valueType: 'string', defaultValue: 'destination' })
  expect(next.definitions[copy.definitionId].implementation).toMatchObject(source.definitions.source.implementation)
})

it('allocates library input identities before binding an earlier Source instance and rebinds custom input conflicts', () => {
  for (const managed of [true, false]) {
    const source = fixture(managed)
    const entry = extractComponentLibraryEntry(source, resources, { id: 'state-group', title: '输入与程序', rootIds: ['program', 'input'] }).entry
    const destination = createBlankCourseProjectV10('目标')
    destination.logic = structuredClone(source.logic!)
    const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 0 })
    const next = apply(destination, insertion.command.edits)
    const program = next.instances[insertion.identities.instances.get('program')!]
    const input = inputDataSchema.parse(next.instances[insertion.identities.instances.get('input')!].data)
    expect(program.stateBindings!.answer).toBe(input.answer!.stateKey)
    expect(program.stateBindings!.validity).toBe(input.answer!.validityKey)
    expect(program.stateBindings!.progress).not.toBe('shared')
    expect(input.answer!.stateKey).not.toBe(inputDataSchema.parse(source.instances.input.data).answer!.stateKey)
    expect(input.stateKey).not.toBe('feedback')
    expect(next.logic!.courseState.some(state => state.key === input.answer!.stateKey)).toBe(true)
    expect(next.logic!.courseState.some(state => state.key === input.stateKey)).toBe(true)
  }
})

it('keeps a missing library alias unbound when its authored key collides with destination state', () => {
  const source = fixture(), destination = createBlankCourseProjectV10('目标')
  source.instances.program.stateBindings = { progress: 'missing-from-source' }
  destination.logic = { courseState: [{ key: 'missing-from-source', valueType: 'number', defaultValue: 11 }], navigationGuards: [] }
  const entry = extractComponentLibraryEntry(source, resources, { id: 'missing-state', title: '保留原程序', rootIds: ['program'] }).entry
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 0 })
  const next = apply(destination, insertion.command.edits), instance = next.instances[insertion.rootIds[0]]
  expect(instance.stateBindings!.progress).not.toBe('missing-from-source')
  expect(next.logic).toEqual(destination.logic)
  expect(instance.data).toEqual(source.instances.program.data)
  expect(insertion.diagnostics).toContainEqual(expect.objectContaining({ code: 'state-binding-required' }))
})
