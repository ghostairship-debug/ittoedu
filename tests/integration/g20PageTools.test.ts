// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTableData } from '../../src/components/table/data'
import { createChartData } from '../../src/components/chart/data'
import { createInputData, inputDataSchema } from '../../src/components/input/data'
import { defaultShapeData } from '../../src/components/shape/data'
import { inspectComponentInputRules } from '../../src/components/input/authoring'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { PublishedInteractionController } from '../../src/player/interactions/PublishedInteractionController'
import { CourseStateStore } from '../../src/player/CourseStateStore'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver(), roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function harness(scope?: ToolTarget[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-pages-')); roots.push(root)
  const project = createBlankCourseProjectV10('Pages'), surfaceId = project.surfaces[0].id
  for (const key of ['shape', 'table', 'chart', 'input']) project.definitions[key] = { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }
  for (const [id, data] of [['table', createTableData()], ['chart', createChartData()], ['input', createInputData({ acceptedAnswers: ['42'] })], ['feedback', defaultShapeData()]] as const) {
    project.instances[id] = { id, definitionId: id === 'feedback' ? 'shape' : id, data: JSON.parse(JSON.stringify(data)), frame: { width: 200, height: 120, transform: [1, 0, 0, 1, 100, 200] } }
    project.surfaces[0].childIds.push(id)
  }
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.original = { id: 'original', path: 'assets/original.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  const model = { kind: 'course-v10' as const, project, resources: { assets: { original: bytes }, components: {} } }, filename = path.join(root, 'pages.glx')
  await fs.writeFile(filename, driver.serialize(model))
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(filename), session = host.registry.get(opened.documentId)
  await host.tools.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: opened.documentId, writable: scope ?? [{ kind: 'document' }] }] })
  const current = () => { const next = session.read().model; if (next.kind !== 'course-v10') throw new Error('Expected V10'); return next }
  return { root, filename, model, surfaceId, host, session, current,
    issue: (target: ToolTarget, readOnly = false) => host.tools.issueTarget('r', session.documentId, target, { readOnly }),
    page: (id = surfaceId) => host.tools.issueTarget('r', session.documentId, { kind: 'course-surface', surfaceId: id }),
    invoke: (name: string, input: unknown) => host.tools.execute('r', randomUUID(), { name, input }),
    list: async () => { const result = await host.tools.execute('r', randomUUID(), { name: 'project.list', input: {} }); expect(result.kind).toBe('read'); if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data as { files: { path: string; type: string }[] } },
    reopen: async () => { await host.internalAPI.save(session.documentId); return (await new DocumentHostService(path.join(root, 'reopen')).open(filename)).model },
    undo: async () => { const before = session.read(); expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }
function committed(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } }) }
async function pagePaths(f: Awaited<ReturnType<typeof harness>>) { return (await f.list()).files.filter(file => file.type === 'structure').map(file => file.path) }

it('creates all three formal page kinds and batches page settings with original resources, save/reopen and reversible history', async () => {
  const f = await harness(), before = f.session.read()
  await f.list()
  for (const kind of ['slide', 'flow', 'spatial']) { committed(await f.invoke('project.apply', { path: 'pages', intent: 'surface.add', kind, title: `New ${kind}` })); await f.list() }
  expect(f.current().project.surfaces.map(surface => surface.kind)).toEqual(['slide', 'slide', 'flow', 'spatial'])
  expect(f.session.read().undoDepth).toBe(3)
  const created = f.current().project.surfaces.slice(1), settingsBefore = f.session.read()
  applied(await f.invoke('batch', { operations: await Promise.all(created.map(async surface => ({ name: 'surface.configure', input: { target: await f.page(surface.id), settings: { title: `Edited ${surface.kind}` } } }))) }))
  expect(f.session.read().undoDepth).toBe(4); expect(f.current().resources).toEqual(before.model.resources)
  expect(await f.reopen()).toEqual(f.current())
  await f.undo(); expect(f.current().project.surfaces).toEqual(settingsBefore.model.kind === 'course-v10' ? settingsBefore.model.project.surfaces : [])
  for (let n = 0; n < 3; n++) await f.undo()
  expect(f.current().project.surfaces).toEqual(f.model.project.surfaces); expect(f.current().project.instances).toEqual(f.model.project.instances); expect(f.current().resources).toEqual(f.model.resources)
})

it('duplicates a page with independent managed input/rule identities and functioning Published judgement in one History while preserving professional data', async () => {
  const f = await harness(), motion = (show: boolean) => ({ type: show ? 'node.enter' as const : 'node.exit' as const, nodeId: 'feedback', effect: 'none' as const, durationMs: 0, easing: 'linear' as const })
  applied(await f.invoke('object.author', { target: await f.issue({ kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'input' }), change: { kind: 'input-rules', request: { mode: 'apply', config: { answerType: 'text', answers: ['42'], correct: [motion(true)], error: [motion(false)] } } } }))
  const before = f.session.read(), prior = f.current(), source = prior.project.surfaces[0]
  applied(await f.invoke('surface.duplicate', { target: await f.page() }))
  const after = f.current(), copy = after.project.surfaces[1]
  expect(copy.id).not.toBe(source.id); expect(copy.childIds.every(id => !source.childIds.includes(id))).toBe(true)
  for (const key of ['table', 'chart']) {
    const instance = copy.childIds.map(id => after.project.instances[id]).find(instance => instance.definitionId === key)!
    expect(instance.data).toEqual(prior.project.instances[key].data); expect(instance.frame).toEqual(prior.project.instances[key].frame)
  }
  const input = copy.childIds.map(id => after.project.instances[id]).find(instance => instance.definitionId === 'input')!, data = inputDataSchema.parse(input.data), original = inputDataSchema.parse(prior.project.instances.input.data)
  expect(data.answer!.stateKey).not.toBe(original.answer!.stateKey); expect(data.answer!.validityKey).not.toBe(original.answer!.validityKey)
  const family = inspectComponentInputRules(after.project, copy.id, input.id).config!; expect(family).toBeTruthy()
  const published = await buildPublishedCourseV3({ project: after.project, assetBytes: after.resources.assets, componentFiles: after.resources.components })
  const rules = interactionRules(interactionBehavior(after.project, { kind: 'surface', surfaceId: copy.id }))
  const behavior = interactionBehavior(after.project, { kind: 'surface', surfaceId: copy.id })!
  expect(published.payload.instances[behavior.id].data).toEqual({ rules })
  expect(data.answer!.ruleFamilyRuleIds.every(id => rules.some(rule => rule.id === id))).toBe(true)
  const state = new CourseStateStore(), motions: { type: string; nodeId: string }[] = []; let submit: ((value: string) => void) | undefined
  const controller = new PublishedInteractionController({ surfaceId: copy.id, rules,
    surface: { bindNodeClick: () => null, executeNodeMotion: action => { motions.push(action); return true }, describeInput: instanceId => instanceId === input.id ? { answerType: data.answer!.type, stateKey: data.answer!.stateKey, validityKey: data.answer!.validityKey, defaultValue: '' } : null,
      bindInputSubmit: (_id, listener) => { submit = listener; return () => { submit = undefined } } },
    session: { courseState: state, setCourseStateBatch: entries => state.setMany(entries), currentSceneId: () => copy.id, goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false } })
  try { expect(submit).toBeTypeOf('function'); submit!('wrong'); await vi.waitFor(() => expect(motions).toEqual(family.error.map(action => expect.objectContaining(action))))
    expect(state.get(data.answer!.validityKey)).toBe(true); expect(state.get(data.answer!.stateKey)).toBe('wrong'); expect(state.get(original.answer!.stateKey)).toBeUndefined() } finally { controller.destroy() }
  expect(f.session.read().undoDepth).toBe(before.undoDepth + 1); expect(after.resources).toEqual(prior.resources); expect(await f.reopen()).toEqual(after)
  await f.undo(); expect(f.current().project.surfaces).toEqual(prior.project.surfaces); expect(f.current().project.instances).toEqual(prior.project.instances); expect(f.current().project.logic).toEqual(prior.project.logic)
})

it('moves and renames exact pages with stable identities, deletes the selected page and reverses order/content/resource changes', async () => {
  const f = await harness(); await f.list()
  committed(await f.invoke('project.apply', { path: 'pages', intent: 'surface.add', kind: 'flow', title: 'Destination' })); await f.list()
  committed(await f.invoke('project.apply', { path: 'pages', intent: 'surface.add', kind: 'spatial', title: 'Unrelated' }))
  const before = f.current(), paths = await pagePaths(f), title = '命名'.repeat(100)
  committed(await f.invoke('project.apply', { path: paths[0], intent: 'surface.move' }))
  expect(f.current().project.surfaces.map(surface => surface.id)).toEqual([before.project.surfaces[1].id, before.project.surfaces[2].id, f.surfaceId])
  const reordered = await pagePaths(f), sourcePath = reordered[2]
  committed(await f.invoke('project.apply', { path: sourcePath, intent: 'surface.title', title: ` ${title} ` }))
  expect(f.current().project.surfaces[2].title).toBe(title)
  expect(f.current().project.surfaces[2].id).toBe(f.surfaceId); expect(f.current().project.instances).toEqual(before.project.instances); expect(f.current().resources).toEqual(before.resources)
  await pagePaths(f)
  const titled = f.current(), fresh = (await pagePaths(f))[2]
  committed(await f.invoke('project.apply', { path: fresh, intent: 'surface.remove' }))
  expect(f.current().project.surfaces.map(surface => surface.id)).toEqual(before.project.surfaces.slice(1).map(surface => surface.id))
  expect(f.current().project.instances.table).toBeUndefined(); expect(f.current().resources).toEqual(before.resources); expect(await f.reopen()).toEqual(f.current())
  await f.undo(); expect(f.current().project.surfaces).toEqual(titled.project.surfaces); expect(f.current().project.instances).toEqual(titled.project.instances)
  await f.undo(); await f.undo(); expect(f.current().project.surfaces).toEqual(before.project.surfaces); expect(f.current().project.instances).toEqual(before.project.instances)
})

it('rejects last-page removal, readonly destinations, stale destructive targets and failed batches without widening authority or partial writes', async () => {
  const f = await harness(); await f.list(); const only = (await pagePaths(f))[0], before = f.session.read()
  expect(await f.invoke('project.apply', { path: only, intent: 'surface.remove' })).toMatchObject({ kind: 'read', data: { commit: 'not_committed' } })
  expect(f.session.read()).toEqual(before)
  const readonly = await f.issue({ kind: 'course-surface', surfaceId: f.surfaceId }, true)
  expect(await f.invoke('surface.duplicate', { target: readonly })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('object.structure', { target: await f.issue({ kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'table' }), action: 'duplicate', destination: readonly })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const page = await f.page()
  expect(await f.invoke('batch', { operations: [
    { name: 'surface.configure', input: { target: page, settings: { title: 'Uncommitted' } } },
    { name: 'object.structure', input: { target: readonly, action: 'remove' } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(before)
  committed(await f.invoke('project.apply', { path: 'pages', intent: 'surface.add', kind: 'flow' })); const observed = await pagePaths(f), old = observed[0]
  const baseline = f.session.read()
  expect(await f.session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId: 'human-content', actor: 'human', baseRevision: baseline.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'surface.title.set', surfaceId: f.surfaceId, title: 'Human edit' }]) } })).toMatchObject({ status: 'applied' })
  const human = f.session.read()
  expect(await f.invoke('project.apply', { path: old, intent: 'surface.remove' })).toMatchObject({ kind: 'read', data: { commit: 'not_committed' } })
  expect(f.session.read()).toEqual(human)
  await f.host.tools.beginRun({ runId: 'limited', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'course-surface', surfaceId: f.surfaceId }] }] })
  const limited = await f.host.tools.issueTarget('limited', f.session.documentId, { kind: 'course-surface', surfaceId: f.surfaceId })
  expect(await f.host.tools.execute('limited', 'no-course-copy', { name: 'surface.duplicate', input: { target: limited } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read()).toEqual(human)
})
