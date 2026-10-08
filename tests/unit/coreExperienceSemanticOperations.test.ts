// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits, resizeComponentSurfacesEdits } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { prepareCourseObjectPaste } from '../../src/renderer/composition/crossSurfaceCommands'
import { componentDefinitionPresentation, componentFieldPresentation } from '../../src/renderer/ui/properties/componentDefinitionPresentation'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import { componentDefinitionBuiltinKey, resolveComponentPresentation, type JsonObject, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { createInputData, inputDataSchema, INPUT_DEFINITION } from '../../src/components/input/data'
import { buildInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { interactionBehavior, interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'

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
  const nav = Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')!
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
it('copies ordinary click programs and managed input feedback through the real executor as one undoable author object', async () => {
  const project = fixture(), surface = project.surfaces[0]!, surfaceId = surface.id, resources = { assets: {}, components: {} }
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const motion = (nodeId: string, show = true): InteractionRule['actions'][number]['action'] => ({ type: show ? 'node.enter' : 'node.exit', nodeId, effect: 'none', durationMs: 0, easing: 'linear' })
  for (const id of ['correct', 'error', 'unrelated']) project.instances[id] = { ...project.instances.a, id, visible: false }
  let serial = 0
  const family = buildInputRuleFamily('input', { stateKey: 'input:input:value', validityKey: 'input:input:valid' }, {
    answerType: 'text', answers: ['42'], correct: [motion('error', false), motion('correct')], error: [motion('correct', false), motion('error')],
  }, () => `family-${++serial}`)
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: createInputData({ answer: {
    type: 'text', stateKey: 'input:input:value', validityKey: 'input:input:valid', ruleFamilyRuleIds: family.map(rule => rule.id),
  } }) as unknown as JsonValue }
  const click: InteractionRule = { id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'a' }, conditions: [],
    actions: [{ id: 'click-action', start: 'after-previous', delayMs: 0, action: motion('correct') }] }
  const complete: InteractionRule = { id: 'complete', enabled: true, trigger: { type: 'animation.completed', actionId: 'click-action' }, conditions: [],
    actions: [{ id: 'complete-action', start: 'after-previous', delayMs: 0, action: motion('error', false) }] }
  const unrelated: InteractionRule = { ...click, id: 'unrelated-rule', trigger: { type: 'node.click', nodeId: 'unrelated' }, actions: [{ ...click.actions[0]!, id: 'unrelated-action', action: { type: 'scene.next' } }] }
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [...family, click, complete, unrelated] } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId } }] }
  surface.childIds = ['a', 'input', 'error', 'unrelated', 'behavior']
  project.global.overlay.push('correct')
  project.instances.other = { ...project.instances.a, id: 'other' }
  const otherRule: InteractionRule = { ...unrelated, id: 'other-rule', trigger: { type: 'node.click', nodeId: 'other' },
    actions: [{ ...unrelated.actions[0]!, id: 'other-action' }] }
  project.instances.otherBehavior = { id: 'otherBehavior', definitionId: 'interactions', data: { rules: [otherRule] } as unknown as JsonValue,
    attachments: [{ instanceId: 'otherBehavior', target: { kind: 'surface', surfaceId: 'other-page' } }] }
  project.surfaces.push({ id: 'other-page', kind: 'slide', title: 'Other page', childIds: ['other', 'otherBehavior'],
    presentation: { states: [{ id: 'unrelated-state', title: 'Unrelated state', overrides: { otherBehavior: { data: { rules: [{ ...otherRule, enabled: false }] } as unknown as JsonValue } } }] } })
  project.logic = { courseState: [{ key: 'input:input:value', valueType: 'string', defaultValue: '' }, { key: 'input:input:valid', valueType: 'boolean', defaultValue: false }], navigationGuards: [] }
  surface.presentation = { states: [{ id: 'answer', title: '另一状态', overrides: { behavior: { data: { rules: [...family,
    { ...click, actions: [{ ...click.actions[0]!, action: motion('error') }] }, unrelated] } as unknown as JsonValue } } }] }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources, activeStateId: null, surfaceId, instanceIds: ['a', 'input'], instanceId: 'a' }
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, roots: ['a', 'input'], resources },
    { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: surface.childIds.length, offset: { x: 20, y: 20 } })
  expect(plan.idMap.has('correct')).toBe(true); expect(plan.idMap.has('error')).toBe(true)
  expect(plan.idMap.has('unrelated')).toBe(false)
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
    binding: { kind: 'untitled', suggestedName: 'program-copy.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'copy-semantic', baseRevision: 0, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const copied = snapshot.model.project, inputId = plan.idMap.get('input')!, buttonId = plan.idMap.get('a')!, correctId = plan.idMap.get('correct')!, errorId = plan.idMap.get('error')!
  expect(copied.surfaces[0].presentation?.states.map(state => state.id)).toEqual(['answer'])
  const input = inputDataSchema.parse(copied.instances[inputId].data), copiedRules = interactionRules(interactionBehavior(copied, { kind: 'surface', surfaceId }))
  expect(input.answer!.ruleFamilyRuleIds.every(id => copiedRules.some(rule => rule.id === id) && !family.some(rule => rule.id === id))).toBe(true)
  expect(copiedRules.filter(rule => rule.id === 'unrelated-rule')).toHaveLength(1)
  const execute = async (stateId: string | null) => {
    const effective = resolveComponentPresentation(copied, surfaceId, stateId), behavior = interactionBehavior(effective, { kind: 'surface', surfaceId })!
    const listeners = new Map<string, () => void>(), visible = new Map<string, boolean>(), values = new Map<string, unknown>([[input.answer!.stateKey, '42'], [input.answer!.validityKey, true]])
    const runtime = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => surfaceId, currentStateId: () => stateId,
      courseState: { get: key => values.get(key), set: (key, value) => { values.set(key, value) } },
      subscribeTrigger(trigger, listener) { listeners.set(JSON.stringify(trigger), listener); return () => { listeners.delete(JSON.stringify(trigger)) } },
      executeAction(action) { if (action.type === 'node.enter' || action.type === 'node.exit') { expect(copied.instances[action.nodeId]).toBeDefined(); visible.set(action.nodeId, action.type === 'node.enter') }; return true }, report(message) { throw new Error(message) } }))
    const mounted = await runtime.mount({ instance: behavior, scope: { signal: new AbortController().signal, isActive: () => true, cleanup() {} } } as unknown as ComponentRuntimeContext)
    const emit = async (type: 'node.click' | 'input.submit', nodeId: string) => { listeners.get(JSON.stringify({ type, nodeId }))?.(); await new Promise(resolve => setTimeout(resolve, 0)) }
    try {
      await emit('node.click', buttonId)
      expect(visible.get(stateId ? errorId : correctId)).toBe(true)
      expect(visible.has('correct') || visible.has('error')).toBe(false)
      if (!stateId) {
        expect(visible.get(errorId)).toBe(false)
        await emit('input.submit', inputId); expect(visible.get(correctId)).toBe(true); expect(visible.get(errorId)).toBe(false)
        values.set(input.answer!.stateKey, 'wrong'); await emit('input.submit', inputId)
        expect(visible.get(correctId)).toBe(false); expect(visible.get(errorId)).toBe(true)
      }
    } finally { await mounted.dispose() }
  }
  await execute(null); await execute('answer')
  expect(driver.load(driver.serialize(snapshot.model)).kind).toBe('course-v10')
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo-semantic-copy', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  expect(restored.kind === 'course-v10' && restored.project.instances).toEqual(project.instances)
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
it('rejects stateful Slide object paste into Flow or Spatial before a canonical write', async () => {
  const source = fixture(), resources = { assets: {}, components: {} }
  source.surfaces[0].presentation = { states: [{ id: 'answer', title: '答案', overrides: { a: { data: { html: 'Answer' } } } }] }
  const beforeSource = structuredClone(source)
  for (const kind of ['flow', 'spatial'] as const) {
    const project = createBlankCourseProjectV10('目标'), surface = project.surfaces[0]
    surface.kind = kind
    const target: CapturedCourseTarget = { documentId: 'target', epoch: 'epoch', project, editingProject: project, resources,
      activeStateId: null, surfaceId: surface.id, instanceIds: [], instanceId: null }
    const session = await DocumentSession.create({ documentId: 'target', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
      binding: { kind: 'untitled', suggestedName: 'target.h5lesson' } }, new CourseV10Driver(),
    { async append() {}, async save() { throw new Error('Unused save') } })
    const before = session.read()
    const paste = async () => {
      const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a'], resources },
        { capturedTarget: target, container: { kind: 'surface', surfaceId: surface.id }, index: 0 })
      return session.execute({ documentId: 'target', epoch: 'epoch', operationId: 'paste', baseRevision: before.revision, actor: 'human',
        mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })
    }
    await expect(paste()).rejects.toThrow('不支持展示状态，无法完整粘贴这些对象')
    expect(session.read()).toEqual(before)
    expect(project).toEqual(before.model.kind === 'course-v10' && before.model.project)
  }
  expect(source).toEqual(beforeSource)
})
it('canonically pastes an ordinary object into Flow or Spatial despite unrelated page states and an order entry', async () => {
  const source = fixture(), resources = { assets: {}, components: {} }, sourceSurface = source.surfaces[0]
  source.instances.other = { ...source.instances.a, id: 'other' }
  source.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (nodeId: string): InteractionRule => ({ id: `rule-${nodeId}`, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
    actions: [{ id: `action-${nodeId}`, start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] })
  const copiedRule = rule('a'), otherRule = rule('other')
  source.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [copiedRule, otherRule] } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: sourceSurface.id } }] }
  sourceSurface.childIds.push('other', 'behavior')
  sourceSurface.presentation = { states: [{ id: 'unrelated', title: '其他对象状态', order: ['other', 'a', 'behavior'], overrides: {
    other: { visible: false }, behavior: { data: { rules: [copiedRule, { ...otherRule, enabled: false }] } as unknown as JsonValue },
  } }] }
  const beforeSource = structuredClone(source)
  for (const kind of ['flow', 'spatial'] as const) {
    const project = createBlankCourseProjectV10('目标'), surface = project.surfaces[0]
    surface.kind = kind
    const target: CapturedCourseTarget = { documentId: 'target', epoch: 'epoch', project, editingProject: project, resources,
      activeStateId: null, surfaceId: surface.id, instanceIds: [], instanceId: null }
    const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a'], resources },
      { capturedTarget: target, container: { kind: 'surface', surfaceId: surface.id }, index: 0 })
    expect(plan.edits.some(edit => edit.type === 'surface.presentation.set')).toBe(false)
    const session = await DocumentSession.create({ documentId: 'target', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
      binding: { kind: 'untitled', suggestedName: 'target.h5lesson' } }, new CourseV10Driver(),
    { async append() {}, async save() { throw new Error('Unused save') } })
    expect(await session.execute({ documentId: 'target', epoch: 'epoch', operationId: 'paste', baseRevision: 0, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
    const after = session.read()
    if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(after.model.project.instances[plan.idMap.get('a')!].data).toEqual(source.instances.a.data)
    expect(after.model.project.surfaces[0].presentation).toBeUndefined()
    expect(interactionRules(interactionBehavior(after.model.project, { kind: 'surface', surfaceId: surface.id }))).toHaveLength(1)
    expect(after.undoDepth).toBe(1)
  }
  expect(source).toEqual(beforeSource)
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
