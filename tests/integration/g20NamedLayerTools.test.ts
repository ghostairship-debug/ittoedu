// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { defaultShapeData } from '../../src/components/shape/data'
import { createImageData } from '../../src/components/image/data'
import { createTextComponentData } from '../../src/components/text/data'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform'
import type { ToolResult } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver()
async function harness() {
  let project = createBlankCourseProjectV10('Named layers'), surfaceId = project.surfaces[0].id
  for (const key of ['shape', 'text', 'image']) project.definitions[key] = { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }
  const frame = (x: number, y: number) => ({ width: 80, height: 40, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
  for (const [id, x, y] of [['a', 20, 30], ['b', 250, 100], ['c', 630, 200]] as const) project.instances[id] = { id, definitionId: 'shape', data: defaultShapeData(), frame: frame(x, y) }
  const fixed = { ...createTextComponentData('base text'), sizing: { mode: 'fixed' as const, minHeight: 0, overflow: 'clip' as const } }
  project.instances['fixed-text'] = { id: 'fixed-text', definitionId: 'text', data: JSON.parse(JSON.stringify(fixed)), frame: frame(100, 350) }
  project.instances['auto-text'] = { id: 'auto-text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('auto text'))), frame: frame(100, 430) }
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.image = { id: 'image', path: 'assets/image.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  project.instances.picture = { id: 'picture', definitionId: 'image', data: createImageData('image'), frame: frame(700, 300) }
  project.surfaces[0].childIds = ['a', 'b', 'c', 'fixed-text', 'auto-text', 'picture']
  project.surfaces[0].presentation = { initialStateId: 'state-a', states: [
    { id: 'state-a', title: 'A', overrides: { a: { frame: frame(60, 30) }, 'fixed-text': { data: { ...fixed, content: { inlines: [{ type: 'text', text: 'state A text' }] } } } } },
    { id: 'state-b', title: 'B', overrides: { a: { frame: frame(500, 30) } } },
  ] }
  project.surfaces[0].presentation!.states[0].overrides.picture = { data: { ...createImageData('image'), alt: 'A picture' }, frame: frame(760, 300) }
  project.surfaces[0].presentation!.states[1].overrides.picture = { data: { ...createImageData('image'), alt: 'B picture' }, frame: frame(920, 300) }
  project.surfaces.push({ id: 'foreign-page', kind: 'slide', title: 'Foreign page', childIds: [] })
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId }, [{ id: 'picture-click', enabled: true,
    name: 'Picture click', trigger: { type: 'node.click', nodeId: 'picture' }, conditions: [], actions: [{ id: 'next', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] }])))
  const model = { kind: 'course-v10' as const, project, resources: { assets: { image: bytes }, components: {} } }
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No physical save requested') } } })
  const session = await registry.create(model, 'named.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource })
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'course-surface', surfaceId, stateId: 'state-a' }] }] })
  const current = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected V10'); return value }
  return { model, surfaceId, session, gateway, current,
    object: (instanceId: string, stateId: string | null = 'state-a') => gateway.issueTarget('r', session.documentId, { kind: 'course-instance', surfaceId, instanceId, ...(stateId ? { stateId } : {}) }),
    page: () => gateway.issueTarget('r', session.documentId, { kind: 'course-surface', surfaceId, stateId: 'state-a' }),
    view: (stateId: string | null) => resolveComponentPresentation(current().project, surfaceId, stateId),
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }),
    undo: async (operationId = 'undo') => { const before = session.read(); expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId, actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }

it('duplicates a local interaction graph and lays out/reorders/hides only the named state with original resources and reversible history', async () => {
  const f = await harness(), before = f.session.read(), handles = await Promise.all(['a', 'b', 'c'].map(id => f.object(id)))
  applied(await f.invoke('state-batch', 'batch', { operations: [
    { name: 'object.structure', input: { target: await f.object('picture'), action: 'duplicate' } },
    { name: 'object.layout', input: { targets: handles, intent: { kind: 'align', alignment: 'top' } } },
    { name: 'object.layout', input: { targets: handles, intent: { kind: 'distribute', axis: 'horizontal' } } },
    { name: 'object.structure', input: { target: handles[0], action: 'reorder', direction: 'front' } },
    { name: 'object.update', input: { target: await f.object('picture'), properties: { visible: false } } },
  ] }))
  const after = f.current(), copy = Object.values(after.project.instances).find(instance => !f.model.project.instances[instance.id] && instance.definitionId === 'image')!
  expect(copy).toBeDefined(); expect(copy.id).not.toBe('picture')
  expect(f.view('state-a').instances[copy.id].data).toEqual(resolveComponentPresentation(f.model.project, f.surfaceId, 'state-a').instances.picture.data)
  expect(f.view('state-a').instances[copy.id].frame).toEqual({ width: 80, height: 40, transform: [1, 0, 0, 1, 780, 320] })
  expect(f.view('state-a').instances[copy.id].visible).toBe(true)
  expect(f.view('state-b').instances[copy.id].visible).toBe(false); expect(f.view(null).instances[copy.id].visible).toBe(false)
  expect(f.view('state-a').instances.picture.visible).toBe(false); expect(f.view(null).instances.picture).toEqual(f.model.project.instances.picture)
  const rules = interactionRules(interactionBehavior(f.view('state-a'), { kind: 'surface', surfaceId: f.surfaceId }))
  expect(rules.some(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === copy.id)).toBe(true)
  const frames = ['a', 'b', 'c'].map(id => f.view('state-a').instances[id].frame!)
  expect(new Set(frames.map(frame => frame.transform[5])).size).toBe(1)
  expect(frames[1].transform[4] - frames[0].transform[4] - frames[0].width).toBe(frames[2].transform[4] - frames[1].transform[4] - frames[1].width)
  expect(after.project.surfaces[0].presentation!.states[1]).toEqual(f.model.project.surfaces[0].presentation!.states[1])
  for (const [id, instance] of Object.entries(f.model.project.instances)) expect(after.project.instances[id]).toEqual(instance)
  expect(f.session.read().undoDepth).toBe(1); expect(after.resources).toEqual(before.model.resources); expect(driver.load(driver.serialize(after))).toEqual(after)
  applied(await f.invoke('remove-copy', 'object.structure', { target: await f.object(copy.id), action: 'remove' }))
  expect(f.current().project.instances[copy.id]).toBeUndefined(); expect(JSON.stringify(f.current().project)).not.toContain(copy.id)
  await f.undo('undo-copy-delete'); expect(f.view('state-a').instances[copy.id].visible).toBe(true)
  await f.undo(); expect(f.current().project.surfaces).toEqual(f.model.project.surfaces); expect(f.current().project.instances).toEqual(f.model.project.instances)
})

it('routes text, display, image and new component writes through named-state overrides without altering base or another state', async () => {
  const f = await harness(), before = f.session.read(), bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="blue"/></svg>')
  const resource = await f.gateway.provideImage('r', f.session.documentId, { filename: 'new.svg', mimeType: 'image/svg+xml', bytes })
  const result = await f.invoke('content', 'batch', { operations: [
    { name: 'text.replace', input: { target: await f.object('fixed-text'), content: 'new A text' } },
    { name: 'object.update', input: { target: await f.object('fixed-text'), properties: { style: { opacity: .4 } } } },
    { name: 'media.apply', input: { target: await f.object('picture'), resource } },
    { name: 'object.insert', input: { target: await f.page(), kind: 'shape', shapeType: 'rectangle' } },
  ] }); applied(result)
  expect(f.view('state-a').instances['fixed-text']).toMatchObject({ style: { opacity: .4 }, data: { content: { inlines: [{ type: 'text', text: 'new A text' }] } } })
  expect(f.view(null).instances['fixed-text']).toEqual(f.model.project.instances['fixed-text']); expect(f.view('state-b').instances['fixed-text']).toEqual(f.model.project.instances['fixed-text'])
  const image = f.view('state-a').instances.picture.data as { assetId: string }
  expect(image.assetId).not.toBe('image'); expect(f.current().resources.assets[image.assetId]).toEqual(bytes)
  expect(f.view(null).instances.picture).toEqual(f.model.project.instances.picture); expect(f.view('state-b').instances.picture).toEqual(resolveComponentPresentation(f.model.project, f.surfaceId, 'state-b').instances.picture)
  const newObject = Object.values(f.current().project.instances).find(instance => !f.model.project.instances[instance.id])!
  expect(f.view('state-a').instances[newObject.id].visible).toBe(true); expect(f.view(null).instances[newObject.id].visible).toBe(false)
  expect(f.session.read().undoDepth).toBe(1); expect(Object.keys(f.current().resources.assets)).toHaveLength(2); expect(driver.load(driver.serialize(f.current()))).toEqual(f.current())
  await f.undo(); expect(f.current().project.surfaces).toEqual(f.model.project.surfaces); expect(f.current().project.instances).toEqual(f.model.project.instances); expect(f.current().resources).toEqual(before.model.resources)
})

it('rejects base/other-state authority and stale concurrent overrides with zero partial writes while preserving a disjoint state edit', async () => {
  const f = await harness(), text = await f.object('fixed-text'), before = f.session.read()
  for (const stateId of [null, 'state-b']) expect(await f.invoke(`scope-${stateId}`, 'text.replace', { target: await f.object('fixed-text', stateId), content: 'wrong' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  await expect(f.object('fixed-text', 'missing-state')).rejects.toThrow()
  for (const [surfaceId, stateId] of [[f.surfaceId, undefined], [f.surfaceId, 'state-b'], ['foreign-page', undefined]] as const) {
    const destination = await f.gateway.issueTarget('r', f.session.documentId, { kind: 'course-surface', surfaceId, ...(stateId ? { stateId } : {}) })
    expect(await f.invoke(`duplicate-escape-${surfaceId}-${stateId}`, 'object.structure', { target: await f.object('picture'), action: 'duplicate', destination })).toMatchObject({ kind: 'error' })
  }
  await f.gateway.beginRun({ runId: 'whole', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'document' }] }] })
  for (const [sourceState, destinationState] of [[undefined, 'state-a'], ['state-a', undefined], ['state-a', 'state-b']] as const) {
    const source = await f.gateway.issueTarget('whole', f.session.documentId, { kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'picture', ...(sourceState ? { stateId: sourceState } : {}) })
    const destination = await f.gateway.issueTarget('whole', f.session.documentId, { kind: 'course-surface', surfaceId: f.surfaceId, ...(destinationState ? { stateId: destinationState } : {}) })
    expect(await f.gateway.execute('whole', `state-mismatch-${sourceState}-${destinationState}`, { name: 'object.structure', input: { target: source, action: 'duplicate', destination } })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  }
  expect(f.session.read()).toEqual(before)
  expect(await f.invoke('invalid-batch', 'batch', { operations: [
    { name: 'text.replace', input: { target: text, content: 'Uncommitted' } },
    { name: 'object.update', input: { target: await f.object('picture', 'state-b'), properties: { visible: false } } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(before)
  const presentation = structuredClone(f.current().project.surfaces[0].presentation!)
  presentation.states[1].overrides['fixed-text'] = { style: { opacity: .7 } }
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-B', actor: 'human', baseRevision: before.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'surface.presentation.set', surfaceId: f.surfaceId, presentation }]) } })).toMatchObject({ status: 'applied' })
  applied(await f.invoke('disjoint', 'text.replace', { target: text, content: 'A after human B' }))
  expect(f.view('state-b').instances['fixed-text'].style).toEqual({ opacity: .7 })
  const current = f.session.read(), state = structuredClone(f.current().project.surfaces[0].presentation!)
  state.states[0].overrides['fixed-text'].data = JSON.parse(JSON.stringify({ ...createTextComponentData('Concurrent human A'), sizing: { mode: 'fixed', minHeight: 0, overflow: 'clip' } }))
  expect(await f.session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'human-A', actor: 'human', baseRevision: current.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'surface.presentation.set', surfaceId: f.surfaceId, presentation: state }]) } })).toMatchObject({ status: 'applied' })
  const concurrent = f.session.read()
  expect(await f.invoke('stale', 'text.replace', { target: text, content: 'Lost update' })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read()).toEqual(concurrent)
})
