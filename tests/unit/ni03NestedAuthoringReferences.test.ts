import { afterEach, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { prepareCourseFlowPlacement, prepareCourseInteractionRules, type CourseAuthoringReferences } from '../../src/core/course/courseAuthoringReferences'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { componentInputRuleEdits, inspectComponentInputRules } from '../../src/components/input/authoring'
import { INPUT_DEFINITION, createInputData } from '../../src/components/input/data'
import { courseGlobalPlacementEdits, prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { executeCourseLogicAuthoringCommand } from '../../src/core/course/courseLogicAuthoringCommands'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'

afterEach(() => { document.body.replaceChildren() })
function fixture() {
  const project = createBlankCourseProjectV10('嵌套平台引用')
  const surface = project.surfaces[0]
  surface.presentation = { states: [{ id: 'answer-state', title: '答案', overrides: {} }] }
  project.definitions.item = { id: 'item', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.button = { id: 'button', definitionId: 'item', name: '提交按钮', data: {} }
  project.instances.feedback = { id: 'feedback', definitionId: 'item', name: '反馈', data: {}, playbackInitialVisibility: 'hidden' }
  surface.childIds.push('button', 'feedback')
  project.surfaces.push({ id: 'destination', kind: 'slide', title: '下一页', childIds: [],
    presentation: { states: [{ id: 'destination-state', title: '目标答案', overrides: {} }] } })
  project.logic = { courseState: [{ key: 'object-ref', valueType: 'string', defaultValue: '' }], navigationGuards: [] }
  const owner = { kind: 'surface' as const, surfaceId: surface.id }
  const refs: CourseAuthoringReferences = new Map([
    ['object-ref', { kind: 'instance', instanceId: 'button' }],
    ['feedback-ref', { kind: 'instance', instanceId: 'feedback' }],
    ['page-ref', { kind: 'surface', surfaceId: surface.id }],
    ['destination-ref', { kind: 'surface', surfaceId: 'destination' }],
    ['state-ref', { kind: 'presentation-state', surfaceId: surface.id, stateId: 'answer-state' }],
    ['destination-state-ref', { kind: 'presentation-state', surfaceId: 'destination', stateId: 'destination-state' }],
  ])
  return { project, surface, owner, refs }
}
function rule(): InteractionRule {
  return { id: 'click-feedback', name: 'object-ref', enabled: true,
    trigger: { type: 'component.event', nodeId: 'object-ref', eventName: 'object-ref' },
    conditions: [{ type: 'scene.in', sceneIds: ['page-ref'] }, { type: 'presentation.in', stateIds: ['state-ref'] },
      { type: 'course-state.compare', key: 'object-ref', operator: 'eq', value: 'object-ref' }],
    actions: [{ id: 'show-feedback', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'feedback-ref', durationMs: 0, easing: 'linear', effect: 'none' } },
      { id: 'navigate', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: 'destination-ref', targetStateId: 'destination-state-ref' } }] }
}
function apply(project: CourseProjectV10, edits: ComponentEdit[]) {
  const model = new CourseV10Driver().apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, edits))
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  return model.project
}

it('prepares declared nested references in the original behavior owner while preserving author strings', () => {
  const f = fixture(), before = structuredClone(f.project)
  const project = apply(f.project, componentRuleEdits(f.project, f.owner, [rule()], f.refs))
  expect(interactionRules(interactionBehavior(project, f.owner))[0]).toMatchObject({ name: 'object-ref',
    trigger: { type: 'component.event', nodeId: 'button', eventName: 'object-ref' },
    conditions: [{ type: 'scene.in', sceneIds: [f.surface.id] }, { type: 'presentation.in', stateIds: ['answer-state'] },
      { type: 'course-state.compare', key: 'object-ref', operator: 'eq', value: 'object-ref' }],
    actions: [{ id: 'show-feedback', action: { nodeId: 'feedback' } }, { id: 'navigate', action: { sceneId: 'destination', targetStateId: 'destination-state' } }] })
  expect(f.project).toEqual(before)
})

it('prepares sound-target unions and scoped completion references, rejecting a wrong role before authoring', () => {
  const f = fixture()
  f.project.media = { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
    narrationDucking: { enabled: false, musicVolume: .25, fadeMs: 0 },
    sounds: { ding: { id: 'ding', name: '提示', assetId: 'existing-sound-asset', channel: 'ui', defaultVolume: 1, defaultLoop: false } } } }
  const refs: CourseAuthoringReferences = new Map([...f.refs, ['sound-ref', { kind: 'sound', soundId: 'ding' }],
    ['action-ref', { kind: 'action', actionId: 'existing-action', owner: f.owner }]])
  const draft: InteractionRule = { ...rule(), trigger: { type: 'animation.completed', actionId: 'action-ref' }, conditions: [], actions: [
    { id: 'sound', start: 'after-previous', delayMs: 0, action: { type: 'audio.pause', target: { kind: 'sound', soundId: 'sound-ref' } } },
    { id: 'channel', start: 'with-previous', delayMs: 0, action: { type: 'audio.stop', target: { kind: 'channel', channel: 'ui' } } },
    { id: 'all', start: 'with-previous', delayMs: 0, action: { type: 'audio.resume', target: { kind: 'all' } } },
  ] }
  expect(prepareCourseInteractionRules(f.project, f.owner, [draft], refs)[0]).toMatchObject({
    trigger: { actionId: 'existing-action' }, actions: [
      { action: { target: { kind: 'sound', soundId: 'ding' } } },
      { action: { target: { kind: 'channel', channel: 'ui' } } }, { action: { target: { kind: 'all' } } }],
  })
  const before = structuredClone(f.project)
  expect(() => componentRuleEdits(f.project, f.owner, [rule()], new Map([...f.refs, ['object-ref', { kind: 'surface', surfaceId: f.surface.id }]]))).toThrow('不是对象')
  expect(() => prepareCourseInteractionRules(f.project, f.owner, [draft], new Map([...refs, ['action-ref', { kind: 'action', actionId: 'existing-action', owner: { kind: 'project' } }]]))).toThrow('另一互动范围')
  expect(() => componentRuleEdits(f.project, f.owner, [rule()], new Map([...f.refs, ['destination-state-ref', { kind: 'presentation-state', surfaceId: f.surface.id, stateId: 'answer-state' }]]))).toThrow('另一页面')
  expect(f.project).toEqual(before)
})

it('uses the input-family owner to prepare feedback and preserves explicit answer and author state strings', () => {
  const f = fixture()
  f.project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  f.project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: createInputData({
    answer: { type: 'text', stateKey: 'author-answer', validityKey: 'author-valid', ruleFamilyRuleIds: [] }, stateKey: 'author-feedback',
  }) }
  f.surface.childIds.push('input')
  const project = apply(f.project, componentInputRuleEdits({ project: f.project, surfaceId: f.surface.id, instanceId: 'input' }, {
    mode: 'apply', config: { answerType: 'text', answers: ['object-ref'],
      correct: [{ type: 'node.enter', nodeId: 'feedback-ref', durationMs: 0, easing: 'linear', effect: 'none' }],
      error: [{ type: 'course-state.set', key: 'object-ref', value: 'feedback-ref' }],
    },
  }, f.refs))
  expect(inspectComponentInputRules(project, f.surface.id, 'input')).toMatchObject({ conflict: false, config: {
    answers: ['object-ref'], correct: [{ nodeId: 'feedback' }], error: [{ key: 'object-ref', value: 'feedback-ref' }],
  } })
  expect(project.instances.input.data).toMatchObject({ answer: { stateKey: 'author-answer', validityKey: 'author-valid' }, stateKey: 'author-feedback' })
})

it('prepares visibility, per-page visibility, paragraph anchor and guard page fields through their existing owners', () => {
  const f = fixture()
  f.surface.childIds = f.surface.childIds.filter(id => id !== 'feedback'); f.project.global.overlay.push('feedback')
  let project = apply(f.project, courseGlobalPlacementEdits(f.project, 'feedback', { visibility: { mode: 'include', surfaceIds: ['page-ref'] } }, f.refs))
  project = apply(project, courseGlobalPlacementEdits(project, 'feedback', { atSurface: { surfaceId: 'destination-ref', visible: true } }, f.refs))
  expect(project.instances.feedback.visibility).toEqual({ mode: 'include', surfaceIds: [f.surface.id, 'destination'] })
  expect(prepareCourseFlowPlacement(f.project, { space: 'paper', plane: 'underlay', paragraphAnchor: { blockId: 'object-ref', offsetY: 20, xRatio: .4 } }, f.refs))
    .toEqual({ space: 'paper', plane: 'underlay', paragraphAnchor: { blockId: 'button', offsetY: 20, xRatio: .4 } })
  const result = executeCourseLogicAuthoringCommand(project, { projectId: project.id, baseRevision: project.revision, kind: 'navigation-guard.add',
    guard: { id: 'guard', effect: 'block', fromSurfaceIds: ['page-ref'], toSurfaceIds: ['destination-ref'], match: 'all', message: 'page-ref',
      conditions: [{ type: 'compare', key: 'object-ref', operator: 'eq', value: 'object-ref' }] } }, f.refs)
  if (!result.ok) throw new Error(result.reason)
  project = apply(project, result.edits)
  expect(project.logic?.navigationGuards[0]).toEqual({ id: 'guard', effect: 'block', fromSurfaceIds: [f.surface.id], toSurfaceIds: ['destination'], match: 'all',
    message: 'page-ref', conditions: [{ type: 'compare', key: 'object-ref', operator: 'eq', value: 'object-ref' }] })
})

it('keeps prepared references canonical through the real Session, object copy, undo/redo, archive save/reopen and Player click', async () => {
  const f = fixture(), driver = new CourseV10Driver()
  let saved: Uint8Array | undefined
  const session = await DocumentSession.create({ documentId: 'nested', epoch: 'epoch',
    binding: { kind: 'file', path: '/fixture/nested.h5lesson', version: 'v1', bindingVersion: 1 },
    model: { kind: 'course-v10', project: f.project, resources: { assets: {}, components: {} } } }, driver, {
    async append() {}, async save(input) { saved = input.bytes; return { kind: 'file', path: '/fixture/nested.h5lesson', version: 'v2', bindingVersion: 1 } },
  })
  const draft: InteractionRule = { id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'object-ref' },
    conditions: [{ type: 'scene.in', sceneIds: ['page-ref'] }], actions: [
      { id: 'show', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'feedback-ref', durationMs: 0, easing: 'linear', effect: 'none' } },
      { id: 'author-value', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'object-ref', value: 'feedback-ref' } },
    ] }
  const execute = async (edits: ComponentEdit[]) => {
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect((await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: crypto.randomUUID(), actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, edits) } })).status).toBe('applied')
  }
  await execute(componentRuleEdits(f.project, f.owner, [draft], f.refs))
  const source = session.read().model
  if (source.kind !== 'course-v10') throw new Error('Expected V10')
  const copy = prepareCourseObjectPaste({ documentId: 'nested', project: source.project, resources: source.resources, roots: ['button', 'feedback'] }, {
    capturedTarget: { documentId: 'nested', project: source.project, resources: source.resources, surfaceId: f.surface.id },
    container: { kind: 'surface', surfaceId: f.surface.id }, index: source.project.surfaces[0].childIds.length, identity: 'copy',
  })
  await execute(copy.edits)
  for (const direction of ['undo', 'redo'] as const) {
    const snapshot = session.read()
    expect((await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: crypto.randomUUID(), actor: 'human', mutation: { type: direction } })).status).toBe('applied')
  }
  await session.save()
  expect(session.read().dirty).toBe(false)
  const reopened = driver.load(saved!)
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  const copiedButton = copy.idMap.get('button')!, copiedFeedback = copy.idMap.get('feedback')!
  const rules = interactionRules(interactionBehavior(reopened.project, f.owner))
  expect(rules.find(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === copiedButton)?.actions[0].action).toMatchObject({ type: 'node.enter', nodeId: copiedFeedback })
  expect(rules.some(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === 'button')).toBe(true)
  const navigation = new ComponentNavigationOwner({ project: () => reopened.project, surfaceId: () => f.surface.id, select() {} })
  const world = new ComponentPlatformRuntime('nested-reference-player', { teacherController: navigation })
  const nodes = new Map(['button', 'feedback', copiedButton, copiedFeedback].map(id => [id, document.createElement('div')]))
  for (const [id, node] of nodes) { document.body.append(node); world.bind(id, node); world.bindTarget(id, node) }
  try {
    await world.sync(reopened.project, reopened.resources)
    expect(nodes.get(copiedFeedback)!.hidden).toBe(true)
    nodes.get(copiedButton)!.click()
    await waitFor(() => expect(world.getState('object-ref')).toBe('feedback-ref'))
    expect(nodes.get(copiedFeedback)!.hidden).toBe(false)
    expect(nodes.get('feedback')!.hidden).toBe(true)
  } finally { await world.dispose(); navigation.dispose() }
})
