// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { coursePresentationEdits } from '../../src/core/tools/coursePresentationEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { defaultShapeData } from '../../src/components/shape/data'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver()
function fixture() {
  let project = createBlankCourseProjectV10('States'), surfaceId = project.surfaces[0].id
  project.definitions.shape = { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'guoling.shape' } }
  project.instances.shape = { id: 'shape', definitionId: 'shape', data: defaultShapeData(), frame: { width: 100, height: 60, transform: [1, 0, 0, 1, 20, 30] } }
  project.surfaces[0].childIds = ['shape']
  project.surfaces[0].presentation = { initialStateId: 'a', thumbnailStateId: 'a', states: [
    { id: 'a', title: 'A', overrides: { shape: { style: { opacity: .4 } } } }, { id: 'b', title: 'B', overrides: {} },
  ] }
  project.surfaces.push({ id: 'other', kind: 'slide', title: 'Other', childIds: [], presentation: { states: [{ id: 'other-a', title: 'Other A', overrides: {} }] } })
  const rule = { id: 'state-enter', name: 'State enter', enabled: true, trigger: { type: 'presentation.enter' as const, stateId: 'a' }, conditions: [],
    actions: [{ id: 'state-enter-action', start: 'after-previous' as const, delayMs: 0, action: { type: 'presentation.set' as const, stateId: 'b' } }] }
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId }, [rule])))
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'project' }, [{ id: 'external-state', name: 'Go', enabled: true,
    trigger: { type: 'presenter.command', command: 'next' }, conditions: [], actions: [{ id: 'external-action', start: 'after-previous', delayMs: 0,
      action: { type: 'scene.go', sceneId: surfaceId, targetStateId: 'a' } }] }])))
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.original = { id: 'original', path: 'assets/original.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  return { kind: 'course-v10' as const, project, resources: { assets: { original: bytes }, components: {} } }
}
async function harness(stateOnly = false) {
  const model = fixture(), surfaceId = model.project.surfaces[0].id
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No physical save requested') } } })
  const session = await registry.create(model, 'states.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'course-surface', surfaceId, ...(stateOnly ? { stateId: 'a' } : {}) }] }] })
  return { model, surfaceId, session, gateway,
    project: () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current.project },
    issue: (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }),
    page: (stateId?: string) => gateway.issueTarget('r', session.documentId, { kind: 'course-surface', surfaceId, ...(stateId ? { stateId } : {}) }),
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }),
    undo: async (operationId = 'undo') => { const s = session.read(); expect(await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId, actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }

it('renames, creates and selects a named state in one History, then duplicates exact overrides through whole-page authority with archive reopen and Undo', async () => {
  const f = await harness(), target = await f.page()
  applied(await f.invoke('states', 'batch', { operations: [
    { name: 'presentation.update', input: { target, action: 'rename', state: 'a', title: '  Renamed  ' } },
    { name: 'presentation.update', input: { target, action: 'add', title: 'New' } },
    { name: 'presentation.update', input: { target, action: 'set-initial', state: 'b' } },
  ] }))
  expect(f.project().surfaces[0].presentation).toMatchObject({ initialStateId: 'b', states: [{ title: 'Renamed' }, { title: 'B' }, { title: 'New' }] })
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(f.model.resources)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(f.model.project.surfaces)
  applied(await f.invoke('duplicate', 'presentation.update', { target: await f.page(), action: 'duplicate', state: 'a' }))
  const states = f.project().surfaces[0].presentation!.states
  expect(states.map(state => state.title)).toEqual(['A', 'A 副本', 'B'])
  expect(states[1].id).not.toBe('a'); expect(states[1].overrides).toEqual(states[0].overrides)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo('undo-duplicate'); expect(f.project().surfaces).toEqual(f.model.project.surfaces)
})

it('deletes state references and resets initial/thumbnail to the base, rejects invalid batches, and reverses all derived changes', async () => {
  const f = await harness(), before = f.session.read()
  applied(await f.invoke('delete-a', 'presentation.update', { target: await f.page(), action: 'delete', state: 'a' }))
  expect(f.project().surfaces[0].presentation).toMatchObject({ initialStateId: null, thumbnailStateId: null, states: [{ id: 'b' }] })
  expect(interactionRules(interactionBehavior(f.project(), { kind: 'surface', surfaceId: f.surfaceId }))).toEqual([])
  expect(interactionRules(interactionBehavior(f.project(), { kind: 'project' }))[0].actions[0].action).not.toHaveProperty('targetStateId')
  const deleted = f.session.read(), target = await f.page()
  expect(await f.invoke('bad-batch', 'batch', { operations: [
    { name: 'presentation.update', input: { target, action: 'rename', state: 'b', title: 'Uncommitted' } },
    { name: 'presentation.update', input: { target, action: 'delete', state: 'missing' } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(deleted)
  applied(await f.invoke('return-to-base', 'presentation.update', { target: await f.page(), action: 'delete', state: 'b' }))
  expect(f.project().surfaces[0].presentation!.states).toEqual([])
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo('undo-last-state'); expect(f.project().surfaces[0].presentation!.states[0].id).toBe('b')
  await f.undo(); expect(f.project().surfaces).toEqual(f.model.project.surfaces); expect(f.project().instances).toEqual(f.model.project.instances); expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('matches the shared rename planner, preserves unrelated page edits and rejects stale, readonly and state-only management authority', async () => {
  const f = await harness(), target = await f.page(), before = f.session.read()
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-other-page', actor: 'human', baseRevision: before.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.project(), [{ type: 'surface.title.set', surfaceId: 'other', title: 'Human other page' }]) } })).toMatchObject({ status: 'applied' })
  const manual = applyComponentOperation(f.project(), captureComponentOperation(f.project(), coursePresentationEdits(f.project(), { kind: 'course-surface', surfaceId: f.surfaceId }, { action: 'rename', state: 'a', title: 'Same manual' })))
  applied(await f.invoke('rename', 'presentation.update', { target, action: 'rename', state: 'a', title: 'Same manual' }))
  expect(f.project().surfaces).toEqual(manual.surfaces)
  const acknowledged = f.session.read()
  expect(await f.session.execute({ documentId: acknowledged.documentId, epoch: acknowledged.epoch, operationId: 'human-same-state', actor: 'human', baseRevision: acknowledged.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.project(), coursePresentationEdits(f.project(), { kind: 'course-surface', surfaceId: f.surfaceId }, { action: 'rename', state: 'a', title: 'Concurrent human A' })) } })).toMatchObject({ status: 'applied' })
  const renamed = f.session.read()
  expect(await f.invoke('stale', 'presentation.update', { target, action: 'rename', state: 'a', title: 'Lost update' })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(await f.invoke('blank', 'presentation.update', { target: await f.page(), action: 'rename', state: 'a', title: '   ' })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await f.invoke('readonly', 'presentation.update', { target: await f.issue({ kind: 'course-surface', surfaceId: f.surfaceId }, true), action: 'duplicate', state: 'a' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read()).toEqual(renamed)
  const local = await harness(true), original = local.session.read()
  expect(await local.invoke('whole-page-escape', 'presentation.update', { target: await local.page(), action: 'duplicate', state: 'a' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await local.invoke('state-handle-escape', 'presentation.update', { target: await local.page('a'), action: 'duplicate', state: 'a' })).toMatchObject({ kind: 'error' })
  expect(local.session.read()).toEqual(original)
})
