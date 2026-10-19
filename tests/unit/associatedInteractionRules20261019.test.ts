// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { duplicateSurfaceEdits } from '../../src/core/course/courseSurfaceStructure'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { associatedComponentInteractionRules, componentClickNavigationEdits, componentClickNavigationView, componentRuleEdits, INTERACTIONS_DEFINITION, interactionRules } from '../../src/shared/componentInteractionData'
import { resolveComponentPresentation, owningContainer, type CourseProjectV10, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { InteractionRule } from '../../src/shared/interactionTypes'

const resources = { assets: {}, components: {} }
const data = (rules: readonly InteractionRule[]) => JSON.parse(JSON.stringify({ rules })) as JsonValue
function fixture() {
  const project = createBlankCourseProjectV10('Associated rules'), surfaceId = project.surfaces[0].id
  project.definitions.card = { id: 'card', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  project.instances.card = { id: 'card', definitionId: 'card', data: { prose: 'card is authored text' } }
  project.instances.global = { id: 'global', definitionId: 'card', data: { prose: 'shared background' }, visibility: { mode: 'include', surfaceIds: [surfaceId] } }
  project.surfaces[0].childIds = ['card']
  const click: InteractionRule = { id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'card' }, conditions: [],
    actions: [{ id: 'jump', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: surfaceId } }] }
  const shared: InteractionRule = { id: 'shared-event', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
    actions: [{ id: 'shared-step', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] }
  const completed: InteractionRule = { id: 'completed', enabled: true, trigger: { type: 'animation.completed', actionId: 'jump' }, conditions: [],
    actions: [{ id: 'complete-step', start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'card', effect: 'none', durationMs: 0, easing: 'linear' } }] }
  for (const [id, rules] of [['project-click', [click, shared]], ['project-completed', [completed]]] as const)
    project.instances[id] = { id, definitionId: INTERACTIONS_DEFINITION.id, data: data(rules), attachments: [{ instanceId: id, target: { kind: 'project' } }] }
  project.global.underlay = ['global', 'project-click', 'project-completed']
  return { project, surfaceId, click, shared, completed }
}

it('shares a cross-owner completion family between extraction and object copy, retaining project owners', () => {
  const { project, surfaceId, shared } = fixture()
  expect(associatedComponentInteractionRules(project, new Set(['card'])).map(value => [value.instance.id, value.rules.map(rule => rule.id)]))
    .toEqual([['project-click', ['click']], ['project-completed', ['completed']]])
  const entry = extractComponentLibraryEntry(project, resources, { id: 'entry', title: 'Card', rootIds: ['card'] }).entry
  expect(interactionRules(entry.example.instances['project-completed']).map(rule => rule.id)).toEqual(['completed'])
  expect(interactionRules(entry.example.instances['project-click']).map(rule => rule.id)).toEqual(['click'])
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, resources, roots: ['card'] }, {
    capturedTarget: { documentId: 'doc', project, resources, surfaceId }, container: { kind: 'surface', surfaceId }, index: 1,
  })
  const next = applyComponentOperation(project, captureComponentOperation(project, plan.edits, plan.readPaths))
  expect(Object.keys(next.instances)).toHaveLength(Object.keys(project.instances).length + 1)
  const copiedClick = interactionRules(next.instances['project-click']).find(rule => rule.id !== 'click' && rule.id !== shared.id)!
  const copiedCompleted = interactionRules(next.instances['project-completed']).find(rule => rule.id !== 'completed')!
  expect(copiedClick.trigger).toEqual({ type: 'node.click', nodeId: plan.idMap.get('card') })
  expect(copiedCompleted.trigger).toEqual({ type: 'animation.completed', actionId: copiedClick.actions[0].id })
  expect(copiedCompleted.actions[0].action).toMatchObject({ nodeId: plan.idMap.get('card') })
  expect(interactionRules(next.instances['project-click']).filter(rule => rule.id === shared.id)).toEqual([shared])
  expect(next.instances.global).toEqual(project.instances.global)
})

it('duplicates a page and its project-owned rule family in one History step, with source read dependencies', async () => {
  const { project, surfaceId, shared } = fixture(), before = structuredClone(project)
  const plan = duplicateSurfaceEdits(project, surfaceId)
  const command = captureComponentOperation(project, plan.edits, plan.readPaths)
  expect(command.expected).toContainEqual(expect.objectContaining({ path: ['instances', 'card'] }))
  const changedSource = structuredClone(project)
  changedSource.instances.card.data = { prose: 'A human change before ACK' }
  expect(() => applyComponentOperation(changedSource, command)).toThrow()
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
    binding: { kind: 'untitled', suggestedName: 'rules.glx' } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'page-copy', baseRevision: 0, actor: 'human', mutation: { type: 'command', command } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course')
  const next = snapshot.model.project, copiedId = plan.ids.get('card')!
  expect(snapshot.undoDepth).toBe(1)
  expect(next.surfaces[1].childIds).toEqual([copiedId])
  const copiedClick = interactionRules(next.instances['project-click']).find(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === copiedId)!
  expect(copiedClick.actions[0].action).toEqual({ type: 'scene.go', sceneId: plan.surfaceId })
  expect(interactionRules(next.instances['project-completed'])[1].trigger).toEqual({ type: 'animation.completed', actionId: copiedClick.actions[0].id })
  expect(interactionRules(next.instances['project-click']).filter(rule => rule.id === shared.id)).toEqual([shared])
  expect(next.instances.global.visibility?.surfaceIds).toEqual([surfaceId, plan.surfaceId])
  expect(project).toEqual(before)
})

it('ordinary click properties update the actual project behavior and reject split click programs', () => {
  const { project, surfaceId } = fixture()
  project.instances['project-completed'].data = data([])
  const target = { project, surfaceId, instanceId: 'card', activeStateId: null }
  expect(componentClickNavigationView(target).action).toEqual({ type: 'scene.go', sceneId: surfaceId })
  const edits = componentClickNavigationEdits(target, null)
  expect(edits).toHaveLength(1)
  expect(edits[0]).toMatchObject({ type: 'data.set', instanceId: 'project-click' })
  const next = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(interactionRules(next.instances['project-click']).map(rule => rule.id)).toEqual(['shared-event'])
  const pageClick: InteractionRule = { ...fixture().click, id: 'page-click' }
  const split = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId }, [pageClick])))
  expect(componentClickNavigationView({ ...target, project: split }).unavailableReason).toContain('多条')
  expect(() => componentClickNavigationEdits({ ...target, project: split }, null)).toThrow('多条')
})

it('copies owned event seeds and their state-only project completion chains through page and library paths', () => {
  const { project, surfaceId } = fixture()
  const event = (step: string): InteractionRule => ({ id: 'event', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
    actions: [{ id: step, start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] })
  const follower = (id: string, actionId: string): InteractionRule => ({ id, enabled: true, trigger: { type: 'animation.completed', actionId }, conditions: [],
    actions: [{ id: id + '-step', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] })
  project.instances.event = { id: 'event', definitionId: INTERACTIONS_DEFINITION.id, data: data([event('base-event-step')]),
    attachments: [{ instanceId: 'event', target: { kind: 'surface', surfaceId } }] }
  project.surfaces[0].childIds.push('event')
  project.surfaces[0].presentation = { states: [{ id: 'answer', title: 'Answer', overrides: { event: { data: data([event('state-event-step')]) } } }] }
  const originalFollowers = [follower('base-follower', 'base-event-step'), follower('state-follower', 'state-event-step')]
  project.instances.followers = { id: 'followers', definitionId: INTERACTIONS_DEFINITION.id, data: data(originalFollowers), attachments: [{ instanceId: 'followers', target: { kind: 'project' } }] }
  project.global.underlay.push('followers')
  const page = duplicateSurfaceEdits(project, surfaceId)
  const next = applyComponentOperation(project, captureComponentOperation(project, page.edits, page.readPaths))
  const copied = next.surfaces.find(surface => surface.id === page.surfaceId)!, state = copied.presentation!.states[0]
  const effective = resolveComponentPresentation(next, copied.id, state.id)
  const stateEvent = interactionRules(effective.instances[page.ids.get('event')!])[0]
  const followed = interactionRules(effective.instances.followers).filter(rule => !originalFollowers.some(original => original.id === rule.id))
  expect(followed).toHaveLength(1)
  expect(followed[0].trigger).toEqual({ type: 'animation.completed', actionId: stateEvent.actions[0].id })

  const extracted = extractComponentLibraryEntry(project, resources, { id: 'page-entry', title: 'Page', surfaceIds: [surfaceId], kind: 'page' }).entry
  expect(interactionRules(extracted.example.instances['project-click']).map(rule => rule.id)).toEqual(['click'])
  expect(interactionRules(extracted.example.instances.followers).map(rule => rule.id)).toEqual(['base-follower'])
  const destination = createBlankCourseProjectV10('Destination'), destinationId = destination.surfaces[0].id
  const insertion = prepareComponentLibraryInsertion(destination, extracted, { container: { kind: 'surface', surfaceId: destinationId }, index: 0 })
  const inserted = applyComponentOperation(destination, insertion.command), insertedPage = inserted.surfaces[1]
  const insertedState = resolveComponentPresentation(inserted, insertedPage.id, insertedPage.presentation!.states[0].id)
  const insertedEvent = interactionRules(insertedState.instances[insertion.identities.instances.get('event')!])[0]
  const insertedFollowers = interactionRules(insertedState.instances[insertion.identities.instances.get('followers')!])
  expect(insertedFollowers).toHaveLength(1)
  expect(insertedFollowers[0].trigger).toEqual({ type: 'animation.completed', actionId: insertedEvent.actions[0].id })
  expect(owningContainer(inserted, insertion.identities.instances.get('followers')!)).toEqual({ kind: 'global', plane: 'underlay' })
})

it('inserts an object library project program into the actual project owner', () => {
  const { project } = fixture()
  const entry = extractComponentLibraryEntry(project, resources, { id: 'objects', title: 'Card', rootIds: ['card'] }).entry
  const destination = createBlankCourseProjectV10('Destination')
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: destination.surfaces[0].id }, index: 0 })
  const inserted = applyComponentOperation(destination, insertion.command)
  expect(owningContainer(inserted, insertion.identities.instances.get('project-click')!)).toEqual({ kind: 'global', plane: 'underlay' })
  expect(owningContainer(inserted, insertion.identities.instances.get('card')!)).toEqual({ kind: 'surface', surfaceId: destination.surfaces[0].id })
})

it('keeps an object-owned click program attached to its copied object', () => {
  const { project, surfaceId } = fixture()
  project.instances['project-click'].attachments = [{ instanceId: 'project-click', target: { kind: 'instance', instanceId: 'card' } }]
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, resources, roots: ['card'] }, {
    capturedTarget: { documentId: 'doc', project, resources, surfaceId }, container: { kind: 'surface', surfaceId }, index: 1,
  })
  const next = applyComponentOperation(project, captureComponentOperation(project, plan.edits, plan.readPaths))
  const family = associatedComponentInteractionRules(next, new Set([plan.idMap.get('card')!])).find(value => value.rules.some(rule => rule.trigger.type === 'node.click'))!
  expect(family.target).toEqual({ kind: 'instance', instanceId: plan.idMap.get('card') })
})

it('keeps broken unrelated programs local and protects actual owner and named-state reads', () => {
  const { project, surfaceId } = fixture()
  project.instances['project-completed'].data = data([])
  project.instances.broken = { id: 'broken', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: 'unfinished' } }
  project.global.underlay.push('broken')
  expect(componentClickNavigationView({ project, surfaceId, instanceId: 'card', activeStateId: null }).action).toEqual({ type: 'scene.go', sceneId: surfaceId })
  expect(componentClickNavigationView({ project, surfaceId, instanceId: 'card', activeStateId: 'answer' }).unavailableReason).toContain('命名状态')
  const plan = duplicateSurfaceEdits(project, surfaceId)
  const changedOwner = structuredClone(project)
  changedOwner.instances['project-click'].attachments = [{ instanceId: 'project-click', target: { kind: 'surface', surfaceId } }]
  expect(() => applyComponentOperation(changedOwner, captureComponentOperation(project, plan.edits, plan.readPaths))).toThrow()
})

it('restores a cut object and its external cross-owner family with the original identities', () => {
  const { project, surfaceId, completed } = fixture()
  project.instances['project-completed'].data = data([{ ...completed, actions: [{ ...completed.actions[0], action: { type: 'scene.next' } }] }])
  const cut = applyComponentOperation(project, captureComponentOperation(project, [{ type: 'instance.remove', instanceId: 'card' }]))
  expect(interactionRules(cut.instances['project-click']).map(rule => rule.id)).toEqual(['shared-event'])
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, resources, roots: ['card'] }, {
    capturedTarget: { documentId: 'doc', project: cut, resources, surfaceId }, container: { kind: 'surface', surfaceId }, index: 0, identity: 'move',
  })
  const next = applyComponentOperation(cut, captureComponentOperation(cut, plan.edits, plan.readPaths))
  expect(plan.idMap.get('card')).toBe('card')
  expect(interactionRules(next.instances['project-click']).find(rule => rule.id === 'click')?.actions[0].id).toBe('jump')
  expect(interactionRules(next.instances['project-completed']).map(rule => rule.id)).toEqual(['completed'])
})
