// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { expect, it } from 'vitest'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentSurfaces, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { componentClickInteractionEdits, componentClickNavigationEdits, componentClickNavigationView,
  componentInteractionOwner, componentRuleEdits, interactionBehavior, interactionRules,
  remapComponentInteractionData } from '../../src/shared/componentInteractionData'

const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
function fixture() {
  let id = 0
  const project = createBlankProgramProject('原程序', () => `p${++id}`), rootId = project.rootIds[0]
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.slide = { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }
  project.instances[rootId].childIds = ['nested']
  project.instances.nested = { id: 'nested', definitionId: 'slide', data: {}, childIds: ['group'], container: { kind: 'slide',
    presentation: { states: [{ id: 'detail', title: '局部详情', overrides: {} }] } } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['item'] }
  project.instances.item = { id: 'item', definitionId: 'group', data: {} }
  return { project, rootId }
}
const rule = (): InteractionRule => ({ id: 'rule', enabled: true, trigger: { type: 'node.click', nodeId: 'item' }, conditions: [],
  actions: [{ id: 'step', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'detail' } }] })

it('keeps behavior in the nearest real container and reuses surface aliases without a second behavior', () => {
  const { project } = fixture(), target = { kind: 'instance' as const, instanceId: 'nested' }
  expect(componentInteractionOwner(project, project.instances.item)).toEqual(target)
  const next = apply(project, componentRuleEdits(project, target, [rule()]))
  const behavior = interactionBehavior(next, target)!
  expect(next.instances.nested.childIds).toContain(behavior.id)
  expect(next.global.underlay).toEqual([])
  expect(componentInteractionOwner(next, behavior)).toEqual(target)
  const changed = [{ ...rule(), name: '改名' }]
  const edits = componentRuleEdits(next, { kind: 'surface', surfaceId: 'nested' }, changed)
  expect(edits).toEqual([{ type: 'data.set', instanceId: behavior.id, path: ['rules'], value: changed }])
  expect(project.instances.nested.childIds).toEqual(['group'])
})

it('authors pure-program click audio and explicit root navigation while keeping one tree and action identities', () => {
  const { project, rootId } = fixture()
  project.instances[rootId].childIds = ['item']
  delete project.instances.nested; delete project.instances.group
  project.media = { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
    narrationDucking: { enabled: false, musicVolume: .3, fadeMs: 0 }, sounds: {
      ding: { id: 'ding', name: '声音', assetId: 'sound', channel: 'sfx', defaultVolume: 1, defaultLoop: false },
      ding2: { id: 'ding2', name: '声音二', assetId: 'sound', channel: 'sfx', defaultVolume: 1, defaultLoop: false } } } }
  const target = { project, surfaceId: null, instanceId: 'item', activeStateId: null }, owner = { kind: 'instance' as const, instanceId: rootId }
  let next = apply(project, componentClickInteractionEdits(target, 'audio-play', 'ding'))
  next = apply(next, componentClickInteractionEdits({ ...target, project: next }, 'location-go', rootId))
  const before = interactionRules(interactionBehavior(next, owner))[0]
  next = apply(next, componentClickInteractionEdits({ ...target, project: next }, 'audio-play', 'ding2'))
  const after = interactionRules(interactionBehavior(next, owner))[0]
  expect(after.actions.map(step => step.id)).toEqual(before.actions.map(step => step.id))
  expect(after.actions.map(step => step.action)).toEqual([{ type: 'audio.play', soundId: 'ding2' }, { type: 'location.go', locationId: rootId }])
  expect(next.rootIds).toEqual([rootId]); expect(componentSurfaces(next)).toEqual([])
  expect(next.instances[rootId].childIds).toContain(interactionBehavior(next, owner)!.id)
  expect(next.global).toEqual({ underlay: [], overlay: [] })
  expect(componentInteractionOwner(next, next.instances[rootId])).toEqual(owner)
  expect(next.definitions[next.instances[rootId].definitionId]).toEqual(project.definitions[project.instances[rootId].definitionId])
})

it('allows an explicit Source-root jump but rejects a nonexistent local state and retains ancestor locks', () => {
  const { project, rootId } = fixture(), target = { project, surfaceId: null, instanceId: 'item', activeStateId: null }
  const next = apply(project, componentClickNavigationEdits(target, { type: 'scene.go', sceneId: rootId }))
  expect(componentClickNavigationView({ ...target, project: next }).action).toEqual({ type: 'scene.go', sceneId: rootId })
  expect(() => componentClickNavigationEdits(target, { type: 'scene.go', sceneId: rootId, targetStateId: 'detail' })).toThrow('镜头或状态')
  project.instances.group.locked = true
  expect(() => componentClickNavigationEdits(target, { type: 'scene.go', sceneId: rootId })).toThrow('锁定')
})

it('remaps explicit container and program-root references without changing container-local state names', () => {
  const data = { rules: [{ id: 'r', enabled: true, trigger: { type: 'node.click', nodeId: 'item' }, conditions: [{ type: 'scene.in', sceneIds: ['program'] }],
    actions: [{ id: 'a', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', containerId: 'nested', stateId: 'detail' } },
      { id: 'b', start: 'after-previous', delayMs: 0, action: { type: 'step.next', containerId: 'nested' } }] },
    { id: 'r2', enabled: true, trigger: { type: 'node.click', nodeId: 'item' }, conditions: [],
      actions: [{ id: 'c', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: 'program', containerId: 'nested' } }] }] }
  const copied = remapComponentInteractionData(JSON.parse(JSON.stringify(data)), { instances: new Map([['item', 'copyItem'], ['program', 'copyProgram'], ['nested', 'copyNested']]),
    surfaces: new Map(), rules: new Map([['r', 'copyRule'], ['r2', 'copyRule2']]), actions: new Map([['a', 'copyA'], ['b', 'copyB'], ['c', 'copyC']]) })
  expect(copied).toEqual({ rules: [{ id: 'copyRule', enabled: true, trigger: { type: 'node.click', nodeId: 'copyItem' }, conditions: [{ type: 'scene.in', sceneIds: ['copyProgram'] }],
    actions: [{ id: 'copyA', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', containerId: 'copyNested', stateId: 'detail' } },
      { id: 'copyB', start: 'after-previous', delayMs: 0, action: { type: 'step.next', containerId: 'copyNested' } }] },
    { id: 'copyRule2', enabled: true, trigger: { type: 'node.click', nodeId: 'copyItem' }, conditions: [],
      actions: [{ id: 'copyC', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: 'copyProgram', containerId: 'copyNested' } }] }] })
})

it('keeps global controls project-scoped and gives explicit attachments priority', () => {
  const { project } = fixture()
  project.instances.global = { id: 'global', definitionId: 'group', data: {}, childIds: ['globalItem'] }
  project.instances.globalItem = { id: 'globalItem', definitionId: 'group', data: {} }
  project.global.overlay.push('global')
  expect(componentInteractionOwner(project, project.instances.globalItem)).toEqual({ kind: 'project' })
  project.instances.item.attachments = [{ instanceId: 'item', target: { kind: 'instance', instanceId: 'global' } }]
  expect(componentInteractionOwner(project, project.instances.item)).toEqual({ kind: 'instance', instanceId: 'global' })
})
