// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits, resizeComponentSurfacesEdits } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { prepareCourseObjectPaste } from '../../src/renderer/composition/crossSurfaceCommands'
import { componentDefinitionPresentation, componentFieldPresentation } from '../../src/renderer/ui/properties/componentDefinitionPresentation'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import { resolveComponentPresentation, type JsonObject, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { InteractionRule } from '../../src/shared/interactionTypes'

function fixture() {
  const project = createBlankCourseProjectV10('完整作者对象')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: 'Base' }, frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 10, 20] } }
  project.surfaces[0].childIds = ['a']
  return project
}
it('deletes presentation references in one canonical operation without broadening conditions or breaking scene jumps', () => {
  const project = fixture(), surface = project.surfaces[0]!, sid = surface.id
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (id: string, action: InteractionRule['actions'][number]['action']): InteractionRule => ({ id, enabled: true,
    trigger: { type: 'node.click', nodeId: 'a' }, conditions: [], actions: [{ id: id + '-action', start: 'after-previous', delayMs: 0, action }] })
  const enter = rule('enter', { type: 'scene.next' }); enter.trigger = { type: 'presentation.enter', stateId: 'gone' }
  const set = rule('set', { type: 'presentation.set', stateId: 'gone' })
  const chain = rule('chain', { type: 'scene.next' }); chain.trigger = { type: 'animation.completed', actionId: 'set-action' }
  const condition = rule('condition', { type: 'scene.next' }); condition.conditions = [{ type: 'presentation.in', stateIds: ['gone'] }]
  const mixed = rule('mixed', { type: 'scene.go', sceneId: sid, targetStateId: 'gone' }); mixed.conditions = [{ type: 'presentation.in', stateIds: ['gone', 'stay'] }]
  const continued = rule('continued', { type: 'presentation.set', stateId: 'gone' }); continued.actions.push({ id: 'next-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } })
  const data = (rules: InteractionRule[]) => ({ rules }) as unknown as JsonValue
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: data([enter, set, chain, condition, mixed, continued]),
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: sid } }] }
  surface.childIds.push('behavior')
  const nav = Object.values(project.instances).find(instance => project.definitions[instance.definitionId].implementation.kind === 'builtin'
    && project.definitions[instance.definitionId].implementation.key === 'guoling.navigation')!
  nav.data = { buttons: [{ id: 'go', action: { type: 'scene.go', sceneId: sid, targetStateId: 'gone' } }] }
  surface.presentation = { initialStateId: 'stay', states: [
    { id: 'gone', title: '删除', overrides: {} },
    { id: 'stay', title: '保留', overrides: { behavior: { data: data([mixed]) }, [nav.id]: { data: structuredClone(nav.data) } } },
  ] }
  project.instances.otherBehavior = { id: 'otherBehavior', definitionId: 'interactions', data: data([set, rule('other-jump', { type: 'scene.go', sceneId: sid, targetStateId: 'gone' })]),
    attachments: [{ instanceId: 'otherBehavior', target: { kind: 'surface', surfaceId: 'other' } }] }
  project.surfaces.push({ id: 'other', kind: 'slide', title: '其他页', childIds: ['otherBehavior'],
    presentation: { states: [{ id: 'gone', title: '同名仍存在', overrides: {} }] } })
  const command = captureComponentOperation(project, [{ type: 'surface.presentation.set', surfaceId: sid,
    presentation: { ...surface.presentation, states: surface.presentation.states.filter(state => state.id !== 'gone') } }])
  const result = applyComponentOperation(project, command)
  const rules = (result.instances.behavior.data as unknown as { rules: InteractionRule[] }).rules
  expect(rules.map(value => value.id)).toEqual(['mixed', 'continued'])
  expect(rules[0]).toMatchObject({ conditions: [{ type: 'presentation.in', stateIds: ['stay'] }], actions: [{ action: { type: 'scene.go', sceneId: sid } }] })
  expect(rules[0]!.actions[0]!.action).not.toHaveProperty('targetStateId')
  expect(rules[1]!.actions).toEqual([{ id: 'next-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }])
  expect(result.instances.nav?.data ?? result.instances[nav.id].data).toEqual({ buttons: [{ id: 'go', action: { type: 'scene.go', sceneId: sid } }] })
  const state = result.surfaces[0]!.presentation!.states[0]!
  expect(state.overrides[nav.id]!.data).toEqual(result.instances[nav.id].data)
  expect((state.overrides.behavior!.data as unknown as { rules: InteractionRule[] }).rules[0]!.conditions).toEqual([{ type: 'presentation.in', stateIds: ['stay'] }])
  expect((result.instances.otherBehavior.data as unknown as { rules: InteractionRule[] }).rules[0]).toEqual(set)
  const stale = structuredClone(project); (stale.instances[nav.id].data as JsonObject).title = 'Human controller title'
  expect(() => applyComponentOperation(stale, command)).toThrow('目标内容或归属已变化')
  const driver = new CourseV10Driver(), model = { kind: 'course-v10' as const, project: result, resources: { assets: {}, components: {} } }
  const reopened = driver.load(driver.serialize(model))
  expect(reopened.kind === 'course-v10' && reopened.project.instances[nav.id].data).toEqual(result.instances[nav.id].data)
})
it('enforces inherited author locks for data, frame and named-state edits while allowing an explicit unlock', () => {
  const project = fixture()
  project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '' }, childIds: ['a'], locked: true }
  project.surfaces[0].childIds = ['group']
  for (const edits of [
    [{ type: 'data.set' as const, instanceId: 'a', path: ['html'], value: 'Changed' }],
    [{ type: 'frame.set' as const, instanceId: 'a', frame: { width: 200, height: 30, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] } }],
    [{ type: 'surface.presentation.set' as const, surfaceId: project.surfaces[0].id, presentation: { states: [{ id: 'answer', title: '答案', overrides: { a: { visible: false } } }] } }],
  ]) expect(() => applyComponentOperation(project, captureComponentOperation(project, edits))).toThrow('已锁定')
  const unlocked = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'instance.patch', instanceId: 'group', patch: { locked: false } },
    { type: 'data.set', instanceId: 'a', path: ['html'], value: 'Changed' },
  ]))
  expect(webDataSchema.parse(unlocked.instances.a.data).html).toBe('Changed')
  expect(webDataSchema.parse(project.instances.a.data).html).toBe('Base')
})
it('blocks changed interaction rules targeting a locked author object without blocking unrelated rule edits', () => {
  const project = fixture()
  project.instances.a.locked = true
  project.instances.b = { ...project.instances.a, id: 'b', locked: false }
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (id: string, nodeId: string) => ({ id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
    actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId, effect: 'none', durationMs: 0, easing: 'linear' } }] })
  const lockedRule = rule('locked-rule', 'a'), otherRule = rule('other-rule', 'b')
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [lockedRule, otherRule] } }
  project.surfaces[0].childIds.push('b', 'behavior')
  const change = (rules: ReturnType<typeof rule>[]) => captureComponentOperation(project,
    [{ type: 'data.set', instanceId: 'behavior', path: ['rules'], value: rules }])
  expect(() => applyComponentOperation(project, change([{ ...lockedRule, enabled: false }, otherRule]))).toThrow('已锁定')
  expect(() => applyComponentOperation(project, change([otherRule]))).toThrow('已锁定')
  const updated = applyComponentOperation(project, change([lockedRule, { ...otherRule, enabled: false }]))
  expect(updated.instances.behavior.data).toEqual({ rules: [lockedRule, { ...otherRule, enabled: false }] })
  expect(updated.instances.a).toEqual(project.instances.a)
})
it('copies base values, all named states and local records in one undoable saved transaction', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.instances.a.data = { html: 'Base', authoringRecords: { local: { kind: 'text', scope: { item: 'a' },
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text: 'Human', geometry: { translateX: 12 } } } } }
  project.surfaces[0].presentation = { states: [
    { id: 'question', title: '问题', overrides: { a: { visible: false } }, order: ['a'] },
    { id: 'answer', title: '答案', overrides: { a: { data: { html: 'Answer' }, frame: { width: 150, height: 40, transform: [1, 0, 0, 1, 40, 60] } } }, order: ['a'] },
  ] }
  const resources = { assets: {}, components: {} }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, resources,
    editingProject: resolveComponentPresentation(project, surfaceId, 'answer'), activeStateId: 'answer', surfaceId, instanceIds: ['a'], instanceId: 'a' }
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, roots: ['a'], resources },
    { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: 1, keepOwner: true, offset: { x: 20, y: 20 } })
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch',
    model: { kind: 'course-v10', project, resources }, binding: { kind: 'untitled', suggestedName: 'copy.h5lesson' } }, driver,
  { async append() {}, async save() { throw new Error('Archive check uses the real Driver') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'copy', baseRevision: 0, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read(), model = snapshot.model
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  const id = plan.idMap.get('a')!, copied = model.project.instances[id]
  expect(webDataSchema.parse(copied.data).authoringRecords).toEqual(webDataSchema.parse(project.instances.a.data).authoringRecords)
  expect(webDataSchema.parse(copied.data).html).toBe('Base')
  expect(model.project.surfaces[0].presentation?.states[0].overrides[id]).toEqual({ visible: false })
  expect(model.project.surfaces[0].presentation?.states[1].overrides[id]).toMatchObject({ data: { html: 'Answer' }, frame: { transform: [1, 0, 0, 1, 60, 80] } })
  expect(model.project.surfaces[0].presentation?.states[1].order).toEqual(['a', id])
  const reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.instances.a).toEqual(project.instances.a)
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  if (restored.kind !== 'course-v10') throw new Error('Expected V10')
  expect(restored.project.instances).toEqual(project.instances)
})
it('keeps professional presentation and field metadata for source-customized definitions', () => {
  const definition = { ...WEB_DEFINITION, implementation: { kind: 'source' as const, language: 'javascript' as const, source: 'export default {}' }, professionalBuiltinKey: 'guoling.web', dataSchema: {} as JsonObject }
  expect(componentDefinitionPresentation(definition).builtinKey).toBe('guoling.web')
  expect(componentFieldPresentation(definition, ['html']).label).toBe('HTML 内容')
})

it('keeps pre-playback visibility in the captured named state through normal save and reopen', () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.surfaces[0].presentation = { states: [{ id: 'a', title: 'A', overrides: {} }, { id: 'b', title: 'B', overrides: {} }] }
  const edits = presentationComponentEdits(project, surfaceId, 'b', [{ type: 'instance.patch', instanceId: 'a', patch: { playbackInitialVisibility: 'hidden' } }])
  const result = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(result.instances.a.playbackInitialVisibility).toBeUndefined()
  expect(resolveComponentPresentation(result, surfaceId, 'a').instances.a.playbackInitialVisibility).toBeUndefined()
  expect(resolveComponentPresentation(result, surfaceId, 'b').instances.a.playbackInitialVisibility).toBe('hidden')
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project: result, resources: { assets: {}, components: {} } }))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.surfaces[0].presentation?.states[1].overrides.a).toEqual({ playbackInitialVisibility: 'hidden' })
})

it('preserves authored coordinates by default and explicitly refits each page, state and shared branch once', () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.surfaces[0].designSize = { width: 800, height: 400 }
  const groupFrame = { width: 200, height: 100, transform: [0, 1, -1, 0, 20, 30] as [number, number, number, number, number, number] }
  project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '' }, frame: groupFrame, childIds: ['a'] }
  project.instances.flat = { id: 'flat', definitionId: WEB_DEFINITION.id, data: { html: '' }, childIds: ['child'] }
  project.instances.child = { ...project.instances.a, id: 'child', frame: { width: 20, height: 10, transform: [1, 0, 0, 1, 40, 10] } }
  project.instances.b = { ...project.instances.a, id: 'b' }
  project.instances.global = { ...project.instances.a, id: 'global' }
  project.global.underlay.push('global')
  project.surfaces[0].childIds = ['group', 'flat']
  project.surfaces.push({ id: 'second', kind: 'slide', title: '第二页', childIds: ['b'], designSize: { width: 400, height: 400 } })
  project.surfaces[0].presentation = { states: [
    { id: 'framed', title: '有父框', overrides: { flat: { frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 30, 20] } } } },
    { id: 'frameless', title: '无父框', overrides: { group: { frame: null }, global: { frame: { width: 30, height: 20, transform: [1, 0, 0, 1, 20, 10] } } } },
  ] }
  const resize = { surfaceIds: [surfaceId, 'second'], designSize: { width: 1200, height: 1200 } }
  const preserve = applyComponentOperation(project, captureComponentOperation(project,
    resizeComponentSurfacesEdits(project, { ...resize, mode: 'preserve' })))
  expect(preserve.instances).toEqual(project.instances)
  expect(preserve.surfaces[0].presentation).toEqual(project.surfaces[0].presentation)
  const edits = resizeComponentSurfacesEdits(project, { ...resize, mode: 'contain', globalReferenceSurfaceId: surfaceId })
  const result = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(result.instances.group.frame?.transform).toEqual([0, 1.5, -1.5, 0, 30, 345])
  expect(result.instances.a.frame).toEqual(project.instances.a.frame)
  expect(result.instances.b.frame?.transform).toEqual([3, 0, 0, 3, 30, 60])
  expect(result.instances.global.frame?.transform).toEqual([1.5, 0, 0, 1.5, 15, 330])
  for (const id of project.global.overlay) expect(result.instances[id]).toEqual(project.instances[id])
  const framed = resolveComponentPresentation(result, surfaceId, 'framed')
  expect(framed.instances.flat.frame?.transform).toEqual([1.5, 0, 0, 1.5, 45, 330])
  expect(framed.instances.child.frame).toEqual(project.instances.child.frame)
  const frameless = resolveComponentPresentation(result, surfaceId, 'frameless')
  expect(frameless.instances.group.frame).toBeUndefined()
  expect(frameless.instances.a.frame?.transform).toEqual([1.5, 0, 0, 1.5, 15, 330])
  expect(frameless.instances.global.frame?.transform).toEqual([1.5, 0, 0, 1.5, 30, 315])
  const driver = new CourseV10Driver()
  expect(driver.load(driver.serialize({ kind: 'course-v10', project: result, resources: { assets: {}, components: {} } }))).toMatchObject({ project: result })
})
