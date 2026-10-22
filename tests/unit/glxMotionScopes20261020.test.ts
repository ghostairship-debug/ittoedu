// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { expect, it } from 'vitest'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { CourseProjectV10, ComponentTarget } from '../../src/shared/contracts/component-platform/project'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { componentEntranceMotionEdits, componentMotionPropertiesView, DEFAULT_COMPONENT_MOTION } from '../../src/shared/componentMotionAuthoring'
import type { InteractionRule } from '../../src/shared/interactionTypes'

const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
function fixture() {
  let id = 0
  const project = createBlankProgramProject('程序', () => `id${++id}`), rootId = project.rootIds[0]
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.flow = { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
  project.instances[rootId].childIds = ['a', 'b']
  for (const name of ['a', 'b']) project.instances[name] = { id: name, definitionId: 'flow', data: {}, childIds: [], container: { kind: 'flow' } }
  project.instances.a.childIds = ['group']
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['text'] }
  project.instances.text = { id: 'text', definitionId: 'group', data: {} }
  return { project, rootId, surfaceId: 'a', instanceId: 'text', activeStateId: null }
}
const rule = (id = 'entrance'): InteractionRule => ({ id, enabled: true, trigger: { type: 'node.activated', nodeId: 'text' }, conditions: [],
  actions: [{ id: `${id}-step`, start: 'after-previous', delayMs: 0,
    action: { type: 'node.enter', nodeId: 'text', effect: 'fade', durationMs: 320, easing: 'ease-out' } }] })

it('does not expose or overwrite another real container behavior that explicitly references the selected node', () => {
  const target = fixture(), ownerB: ComponentTarget = { kind: 'instance', instanceId: 'b' }
  // The formal rule writer accepts this explicit cross-container node action.
  const project = apply(target.project, componentRuleEdits(target.project, ownerB, [rule('b')]))
  const behaviorB = interactionBehavior(project, ownerB)!, before = structuredClone(behaviorB)
  expect(componentMotionPropertiesView({ ...target, project }).entrance).toBeNull()
  const updated = apply(project, componentEntranceMotionEdits({ ...target, project }, { ...DEFAULT_COMPONENT_MOTION, effect: 'scale' }, true))
  expect(updated.instances[behaviorB.id]).toEqual(before)
  const local = interactionBehavior(updated, { kind: 'instance', instanceId: 'a' })!
  expect(componentMotionPropertiesView({ ...target, project: updated }).entrance?.behaviorId).toBe(local.id)
})

it('keeps project-global motion available and resolves ordinary instance attachments through their owning container', () => {
  const target = fixture()
  let project = apply(target.project, componentRuleEdits(target.project, { kind: 'project' }, [rule('global')]))
  const global = interactionBehavior(project, { kind: 'project' })!
  expect(componentMotionPropertiesView({ ...target, project }).entrance?.behaviorId).toBe(global.id)
  project = apply(target.project, componentRuleEdits(target.project, { kind: 'instance', instanceId: 'group' }, [rule('group')]))
  expect(componentMotionPropertiesView({ ...target, project }).entrance?.behaviorId)
    .toBe(interactionBehavior(project, { kind: 'instance', instanceId: 'group' })!.id)
  expect(componentMotionPropertiesView({ ...target, project, surfaceId: 'b' }).entrance).toBeNull()
})

it('authors Source-root native motion without a synthetic surface and isolates another Source root', () => {
  const target = fixture(), { rootId } = target
  target.project.instances[rootId].childIds = ['text']
  delete target.project.instances.a; delete target.project.instances.b; delete target.project.instances.group
  const sourceTarget = { ...target, surfaceId: null }
  const project = apply(target.project, componentEntranceMotionEdits(sourceTarget, DEFAULT_COMPONENT_MOTION, true))
  expect(componentMotionPropertiesView({ ...sourceTarget, project }).entrance?.enabled).toBe(true)
  project.instances.other = { id: 'other', definitionId: project.instances[rootId].definitionId, data: { html: '', css: '' }, childIds: [] }
  project.rootIds.push('other')
  const owner = { kind: 'instance' as const, instanceId: 'other' }
  const withOther = apply(project, componentRuleEdits(project, owner, [rule('other')]))
  const view = componentMotionPropertiesView({ ...sourceTarget, project: withOther })
  expect(view.entrance).not.toBeNull()
  expect(view.entrance?.behaviorId).not.toBe(interactionBehavior(withOther, owner)!.id)
  expect(view.entranceUnavailableReason).toBeNull()
  expect(interactionRules(interactionBehavior(withOther, owner))).toEqual([rule('other')])
})
